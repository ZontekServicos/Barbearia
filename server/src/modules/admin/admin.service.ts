import { prisma } from "../../config/prisma.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { logger } from "../../utils/logger.js"
import { lockKey, lockUser } from "../../utils/locks.js"
import { toPublicUser, type PublicUser } from "../users/users.mapper.js"
import type { UserRole, UserStatus } from "../../generated/prisma/enums.js"
import { hashPassword } from "../auth/password.service.js"

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

/**
 * Redefinição de senha assistida pelo administrador.
 *
 * Sem SMS e sem e-mail, não existe canal automático capaz de provar posse do
 * telefone. A única recuperação honesta é presencial: o cliente se identifica
 * no balcão, o administrador gera uma senha temporária e a entrega em mãos.
 *
 * Garantias:
 *  - a senha original nunca é revelada — ela não existe em texto puro em
 *    lugar nenhum, só o hash Argon2id;
 *  - a nova senha é recebida do operador por HTTPS e nunca devolvida
 *    na resposta nem registrada em log;
 *  - a ação fica na trilha de auditoria com ator, alvo e data;
 *  - todas as sessões do alvo são encerradas.
 *
 * É também o caminho das contas herdadas do fluxo OTP, que nasceram sem senha
 * e por isso não conseguem entrar nem podem ser reivindicadas pelo cadastro.
 */
export async function resetUserPassword(
  actorId: string,
  targetUserId: string,
  newPassword: string,
): Promise<{ user: PublicUser }> {
  if (actorId === targetUserId) {
    // Um admin troca a própria senha pelo fluxo autenticado normal, provando
    // que sabe a senha atual. Passar por aqui contornaria essa checagem.
    throw AppError.badRequest(
      ErrorCodes.FORBIDDEN,
      "Use a troca de senha autenticada para a sua própria conta.",
    )
  }

  const passwordHash = await hashPassword(newPassword)

  const updated = await prisma.$transaction(async (tx) => {
    await lockKey(tx, "admin-status")
    for (const id of [actorId, targetUserId].sort()) await lockUser(tx, id)

    // O ator é revalidado dentro da transação: um admin rebaixado no meio do
    // caminho não conclui a operação.
    const actor = await tx.user.findUnique({ where: { id: actorId } })
    if (actor?.role !== "ADMIN" || actor.status !== "ACTIVE")
      throw AppError.forbidden()

    const target = await tx.user.findUnique({ where: { id: targetUserId } })
    if (!target)
      throw AppError.notFound(
        ErrorCodes.USER_NOT_FOUND,
        "Usuário não encontrado.",
      )

    const user = await tx.user.update({
      where: { id: targetUserId },
      data: {
        passwordHash,
        passwordUpdatedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    })

    await tx.adminAuditLog.create({
      data: {
        actorId,
        targetUserId,
        action: "USER_PASSWORD_RESET",
        // Registra o fato, jamais a senha ou o hash.
        metadata: { hadPassword: target.passwordHash !== null },
      },
    })

    await tx.refreshToken.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    return user
  })

  logger.info("Senha redefinida pelo administrador", { actorId, targetUserId })
  return { user: toPublicUser(updated) }
}
