import type { Request, Response } from "express"
import { env, isProduction } from "../../config/env.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { sendSuccess } from "../../utils/http.js"
import { toPublicUser } from "../users/users.mapper.js"
import { prisma } from "../../config/prisma.js"
import { requestOtp, verifyOtp } from "./auth.service.js"
import {
  revokeSession,
  rotateSession,
  type SessionTokens,
} from "./token.service.js"
import type { RequestOtpInput, VerifyOtpInput } from "./auth.schemas.js"

const REFRESH_COOKIE = "ec_refresh"

/**
 * O refresh token vai em cookie httpOnly: mesmo com XSS o script da página não
 * consegue lê-lo. O access token fica em memória no frontend.
 */
export function setRefreshCookie(res: Response, tokens: SessionTokens): void {
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: env.REFRESH_COOKIE_SAME_SITE,
    expires: tokens.refreshTokenExpiresAt,
    maxAge: Math.max(0, tokens.refreshTokenExpiresAt.getTime() - Date.now()),
    path: env.REFRESH_COOKIE_PATH,
  })
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: isProduction,
    sameSite: env.REFRESH_COOKIE_SAME_SITE,
    path: env.REFRESH_COOKIE_PATH,
  })
}

/** O refresh token nunca é devolvido no corpo — só no cookie. */
function sessionPayload(tokens: SessionTokens) {
  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
  }
}

export async function requestOtpController(req: Request, res: Response) {
  const { phone } = req.body as RequestOtpInput
  const result = await requestOtp(phone)

  return sendSuccess(res, {
    expiresInSeconds: result.expiresInSeconds,
    // Só em desenvolvimento dizemos onde o código foi parar.
    ...(env.AUTH_OTP_DEV_MODE
      ? { devHint: "Código registrado no log do servidor." }
      : {}),
  })
}

export async function verifyOtpController(req: Request, res: Response) {
  const { phone, code, fullName } = req.body as VerifyOtpInput
  const { user, tokens, isNewUser } = await verifyOtp(phone, code, fullName)

  setRefreshCookie(res, tokens)

  return sendSuccess(
    res,
    { user, isNewUser, ...sessionPayload(tokens) },
    isNewUser ? 201 : 200,
  )
}

export async function refreshController(req: Request, res: Response) {
  const raw: unknown = req.cookies?.[REFRESH_COOKIE]
  const presented =
    typeof raw === "string" && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : undefined

  if (!presented) {
    clearRefreshCookie(res)
    throw AppError.unauthorized(
      ErrorCodes.UNAUTHENTICATED,
      "Sessão não encontrada.",
    )
  }

  try {
    const tokens = await rotateSession(presented)
    setRefreshCookie(res, tokens)
    return sendSuccess(res, sessionPayload(tokens))
  } catch (error) {
    if (error instanceof AppError && [401, 403].includes(error.statusCode))
      clearRefreshCookie(res)
    throw error
  }
}

export async function logoutController(req: Request, res: Response) {
  const raw: unknown = req.cookies?.[REFRESH_COOKIE]
  const presented =
    typeof raw === "string" && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : undefined

  if (presented) {
    await revokeSession(presented)
  }

  clearRefreshCookie(res)
  return sendSuccess(res, { loggedOut: true })
}

export async function meController(req: Request, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user) {
    throw AppError.notFound(
      ErrorCodes.USER_NOT_FOUND,
      "Usuário não encontrado.",
    )
  }
  return sendSuccess(res, { user: toPublicUser(user) })
}
