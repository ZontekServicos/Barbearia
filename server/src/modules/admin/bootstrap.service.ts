import { prisma } from "../../config/prisma.js"
import { normalizePhone } from "../../utils/phone.js"
import { lockKey, lockUser } from "../../utils/locks.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { hashPassword } from "../auth/password.service.js"

export type BootstrapOutcome =
  | "unchanged"
  | "created"
  | "promoted"
  | "credential-established"

export interface BootstrapResult {
  id: string
  outcome: BootstrapOutcome
  changed: boolean
}

/**
 * Cria ou ajusta o primeiro administrador.
 *
 * A senha vem do ambiente de quem executa o script e nunca é impressa,
 * persistida em texto puro nem embutida no código. Sem ela não é possível
 * criar um admin: uma conta administrativa sem credencial seria uma conta que
 * ninguém consegue usar e que o fluxo de login recusa de qualquer forma.
 */
export async function bootstrapAdmin(
  rawPhone: string,
  fullName: string | null,
  password: string | null,
  allowPromotion = false,
  allowPasswordReset = false,
): Promise<BootstrapResult> {
  const phone = normalizePhone(rawPhone)

  // Hash fora da transação: Argon2id é caro e não deve segurar o lock.
  const passwordHash = password ? await hashPassword(password) : null

  return prisma.$transaction(async (tx) => {
    await lockKey(tx, "admin-status")
    await lockKey(tx, "auth:" + phone)

    const existing = await tx.user.findUnique({ where: { phone } })
    if (existing) await lockUser(tx, existing.id)

    const isActiveAdmin =
      existing?.role === "ADMIN" && existing.status === "ACTIVE"

    // Admin pronto e com credencial: nada a fazer. Idempotente de propósito,
    // para que rodar o script duas vezes não vire um incidente.
    if (isActiveAdmin && existing!.passwordHash && !allowPasswordReset) {
      return { id: existing!.id, outcome: "unchanged" as const, changed: false }
    }

    if (existing && !isActiveAdmin && !allowPromotion) {
      throw AppError.conflict(
        ErrorCodes.CONFLICT,
        "Registro existente: defina BOOTSTRAP_ADMIN_ALLOW_PROMOTION=true para confirmar a promoção/reativação.",
      )
    }

    // Trocar a senha de um admin que já tem credencial é tomada de conta, não
    // bootstrap. Exige intenção declarada, separada da promoção de papel.
    if (existing?.passwordHash && !allowPasswordReset) {
      if (!allowPromotion) {
        throw AppError.conflict(
          ErrorCodes.CONFLICT,
          "Este telefone já possui senha. Use BOOTSTRAP_ADMIN_RESET_PASSWORD=true para substituí-la.",
        )
      }
      // Promove o papel e preserva a credencial existente.
      const promoted = await tx.user.update({
        where: { id: existing.id },
        data: {
          role: "ADMIN",
          status: "ACTIVE",
          ...(!existing.fullName && fullName ? { fullName } : {}),
        },
      })
      await revokeSessions(tx, promoted.id)
      await audit(tx, promoted.id, "BOOTSTRAP_ADMIN_PROMOTE", {
        previousRole: existing.role,
        previousStatus: existing.status,
        passwordChanged: false,
      })
      return { id: promoted.id, outcome: "promoted" as const, changed: true }
    }

    if (!passwordHash) {
      throw AppError.badRequest(
        ErrorCodes.VALIDATION_ERROR,
        "Defina BOOTSTRAP_ADMIN_PASSWORD para estabelecer a credencial do administrador.",
      )
    }

    const now = new Date()
    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: {
            role: "ADMIN",
            status: "ACTIVE",
            passwordHash,
            passwordUpdatedAt: now,
            failedLoginAttempts: 0,
            lockedUntil: null,
            ...(!existing.fullName && fullName ? { fullName } : {}),
          },
        })
      : await tx.user.create({
          data: {
            phone,
            fullName,
            role: "ADMIN",
            status: "ACTIVE",
            passwordHash,
            passwordUpdatedAt: now,
          },
        })

    // Estabelecer credencial encerra qualquer sessão anterior.
    await revokeSessions(tx, user.id)

    const outcome: BootstrapOutcome = !existing
      ? "created"
      : existing.passwordHash
        ? "credential-established"
        : isActiveAdmin
          ? "credential-established"
          : "promoted"

    await audit(
      tx,
      user.id,
      existing ? "BOOTSTRAP_ADMIN_PROMOTE" : "BOOTSTRAP_ADMIN_CREATE",
      existing
        ? {
            previousRole: existing.role,
            previousStatus: existing.status,
            passwordChanged: true,
          }
        : { passwordChanged: true },
    )

    return { id: user.id, outcome, changed: true }
  })
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

async function revokeSessions(tx: Tx, userId: string) {
  await tx.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/** A auditoria guarda o que mudou — nunca a senha nem o hash. */
async function audit(
  tx: Tx,
  userId: string,
  action: string,
  metadata: Record<string, string | boolean>,
) {
  await tx.adminAuditLog.create({
    data: { actorId: userId, targetUserId: userId, action, metadata },
  })
}
