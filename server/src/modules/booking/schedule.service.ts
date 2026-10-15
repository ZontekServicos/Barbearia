import { prisma } from "../../config/prisma.js"
import type { Prisma } from "../../generated/prisma/client.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { lockKey } from "../../utils/locks.js"
import {
  addDaysToShopDate,
  clockToMinutes,
  shopWallClockToInstant,
} from "../../utils/time.js"
import { toPublicScheduleBlock, type PublicScheduleBlock } from "./booking.mapper.js"

/**
 * Este módulo cuida apenas de disponibilidade NEGATIVA: bloqueios.
 *
 * O expediente — disponibilidade POSITIVA — saiu daqui para
 * `opening.service.ts` quando a agenda passou a ser fechada por padrão. O que
 * existia aqui (`DEFAULT_WEEK`, `getWeekHours`, `getDayWindow`) assumia um dia
 * aberto quando não havia configuração, que é exatamente a premissa invertida
 * pela abertura manual.
 *
 * A tabela `business_hours` continua no banco, sem leitor, preservada por uma
 * migration aditiva — apagá-la num deploy reversível destruiria configuração
 * real sem volta.
 */

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
  /** Quem bloqueou. A rota passa a sessão; nunca vem do corpo. */
  createdById?: string
}): Promise<PublicScheduleBlock> {
  const startsAt = shopWallClockToInstant(input.date, clockToMinutes(input.startsAt))
  const endsAt = shopWallClockToInstant(input.date, clockToMinutes(input.endsAt))

  if (startsAt.getTime() >= endsAt.getTime()) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_ERROR,
      "O fim do bloqueio deve ser depois do início.",
    )
  }

  const block = await prisma.$transaction(async tx => {
    await lockKey(tx, `booking-day:${input.date}`)
    await assertIntervalCanBeBlocked(tx, startsAt, endsAt)
    return tx.scheduleBlock.create({
      data: {
        startsAt,
        endsAt,
        reason: input.reason,
        ...(input.createdById ? { createdById: input.createdById } : {}),
      },
    })
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

/**
 * Bloqueia o DIA INTEIRO.
 *
 * Um bloqueio só, cobrindo de meia-noite a meia-noite, em vez de um por horário
 * da grade: o dia inteiro é uma decisão única ("não atendo amanhã"), e liberar
 * depois tem de ser um clique — não quinze. Também sobrevive a mudança de
 * expediente, porque não depende de onde a grade começava quando foi criado.
 *
 * NÃO cancela agendamento existente. Um horário já reservado continua reservado:
 * bloquear a agenda e desmarcar cliente são decisões diferentes, e a segunda
 * passa pelo cancelamento, que avisa quem ia ser atendido.
 */
export async function blockWholeDay(input: {
  date: string
  reason: string
  createdById?: string
}): Promise<PublicScheduleBlock> {
  const startsAt = shopWallClockToInstant(input.date, 0)
  const endsAt = shopWallClockToInstant(addDaysToShopDate(input.date, 1), 0)

  const block = await prisma.$transaction(async tx => {
    await lockKey(tx, `booking-day:${input.date}`)
    await assertIntervalCanBeBlocked(tx, startsAt, endsAt)
    return tx.scheduleBlock.create({
      data: {
        startsAt,
        endsAt,
        reason: input.reason,
        ...(input.createdById ? { createdById: input.createdById } : {}),
      },
    })
  })
  return toPublicScheduleBlock(block)
}

/**
 * Rechecked only after taking the same day lock used by appointment creation.
 * This is the cross-table equivalent of an exclusion constraint: PostgreSQL
 * cannot express one EXCLUDE over appointments and schedule_blocks directly.
 */
async function assertIntervalCanBeBlocked(
  tx: Prisma.TransactionClient,
  startsAt: Date,
  endsAt: Date,
): Promise<void> {
  const now = new Date()
  const appointments = await tx.appointment.count({
    where: {
      startsAt: { lt: endsAt },
      reservedEndsAt: { gt: startsAt },
      OR: [
        { status: "CONFIRMED" },
        { status: "PENDING", pendingExpiresAt: { gt: now } },
        { status: "AWAITING_PAYMENT", pendingExpiresAt: { gt: now } },
      ],
    },
  })
  if (appointments > 0) {
    throw AppError.conflict(
      ErrorCodes.CONFLICT,
      "Existe um agendamento ativo neste intervalo. Cancele-o pelo fluxo próprio antes de bloquear.",
    )
  }
}
