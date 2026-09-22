import { env, isProduction } from "../../../config/env.js"
import { logger } from "../../../utils/logger.js"
import { AppError, ErrorCodes } from "../../../utils/errors.js"
import { maskPhone } from "../../../utils/phone.js"

/**
 * Contrato de envio de OTP. Trocar de fornecedor (Twilio, Zenvia, Supabase...)
 * significa implementar esta interface — nada além disso conhece o provider.
 */
export interface SmsProvider {
  readonly name: string
  sendOtp(phone: string, code: string): Promise<void>
}

/**
 * Provider de desenvolvimento: imprime o código no log do servidor.
 * Protegido em duas camadas — a validação de env recusa produção, e o
 * construtor recusa de novo em tempo de execução.
 */
class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console"

  constructor() {
    if (isProduction) {
      throw new Error("ConsoleSmsProvider não pode ser usado em produção.")
    }
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    if (isProduction || !env.AUTH_OTP_DEV_MODE) {
      throw new AppError(
        ErrorCodes.SMS_UNAVAILABLE,
        "Provider de SMS indisponível.",
        503,
      )
    }
    // Exceção explícita de desenvolvimento: nunca via API ou logger estruturado.
    console.log(
      `\n[DEV OTP] ${maskPhone(phone)} -> ${code}  (expira em ${env.OTP_TTL_MINUTES} min)\n`,
    )
  }
}

/**
 * Esqueleto do provider real. A integração HTTP entra aqui na fase de
 * produção; deixamos explícito para ninguém achar que já está enviando SMS.
 */
class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio"

  async sendOtp(phone: string, _code: string): Promise<void> {
    logger.error("Provider de SMS Twilio ainda não implementado", {
      phone: maskPhone(phone),
    })
    throw new Error(
      "SMS_PROVIDER=twilio ainda não possui integração. Implemente TwilioSmsProvider.sendOtp antes de usar em produção.",
    )
  }
}

export function createSmsProvider(): SmsProvider {
  switch (env.SMS_PROVIDER) {
    case "twilio":
      return new TwilioSmsProvider()
    case "console":
    default:
      return new ConsoleSmsProvider()
  }
}

export const smsProvider: SmsProvider = createSmsProvider()
