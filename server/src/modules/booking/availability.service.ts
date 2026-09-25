import { prisma } from "../../config/prisma.js"
import {
  addDaysToShopDate,
  instantToShopDate,
  minutesToClock,
  parseShopDate,
  shopWallClockToInstant,
} from "../../utils/time.js"
import { BookingRules, reservedMinutesFor } from "./booking.rules.js"
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
  /**
   * Minutos que a agenda reserva a partir deste início. Pode ser maior que a
   * duração do serviço; a interface mostra a duração e, quando diferem,
   * explica a reserva — nunca troca uma pela outra.
   */
  reservedMinutes: number
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
  /**
   * Minutos que a agenda realmente reserva para este serviço —
   * `max(grade, duração + buffers)`. Vem separado de `durationMinutes` porque
   * a interface mostra a duração real ao cliente e nunca a reserva.
   */
  reservedMinutes: number
  /** Se a reancoragem no fim de atendimentos está ligada. */
  adaptive: boolean
  open: boolean
  /** Janelas de atendimento do dia, em hora local ("09:00"–"12:00"). */
  windows: Array<{ opensAt: string; closesAt: string }>
  slots: AvailableSlot[]
  /** Por que não há horários, quando a lista vem vazia. */
  reason: "CLOSED" | "PAST_DATE" | "TOO_FAR" | "FULLY_BOOKED" | null
}

/**
 * Status que realmente ocupam a cadeira.
 *
 * PENDING entra porque uma solicitação aguardando o barbeiro já segura o
 * horário — oferecê-lo a outra pessoa criaria duas promessas para a mesma
 * vaga. CANCELLED, NO_SHOW, REJECTED e EXPIRED liberam.
 */
export const BLOCKING_STATUSES = ["PENDING", "CONFIRMED"] as const

/**
 * Filtro de ocupação: o que realmente segura um horário AGORA.
 *
 * Confirmados sempre; pendentes apenas enquanto dentro do prazo. Uma
 * solicitação vencida não conta mais, e é liberada de fato no momento em que
 * alguém tenta reservar aquele intervalo (ver appointments.service) — não por
 * uma varredura a cada consulta.
 *
 * Essa escolha é deliberada: um `UPDATE` global no caminho de LEITURA
 * competia por lock com os `INSERT` de quem estava reservando, e sob
 * concorrência o PostgreSQL chegava a relatar deadlock em vez de um conflito
 * limpo. Leitura não escreve.
 */
function blockingAppointmentFilter(now: Date) {
  return {
    OR: [
      { status: "CONFIRMED" as const },
      { status: "PENDING" as const, pendingExpiresAt: { gt: now } },
    ],
  }
}

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
  options: { applyDisplayLimit?: boolean } = {},
): Promise<AvailabilityResult> {
  // Uma data inexistente deve ser 400 mesmo que pareça passada ou distante.
  parseShopDate(dateISO)
  const service = await getBookableService(serviceId)

  const base = {
    date: dateISO,
    serviceId: service.id,
    serviceName: service.name,
    durationMinutes: service.durationMinutes,
    slotIntervalMinutes: BookingRules.baseSlotMinutes,
    reservedMinutes: reservedMinutesFor(
      service.durationMinutes,
      service.bufferBeforeMinutes,
      service.bufferAfterMinutes,
    ),
    adaptive: BookingRules.adaptiveSchedulingEnabled,
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
        ...blockingAppointmentFilter(now),
        startsAt: { lt: dayEnd },
        reservedEndsAt: { gt: dayStart },
      },
      select: { startsAt: true, reservedEndsAt: true },
    }),
    findBlocksOverlapping(dayStart, dayEnd),
  ])

  const busy: BusyInterval[] = [
    // Cada reserva ocupa o intervalo operacional congelado nela — que pode ser
    // maior que a duração do serviço. Ler `reservedEndsAt` (e não `endsAt`)
    // é o que mantém a disponibilidade de acordo com a EXCLUDE do banco.
    ...appointments.map(appointment =>
      toDayMinutes(dayStart, appointment.startsAt, appointment.reservedEndsAt),
    ),
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
    reservedMinutes: base.reservedMinutes,
    slotIntervalMinutes: BookingRules.baseSlotMinutes,
    earliestStartMinute,
    adaptive: BookingRules.adaptiveSchedulingEnabled,
    maxOptions:
      options.applyDisplayLimit === false ? undefined : BookingRules.maxDailyStartOptions,
  })

  const slots: AvailableSlot[] = starts.map(startMinute => {
    const startsAt = shopWallClockToInstant(dateISO, startMinute)
    return {
      startsAtClock: minutesToClock(startMinute),
      endsAtClock: minutesToClock(startMinute + service.durationMinutes),
      reservedMinutes: base.reservedMinutes,
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

/**
 * Os inícios que a agenda aceita para este serviço neste dia, SEM o teto de
 * exibição.
 *
 * A criação valida por participação nesta lista, e não repetindo as regras à
 * mão: assim é impossível a tela oferecer um horário que a reserva recuse, ou
 * o contrário. Cobre de uma vez expediente, almoço, bloqueios, ocupação,
 * antecedência, grade e reancoragem adaptativa.
 *
 * O teto de `maxDailyStartOptions` fica de fora de propósito. Ele existe para
 * não despejar dezenas de botões na tela — limitar o que é EXIBIDO. Aplicá-lo
 * aqui transformaria um limite de interface em limite de reservas, e o
 * barbeiro perderia atendimentos que caberiam no dia.
 */
export async function listBookableStartMinutes(
  dateISO: string,
  serviceId: string,
  now: Date = new Date(),
): Promise<number[]> {
  const full = await getAvailability(dateISO, serviceId, now, { applyDisplayLimit: false })
  return full.slots.map(slot => clockToMinutesLocal(slot.startsAtClock))
}

function clockToMinutesLocal(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number)
  return hour! * 60 + minute!
}
