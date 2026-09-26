import { createHmac, timingSafeEqual } from "node:crypto"
import { env, isProduction } from "../../../config/env.js"
import { AppError, ErrorCodes } from "../../../utils/errors.js"
import type {
  CreatePaymentInput,
  CreatedPayment,
  PaymentProvider,
  ProviderPaymentState,
  RawWebhookRequest,
  WebhookNotification,
} from "../payment.provider.js"

/**
 * Adaptador de TESTE. Não move dinheiro.
 *
 * Existe para exercitar o fluxo inteiro — criação, notificação, idempotência,
 * divergência de valor, expiração — sem nenhuma credencial de provedor e sem
 * nenhuma transação real. É o que os testes automatizados usam.
 *
 * Em produção ele é recusado na validação do ambiente (ver config/env.ts), não
 * aqui, para o processo morrer na inicialização em vez de no meio de uma
 * cobrança. A guarda abaixo é a segunda tranca: se alguém contornar a
 * validação, ainda assim não roda.
 *
 * A notificação é autenticada por HMAC-SHA256 sobre os bytes do corpo, com
 * PAYMENT_WEBHOOK_SECRET — o mesmo desenho que provedores reais usam. Assim o
 * caminho de validação que os testes cobrem é o caminho de verdade, não uma
 * simulação frouxa que aceita qualquer coisa.
 */
export const MANUAL_PROVIDER_NAME = "manual"

interface ManualWebhookBody {
  eventId?: unknown
  providerPaymentId?: unknown
  status?: unknown
  amountCents?: unknown
  currency?: unknown
  reference?: unknown
}

const VALID_STATUSES = new Set(["PENDING", "PAID", "FAILED", "EXPIRED", "CANCELED"])

function refuse(): AppError {
  // Mensagem única e neutra: um webhook não conta a quem bate na porta o que
  // estava errado na tentativa.
  return AppError.badRequest(ErrorCodes.VALIDATION_ERROR, "Notificação inválida.")
}

export function createManualProvider(): PaymentProvider {
  if (isProduction) {
    throw new Error(
      "O provedor 'manual' é de teste e não pode ser instanciado em produção.",
    )
  }
  const secret = env.PAYMENT_WEBHOOK_SECRET
  if (!secret) throw new Error("PAYMENT_WEBHOOK_SECRET é obrigatório com PAYMENT_PROVIDER.")

  /**
   * Chave separada para derivar identificadores de cobrança.
   *
   * O identificador é devolvido ao cliente dentro do endereço de checkout. Se
   * ele fosse HMAC direto do segredo de assinatura, cada cobrança publicaria um
   * par (entrada, saída) daquele segredo. HMAC-SHA256 não entrega a chave por
   * isso, mas separar domínios é barato e tira a pergunta do caminho.
   */
  const idKey = createHmac("sha256", secret).update("manual-payment-id:v1").digest()

  return {
    name: MANUAL_PROVIDER_NAME,

    async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
      // Id determinístico a partir da referência: o teste sabe onde notificar
      // sem precisar de estado compartilhado, e duas cobranças diferentes nunca
      // colidem porque a referência é única por agendamento.
      const providerPaymentId = `manual-${createHmac("sha256", idKey)
        .update(`payment:${input.reference}`)
        .digest("hex")
        .slice(0, 32)}`
      return {
        providerPaymentId,
        // Endereço fictício de checkout. Não há tela de provedor nenhuma.
        checkoutUrl: `https://pagamento.invalido/manual/${providerPaymentId}`,
        pixQrCode: `00020126MANUAL${providerPaymentId}`,
      }
    },

    async getPayment(providerPaymentId: string): Promise<ProviderPaymentState> {
      // Sem serviço externo para consultar. Reconciliação ativa é o que um
      // provedor real implementa aqui; declarar PAID sem consultar ninguém
      // seria exatamente a confirmação falsa que este desenho evita.
      throw AppError.badRequest(
        ErrorCodes.VALIDATION_ERROR,
        `Consulta ativa não existe no adaptador de teste (${providerPaymentId}).`,
      )
    },

    async parseWebhook(request: RawWebhookRequest): Promise<WebhookNotification> {
      const signature = request.headers["x-payment-signature"]
      if (typeof signature !== "string" || signature.length === 0) throw refuse()

      const expected = createHmac("sha256", secret).update(request.rawBody).digest("hex")
      const received = Buffer.from(signature, "utf8")
      const computed = Buffer.from(expected, "utf8")
      // Comparação de tamanho primeiro: timingSafeEqual lança com tamanhos
      // diferentes, e o tamanho da assinatura não é segredo.
      if (received.length !== computed.length) throw refuse()
      if (!timingSafeEqual(received, computed)) throw refuse()

      let body: ManualWebhookBody
      try {
        body = JSON.parse(request.rawBody) as ManualWebhookBody
      } catch {
        throw refuse()
      }

      const { eventId, providerPaymentId, status, amountCents, currency, reference } = body
      if (
        typeof eventId !== "string" || eventId.length === 0 || eventId.length > 200 ||
        typeof providerPaymentId !== "string" || providerPaymentId.length === 0 ||
        typeof status !== "string" || !VALID_STATUSES.has(status) ||
        typeof amountCents !== "number" || !Number.isInteger(amountCents) ||
        typeof currency !== "string" || currency.length !== 3 ||
        typeof reference !== "string" || reference.length === 0
      ) {
        throw refuse()
      }

      return {
        eventId,
        payment: {
          providerPaymentId,
          status: status as ProviderPaymentState["status"],
          amountCents,
          currency,
          reference,
        },
      }
    },
  }
}
