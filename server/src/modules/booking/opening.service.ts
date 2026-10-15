import { prisma } from "../../config/prisma.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { lockKey } from "../../utils/locks.js"
import {
  addDaysToShopDate,
  clockToMinutes,
  instantToShopDate,
  minutesToClock,
  parseShopDate,
  shopWallClockToInstant,
  shopWeekday,
} from "../../utils/time.js"
import type { OpenWindow } from "./availability.engine.js"
import type { Prisma } from "../../generated/prisma/client.js"

/**
 * ABERTURA MANUAL DA AGENDA — disponibilidade positiva.
 *
 * A agenda é FECHADA POR PADRÃO. Sem faixa cadastrada, nenhum horário aceita
 * agendamento. É o oposto do comportamento anterior, em que um dia sem
 * configuração caía num expediente embutido no código — o que fazia a agenda
 * abrir sozinha em dias que a barbearia nunca confirmou.
 *
 * Precedência da resolução de um dia:
 *
 *   1. exceção da DATA  (existe linha em `schedule_date_overrides`)
 *   2. regra SEMANAL    (faixas com `weekday`)
 *   3. fechado
 *
 * A exceção vence por EXISTIR, não por ter faixas: uma exceção sem faixas é
 * "fechado nesta data", e é por isso que a ausência de faixas não pode
 * significar "use a semana" — significaria que fechar uma data é impossível.
 *
 * O que este módulo NÃO faz: remover agendamento, bloqueio ou passado. Ele
 * devolve apenas a janela ABERTA; subtrair o que está ocupado continua sendo
 * trabalho da engine, exatamente como antes.
 */

/** Chave do lock que separa leitura das regras de reescrita das regras. */
export const SCHEDULE_RULES_LOCK = "schedule-rules"

export interface OpeningRange {
  startMinute: number
  endMinute: number
}
/** Faixa em hora local ("09:00"), como entra e sai da API. */
export interface PublicRange {
  opensAt: string
  closesAt: string
}

const toPublicRange = (range: OpeningRange): PublicRange => ({
  opensAt: minutesToClock(range.startMinute),
  closesAt: minutesToClock(range.endMinute),
})
const byStart = (a: OpeningRange, b: OpeningRange) => a.startMinute - b.startMinute

/**
 * Data da barbearia a partir de uma coluna `DATE`.
 *
 * Prisma devolve `@db.Date` como instante à meia-noite UTC. Formatar em UTC é o
 * que preserva o dia escrito; usar o fuso local aqui deslocaria a data um dia
 * para trás em qualquer offset negativo — e o nosso é −03.
 */
const dateColumnToShopDate = (value: Date): string => value.toISOString().slice(0, 10)
/** Caminho inverso, para gravar e consultar a coluna `DATE`. */
const shopDateToDateColumn = (dateISO: string): Date => {
  const { year, month, day } = parseShopDate(dateISO)
  return new Date(Date.UTC(year, month - 1, day))
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

/**
 * Valida um conjunto de faixas de um mesmo dia.
 *
 * O banco já recusa fim<=início, limites fora do dia e sobreposição — e é ele
 * que resiste a dois administradores salvando ao mesmo tempo. Esta validação
 * existe pela MENSAGEM: "as faixas 09:00–13:00 e 12:00–18:00 se sobrepõem"
 * ajuda; uma violação de constraint crua não.
 *
 * Lista vazia é válida e significa FECHADO.
 */
export function validateRanges(ranges: PublicRange[]): OpeningRange[] {
  const parsed = ranges.map(range => {
    const startMinute = clockToMinutes(range.opensAt)
    const endMinute = clockToMinutes(range.closesAt)
    if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, "Horário inválido.")
    }
    if (endMinute <= startMinute) {
      throw AppError.badRequest(
        ErrorCodes.VALIDATION_ERROR,
        `O fim (${range.closesAt}) deve ser depois do início (${range.opensAt}).`,
      )
    }
    if (startMinute < 0 || endMinute > 1440) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, "Horário fora do dia.")
    }
    return { startMinute, endMinute }
  })

  const ordered = [...parsed].sort(byStart)
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1]!
    const current = ordered[index]!
    // Intervalo meio-aberto: 09:00–12:00 e 12:00–18:00 NÃO se sobrepõem, e é
    // justamente a divisão de almoço mais comum.
    if (current.startMinute < previous.endMinute) {
      const same =
        current.startMinute === previous.startMinute && current.endMinute === previous.endMinute
      throw AppError.badRequest(
        ErrorCodes.VALIDATION_ERROR,
        same
          ? `A faixa ${minutesToClock(current.startMinute)}–${minutesToClock(current.endMinute)} está repetida.`
          : `As faixas ${minutesToClock(previous.startMinute)}–${minutesToClock(previous.endMinute)} e ` +
            `${minutesToClock(current.startMinute)}–${minutesToClock(current.endMinute)} se sobrepõem.`,
      )
    }
  }
  return ordered
}

