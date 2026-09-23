import jwt from "jsonwebtoken"
import { env } from "../../config/env.js"
import { prisma } from "../../config/prisma.js"
import type { Prisma, RefreshToken } from "../../generated/prisma/client.js"
import { generateRefreshToken, hashRefreshToken } from "../../utils/crypto.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { lockUser } from "../../utils/locks.js"

export interface AccessTokenPayload {
  sub: string
  role: string
  sid: string
}
export interface SessionTokens {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: Date
  refreshTokenExpiresAt: Date
}
const issuer = "erickcorttes-api"
const audience = "erickcorttes-web"
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const d = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer,
      audience,
      algorithms: ["HS256"],
    })
    if (
      typeof d === "string" ||
      typeof d.sub !== "string" ||
      !uuid.test(d.sub) ||
      typeof d.sid !== "string" ||
      !uuid.test(d.sid) ||
      typeof d.exp !== "number"
    )
      throw new Error("claims")
    return { sub: d.sub, sid: d.sid, role: String(d.role ?? "") }
  } catch {
    throw AppError.unauthorized(
      ErrorCodes.INVALID_TOKEN,
      "Sessão expirada ou inválida.",
    )
  }
}

// Caller holds the user lock; session creation belongs to the same transaction
// as the credential check, so uma verificação bem-sucedida e a sessão nascem juntas.
export async function createSession(
  tx: Prisma.TransactionClient,
  user: {
    id: string
    role: string
  },
): Promise<SessionTokens> {
  const refreshToken = generateRefreshToken()
  const refreshTokenExpiresAt = new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400000,
  )
  const session = await tx.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiresAt,
    },
  })
  const seconds = env.ACCESS_TOKEN_TTL_MINUTES * 60
  const accessToken = jwt.sign(
    { sub: user.id, role: user.role, sid: session.id },
    env.JWT_ACCESS_SECRET,
    { algorithm: "HS256", issuer, audience, expiresIn: seconds },
  )
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(Date.now() + seconds * 1000),
    refreshTokenExpiresAt,
  }
}

export async function issueSession(userId: string): Promise<SessionTokens> {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId)
    const user = await tx.user.findUnique({ where: { id: userId } })
    if (!user)
      throw AppError.unauthorized(ErrorCodes.INVALID_TOKEN, "Sessão inválida.")
    if (user.status === "BLOCKED")
      throw AppError.forbidden(ErrorCodes.ACCOUNT_BLOCKED, "Conta bloqueada.")
    return createSession(tx, user)
  })
}

export async function rotateSession(
  presentedToken: string,
): Promise<SessionTokens> {
  const tokenHash = hashRefreshToken(presentedToken)
  const result = await prisma.$transaction(async (tx) => {
    const lookup = await tx.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    })
    if (!lookup)
      return {
        error: AppError.unauthorized(
          ErrorCodes.INVALID_TOKEN,
          "Sessão inválida.",
        ),
      }
    await lockUser(tx, lookup.userId)
    const stored = await tx.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    })
    if (!stored)
      return {
        error: AppError.unauthorized(
          ErrorCodes.INVALID_TOKEN,
          "Sessão inválida.",
        ),
      }
    if (stored.revokedAt || stored.user.status === "BLOCKED") {
      await tx.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      // Return, then throw outside the transaction: revocation MUST commit on reuse.
      return {
        error:
          stored.user.status === "BLOCKED"
            ? AppError.forbidden(ErrorCodes.ACCOUNT_BLOCKED, "Conta bloqueada.")
            : AppError.unauthorized(
                ErrorCodes.INVALID_TOKEN,
                "Sessão inválida.",
              ),
      }
    }
    if (stored.expiresAt.getTime() <= Date.now())
      return {
        error: AppError.unauthorized(
          ErrorCodes.INVALID_TOKEN,
          "Sessão expirada.",
        ),
      }
    const tokens = await createSession(tx, stored.user)
    const replacement = await tx.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(tokens.refreshToken) },
    })
    await tx.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: replacement.id },
    })
    return { tokens }
  })
  if (result.error) throw result.error
  return result.tokens!
}

export async function revokeSession(presentedToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(presentedToken)
  await prisma.$transaction(async (tx) => {
    const stored = await tx.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    })
    if (!stored) return
    await lockUser(tx, stored.userId)
    // A logout racing rotation must also revoke the successor of that session.
    let current: string | null = tokenHash
    while (current) {
      const token: RefreshToken | null = await tx.refreshToken.findUnique({
        where: { tokenHash: current },
      })
      if (!token) break
      await tx.refreshToken.update({
        where: { id: token.id },
        data: { revokedAt: new Date() },
      })
      const next: RefreshToken | null = token.replacedById
        ? await tx.refreshToken.findUnique({
            where: { id: token.replacedById },
          })
        : null
      current = next?.tokenHash ?? null
    }
  })
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId)
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  })
}
