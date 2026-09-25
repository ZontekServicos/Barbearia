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
 * Cadastro: cada requisição cria uma conta real que o administrador terá de
 * revisar. Limite rígido por IP para que ninguém encha a fila de aprovação.
 */
export const registerRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60_000,
  limit: 5,
})

/**
 * Login: freio por IP contra força bruta e contra varredura de telefones.
 *
 * Complementa — não substitui — o bloqueio por conta em auth.service, que
 * fica no banco e por isso continua valendo com várias réplicas e quando o
 * atacante troca de IP. Este limitador é por processo.
 */
export const loginRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60_000,
  limit: 10,
})

/** Limita tentativas da senha atual e redefinições privilegiadas. */
export const passwordChangeRateLimit = rateLimit({ ...sharedOptions, windowMs: 15 * 60_000, limit: 10 })

/**
 * Solicitação pública de agendamento: não exige login, então o limite por IP é
 * a primeira barreira contra flood. Complementa o limite durável por telefone
 * aplicado em public-booking.service, que vale entre réplicas.
 */
export const publicBookingRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60_000,
  limit: 10,
})

/** Consulta do próprio pedido pelo token: leitura barata, limite generoso. */
export const publicRequestLookupRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60_000,
  limit: 60,
})