// ---------------------------------------------------------------------------
// Resolução (o que a engine consome)
// ---------------------------------------------------------------------------

/**
 * Janelas ABERTAS de uma data, já aplicada a precedência.
 *
 * Aceita um cliente de transação para que a criação de reserva possa reconferir
 * a janela DENTRO da própria transação — sem isso, fechar um horário enquanto
 * alguém reserva deixaria a reserva passar numa janela que já não existe.
 */
export async function resolveOpenWindows(
  dateISO: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<OpenWindow[]> {
  const date = shopDateToDateColumn(dateISO)

  const override = await client.scheduleDateOverride.findUnique({ where: { date } })
  if (override) {
    const ranges = await client.scheduleOpening.findMany({
      where: { date },
      select: { startMinute: true, endMinute: true },
      orderBy: { startMinute: "asc" },
    })
    // Exceção sem faixa = fechado nesta data. Não cai para a regra semanal.
    return ranges.map(range => ({ startMinute: range.startMinute, endMinute: range.endMinute }))
  }

  const weekly = await client.scheduleOpening.findMany({
    where: { weekday: shopWeekday(dateISO) },
    select: { startMinute: true, endMinute: true },
    orderBy: { startMinute: "asc" },
  })
  return weekly.map(range => ({ startMinute: range.startMinute, endMinute: range.endMinute }))
}

// ---------------------------------------------------------------------------
// Regra semanal
// ---------------------------------------------------------------------------

export interface WeekdayOpening {
  weekday: number
  /**
   * Derivado de `ranges`, não guardado.
   *
   * Um booleano persistido poderia contradizer as faixas — "fechado" com três
   * faixas abertas. Aqui fechado é, por definição, não ter faixa.
   */
  closed: boolean
  /** Vazio = dia fechado. */
  ranges: PublicRange[]
}

/** Os sete dias, sempre — dia sem faixa aparece fechado em vez de desaparecer. */
export async function listWeeklyOpenings(): Promise<WeekdayOpening[]> {
  const rows = await prisma.scheduleOpening.findMany({
    where: { weekday: { not: null } },
    select: { weekday: true, startMinute: true, endMinute: true },
    orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
  })
  return Array.from({ length: 7 }, (_unused, weekday) => {
    const ranges = rows
      .filter(row => row.weekday === weekday)
      .map(row => toPublicRange({ startMinute: row.startMinute, endMinute: row.endMinute }))
    return { weekday, closed: ranges.length === 0, ranges }
  })
}

/**
 * Substitui TODAS as faixas de um dia da semana.
 *
 * Substituição, não acréscimo: a tela mostra o dia inteiro e salva o dia
 * inteiro, então mesclar deixaria faixas que o administrador acabou de remover
 * vivas no banco.
 *
 * Toma o lock EXCLUSIVO das regras: enquanto grava, nenhuma reserva nova
 * atravessa (ver `lockKeyShared` em `createAppointment`).
 */
export async function replaceWeekdayOpenings(input: {
  weekday: number
  ranges: PublicRange[]
  createdById?: string
}): Promise<WeekdayOpening[]> {
  const ranges = validateRanges(input.ranges)

  await prisma.$transaction(async tx => {
    await lockKey(tx, SCHEDULE_RULES_LOCK)
    await tx.scheduleOpening.deleteMany({ where: { weekday: input.weekday } })
    if (ranges.length > 0) {
      await tx.scheduleOpening.createMany({
        data: ranges.map(range => ({
          weekday: input.weekday,
          startMinute: range.startMinute,
          endMinute: range.endMinute,
          ...(input.createdById ? { createdById: input.createdById } : {}),
        })),
      })
    }
  })

  return listWeeklyOpenings()
}

/**
 * Copia as faixas de um dia para outros, SUBSTITUINDO o que havia neles.
 *
 * Substituir é o que o administrador espera de "copiar para", e a confirmação
 * acontece na interface antes de chamar — aqui a operação é direta e atômica,
 * para não existir estado intermediário em que metade dos dias copiou.
 */
export async function copyWeekdayOpenings(input: {
  from: number
  to: number[]
  createdById?: string
}): Promise<WeekdayOpening[]> {
  const targets = [...new Set(input.to)].filter(weekday => weekday !== input.from)
  if (targets.length === 0) {
    throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, "Escolha ao menos um dia de destino.")
  }

  await prisma.$transaction(async tx => {
    await lockKey(tx, SCHEDULE_RULES_LOCK)
    const source = await tx.scheduleOpening.findMany({
      where: { weekday: input.from },
      select: { startMinute: true, endMinute: true },
      orderBy: { startMinute: "asc" },
    })
    await tx.scheduleOpening.deleteMany({ where: { weekday: { in: targets } } })
    if (source.length > 0) {
      await tx.scheduleOpening.createMany({
        data: targets.flatMap(weekday =>
          source.map(range => ({
            weekday,
            startMinute: range.startMinute,
            endMinute: range.endMinute,
            ...(input.createdById ? { createdById: input.createdById } : {}),
          })),
        ),
      })
    }
  })

  return listWeeklyOpenings()
}

