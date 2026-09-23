import { prisma } from "../../config/prisma.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import {
  addDaysToShopDate,
  clockToMinutes,
  shopWallClockToInstant,
  shopWeekday,
} from "../../utils/time.js"
import {
  toPublicBusinessHours,
  toPublicScheduleBlock,
  type PublicBusinessHours,
  type PublicScheduleBlock,
} from "./booking.mapper.js"

/** Expediente padrão usado quando o banco ainda não tem configuração. */
const DEFAULT_WEEK: ReadonlyArray<{
  weekday: number
  closed: boolean
  openMinute: number
  closeMinute: number
}> = [
  { weekday: 0, closed: true, openMinute: 9 * 60, closeMinute: 13 * 60 },
  { weekday: 1, closed: true, openMinute: 9 * 60, closeMinute: 19 * 60 },
  { weekday: 2, closed: false, openMinute: 9 * 60, closeMinute: 19 * 60 },
  { weekday: 3, closed: false, openMinute: 9 * 60, closeMinute: 19 * 60 },
  { weekday: 4, closed: false, openMinute: 9 * 60, closeMinute: 19 * 60 },
  { weekday: 5, closed: false, openMinute: 9 * 60, closeMinute: 20 * 60 },
  { weekday: 6, closed: false, openMinute: 8 * 60, closeMinute: 18 * 60 },
]

export interface WeekdayHours {
  weekday: number
  closed: boolean
  openMinute: number
  closeMinute: number
  breakStartMinute: number | null
  breakEndMinute: number | null
}

/**
 * Expediente da semana inteira, sempre com os 7 dias.
 *
 * Se um dia não estiver configurado, cai no padrão em vez de sumir — a agenda
 * nunca fica com buraco por configuração incompleta.
 */
export async function getWeekHours(): Promise<WeekdayHours[]> {
  const stored = await prisma.businessHours.findMany({ orderBy: { weekday: "asc" } })
  const byWeekday = new Map(stored.map(day => [day.weekday, day]))

  return DEFAULT_WEEK.map(fallback => {
    const record = byWeekday.get(fallback.weekday)
    if (!record) {
      return { ...fallback, breakStartMinute: null, breakEndMinute: null }
    }
    return {
      weekday: record.weekday,
      closed: record.closed,
      openMinute: record.openMinute,
      closeMinute: record.closeMinute,
      breakStartMinute: record.breakStartMinute,
      breakEndMinute: record.breakEndMinute,
    }
  })
}

export async function listBusinessHours(): Promise<PublicBusinessHours[]> {
  const week = await getWeekHours()
  return week.map(toPublicBusinessHours)
}

export interface BusinessHoursInput {
  weekday: number
  closed: boolean
  opensAt: string
  closesAt: string
  breakStartsAt: string | null
  breakEndsAt: string | null
}

/** Substitui a semana inteira numa transação: nunca fica meio configurada. */
export async function replaceBusinessHours(
  days: BusinessHoursInput[],
): Promise<PublicBusinessHours[]> {
  await prisma.$transaction(
    days.map(day =>
      prisma.businessHours.upsert({
        where: { weekday: day.weekday },
        create: {
          weekday: day.weekday,
          closed: day.closed,
          openMinute: clockToMinutes(day.opensAt),
          closeMinute: clockToMinutes(day.closesAt),
          breakStartMinute: day.breakStartsAt === null ? null : clockToMinutes(day.breakStartsAt),
          breakEndMinute: day.breakEndsAt === null ? null : clockToMinutes(day.breakEndsAt),
        },
        update: {
          closed: day.closed,
          openMinute: clockToMinutes(day.opensAt),
          closeMinute: clockToMinutes(day.closesAt),
          breakStartMinute: day.breakStartsAt === null ? null : clockToMinutes(day.breakStartsAt),
          breakEndMinute: day.breakEndsAt === null ? null : clockToMinutes(day.breakEndsAt),
        },
      }),
    ),
  )

  return listBusinessHours()
}

/** Expediente do dia. `null` quando a barbearia está fechada. */
export async function getDayWindow(
  dateISO: string,
): Promise<{ openMinute: number; closeMinute: number; breakStartMinute: number | null; breakEndMinute: number | null } | null> {
  const week = await getWeekHours()
  const weekday = shopWeekday(dateISO)
  const day = week.find(entry => entry.weekday === weekday)

  if (!day || day.closed) return null

  return {
    openMinute: day.openMinute,
    closeMinute: day.closeMinute,
    breakStartMinute: day.breakStartMinute,
    breakEndMinute: day.breakEndMinute,
  }
}

// ---------------------------------------------------------------------------
// Bloqueios
// ---------------------------------------------------------------------------

export async function listBlocks(from: string, to: string): Promise<PublicScheduleBlock[]> {
  const rangeStart = shopWallClockToInstant(from, 0)
  const rangeEnd = shopWallClockToInstant(addDaysToShopDate(to, 1), 0)

  const blocks = await prisma.scheduleBlock.findMany({
    where: { startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
    orderBy: { startsAt: "asc" },
  })

  return blocks.map(toPublicScheduleBlock)
}

/** Bloqueios que tocam um intervalo — usado pela disponibilidade. */
export async function findBlocksOverlapping(rangeStart: Date, rangeEnd: Date) {
  return prisma.scheduleBlock.findMany({
    where: { startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
    orderBy: { startsAt: "asc" },
  })
}

export async function createBlock(input: {
  date: string
  startsAt: string
  endsAt: string
  reason: string
}): Promise<PublicScheduleBlock> {
  const startsAt = shopWallClockToInstant(input.date, clockToMinutes(input.startsAt))
  const endsAt = shopWallClockToInstant(input.date, clockToMinutes(input.endsAt))

  if (startsAt.getTime() >= endsAt.getTime()) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_ERROR,
      "O fim do bloqueio deve ser depois do início.",
    )
  }

  const block = await prisma.scheduleBlock.create({
    data: { startsAt, endsAt, reason: input.reason },
  })

  return toPublicScheduleBlock(block)
}

export async function deleteBlock(id: string): Promise<void> {
  const existing = await prisma.scheduleBlock.findUnique({ where: { id } })
  if (!existing) {
    throw AppError.notFound(ErrorCodes.NOT_FOUND, "Bloqueio não encontrado.")
  }
  await prisma.scheduleBlock.delete({ where: { id } })
}
