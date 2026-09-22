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
 * Monta a mensagem entregue ao cliente. O código é gerado e validado pelo
 * backend; a Twilio é só transporte e nunca decide o conteúdo do OTP.
 */
export function buildOtpMessage(code: string): string {
  return `ERICKCORTTES BARBEARIA: seu código de confirmação é ${code}. Não compartilhe este código.`
}

export interface TwilioConfig {
  accountSid: string
  authToken: string
  /** Remetente por número E.164. Alternativa ao Messaging Service. */
  fromNumber?: string
  /** Remetente por Messaging Service. Tem precedência sobre `fromNumber`. */
  messagingServiceSid?: string
  timeoutMs: number
}

type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
}>

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01"

/**
 * Status terminais de falha devolvidos pela própria Twilio num HTTP 201.
 * Aceitar `failed`/`undelivered` como sucesso faria o backend afirmar que o
 * código foi enviado quando não foi.
 */
const FAILED_MESSAGE_STATUS = new Set(["failed", "undelivered", "canceled"])
const ACCEPTED_MESSAGE_STATUS = new Set(["accepted", "queued", "sending", "sent", "delivered"])
const MESSAGE_SID_PATTERN = /^SM[0-9a-fA-F]{32}$/

/** Códigos da Twilio que indicam destinatário inválido, não falha nossa. */
const INVALID_DESTINATION_CODES = new Set([
  21211, // 'To' inválido
  21214, // 'To' não é um número válido para SMS
  21408, // permissão de envio para a região desabilitada
  21610, // destinatário optou por não receber
  21614, // 'To' não é um número móvel
])

/** Códigos que indicam remetente/credencial mal configurados no nosso lado. */
const CONFIGURATION_CODES = new Set([
  20003, // autenticação recusada
  21212, // 'From' inválido
  21265, // Messaging Service sem remetente disponível
  21603, // 'From' obrigatório
  21606, // 'From' não habilitado para SMS
  21608, // número de teste: só envia para destinos verificados
  21660, // par remetente/conta inconsistente
])

