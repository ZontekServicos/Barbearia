import { apiRequest } from "./api"
import type { Appointment, AppointmentStatus, BusinessHoursDay, Service } from "./booking"

/**
 * Cobrança como o painel a vê.
 *
 * Sem id de pagamento, id de cobrança do provedor ou nome do adaptador: nada
 * disso ajuda o barbeiro a decidir, e todos são identificadores internos.
 *
 * `canConfirmManually` é decidido pelo SERVIDOR. O botão não recombina quatro
 * condições no navegador esperando acertar todas.
 */
export interface AdminPayment {
  /** `PIX_MANUAL` confirma pelo painel; `PROVIDER` depende do webhook dele. */
  method: "PIX_MANUAL" | "PROVIDER"
  status: "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELED"
  amountCents: number
  amountFormatted: string
  canConfirmManually: boolean
  expiresAt: string
  expiresInSeconds: number
  /** Prazo vencido com cobrança em aberto: exige tratamento manual. */
  windowClosed: boolean
  paidAt: string | null
  /** Quando o CLIENTE declarou ter pago. Nulo = ainda não declarou. */
  reportedAt: string | null
  /** Prazo para conferir o Pix declarado. */
  reviewExpiresAt: string | null
  /** Declarado, prazo vencido e ninguém decidiu: exige tratamento. */
  reviewOverdue: boolean
}

export interface AdminAppointment extends Appointment {
  customer: {
    id: string
    fullName: string | null
    phone: string
    phoneFormatted: string
  }
  /** Referência pública curta ("EC-7F3K2Q"). Nasce na aprovação. */
  reference: string | null
  payment: AdminPayment | null
}

export interface ScheduleBlock {
  id: string
  startsAt: string
  endsAt: string
  date: string
  startsAtClock: string
  endsAtClock: string
  reason: string
}

export interface CustomerSummary {
  totalAppointments: number
  completed: number
  cancelled: number
  noShow: number
  upcoming: number
  lastVisitAt: string | null
}

// --------------------------------------------------------------------------
// Serviços
// --------------------------------------------------------------------------

export async function listAdminServices(includeInactive = true): Promise<Service[]> {
  const data = await apiRequest<{ services: Service[] }>(
    `/admin/services?includeInactive=${includeInactive}`,
  )
  return data.services
}

export interface ServicePayload {
  name: string
  description?: string
  priceCents: number
  durationMinutes: number
}

export async function createAdminService(payload: ServicePayload): Promise<Service> {
  const data = await apiRequest<{ service: Service }>("/admin/services", {
    method: "POST",
    body: payload,
  })
  return data.service
}

export async function updateAdminService(
  id: string,
  payload: Partial<ServicePayload>,
): Promise<Service> {
  const data = await apiRequest<{ service: Service }>(`/admin/services/${id}`, {
    method: "PATCH",
    body: payload,
  })
  return data.service
}

export async function setAdminServiceActive(id: string, active: boolean): Promise<Service> {
  const data = await apiRequest<{ service: Service }>(
    `/admin/services/${id}/${active ? "activate" : "deactivate"}`,
    { method: "POST" },
  )
  return data.service
}

// --------------------------------------------------------------------------
// Agenda
// --------------------------------------------------------------------------

export async function listAgenda(
  from: string,
  to?: string,
  status?: AppointmentStatus,
  signal?: AbortSignal,
): Promise<AdminAppointment[]> {
  const query = new URLSearchParams({ from })
  if (to) query.set("to", to)
  if (status) query.set("status", status)

  const data = await apiRequest<{ appointments: AdminAppointment[] }>(
    `/admin/agenda?${query.toString()}`,
    { signal },
  )
  return data.appointments
}

export async function getAdminAppointment(id: string): Promise<AdminAppointment> {
  const data = await apiRequest<{ appointment: AdminAppointment }>(`/admin/appointments/${id}`)
  return data.appointment
}

export async function updateAppointmentStatus(
  id: string,
  status: "COMPLETED" | "CANCELLED" | "NO_SHOW",
): Promise<AdminAppointment> {
  const data = await apiRequest<{ appointment: AdminAppointment }>(
    `/admin/appointments/${id}/status`,
    { method: "PATCH", body: { status } },
  )
  return data.appointment
}

/**
 * Registra o resultado da conferência de um Pix recebido por fora.
 *
 * O corpo leva SÓ a decisão. Valor, data do pagamento, provedor e o novo estado
 * do agendamento são resolvidos pelo servidor a partir da cobrança no banco —
 * o painel não tem como influenciar nenhum deles, e não deveria.
 *
 * `PAID` confirma o agendamento. `FAILED` registra que o dinheiro não foi
 * encontrado, sem destruir a reserva: dentro do prazo ainda dá para tentar.
 */
