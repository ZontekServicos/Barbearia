import type { Response } from 'express'
import type { ErrorCode } from './errors.js'

/** Envelope de sucesso: { success: true, data }. */
export function sendSuccess<T>(res: Response, data: T, statusCode = 200): Response {
  return res.status(statusCode).json({ success: true, data })
}

/** Envelope de erro: { success: false, error: { code, message } }. */
export function sendError(
  res: Response,
  statusCode: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
): Response {
  return res.status(statusCode).json({
    success: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  })
}
