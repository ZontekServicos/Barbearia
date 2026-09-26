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

/**
 * Etapa de cadastro do fluxo público: cada chamada pode criar um contato.
 * Orçamento próprio, separado do envio da solicitação, para que um não consuma
 * o do outro.
 */
export const publicContactRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: 15 * 60_000,
  limit: 10,
})

/**
 * Webhook de pagamento.
 *
 * Folgado de propósito: é o provedor batendo, e ele legitimamente reenvia
 * quando não recebe 2xx. Estrangular a notificação legítima seria pior que o
 * abuso que o limite evita — quem não tem a assinatura não passa de
 * `parseWebhook` de qualquer forma.
 */
export const paymentWebhookRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: 60_000,
  limit: 120,
})

/**
 * Criação/reabertura da cobrança pelo cliente, com o token da solicitação.
 *
 * Apertado: cada chamada pode falar com o provedor de pagamento.
 */
export const paymentIntentRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: 10 * 60_000,
  limit: 12,
})
