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
  blockedRange,
  computeSlotGrid,
  overlaps,
  type SlotGridEntry,
  type SlotUnavailableReason,
  type TaggedBusyInterval,
} from "./availability.engine.js"
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
  /**
   * Grade do dia INTEIRA: todo início da grade, livre ou não.
   *
   * Existe para a tela mostrar o horário ocupado em cinza em vez de escondê-lo.
   * Sumir com o que está ocupado deixa buracos na grade que parecem defeito, e
   * esconde do cliente a informação mais útil que ele tem — como o dia está.
   *
   * O motivo NÃO vem aqui. Saber que às 15:00 existe um agendamento já é dado
   * de outra pessoa; a versão pública diz apenas que não pode ser escolhido.
   */
  grid: PublicGridSlot[]
  /** Por que não há horários, quando a lista vem vazia. */
  reason: "CLOSED" | "PAST_DATE" | "TOO_FAR" | "FULLY_BOOKED" | null
}

/** Um início da grade, como o PÚBLICO o vê: sem razão, sem dado de ninguém. */
export interface PublicGridSlot {
  /** "09:00" — hora local da barbearia. */
  startsAtClock: string
  endsAtClock: string
  startsAt: string
  /** `false` desenha o botão cinza e desabilitado. E é tudo que se revela. */
  available: boolean
}

/**
 * Status que realmente ocupam a cadeira.
 *
 * PENDING entra porque uma solicitação aguardando o barbeiro já segura o
 * horário — oferecê-lo a outra pessoa criaria duas promessas para a mesma
 * vaga. AWAITING_PAYMENT entra pelo mesmo motivo: o barbeiro já aprovou e o
 * cliente está pagando; liberar o horário no meio disso venderia duas vezes.
 * CANCELLED, NO_SHOW, REJECTED e EXPIRED liberam.
 */
export const BLOCKING_STATUSES = ["PENDING", "AWAITING_PAYMENT", "CONFIRMED"] as const

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
      // Os dois estados com prazo usam `pendingExpiresAt` como "até quando esta
      // reserva segura o horário": aguardando o barbeiro e aguardando o
      // pagamento. Vencido o prazo, o horário volta a ser oferecido — sem
      // escrever nada no caminho de leitura, que era a origem do deadlock.
      { status: "PENDING" as const, pendingExpiresAt: { gt: now } },
      { status: "AWAITING_PAYMENT" as const, pendingExpiresAt: { gt: now } },
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
    grid: [],
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

  const taggedBusy: TaggedBusyInterval[] = [
    ...appointments.map(appointment => ({
      ...toDayMinutes(dayStart, appointment.startsAt, appointment.reservedEndsAt),
      kind: "APPOINTMENT" as const,
    })),
    ...blocks.map(block => ({
      ...toDayMinutes(dayStart, block.startsAt, block.endsAt),
      kind: "BLOCK" as const,
    })),
  ]

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

  /**
   * Grade completa do dia, para a tela poder mostrar o que NÃO está livre.
   *
   * Derivada em paralelo, nunca no lugar de `starts`: quem decide o que é
   * reservável continua sendo `computeSlotStarts`, e é a lista dele que a
   * criação de agendamento valida. Aqui só se descreve.
   *
   * Sem limite de exibição: o teto de `maxDailyStartOptions` existe para não
   * despejar cinquenta botões de escolha, e cortar a grade pela metade deixaria
   * buracos sem explicação no meio do dia.
   */
  const grid = computeSlotGrid({
    windows,
    busy: taggedBusy,
    durationMinutes: service.durationMinutes,
    reservedMinutes: base.reservedMinutes,
    slotIntervalMinutes: BookingRules.baseSlotMinutes,
    earliestStartMinute,
    adaptive: BookingRules.adaptiveSchedulingEnabled,
  })

  /**
   * Só o que é realmente oferecível entra como disponível na grade.
   *
   * `starts` já passou pelo teto de exibição; um início livre que ficou fora do
   * teto aparece na grade como indisponível em vez de clicável, para a tela
   * nunca oferecer um botão que a validação recusaria.
   */
  const offered = new Set(starts)

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
    grid: grid.map(entry => ({
      startsAtClock: minutesToClock(entry.startMinute),
      endsAtClock: minutesToClock(entry.startMinute + service.durationMinutes),
      startsAt: shopWallClockToInstant(dateISO, entry.startMinute).toISOString(),
      // Livre E realmente oferecido: ver `offered`.
      available: entry.available && offered.has(entry.startMinute),
    })),
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

// ---------------------------------------------------------------------------
// Grade administrativa — com motivo
// ---------------------------------------------------------------------------

/**
 * Um início da grade como a BARBEARIA o vê.
 *
 * Aqui o motivo existe, porque a ação depende dele: bloqueio manual pode ser
 * liberado, agendamento não — esse passa pelo cancelamento, que avisa o cliente
 * e devolve o horário pela regra certa. Expor os dois como "liberar" convidaria
 * a apagar a reserva de alguém com um clique.
 */
