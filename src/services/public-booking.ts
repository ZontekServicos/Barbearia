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
  phone: string
  fullName: string
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

export async function getBookingRequest(token: string): Promise<Appointment> {
  const data = await apiRequest<{ appointment: Appointment }>(
    `/booking/requests/${encodeURIComponent(token)}`,
    { skipRefresh: true },
  )
  return data.appointment
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
