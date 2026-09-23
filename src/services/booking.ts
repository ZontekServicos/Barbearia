import { apiRequest } from "./api"

export type AppointmentStatus = "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW"

export interface Service {
  id: string
  name: string
  description: string
  priceCents: number
  priceFormatted: string
  durationMinutes: number
  active: boolean
}

export interface BusinessHoursDay {
  weekday: number
  closed: boolean
  opensAt: string
  closesAt: string
  breakStartsAt: string | null
  breakEndsAt: string | null
}

export interface AvailableSlot {
  startsAtClock: string
  endsAtClock: string
  startsAt: string
  endsAt: string
}

export interface Availability {
  date: string
  serviceId: string
  serviceName: string
  durationMinutes: number
  open: boolean
  slots: AvailableSlot[]
  reason: "CLOSED" | "PAST_DATE" | "TOO_FAR" | "FULLY_BOOKED" | null
}

export interface Appointment {
  id: string
  serviceId: string
  serviceName: string
  servicePriceCents: number
  servicePriceFormatted: string
  startsAt: string
  endsAt: string
  date: string
  startsAtClock: string
  endsAtClock: string
  durationMinutes: number
  status: AppointmentStatus
  notes: string | null
  createdAt: string
  cancelledAt: string | null
}

/** Catálogo público — só serviços ativos. */
export async function listServices(): Promise<Service[]> {
  const data = await apiRequest<{ services: Service[] }>("/booking/services")
  return data.services
}

export async function listBusinessHours(): Promise<BusinessHoursDay[]> {
  const data = await apiRequest<{ days: BusinessHoursDay[] }>("/booking/business-hours")
  return data.days
}

/** Horários livres calculados pelo backend. */
export async function getAvailability(date: string, serviceId: string): Promise<Availability> {
  const query = new URLSearchParams({ date, serviceId })
  return apiRequest<Availability>(`/booking/availability?${query.toString()}`)
}

export async function createAppointment(input: {
  serviceId: string
  date: string
  startsAt: string
  notes?: string
}): Promise<Appointment> {
  const data = await apiRequest<{ appointment: Appointment }>("/booking/appointments", {
    method: "POST",
    body: input,
  })
  return data.appointment
}

export async function listMyAppointments(
  scope: "upcoming" | "history" | "all" = "all",
): Promise<Appointment[]> {
  const data = await apiRequest<{ appointments: Appointment[] }>(
    `/booking/appointments/me?scope=${scope}`,
  )
  return data.appointments
}

export async function cancelMyAppointment(id: string): Promise<Appointment> {
  const data = await apiRequest<{ appointment: Appointment }>(
    `/booking/appointments/${id}/cancel`,
    { method: "POST" },
  )
  return data.appointment
}

/** Rótulos de status — fonte única para cliente e admin. */
export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  CONFIRMED: "Confirmado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  NO_SHOW: "Não compareceu",
}

export const STATUS_BADGE: Record<AppointmentStatus, "confirmed" | "completed" | "cancelled" | "missed"> = {
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "missed",
}
