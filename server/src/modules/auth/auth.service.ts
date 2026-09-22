import { env } from "../../config/env.js"
import { prisma } from "../../config/prisma.js"
import {
  generateOtpCode,
  hashOtpCode,
  verifyOtpCode,
} from "../../utils/crypto.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { lockKey, lockUser } from "../../utils/locks.js"
import { smsProvider } from "./sms/sms-provider.js"
import { createSession, type SessionTokens } from "./token.service.js"
import { toPublicUser, type PublicUser } from "../users/users.mapper.js"

export interface RequestOtpResult {
  expiresInSeconds: number
}
export async function requestOtp(phone: string): Promise<RequestOtpResult> {
  const code = generateOtpCode()
  const codeHash = await hashOtpCode(code)
  const challenge = await prisma.$transaction(async (tx) => {
    await lockKey(tx, "otp:" + phone)
    // Durable per-phone limit complements the IP limiter, even across replicas.
    const recent = await tx.otpChallenge.count({
      where: { phone, createdAt: { gt: new Date(Date.now() - 15 * 60000) } },
    })
    if (recent >= 5) throw AppError.tooManyRequests()
    await tx.otpChallenge.updateMany({
      where: { phone, consumedAt: null },
      data: { consumedAt: new Date() },
    })
    return tx.otpChallenge.create({
      data: {
        phone,
        codeHash,
        expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60000),
      },
    })
  })
  try {
    await smsProvider.sendOtp(phone, code)
  } catch {
    await prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    })
    throw new AppError(
      ErrorCodes.SMS_UNAVAILABLE,
      "Não foi possível enviar o código. Tente novamente mais tarde.",
      503,
    )
  }
  return { expiresInSeconds: env.OTP_TTL_MINUTES * 60 }
}

export interface VerifyOtpResult {
  user: PublicUser
  tokens: SessionTokens
  isNewUser: boolean
}
export async function verifyOtp(
  phone: string,
  code: string,
  fullName?: string,
): Promise<VerifyOtpResult> {
  const result = await prisma.$transaction(
    async (tx) => {
      await lockKey(tx, "otp:" + phone)
      const challenge = await tx.otpChallenge.findFirst({
        where: { phone, consumedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
      if (!challenge)
        return {
          error: AppError.badRequest(
            ErrorCodes.OTP_INVALID,
            "Código inválido. Solicite um novo.",
          ),
        }
      if (challenge.expiresAt.getTime() <= Date.now()) {
        await tx.otpChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() },
        })
        return {
          error: AppError.badRequest(
            ErrorCodes.OTP_EXPIRED,
            "Código expirado. Solicite um novo.",
          ),
        }
      }
      const matches =
        challenge.attempts < env.OTP_MAX_ATTEMPTS &&
        (await verifyOtpCode(code, challenge.codeHash))
      if (!matches) {
        const exhausted = challenge.attempts + 1 >= env.OTP_MAX_ATTEMPTS
        await tx.otpChallenge.update({
          where: { id: challenge.id },
          data: {
            attempts: { increment: 1 },
            ...(exhausted ? { consumedAt: new Date() } : {}),
          },
        })
        return {
          error: AppError.badRequest(
            exhausted ? ErrorCodes.OTP_MAX_ATTEMPTS : ErrorCodes.OTP_INVALID,
            exhausted
              ? "Número de tentativas excedido. Solicite um novo código."
              : "Código inválido.",
          ),
        }
      }
      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      })
      const existing = await tx.user.findUnique({ where: { phone } })
      if (existing) await lockUser(tx, existing.id)
      const user = await tx.user.upsert({
        where: { phone },
        update: {},
        create: {
          phone,
          fullName: fullName ?? null,
          role: "CUSTOMER",
          status: "PENDING",
          phoneVerifiedAt: new Date(),
        },
      })
      if (user.status === "BLOCKED")
        return {
          error: AppError.forbidden(
            ErrorCodes.ACCOUNT_BLOCKED,
            "Sua conta está bloqueada.",
          ),
        }
      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          phoneVerifiedAt: user.phoneVerifiedAt ?? new Date(),
          ...(!user.fullName && fullName ? { fullName } : {}),
        },
      })
      const tokens = await createSession(tx, updated)
      return {
        value: { user: toPublicUser(updated), tokens, isNewUser: !existing },
      }
    },
    { maxWait: 10000, timeout: 15000 },
  )
  // Failed attempts/consumption are persisted, not rolled back by an exception.
  if (result.error) throw result.error
  return result.value!
}

export async function purgeStaleOtpChallenges(
  olderThanHours = 24,
): Promise<number> {
  const result = await prisma.otpChallenge.deleteMany({
    where: {
      createdAt: { lt: new Date(Date.now() - olderThanHours * 3600000) },
    },
  })
  return result.count
}
