import { prisma } from "../../config/prisma.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { logger } from "../../utils/logger.js"
import { lockKey, lockUser } from "../../utils/locks.js"
import { toPublicUser, type PublicUser } from "../users/users.mapper.js"
import type { UserRole, UserStatus } from "../../generated/prisma/enums.js"

export interface ListUsersFilters {
  status?: UserStatus
  role?: UserRole
  search?: string
  page: number
  perPage: number
}

export interface ListUsersResult {
  users: PublicUser[]
  total: number
  page: number
  perPage: number
  totalPages: number
}

export async function listUsers(
  filters: ListUsersFilters,
): Promise<ListUsersResult> {
  const where = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.search
      ? {
          OR: [
            {
              fullName: {
                contains: filters.search,
                mode: "insensitive" as const,
              },
            },
            ...(filters.search.replace(/\D/g, "")
              ? [{ phone: { contains: filters.search.replace(/\D/g, "") } }]
              : []),
          ],
        }
      : {}),
  }

  const [records, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.perPage,
      take: filters.perPage,
    }),
    prisma.user.count({ where }),
  ])

  return {
    users: records.map(toPublicUser),
    total,
    page: filters.page,
    perPage: filters.perPage,
    totalPages: Math.max(1, Math.ceil(total / filters.perPage)),
  }
}

export async function getUserById(id: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user)
    throw AppError.notFound(
      ErrorCodes.USER_NOT_FOUND,
      "Usuário não encontrado.",
    )
  return toPublicUser(user)
}

export async function countPendingUsers(): Promise<number> {
  return prisma.user.count({ where: { status: "PENDING" } })
}

/**
 * Altera o status de um usuário e registra a ação na trilha de auditoria.
 *
 * Bloquear encerra todas as sessões ativas imediatamente — não adianta bloquear
 * alguém que continua com um refresh token válido no bolso.
 */
export async function updateUserStatus(
  actorId: string,
  targetUserId: string,
  status: UserStatus,
): Promise<PublicUser> {
  if (actorId === targetUserId) {
    throw AppError.badRequest(
      ErrorCodes.FORBIDDEN,
      "Você não pode alterar o próprio status.",
    )
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Serialize administrative transitions; two admins cannot deactivate each other concurrently.
    await lockKey(tx, "admin-status")
    for (const id of [actorId, targetUserId].sort()) await lockUser(tx, id)
    const actor = await tx.user.findUnique({ where: { id: actorId } })
    if (actor?.role !== "ADMIN" || actor.status !== "ACTIVE")
      throw AppError.forbidden()
    const target = await tx.user.findUnique({ where: { id: targetUserId } })
    if (!target)
      throw AppError.notFound(
        ErrorCodes.USER_NOT_FOUND,
        "Usuário não encontrado.",
      )
    if (target.status === status) return target
    if (
      target.role === "ADMIN" &&
      target.status === "ACTIVE" &&
      status !== "ACTIVE" &&
      (await tx.user.count({ where: { role: "ADMIN", status: "ACTIVE" } })) <= 1
    ) {
      throw AppError.conflict(
        ErrorCodes.CONFLICT,
        "O último administrador ativo não pode ser desativado.",
      )
    }
    const user = await tx.user.update({
      where: { id: targetUserId },
      data: { status },
    })
    await tx.adminAuditLog.create({
      data: {
        actorId,
        targetUserId,
        action: "USER_STATUS_" + status,
        metadata: { from: target.status, to: status },
      },
    })
    if (status !== "ACTIVE")
      await tx.refreshToken.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    return user
  })
  logger.info("Status de usuário alterado", {
    actorId,
    targetUserId,
    to: status,
  })

  return toPublicUser(updated)
}

/** Histórico recente de ações administrativas. */
export async function listAuditLog(limit = 50) {
  const entries = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      actor: { select: { id: true, fullName: true, phone: true } },
      targetUser: { select: { id: true, fullName: true, phone: true } },
    },
  })

  return entries.map((entry) => ({
    id: entry.id,
    action: entry.action,
    createdAt: entry.createdAt.toISOString(),
    actor: { id: entry.actor.id, fullName: entry.actor.fullName },
    targetUser: entry.targetUser
      ? { id: entry.targetUser.id, fullName: entry.targetUser.fullName }
      : null,
  }))
}
