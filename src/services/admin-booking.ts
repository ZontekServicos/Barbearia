import { apiRequest } from "./api"
import type { Appointment, AppointmentStatus, BusinessHoursDay, Service } from "./booking"

export interface AdminAppointment extends Appointment {
  customer: {
    id: string
    fullName: string | null
    phone: string
    phoneFormatted: string
  }
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
): Promise<AdminAppointment> {
  const data = await apiRequest<{ appointment: AdminAppointment }>(
    `/admin/requests/${id}/decide`,
    { method: "POST", body: { decision } },
  )
  return data.appointment
}
