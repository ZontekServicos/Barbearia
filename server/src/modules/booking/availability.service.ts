import { prisma } from "../../config/prisma.js"
import {
  addDaysToShopDate,
  instantToShopDate,
  minutesToClock,
  parseShopDate,
  shopWallClockToInstant,
} from "../../utils/time.js"
import { BookingRules } from "./booking.rules.js"
import { getBookableService } from "./catalog.service.js"
import { findBlocksOverlapping, getDayWindow } from "./schedule.service.js"
import {
  computeSlotStarts,
  windowsFromBusinessHours,
  type BusyInterval,
  type OpenWindow,
} from "./availability.engine.js"

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
  /**
   * De quanto em quanto tempo os inícios são sugeridos. Vai na resposta de
   * propósito: é a forma mais rápida de conferir, pelo DevTools, qual grade o
   * servidor que está no ar realmente usa.
   */
  slotIntervalMinutes: number
  open: boolean
  /** Janelas de atendimento do dia, em hora local ("09:00"–"12:00"). */
  windows: Array<{ opensAt: string; closesAt: string }>
  slots: AvailableSlot[]
  /** Por que não há horários, quando a lista vem vazia. */
  reason: "CLOSED" | "PAST_DATE" | "TOO_FAR" | "FULLY_BOOKED" | null
}

/** Status que realmente ocupam a cadeira. Cancelado e falta liberam o horário. */
const BLOCKING_STATUSES = ["CONFIRMED"] as const

/**
 * Converte um período absoluto para o eixo de minutos do dia consultado.
 *
 * Pode devolver valores negativos ou acima de 1440 quando o período começa no
 * dia anterior ou termina no seguinte. Isso é proposital: a engine compara
 * intervalos no eixo estendido, e clampar inventaria conflitos.
 */
function toDayMinutes(dayStart: Date, startsAt: Date, endsAt: Date): BusyInterval {
  return {
    startMinute: (startsAt.getTime() - dayStart.getTime()) / 60_000,
    endMinute: (endsAt.getTime() - dayStart.getTime()) / 60_000,
  }
}

/**
 * Calcula os horários livres de um dia para um serviço específico.
 *
 * A duração vem SEMPRE do banco, nunca do cliente: o frontend manda apenas
 * `serviceId`. Trocar a duração de um serviço no painel muda a disponibilidade
 * na consulta seguinte, sem tocar em agendamentos já feitos — eles guardam o
 * próprio `startsAt`/`endsAt`.
 *
 * Nada é persistido. Slots calculados não viram linha no banco: seriam cache
 * que envelhece e passa a mentir. E isto é conveniência de UI — a garantia
 * real de que o horário está livre é a EXCLUDE constraint no momento da
 * reserva, porque entre listar e reservar alguém pode ter agendado.
 */
export async function getAvailability(
  dateISO: string,
  serviceId: string,
  now: Date = new Date(),
): Promise<AvailabilityResult> {
  // Uma data inexistente deve ser 400 mesmo que pareça passada ou distante.
  parseShopDate(dateISO)
  const service = await getBookableService(serviceId)

  const base = {
    date: dateISO,
    serviceId: service.id,
    serviceName: service.name,
    durationMinutes: service.durationMinutes,
    slotIntervalMinutes: BookingRules.slotIntervalMinutes,
  }
  const closed = (reason: AvailabilityResult["reason"]): AvailabilityResult => ({
    ...base,
    open: false,
    windows: [],
    slots: [],
    reason,
  })

  const today = instantToShopDate(now)
  if (dateISO < today) return closed("PAST_DATE")

  const lastBookableDate = addDaysToShopDate(today, BookingRules.maximumAdvanceDays)
  if (dateISO > lastBookableDate) return closed("TOO_FAR")

  const day = await getDayWindow(dateISO)
  if (!day) return closed("CLOSED")

  const windows: OpenWindow[] = windowsFromBusinessHours(day)
  if (windows.length === 0) return closed("CLOSED")

  const dayStart = shopWallClockToInstant(dateISO, 0)
  const dayEnd = shopWallClockToInstant(addDaysToShopDate(dateISO, 1), 0)

  // Um atendimento pode ter começado no dia anterior e invadir a manhã, então
  // buscamos por sobreposição de intervalo e não por "starts_at neste dia".
  const [appointments, blocks] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        status: { in: [...BLOCKING_STATUSES] },
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
      },
      select: {
        startsAt: true,
        endsAt: true,
        bufferBeforeMinutes: true,
        bufferAfterMinutes: true,
      },
    }),
    findBlocksOverlapping(dayStart, dayEnd),
  ])

  const busy: BusyInterval[] = [
    // Cada reserva ocupa a própria duração mais os buffers congelados nela.
    ...appointments.map(appointment => {
      const range = toDayMinutes(dayStart, appointment.startsAt, appointment.endsAt)
      return {
        startMinute: range.startMinute - appointment.bufferBeforeMinutes,
        endMinute: range.endMinute + appointment.bufferAfterMinutes,
      }
    }),
    // Bloqueio administrativo ocupa exatamente o que o barbeiro marcou.
    ...blocks.map(block => toDayMinutes(dayStart, block.startsAt, block.endsAt)),
  ]

  // Antecedência mínima, convertida para o eixo do dia. Quem manda é o relógio
  // do servidor no fuso da barbearia, nunca o do navegador.
  const earliestStartMinute = Math.ceil(
    (now.getTime() + BookingRules.minimumAdvanceMinutes * 60_000 - dayStart.getTime()) / 60_000,
  )

  const starts = computeSlotStarts({
    windows,
    busy,
    durationMinutes: service.durationMinutes,
    slotIntervalMinutes: BookingRules.slotIntervalMinutes,
    bufferBeforeMinutes: service.bufferBeforeMinutes,
    bufferAfterMinutes: service.bufferAfterMinutes,
    earliestStartMinute,
  })

  const slots: AvailableSlot[] = starts.map(startMinute => {
    const startsAt = shopWallClockToInstant(dateISO, startMinute)
    return {
      startsAtClock: minutesToClock(startMinute),
      endsAtClock: minutesToClock(startMinute + service.durationMinutes),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + service.durationMinutes * 60_000).toISOString(),
    }
  })

  return {
    ...base,
    open: true,
    windows: windows.map(window => ({
      opensAt: minutesToClock(window.startMinute),
      closesAt: minutesToClock(window.endMinute),
    })),
    slots,
    reason: slots.length === 0 ? "FULLY_BOOKED" : null,
  }
}
