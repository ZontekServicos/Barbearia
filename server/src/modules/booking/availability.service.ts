import { prisma } from "../../config/prisma.js"
import {
  addDaysToShopDate,
  instantToShopDate,
  intervalsOverlap,
  minutesToClock,
  shopWallClockToInstant,
} from "../../utils/time.js"
import { BookingRules } from "./booking.rules.js"
import { getBookableService } from "./catalog.service.js"
import { findBlocksOverlapping, getDayWindow } from "./schedule.service.js"

export interface AvailableSlot {
  /** "09:00" — hora local da barbearia. */
  startsAtClock: string
  endsAtClock: string
  /** Instante absoluto, para o cliente não precisar recalcular fuso. */
  startsAt: string
  endsAt: string
}

export interface AvailabilityResult {
  date: string
  serviceId: string
  serviceName: string
  durationMinutes: number
  open: boolean
  slots: AvailableSlot[]
  /** Por que não há horários, quando a lista vem vazia. */
  reason: "CLOSED" | "PAST_DATE" | "TOO_FAR" | "FULLY_BOOKED" | null
}

/**
 * Calcula os horários livres de um dia.
 *
 * Deriva tudo do estado atual — expediente, bloqueios, agendamentos, regras de
 * antecedência — e não persiste nada. Slots calculados não viram linha no
 * banco: seriam cache que envelhece e passa a mentir.
 *
 * Importante: isto é conveniência de UI. A garantia real de que o horário está
 * livre é a EXCLUDE constraint no momento da reserva, porque entre listar e
 * reservar alguém pode ter agendado.
 */
export async function getAvailability(
  dateISO: string,
  serviceId: string,
  now: Date = new Date(),
): Promise<AvailabilityResult> {
  const service = await getBookableService(serviceId)

  const base: Omit<AvailabilityResult, "slots" | "open" | "reason"> = {
    date: dateISO,
    serviceId: service.id,
    serviceName: service.name,
    durationMinutes: service.durationMinutes,
  }

  const today = instantToShopDate(now)
  if (dateISO < today) {
    return { ...base, open: false, slots: [], reason: "PAST_DATE" }
  }

  const lastBookableDate = addDaysToShopDate(today, BookingRules.maximumAdvanceDays)
  if (dateISO > lastBookableDate) {
    return { ...base, open: false, slots: [], reason: "TOO_FAR" }
  }

  const window = await getDayWindow(dateISO)
  if (!window) {
    return { ...base, open: false, slots: [], reason: "CLOSED" }
  }

  const dayStart = shopWallClockToInstant(dateISO, 0)
  const dayEnd = shopWallClockToInstant(addDaysToShopDate(dateISO, 1), 0)

  // Um atendimento pode ter começado no dia anterior e invadir a manhã, então
  // buscamos por sobreposição de intervalo e não por "starts_at neste dia".
  const [appointments, blocks] = await Promise.all([
    prisma.appointment.findMany({
      where: { status: "CONFIRMED", startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
      select: { startsAt: true, endsAt: true },
    }),
    findBlocksOverlapping(dayStart, dayEnd),
  ])

  const busy = [...appointments, ...blocks]

  // Intervalo (almoço) é tratado como indisponibilidade fixa do dia.
  if (window.breakStartMinute !== null && window.breakEndMinute !== null) {
    busy.push({
      startsAt: shopWallClockToInstant(dateISO, window.breakStartMinute),
      endsAt: shopWallClockToInstant(dateISO, window.breakEndMinute),
    })
  }

  const earliestStart = new Date(now.getTime() + BookingRules.minimumAdvanceMinutes * 60_000)
  const slots: AvailableSlot[] = []

  for (
    let minute = window.openMinute;
    minute + service.durationMinutes <= window.closeMinute;
    minute += BookingRules.slotIntervalMinutes
  ) {
    const startsAt = shopWallClockToInstant(dateISO, minute)
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000)

    if (startsAt.getTime() < earliestStart.getTime()) continue

    const conflicts = busy.some(entry =>
      intervalsOverlap(startsAt, endsAt, entry.startsAt, entry.endsAt),
    )
    if (conflicts) continue

    slots.push({
      startsAtClock: minutesToClock(minute),
      endsAtClock: minutesToClock(minute + service.durationMinutes),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    })
  }

  return {
    ...base,
    open: true,
    slots,
    reason: slots.length === 0 ? "FULLY_BOOKED" : null,
  }
}