// ---------------------------------------------------------------------------
// Exceções por data
// ---------------------------------------------------------------------------

export interface DateOverrideView {
  date: string
  /** Vazio = fechado nesta data. */
  ranges: PublicRange[]
  note: string | null
}

/** Exceções de um período, em ordem de data. */
export async function listDateOverrides(from: string, to: string): Promise<DateOverrideView[]> {
  const overrides = await prisma.scheduleDateOverride.findMany({
    where: { date: { gte: shopDateToDateColumn(from), lte: shopDateToDateColumn(to) } },
    orderBy: { date: "asc" },
  })
  if (overrides.length === 0) return []

  const ranges = await prisma.scheduleOpening.findMany({
    where: { date: { in: overrides.map(override => override.date) } },
    select: { date: true, startMinute: true, endMinute: true },
    orderBy: { startMinute: "asc" },
  })

  return overrides.map(override => {
    const key = dateColumnToShopDate(override.date)
    return {
      date: key,
      note: override.note,
      ranges: ranges
        .filter(range => range.date && dateColumnToShopDate(range.date) === key)
        .map(range => toPublicRange({ startMinute: range.startMinute, endMinute: range.endMinute })),
    }
  })
}

/**
 * Cria ou substitui a exceção de uma data.
 *
 * `ranges` vazio grava a exceção SEM faixas — é assim que se fecha uma data. A
 * linha de exceção é o que faz a data ignorar a semana; apagá-la é o que
 * devolve a data à regra semanal (ver `removeDateOverride`).
 */
