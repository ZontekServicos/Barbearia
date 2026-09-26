import { env } from "../../config/env.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import type { PaymentProvider } from "./payment.provider.js"
import { createManualProvider, MANUAL_PROVIDER_NAME } from "./providers/manual.provider.js"

/**
 * Qual provedor está ativo.
 *
 * Um só por instalação: cobrar por dois caminhos ao mesmo tempo multiplicaria
 * os estados de reconciliação sem ninguém pedir. Quando houver necessidade de
 * mais de um, o registro abaixo já é o ponto de extensão.
 *
 * Provedores conectáveis depois — todos com suporte a Pix, que é o alvo:
 *   - Mercado Pago (Pix + cartão; webhook por notificação de merchant_order);
 *   - Asaas (Pix + boleto; webhook com token próprio);
 *   - Pagar.me / Stripe (cartão; Pix apenas na operação brasileira);
 *   - PSP direto do banco (Pix puro, via API do próprio banco).
 *
 * Para conectar um deles: implementar `PaymentProvider`, registrar aqui,
 * adicionar o nome ao enum de `PAYMENT_PROVIDER` em config/env.ts. Nada acima
 * desta camada muda.
 */
const factories: Record<string, () => PaymentProvider> = {
  [MANUAL_PROVIDER_NAME]: createManualProvider,
}

let instance: PaymentProvider | null = null
let resolvedFor: string | undefined

/**
 * Provedor ativo, ou `null` quando pagamento está desligado.
 *
 * `null` não é erro: é a instalação sem provedor configurado, onde a aprovação
 * do barbeiro confirma a reserva direto — o comportamento anterior a esta
 * versão.
 */
export function getPaymentProvider(): PaymentProvider | null {
  const name = env.PAYMENT_PROVIDER
  if (!name) return null
  if (instance && resolvedFor === name) return instance

  const factory = factories[name]
  // Inalcançável pelo enum do ambiente; a guarda existe para o dia em que
  // alguém adicionar um nome ao enum e esquecer de registrar a fábrica.
  if (!factory) throw new Error(`Provedor de pagamento desconhecido: ${name}`)

  instance = factory()
  resolvedFor = name
  return instance
}

/** Igual ao anterior, mas falha quando o pagamento deveria estar configurado. */
export function requirePaymentProvider(): PaymentProvider {
  const provider = getPaymentProvider()
  if (!provider) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_ERROR,
      "Pagamento não está disponível no momento.",
    )
  }
  return provider
}

/** Só para os testes: descarta a instância memorizada entre cenários. */
export function resetPaymentProviderCache(): void {
  instance = null
  resolvedFor = undefined
}