export interface AdminGridSlot {
  startsAtClock: string
  endsAtClock: string
  startsAt: string
  available: boolean
  reason: SlotUnavailableReason | null
  /** Bloqueio manual que cobre este início. É o único que pode ser liberado. */
  blockId: string | null
  blockReason: string | null
  /** Agendamento que cobre este início, para a tela levar ao detalhe dele. */
  appointmentId: string | null
}

export interface AdminAvailability {
  date: string
  serviceId: string
  serviceName: string
  durationMinutes: number
  reservedMinutes: number
  slotIntervalMinutes: number
  open: boolean
  windows: Array<{ opensAt: string; closesAt: string }>
  grid: AdminGridSlot[]
}

/**
 * Grade do dia para a gestão de disponibilidade.
 *
 * Usa a MESMA engine da grade pública — `computeSlotGrid` — para as duas telas
 * não divergirem. Se o público vê cinza, a barbearia vê cinza com o motivo; não
 * existe caminho em que uma mostra livre e a outra não.
 *
 * O teto de exibição não se aplica: quem administra precisa do dia inteiro.
 */
export async function getAdminAvailability(
  dateISO: string,
  serviceId: string,
  now: Date = new Date(),
): Promise<AdminAvailability> {
  const service = await getBookableService(serviceId)
  const reservedMinutes = reservedMinutesFor(
    service.durationMinutes,
    service.bufferBeforeMinutes,
    service.bufferAfterMinutes,
  )
  const shell = {
    date: dateISO,
    serviceId: service.id,
    serviceName: service.name,
    durationMinutes: service.durationMinutes,
    reservedMinutes,
    slotIntervalMinutes: BookingRules.baseSlotMinutes,
  }

  const day = await getDayWindow(dateISO)
  const windows: OpenWindow[] = day ? windowsFromBusinessHours(day) : []
  if (windows.length === 0) {
    return { ...shell, open: false, windows: [], grid: [] }
  }

  const dayStart = shopWallClockToInstant(dateISO, 0)
  const dayEnd = shopWallClockToInstant(addDaysToShopDate(dateISO, 1), 0)

  const [appointments, blocks] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        ...blockingAppointmentFilter(now),
        startsAt: { lt: dayEnd },
        reservedEndsAt: { gt: dayStart },
      },
      // O id vem para a tela poder levar ao detalhe do agendamento. Nome,
      // telefone e serviço do cliente NÃO: a grade é sobre ocupação, e o
      // detalhe já mostra o que a barbearia precisa saber.
      select: { id: true, startsAt: true, reservedEndsAt: true },
    }),
    findBlocksOverlapping(dayStart, dayEnd),
  ])

  const taggedBusy: TaggedBusyInterval[] = [
    ...appointments.map(appointment => ({
      ...toDayMinutes(dayStart, appointment.startsAt, appointment.reservedEndsAt),
      kind: "APPOINTMENT" as const,
    })),
    ...blocks.map(block => ({
      ...toDayMinutes(dayStart, block.startsAt, block.endsAt),
      kind: "BLOCK" as const,
    })),
  ]

  const earliestStartMinute = Math.ceil(
    (now.getTime() + BookingRules.minimumAdvanceMinutes * 60_000 - dayStart.getTime()) / 60_000,
  )

  const grid: SlotGridEntry[] = computeSlotGrid({
    windows,
    busy: taggedBusy,
    durationMinutes: service.durationMinutes,
    reservedMinutes,
    slotIntervalMinutes: BookingRules.baseSlotMinutes,
    earliestStartMinute,
    adaptive: BookingRules.adaptiveSchedulingEnabled,
  })

  /** Qual período cobre o intervalo reservado a partir deste início. */
  const covering = (startMinute: number) => {
    const blocked = blockedRange(
      startMinute,
      reservedMinutes,
      service.bufferBeforeMinutes,
      service.bufferAfterMinutes,
    )
    const appointment = appointments.find(entry => {
      const span = toDayMinutes(dayStart, entry.startsAt, entry.reservedEndsAt)
      return overlaps(blocked.startMinute, blocked.endMinute, span.startMinute, span.endMinute)
    })
    const block = blocks.find(entry => {
      const span = toDayMinutes(dayStart, entry.startsAt, entry.endsAt)
      return overlaps(blocked.startMinute, blocked.endMinute, span.startMinute, span.endMinute)
    })
    return { appointment, block }
  }

  return {
    ...shell,
    open: true,
    windows: windows.map(window => ({
      opensAt: minutesToClock(window.startMinute),
      closesAt: minutesToClock(window.endMinute),
    })),
    grid: grid.map(entry => {
      const { appointment, block } = entry.available
        ? { appointment: undefined, block: undefined }
        : covering(entry.startMinute)
      return {
        startsAtClock: minutesToClock(entry.startMinute),
        endsAtClock: minutesToClock(entry.startMinute + service.durationMinutes),
        startsAt: shopWallClockToInstant(dateISO, entry.startMinute).toISOString(),
        available: entry.available,
        reason: entry.reason,
        blockId: entry.reason === "BLOCK" ? (block?.id ?? null) : null,
        blockReason: entry.reason === "BLOCK" ? (block?.reason ?? null) : null,
        appointmentId: entry.reason === "APPOINTMENT" ? (appointment?.id ?? null) : null,
      }
    }),
  }
}