export async function upsertDateOverride(input: {
  date: string
  ranges: PublicRange[]
  note?: string | null
  createdById?: string
}): Promise<DateOverrideView> {
  const ranges = validateRanges(input.ranges)
  const date = shopDateToDateColumn(input.date)

  await prisma.$transaction(async tx => {
    await lockKey(tx, SCHEDULE_RULES_LOCK)
    await tx.scheduleDateOverride.upsert({
      where: { date },
      create: {
        date,
        note: input.note ?? null,
        ...(input.createdById ? { createdById: input.createdById } : {}),
      },
      update: { note: input.note ?? null },
    })
    await tx.scheduleOpening.deleteMany({ where: { date } })
    if (ranges.length > 0) {
      await tx.scheduleOpening.createMany({
        data: ranges.map(range => ({
          date,
          startMinute: range.startMinute,
          endMinute: range.endMinute,
          ...(input.createdById ? { createdById: input.createdById } : {}),
        })),
      })
    }
  })

  const [view] = await listDateOverrides(input.date, input.date)
  if (!view) throw AppError.notFound(ErrorCodes.NOT_FOUND, "Exceção não encontrada.")
  return view
}

/** Remove a exceção e devolve a data à regra semanal. */
export async function removeDateOverride(dateISO: string): Promise<void> {
  const date = shopDateToDateColumn(dateISO)
  await prisma.$transaction(async tx => {
    await lockKey(tx, SCHEDULE_RULES_LOCK)
    const existing = await tx.scheduleDateOverride.findUnique({ where: { date } })
    if (!existing) {
      throw AppError.notFound(ErrorCodes.NOT_FOUND, "Não há exceção nesta data.")
    }
    await tx.scheduleOpening.deleteMany({ where: { date } })
    await tx.scheduleDateOverride.delete({ where: { date } })
  })
}

// ---------------------------------------------------------------------------
// Aviso de agendamentos afetados (§12)
// ---------------------------------------------------------------------------

/**
 * Quantos agendamentos ativos ficariam FORA das faixas propostas.
 *
 * Serve ao aviso da interface, e só a isso: fechar um horário NUNCA cancela
 * agendamento. Devolve apenas a contagem — quem são os clientes não é
 * necessário para decidir, e a tela de agenda já mostra o detalhe.
 *
 * `horizonDays` limita a varredura: uma regra semanal vale para sempre, e
 * contar até o infinito não ajudaria ninguém a decidir.
 */
export async function countAppointmentsOutsideRanges(input: {
  weekday?: number
  date?: string
  ranges: PublicRange[]
  now?: Date
  horizonDays?: number
}): Promise<number> {
  const now = input.now ?? new Date()
  const ranges = validateRanges(input.ranges)
  const today = instantToShopDate(now)
  const horizon = input.horizonDays ?? 90

  const dates: string[] =
    input.date !== undefined
      ? [input.date]
      : Array.from({ length: horizon }, (_unused, offset) => addDaysToShopDate(today, offset))
          .filter(dateISO => shopWeekday(dateISO) === input.weekday)

  let total = 0
  for (const dateISO of dates) {
    const dayStart = shopWallClockToInstant(dateISO, 0)
    const dayEnd = shopWallClockToInstant(addDaysToShopDate(dateISO, 1), 0)
    const appointments = await prisma.appointment.findMany({
      where: {
        startsAt: { lt: dayEnd, gte: now },
        reservedEndsAt: { gt: dayStart },
        OR: [
          { status: "CONFIRMED" },
          { status: "PENDING", pendingExpiresAt: { gt: now } },
          { status: "AWAITING_PAYMENT", pendingExpiresAt: { gt: now } },
        ],
      },
      select: { startsAt: true, reservedEndsAt: true },
    })

    for (const appointment of appointments) {
      const startMinute = Math.round((appointment.startsAt.getTime() - dayStart.getTime()) / 60_000)
      const endMinute = Math.round(
        (appointment.reservedEndsAt.getTime() - dayStart.getTime()) / 60_000,
      )
      const covered = ranges.some(
        range => startMinute >= range.startMinute && endMinute <= range.endMinute,
      )
      if (!covered) total++
    }
  }
  return total
}
