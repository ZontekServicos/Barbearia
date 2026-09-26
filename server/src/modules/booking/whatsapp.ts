import { env } from "../../config/env.js"

/**
 * Link de confirmação pelo WhatsApp da barbearia.
 *
 * Montado no BACKEND, não no navegador, por dois motivos:
 *
 *  - o destinatário vem de `BARBERSHOP_WHATSAPP_NUMBER` e de lugar nenhum mais.
 *    Número vindo do cliente jamais define para quem a mensagem vai — senão
 *    bastaria adulterar o payload para desviar a conversa;
 *  - a mensagem é montada a partir do que está no banco, então não há como o
 *    navegador inventar "pagamento confirmado" num pedido que não foi pago.
 *
 * Uma configuração só. O número não aparece em componente nenhum do frontend.
 */

/** Dados que entram na mensagem. Todos já validados no banco. */
export interface WhatsappConfirmation {
  serviceName: string
  /** AAAA-MM-DD */
  date: string
  startsAtClock: string
  /** "EC-7F3K2Q" */
  reference: string
  /** Valor pago, já formatado ("35,00"). Ausente quando não houve cobrança. */
  amountFormatted?: string
  /** Primeiro nome, para a mensagem soar como a pessoa falando. */
  firstName?: string
}

/**
 * Mensagem da confirmação.
 *
 * O que NÃO entra, por decisão explícita: publicToken, contactHandle, JWT, id
 * interno de usuário, id interno de pagamento, dado de cartão, segredo ou token
 * do provedor. A referência pública existe justamente para ocupar esse lugar —
 * ela identifica o agendamento sem dar acesso a ele.
 */
export function buildConfirmationMessage(data: WhatsappConfirmation): string {
  const [year, month, day] = data.date.split("-")
  const lines = [
    "Olá! Meu agendamento na ErickCorttes foi confirmado ✅",
    "",
    ...(data.firstName ? [`Nome: ${data.firstName}`] : []),
    `Serviço: ${data.serviceName}`,
    `Data: ${day}/${month}/${year}`,
    `Horário: ${data.startsAtClock}`,
    ...(data.amountFormatted ? [`Pagamento: confirmado (R$ ${data.amountFormatted})`] : []),
    `Referência: ${data.reference}`,
    "",
    "Obrigado!",
  ]
  return lines.join("\n")
}

/**
 * `https://wa.me/<numero>?text=<mensagem>`.
 *
 * `wa.me` quer o número só com dígitos, sem `+`. A mensagem vai
 * percent-encoded por `encodeURIComponent`, que escapa acentos, emoji e as
 * quebras de linha.
 *
 * Devolve `null` quando o número não está configurado: sem destino não existe
 * botão, e inventar um número seria pior que não oferecer a ação.
 */
export function buildWhatsappLink(data: WhatsappConfirmation): string | null {
  const number = env.BARBERSHOP_WHATSAPP_NUMBER
  if (!number) return null
  const digits = number.replace(/[^0-9]/g, "")
  return `https://wa.me/${digits}?text=${encodeURIComponent(buildConfirmationMessage(data))}`
}
