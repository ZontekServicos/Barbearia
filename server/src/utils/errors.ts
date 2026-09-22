/** Códigos de erro estáveis, consumidos pelo frontend para decidir o que exibir. */
export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_PHONE: "INVALID_PHONE",
  OTP_INVALID: "OTP_INVALID",
  OTP_EXPIRED: "OTP_EXPIRED",
  OTP_MAX_ATTEMPTS: "OTP_MAX_ATTEMPTS",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  INVALID_TOKEN: "INVALID_TOKEN",
  FORBIDDEN: "FORBIDDEN",
  ACCOUNT_PENDING: "ACCOUNT_PENDING",
  ACCOUNT_BLOCKED: "ACCOUNT_BLOCKED",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  PHONE_ALREADY_REGISTERED: "PHONE_ALREADY_REGISTERED",
  RATE_LIMITED: "RATE_LIMITED",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SMS_UNAVAILABLE: "SMS_UNAVAILABLE",
  CONFLICT: "CONFLICT",
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]

/** Erro previsto da aplicação. Qualquer coisa que não seja AppError vira 500 genérico. */
export class AppError extends Error {
  readonly statusCode: number
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(
    code: ErrorCode,
    message: string,
    statusCode = 400,
    details?: unknown,
  ) {
    super(message)
    this.name = "AppError"
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }

  static badRequest(code: ErrorCode, message: string, details?: unknown) {
    return new AppError(code, message, 400, details)
  }

  static unauthorized(
    code: ErrorCode = ErrorCodes.UNAUTHENTICATED,
    message = "Autenticação necessária.",
  ) {
    return new AppError(code, message, 401)
  }

  static forbidden(
    code: ErrorCode = ErrorCodes.FORBIDDEN,
    message = "Acesso negado.",
  ) {
    return new AppError(code, message, 403)
  }

  static notFound(
    code: ErrorCode = ErrorCodes.NOT_FOUND,
    message = "Recurso não encontrado.",
  ) {
    return new AppError(code, message, 404)
  }

  static conflict(code: ErrorCode, message: string) {
    return new AppError(code, message, 409)
  }

  static tooManyRequests(
    message = "Muitas tentativas. Tente novamente mais tarde.",
  ) {
    return new AppError(ErrorCodes.RATE_LIMITED, message, 429)
  }
}
