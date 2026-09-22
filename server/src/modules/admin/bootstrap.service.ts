import { prisma } from "../../config/prisma.js"
import { normalizePhone } from "../../utils/phone.js"
import { lockKey, lockUser } from "../../utils/locks.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"

export async function bootstrapAdmin(
  rawPhone: string,
  fullName: string | null,
  allowPromotion = false,
) {
  const phone = normalizePhone(rawPhone)
  return prisma.$transaction(async (tx) => {
    await lockKey(tx, "admin-status")
    await lockKey(tx, "otp:" + phone)
    const existing = await tx.user.findUnique({ where: { phone } })
    if (existing) await lockUser(tx, existing.id)
    if (existing?.role === "ADMIN" && existing.status === "ACTIVE")
      return { id: existing.id, changed: false }
    if (existing && !allowPromotion)
      throw AppError.conflict(
        ErrorCodes.CONFLICT,
        "Registro existente: defina BOOTSTRAP_ADMIN_ALLOW_PROMOTION=true para confirmar a promoção/reativação.",
      )
    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: {
            role: "ADMIN",
            status: "ACTIVE",
            ...(!existing.fullName ? { fullName } : {}),
          },
        })
      : await tx.user.create({
          data: { phone, fullName, role: "ADMIN", status: "ACTIVE" },
        })
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await tx.adminAuditLog.create({
      data: {
        actorId: user.id,
        targetUserId: user.id,
        action: existing ? "BOOTSTRAP_ADMIN_PROMOTE" : "BOOTSTRAP_ADMIN_CREATE",
        metadata: existing
          ? { previousRole: existing.role, previousStatus: existing.status }
          : {},
      },
    })
    return { id: user.id, changed: true }
  })
}
