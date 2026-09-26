import { apiRequest } from "./api"
import type { Appointment } from "./booking"

/**
 * Solicitação de agendamento sem login.
 *
 * O WhatsApp identifica o contato; ele não autentica ninguém e não dá acesso a
 * reserva nenhuma. A única chave para acompanhar o pedido depois é o token
 * aleatório que o backend devolve na criação.
 */

export interface BookingRequestPayload {
  /** Handle da etapa de cadastro. Nome e telefone não trafegam de novo. */
  contactHandle: string
  serviceId: string
  date: string
  startsAt: string
  notes?: string
}

export interface BookingRequestResult {
  appointment: Appointment
  /** Entregue uma única vez. Guardado localmente para consulta posterior. */
  publicToken: string
  /** `true` quando o pedido ainda depende da confirmação do barbeiro. */
  awaitingApproval: boolean
  /** Por quanto tempo o horário fica segurado enquanto pendente. */
  pendingTtlMinutes: number
}

export async function requestBooking(
  payload: BookingRequestPayload,
): Promise<BookingRequestResult> {
  return apiRequest<BookingRequestResult>("/booking/requests", {
    method: "POST",
    body: payload,
    // Não há sessão a renovar: esta rota é pública de propósito.
    skipRefresh: true,
  })
}

/** Situação do pagamento, como o cliente pode vê-la. */
export interface PaymentView {
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELED'
  amountCents: number
  /** "35,00" — já formatado pelo servidor. */
  amountFormatted: string
  currency: string
  mode: 'FULL' | 'DEPOSIT'
  /** Quanto falta da janela de pagamento. Nunca negativo. */
  expiresInSeconds: number
  expiresAt: string
  checkoutUrl: string | null
  /** Pix copia-e-cola. Público por natureza. */
  pixQrCode: string | null
}

/**
 * Dados do Pix, montados pelo backend.
 *
 * O navegador não calcula nada aqui: payload, QR e valor chegam prontos. Chave
 * Pix e BR Code são públicos por natureza — quem paga precisa deles.
 */
export interface PixView {
  /**
   * `DYNAMIC_PROVIDER_PIX` — cobrança do provedor, confirmação automática.
   * `STATIC_PIX` — Pix da barbearia, alguém de lá confere.
   */
  source: 'DYNAMIC_PROVIDER_PIX' | 'STATIC_PIX'
  /** BR Code completo: o "Pix Copia e Cola". */
  copyPaste: string
  /** QR do BR Code, já em SVG. */
  qrCodeSvg: string
  /** Chave da barbearia — só no Pix estático. */
  key: string | null
  /** `5f79…8c21`, para a tela não estampar a chave inteira. */
  keyMasked: string | null
  receiverName: string | null
  /** `true` quando a confirmação depende de alguém da barbearia conferir. */
  requiresManualConfirmation: boolean
}

/**
 * O pedido inteiro, como quem tem o token pode vê-lo.
 *
 * `whatsappUrl` vem pronto do backend e só existe quando o agendamento está
 * CONFIRMED — o destinatário é o número da barbearia e a mensagem é montada a
 * partir do banco, então o navegador não tem como anunciar como confirmado algo
 * que não foi pago.
 */
export interface BookingRequestView {
  appointment: Appointment
  /** "EC-7F3K2Q". Existe a partir da aprovação. */
  reference: string | null
  payment: PaymentView | null
  whatsappUrl: string | null
  /** Pix a pagar. Só enquanto a cobrança está em aberto. */
  pix: PixView | null
  /** "Falar com a barbearia" durante o pagamento. Não afirma confirmação. */
  paymentHelpUrl: string | null
}

export async function getBookingRequest(
  token: string,
  options: { signal?: AbortSignal } = {},
): Promise<BookingRequestView> {
  return apiRequest<BookingRequestView>(
    `/booking/requests/${encodeURIComponent(token)}`,
    { skipRefresh: true, ...(options.signal ? { signal: options.signal } : {}) },
  )
}

/**
 * Token da última solicitação, para a pessoa reabrir a confirmação.
 *
 * Fica em `localStorage` porque sobreviver ao fechamento da aba é o ponto —
 * é o comprovante dela. Guardamos só o token: nenhum telefone, nome ou dado
 * pessoal. Quem tem o token vê aquele pedido e mais nada.
 */
const TOKEN_KEY = "ec.booking.lastRequest"

export function rememberRequestToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Navegação privada ou armazenamento bloqueado: o fluxo segue sem o atalho.
  }
}

export function readRequestToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
  } catch {
    return null
  }
}

export function forgetRequestToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nada a fazer.
  }
}

export interface BookingPolicy {
  /** Pedido público aguarda confirmação do barbeiro. */
  requiresApproval: boolean
  /** Grade operacional usada pelo servidor, em minutos. */
  baseSlotMinutes: number
  pendingTtlMinutes: number
  minimumAdvanceMinutes: number
  /** Confirmar exige pagamento nesta instalação. */
  paymentRequired: boolean
  /** Janela para pagar depois da aprovação, em minutos. */
  paymentWindowMinutes: number
  /** Como o pagamento é recebido nesta instalação. */
  paymentMethod: 'DYNAMIC_PROVIDER_PIX' | 'STATIC_PIX' | 'NONE'
}

/**
 * Política vigente, servida pelo backend.
 *
 * Buscada em vez de embutida: a regra de negócio vive em um lugar só, e
 * mudá-la não exige publicar o frontend de novo.
 */
export async function getBookingPolicy(): Promise<BookingPolicy> {
  return apiRequest<BookingPolicy>("/booking/policy", { skipRefresh: true })
}

export interface ContactRegistration {
  /** Handle de uso restrito devolvido pelo cadastro. Não é sessão. */
  contactHandle: string
  fullName: string
  /** "(71) *****-6090" — o servidor nunca devolve o número inteiro. */
  phoneMasked: string
}

/**
 * Etapa de cadastro: valida e grava o contato antes de qualquer seleção.
 *
 * Não cria senha, sessão nem token de acesso. O handle devolvido autoriza
 * apenas abrir uma solicitação para aquele contato.
 */
export async function registerContact(
  fullName: string,
  phone: string,
  options: { previousHandle?: string; signal?: AbortSignal } = {},
): Promise<ContactRegistration> {
  return apiRequest<ContactRegistration>("/booking/contacts", {
    method: "POST",
    body: { fullName, phone, ...(options.previousHandle ? { previousHandle: options.previousHandle } : {}) },
    signal: options.signal,
    skipRefresh: true,
  })
}