export async function settleAppointmentPayment(
  id: string,
  decision: "PAID" | "FAILED",
): Promise<AdminAppointment> {
  const data = await apiRequest<{ appointment: AdminAppointment }>(
    `/admin/appointments/${id}/payment`,
    { method: "POST", body: { decision } },
  )
  return data.appointment
}

// --------------------------------------------------------------------------
// Bloqueios e expediente
// --------------------------------------------------------------------------

export async function listBlocks(from: string, to: string): Promise<ScheduleBlock[]> {
  const query = new URLSearchParams({ from, to })
  const data = await apiRequest<{ blocks: ScheduleBlock[] }>(`/admin/blocks?${query.toString()}`)
  return data.blocks
}

export async function createBlock(input: {
  date: string
  startsAt: string
  endsAt: string
  reason: string
}): Promise<ScheduleBlock> {
  const data = await apiRequest<{ block: ScheduleBlock }>("/admin/blocks", {
    method: "POST",
    body: input,
  })
  return data.block
}

export async function deleteBlock(id: string): Promise<void> {
  await apiRequest(`/admin/blocks/${id}`, { method: "DELETE" })
}

/**
 * Bloqueia o dia inteiro de uma vez.
 *
 * Um bloqueio só cobrindo o dia, em vez de um por horário da grade: liberar
 * depois é um clique, não quinze.
 */
export async function blockWholeDay(input: {
  date: string
  reason: string
}): Promise<ScheduleBlock> {
  const data = await apiRequest<{ block: ScheduleBlock }>("/admin/blocks/whole-day", {
    method: "POST",
    body: input,
  })
  return data.block
}

/** Por que um horário não pode ser escolhido. Só a visão administrativa recebe. */
export type SlotUnavailableReason = "APPOINTMENT" | "BLOCK" | "OUTSIDE_HOURS" | "PAST"

/**
 * Um início da grade, visto pela barbearia.
 *
 * A diferença em relação à grade pública é o MOTIVO — e ele muda a ação
 * possível: `BLOCK` se desfaz por aqui, `APPOINTMENT` não. Por isso `blockId` só
 * vem quando o motivo é bloqueio: sem ele, a tela não tem o que liberar, e não
 * pode oferecer um botão que apagaria a reserva de alguém.
 */
export interface AdminGridSlot {
  startsAtClock: string
  endsAtClock: string
  startsAt: string
  available: boolean
  reason: SlotUnavailableReason | null
  blockId: string | null
  blockReason: string | null
  /** Leva ao detalhe do agendamento. Nunca vem com `blockId`. */
  appointmentId: string | null
}

export interface AdminAvailability {
  date: string
  serviceId: string
  serviceName: string
  durationMinutes: number
  /** Minutos que a agenda reserva; pode exceder a duração. */
  reservedMinutes: number
  slotIntervalMinutes: number
  /** `false` é dia sem expediente — a grade vem vazia. */
  open: boolean
  windows: Array<{ opensAt: string; closesAt: string }>
  grid: AdminGridSlot[]
}

export async function getAdminAvailability(
  date: string,
  serviceId: string,
): Promise<AdminAvailability> {
  const query = new URLSearchParams({ date, serviceId })
  return apiRequest<AdminAvailability>(`/admin/availability?${query.toString()}`)
}

export async function listAdminBusinessHours(): Promise<BusinessHoursDay[]> {
  const data = await apiRequest<{ days: BusinessHoursDay[] }>("/admin/business-hours")
  return data.days
}

export async function saveBusinessHours(days: BusinessHoursDay[]): Promise<BusinessHoursDay[]> {
  const data = await apiRequest<{ days: BusinessHoursDay[] }>("/admin/business-hours", {
    method: "PUT",
    body: { days },
  })
  return data.days
}

// --------------------------------------------------------------------------
// Ficha do cliente
// --------------------------------------------------------------------------

export async function getCustomerDossier(
  userId: string,
): Promise<{ summary: CustomerSummary; appointments: Appointment[] }> {
  return apiRequest(`/admin/customers/${userId}/summary`)
}

/**
 * Decide uma solicitação pública pendente.
 *
 * Confirmar não recria a reserva — o horário já estava segurado desde o
 * pedido. Recusar o libera na consulta seguinte.
 */
export async function decideBookingRequest(
  id: string,
  decision: "CONFIRMED" | "REJECTED",
  /**
   * "Sim, recusar mesmo com Pix declarado."
   *
   * O servidor barra com 409 uma recusa sobre pedido com pagamento declarado ou
   * já confirmado, até vir este reconhecimento — e recusar NÃO devolve dinheiro.
   */
  acknowledgePaidReport?: boolean,
): Promise<AdminAppointment> {
  const data = await apiRequest<{ appointment: AdminAppointment }>(
    `/admin/requests/${id}/decide`,
    {
      method: "POST",
      body: {
        decision,
        ...(acknowledgePaidReport ? { acknowledgePaidReport: true } : {}),
      },
    },
  )
  return data.appointment
}
