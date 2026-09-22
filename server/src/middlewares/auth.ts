import type { NextFunction, Request, RequestHandler, Response } from "express"
import { prisma } from "../config/prisma.js"
import { AppError, ErrorCodes } from "../utils/errors.js"
import { verifyAccessToken } from "../modules/auth/token.service.js"
import type { UserRole } from "../generated/prisma/enums.js"

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization
  if (!header?.startsWith("Bearer ")) return null
  const token = header.slice("Bearer ".length).trim()
  return token.length > 0 ? token : null
}

/**
 * Valida o access token e recarrega o usuário do banco.
 *
 * O papel e o status vêm sempre do banco, nunca do JWT: assim, bloquear ou
 * rebaixar alguém tem efeito imediato, sem esperar o token expirar.
 */
export const requireAuth: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const token = extractBearerToken(req)
    if (!token) {
      throw AppError.unauthorized(
        ErrorCodes.UNAUTHENTICATED,
        "Autenticação necessária.",
      )
    }

    const payload = verifyAccessToken(token)

    const session = await prisma.refreshToken.findUnique({
      where: { id: payload.sid },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            status: true,
            phone: true,
            fullName: true,
          },
        },
      },
    })
    const user = session?.user
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw AppError.unauthorized(ErrorCodes.INVALID_TOKEN, "Sessão inválida.")
    }

    if (!user) {
      throw AppError.unauthorized(ErrorCodes.INVALID_TOKEN, "Sessão inválida.")
    }

    if (user.status === "BLOCKED") {
      throw AppError.forbidden(
        ErrorCodes.ACCOUNT_BLOCKED,
        "Sua conta está bloqueada.",
      )
    }

    req.user = user
    next()
  } catch (error) {
    next(error)
  }
}

/** Exige um papel específico. A decisão é sempre do backend. */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(AppError.unauthorized())
      return
    }
    if (!roles.includes(req.user.role)) {
      next(
        AppError.forbidden(
          ErrorCodes.FORBIDDEN,
          "Você não tem permissão para esta ação.",
        ),
      )
      return
    }
    next()
  }
}

/**
 * Exige conta aprovada. Usuários PENDING autenticam e enxergam o próprio
 * perfil, mas não executam ações de cliente ativo (ex.: agendar).
 */
export const requireActiveAccount: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    next(AppError.unauthorized())
    return
  }
  if (req.user.status === "PENDING") {
    next(
      AppError.forbidden(
        ErrorCodes.ACCOUNT_PENDING,
        "Seu cadastro está aguardando aprovação da barbearia.",
      ),
    )
    return
  }
  if (req.user.status === "BLOCKED") {
    next(
      AppError.forbidden(
        ErrorCodes.ACCOUNT_BLOCKED,
        "Sua conta está bloqueada.",
      ),
    )
    return
  }
  next()
}