/**
 * Envio real via API REST da Twilio.
 *
 * Usa `fetch` nativo em vez do SDK oficial: a chamada é um único POST
 * form-urlencoded, o SDK traria uma árvore de dependências grande para dentro
 * do caminho de autenticação, e injetar `fetch` deixa a suíte testar falhas,
 * timeouts e respostas do provedor sem disparar SMS de verdade.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio"
  private readonly config: TwilioConfig
  private readonly fetchImpl: FetchLike

  constructor(config: TwilioConfig, fetchImpl?: FetchLike) {
    // Defesa em profundidade: a validação de env já barra isso no boot, mas o
    // provider não confia em ter sido construído pelo caminho feliz.
    if (!config.accountSid || !config.authToken) {
      throw new Error(
        "TwilioSmsProvider exige TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN.",
      )
    }
    if (!config.fromNumber && !config.messagingServiceSid) {
      throw new Error(
        "TwilioSmsProvider exige TWILIO_MESSAGING_SERVICE_SID ou TWILIO_FROM_NUMBER.",
      )
    }

    this.config = config
    const resolved = fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
    if (typeof resolved !== "function") {
      throw new Error("fetch indisponível neste runtime; use Node 18 ou superior.")
    }
    this.fetchImpl = resolved
  }

  private authorizationHeader(): string {
    const credentials = `${this.config.accountSid}:${this.config.authToken}`
    return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    const form = new URLSearchParams({ To: phone, Body: buildOtpMessage(code) })
    // Messaging Service vence quando ambos existem: é o modo mais completo
    // (pool de remetentes, compliance) e combinar os dois é ambíguo.
    if (this.config.messagingServiceSid) {
      form.set("MessagingServiceSid", this.config.messagingServiceSid)
    } else {
      form.set("From", this.config.fromNumber!)
    }

    const url = `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(this.config.accountSid)}/Messages.json`

    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: this.authorizationHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        // `form` carrega o OTP: nunca entra em log, nem em mensagem de erro.
        body: form.toString(),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch (error) {
      // Rede, DNS, TLS e timeout caem aqui. A causa original não é propagada
      // adiante para não vazar URL, credencial ou stack na resposta HTTP.
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      logger.error("Falha de comunicação com a Twilio", {
        provider: this.name,
        phone: maskPhone(phone),
        reason: timedOut ? "timeout" : "network",
        timeoutMs: this.config.timeoutMs,
      })
      throw this.unavailable()
    }

    const payload = await readJsonSafely(response)

    if (!response.ok) {
      const providerErrorCode =
        typeof payload?.code === "number" &&
        (INVALID_DESTINATION_CODES.has(payload.code) || CONFIGURATION_CODES.has(payload.code) || [20429, 20500].includes(payload.code))
          ? payload.code : undefined
      logger.error("Twilio recusou o envio do OTP", {
        provider: this.name,
        phone: maskPhone(phone),
        httpStatus: response.status,
        providerErrorCode,
        reason: classifyFailure(response.status, providerErrorCode),
      })
      throw this.unavailable()
    }

    const status = typeof payload?.status === "string" ? payload.status : ""
    const messageSid = typeof payload?.sid === "string" && MESSAGE_SID_PATTERN.test(payload.sid)
      ? payload.sid : undefined
    if (FAILED_MESSAGE_STATUS.has(status)) {
      logger.error("Twilio aceitou a requisição mas marcou a mensagem como falha", {
        provider: this.name,
        phone: maskPhone(phone),
        messageStatus: status,
        messageSid,
      })
      throw this.unavailable()
    }

    if (response.status !== 201 || !messageSid || !ACCEPTED_MESSAGE_STATUS.has(status)) {
      // Invalid JSON, interrupted body reads and unknown states never mean success.
      logger.error("Resposta invalida da Twilio", {
        provider: this.name,
        phone: maskPhone(phone),
        httpStatus: response.status,
        reason: "invalid-provider-response",
      })
      throw this.unavailable()
    }

    // Identificador da mensagem é operacional (rastreio no painel da Twilio),
    // não é segredo — e é o que permite investigar uma entrega depois.
    logger.info("Solicitacao de SMS aceita pela Twilio", {
      provider: this.name,
      phone: maskPhone(phone),
      messageSid,
      messageStatus: status,
    })
  }

  /** Resposta única para o chamador: nada da Twilio atravessa essa fronteira. */
  private unavailable(): AppError {
    return new AppError(
      ErrorCodes.SMS_UNAVAILABLE,
      "Não foi possível enviar o código no momento.",
      503,
    )
  }
}

/** Rótulo operacional para o log. Nunca chega ao frontend. */
function classifyFailure(
  httpStatus: number,
  providerErrorCode: number | undefined,
): string {
  if (providerErrorCode && INVALID_DESTINATION_CODES.has(providerErrorCode)) {
    return "destinatario-invalido"
  }
  if (providerErrorCode && CONFIGURATION_CODES.has(providerErrorCode)) {
    return "configuracao-invalida"
  }
  if (httpStatus === 401 || httpStatus === 403) return "credenciais-invalidas"
  if (httpStatus === 429) return "limite-do-provedor"
  if (httpStatus >= 500) return "provedor-indisponivel"
  return "requisicao-recusada"
}

/**
 * Lê o corpo sem deixar o parse derrubar o fluxo: um HTML de proxy ou uma
 * resposta vazia não podem virar exceção não tratada dentro do login.
 */
async function readJsonSafely(
  response: Awaited<ReturnType<FetchLike>>,
): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await response.text()
    if (!text || text.length > 8192) return undefined
    // Limite defensivo: não analisamos payloads inesperadamente grandes.
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export function createSmsProvider(): SmsProvider {
  switch (env.SMS_PROVIDER) {
    case "twilio":
      return new TwilioSmsProvider({
        accountSid: env.TWILIO_ACCOUNT_SID!,
        authToken: env.TWILIO_AUTH_TOKEN!,
        fromNumber: env.TWILIO_FROM_NUMBER,
        messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
        timeoutMs: env.TWILIO_TIMEOUT_MS,
      })
    case "console":
    default:
      return new ConsoleSmsProvider()
  }
}

export const smsProvider: SmsProvider = createSmsProvider()
