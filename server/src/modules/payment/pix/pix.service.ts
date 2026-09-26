import QRCode from "qrcode"
import { paymentMethod, staticPix } from "../../../config/env.js"
import { buildBrCode, isValidBrCode, maskPixKey } from "./brcode.js"

/** Nome do "provedor" gravado numa cobrança de Pix estático. */
export const STATIC_PIX_PROVIDER = "static-pix"

/**
 * O que a tela de pagamento recebe.
 *
 * Montado no BACKEND inteiro — payload, QR e valor. O navegador só desenha o
 * que chega. Nada aqui carrega segredo: chave Pix e BR Code são públicos por
 * natureza (quem paga precisa deles), e nenhum identificador interno entra.
 */
export interface PixPresentation {
  /**
   * De onde vem este Pix:
   *   DYNAMIC_PROVIDER_PIX — cobrança do provedor, confirmação automática;
   *   STATIC_PIX           — Pix da barbearia, confirmação manual.
   *
   * A tela usa isto para dizer a verdade sobre o que acontece depois de pagar.
   */
  source: "DYNAMIC_PROVIDER_PIX" | "STATIC_PIX"
  /** BR Code completo — é o "Pix Copia e Cola". */
  copyPaste: string
  /** QR do BR Code, como SVG pronto para embutir. */
  qrCodeSvg: string
  /**
   * Chave Pix, apenas quando estática.
   *
   * No dinâmico não existe chave a exibir: a cobrança tem payload próprio, e
   * mostrar a chave da barbearia ali convidaria a pessoa a pagar por fora da
   * cobrança, que é justamente o que o provedor consegue conciliar.
   */
  key: string | null
  /** `5f79…8c21` — forma curta para a tela, sem estampar a chave inteira. */
  keyMasked: string | null
  receiverName: string | null
  /** `true` quando a confirmação depende de alguém da barbearia conferir. */
  requiresManualConfirmation: boolean
}

/** SVG sem XML prolog, para embutir direto no HTML. */
async function toSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    // Sem width fixa: o SVG escala pelo CSS e serve de 360px a desktop.
  })
}

export interface PaymentRecord {
  provider: string
  amountCents: number
  pixQrCode: string | null
  checkoutUrl: string | null
}

/**
 * Monta a apresentação do Pix para uma cobrança.
 *
 * Ordem de prioridade, conforme a arquitetura:
 *
 * 1. O "Copia e Cola" que o PROVEDOR gerou para aquela cobrança. É o único que
 *    o provedor consegue conciliar e confirmar por webhook, então ele ganha
 *    de qualquer Pix estático configurado.
 * 2. O Pix ESTÁTICO da barbearia, como recurso manual — o dinheiro entra, mas
 *    alguém precisa conferir.
 *
 * Devolve `null` quando não há como apresentar Pix: sem payload do provedor e
 * sem chave configurada. Nesse caso a tela mostra apenas o valor e orienta a
 * falar com a barbearia, em vez de exibir um QR que não funciona.
 */
export async function buildPixPresentation(
  payment: PaymentRecord,
  reference: string | null,
): Promise<PixPresentation | null> {
  /**
   * 1. A cobrança é de PROVEDOR.
   *
   * Quem manda aqui é o dono da cobrança, não a qualidade do payload. Se o
   * provedor devolveu um "Copia e Cola" inválido, NÃO caímos no Pix estático:
   * o cliente pagaria na conta da barbearia um valor que o provedor nunca vai
   * conciliar, e o sistema ficaria esperando um webhook sobre dinheiro que foi
   * para outro lugar. Melhor não apresentar Pix e mandar falar com a barbearia.
   */
  if (payment.provider !== STATIC_PIX_PROVIDER) {
    const usable = Boolean(payment.pixQrCode) && isValidBrCode(payment.pixQrCode!)
    if (!usable) return null
    return {
      source: "DYNAMIC_PROVIDER_PIX",
      copyPaste: payment.pixQrCode!,
      qrCodeSvg: await toSvg(payment.pixQrCode!),
      // A chave da barbearia não aparece numa cobrança de provedor: exibi-la
      // convidaria a pagar por fora, justamente o que não se concilia.
      key: null,
      keyMasked: null,
      receiverName: null,
      requiresManualConfirmation: false,
    }
  }

  // 2. Pix estático da barbearia.
  if (!staticPix) return null
  const copyPaste = buildBrCode({
    pixKey: staticPix.key,
    receiverName: staticPix.receiverName,
    receiverCity: staticPix.receiverCity,
    // Valor do banco, sempre. Não há parâmetro por onde o navegador informá-lo.
    amountCents: payment.amountCents,
    ...(reference ? { reference } : {}),
  })

  return {
    source: "STATIC_PIX",
    copyPaste,
    qrCodeSvg: await toSvg(copyPaste),
    key: staticPix.key,
    keyMasked: maskPixKey(staticPix.key),
    receiverName: staticPix.receiverName,
    // Sem provedor, ninguém nos avisa que o dinheiro entrou.
    requiresManualConfirmation: true,
  }
}

/** Esta instalação recebe por Pix estático? */
export const isStaticPix = () => paymentMethod === "STATIC_PIX"
