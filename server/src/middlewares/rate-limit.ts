import rateLimit, { type Options } from 'express-rate-limit'
import { ErrorCodes } from '../utils/errors.js'

const sharedOptions: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: ErrorCodes.RATE_LIMITED,
        message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
      },
    })
  },
}

/** Limite geral da API. */
export const globalRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: 60_000,
  limit: 120,
})

/**
 * Pedido de OTP: limite rígido por IP. Cada envio custa um SMS e é um vetor
 * de abuso (enumeração e flood).
 */
export const requestOtpRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60_000,
  limit: 5,
})

/** Verificação de OTP: evita força bruta distribuída sobre o código. */
export const verifyOtpRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60_000,
  limit: 10,
})
