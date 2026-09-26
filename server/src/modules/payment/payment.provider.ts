/**
 * Contrato de um provedor de pagamento.
 *
 * O domínio conhece só esta interface. Nenhum serviço acima dela sabe se o
 * dinheiro entra por Pix, cartão ou boleto — e trocar de provedor não toca em
 * agendamento, agenda ou confirmação.
 *
 * Três operações, porque três coisas precisam acontecer:
 *   - `createPayment` — abrir a cobrança quando o barbeiro aprova;
 *   - `getPayment`    — conferir o estado direto na fonte, para não depender de
 *                       uma notificação que pode se perder;
 *   - `parseWebhook`  — validar a autenticidade da notificação e traduzi-la.
 *
 * O que NÃO está aqui, deliberadamente: nada que confirme pagamento a partir do
 * navegador. Não há operação "marcar como pago"; a confirmação só nasce de
 * `parseWebhook` ou `getPayment`, ambas falando com o provedor.
 */

/** Estado do dinheiro do ponto de vista do provedor. */
export type ProviderPaymentStatus =
  | "PENDING"
  | "PAID"
  | "FAILED"
  | "EXPIRED"
  | "CANCELED"

export interface CreatePaymentInput {
  /**
   * Referência pública do agendamento ("EC-7F3K2Q"). É o que aparece no
   * extrato e o que conferimos quando a notificação chega.
   *
   * Nunca o publicToken, nunca o id interno: os dois são credenciais de
   * consulta e não podem circular por sistema de terceiro.
   */
  reference: string
  /** Em centavos, calculado no servidor a partir do preço do banco. */
  amountCents: number
  currency: string
  /** Texto curto para o cliente reconhecer a cobrança. Sem dado pessoal. */
  description: string
  /** Fim da janela de pagamento. O provedor deve expirar junto. */
  expiresAt: Date
}

export interface CreatedPayment {
  /** Identificador da cobrança no provedor. */
  providerPaymentId: string
  /** Endereço público de checkout, quando o provedor oferece um. */
  checkoutUrl?: string
  /** Pix copia-e-cola. É público por natureza — não é segredo. */
  pixQrCode?: string
}

/** Retrato da cobrança conforme o provedor. Usado para conferência. */
export interface ProviderPaymentState {
  providerPaymentId: string
  status: ProviderPaymentStatus
  amountCents: number
  currency: string
  /** A referência que enviamos na criação, devolvida pelo provedor. */
  reference: string
}

export interface WebhookNotification {
  /**
   * Identificador da NOTIFICAÇÃO no provedor — não da cobrança.
   *
   * É a chave de idempotência: a mesma notificação reenviada traz o mesmo
   * `eventId`, e a unicidade em `payment_webhook_events` descarta a repetição.
   */
  eventId: string
  payment: ProviderPaymentState
}

/** Requisição crua do webhook, para o provedor validar a assinatura. */
export interface RawWebhookRequest {
  headers: Record<string, string | undefined>
  /** Corpo exatamente como chegou. Assinatura se calcula sobre os bytes. */
  rawBody: string
}

export interface PaymentProvider {
  readonly name: string
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>
  getPayment(providerPaymentId: string): Promise<ProviderPaymentState>
  /**
   * Valida a autenticidade e traduz a notificação.
   *
   * Deve LANÇAR quando a assinatura não confere. Devolver algo aqui é afirmar
   * que a mensagem veio mesmo do provedor.
   */
  parseWebhook(request: RawWebhookRequest): Promise<WebhookNotification>
}
