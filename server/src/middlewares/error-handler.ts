import type { NextFunction, Request, Response } from "express"
import { ZodError } from "zod"
import { AppError, ErrorCodes } from "../utils/errors.js"
import { sendError } from "../utils/http.js"
import { logger } from "../utils/logger.js"
import { isProduction } from "../config/env.js"

function safePath(path: string): string {
  return path.replace(/(\/booking\/requests\/)[^/]+/g, "$1[redacted]")
}

export function notFoundHandler(req: Request, res: Response) {
  return sendError(
    res,
    404,
    ErrorCodes.NOT_FOUND,
    `Rota não encontrada: ${req.method} ${safePath(req.path)}`,
  )
}

/**
 * Tratamento centralizado. Nada que não seja AppError vaza detalhe para o
 * cliente — em produção a resposta é sempre genérica, sem stack trace.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error("Erro de aplicação", { code: error.code, path: safePath(req.path) })
    }
    return sendError(
      res,
      error.statusCode,
      error.code,
      error.message,
      error.details,
    )
  }

  if (error instanceof ZodError) {
    return sendError(
      res,
      400,
      ErrorCodes.VALIDATION_ERROR,
      "Dados inválidos.",
      formatZodIssues(error),
    )
  }

  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : ""
  if (code === "P2002")
    return sendError(res, 409, ErrorCodes.CONFLICT, "Registro já existente.")
  if (code === "P2025")
    return sendError(res, 404, ErrorCodes.NOT_FOUND, "Registro não encontrado.")
  if (code === "P2003")
    return sendError(
      res,
      409,
      ErrorCodes.CONFLICT,
      "A operação conflita com registros relacionados.",
    )
  const type =
    error && typeof error === "object" && "type" in error ? error.type : ""
  if (type === "entity.parse.failed")
    return sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "JSON inválido.")
  if (type === "entity.too.large")
    return sendError(
      res,
      413,
      ErrorCodes.VALIDATION_ERROR,
      "Corpo da requisição muito grande.",
    )

  logger.error("Erro não tratado", {
    path: safePath(req.path),
    method: req.method,
    name: error instanceof Error ? error.name : "UnknownError",
    ...(isProduction || req.path.startsWith("/booking/requests") || req.path.startsWith("/booking/contacts")
      ? {}
      : { stack: error instanceof Error ? error.stack : undefined }),
  })

  return sendError(
    res,
    500,
    ErrorCodes.INTERNAL_ERROR,
    "Erro interno. Tente novamente em instantes.",
  )
}

export function formatZodIssues(
  error: ZodError,
): Array<{
  field: string
  message: string
}> {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(raiz)",
    message: issue.message,
  }))
}
