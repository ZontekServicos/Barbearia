import { apiRequest } from "./api"

/**
 * Estados de um agendamento.
 *
 * PENDING é a solicitação pública aguardando o barbeiro — ela já segura o
 * horário. AWAITING_PAYMENT é a aprovada esperando o pagamento; também segura,
 * pelo prazo da janela. REJECTED e EXPIRED liberam.
 */
export type AppointmentStatus =
  | "PENDING"
  | "AWAITING_PAYMENT"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW"
  | "REJECTED"
  | "EXPIRED"

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
  /** Minutos reservados na agenda. Pode exceder a duração do serviço. */
  reservedMinutes: number
}

/**
 * Um início da grade do dia — livre ou não.
 *
 * Serve para a tela mostrar o horário ocupado em CINZA em vez de escondê-lo.
 * Sumir com o que está ocupado deixa buracos na grade que parecem defeito, e
 * esconde do cliente a informação mais útil que ele tem: como o dia está.
 *
 * O MOTIVO não vem de propósito. Saber que às 15:00 existe um agendamento já é
 * dado de outra pessoa; aqui só se sabe que não dá para escolher.
 */
export interface GridSlot {
  startsAtClock: string
  endsAtClock: string
  startsAt: string
  available: boolean
}

export interface Availability {
  date: string
  serviceId: string
  serviceName: string
  /** Duração real do serviço, vinda do banco. O frontend nunca a calcula. */
  durationMinutes: number
  /** Grade de início usada pelo servidor. Útil para conferir qual build está no ar. */
  slotIntervalMinutes: number
  open: boolean
  /** Janelas de atendimento do dia, ex.: 09:00–12:00 e 14:00–20:00. */
  windows: Array<{ opensAt: string; closesAt: string }>
  slots: AvailableSlot[]
  /**
   * Grade do dia inteira. `slots` continua sendo a lista do que pode ser
   * reservado — a grade apenas descreve, e os dois nunca se contradizem.
   */
  grid: GridSlot[]
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
  /** Minutos reservados na agenda; pode exceder a duração do serviço. */
  reservedMinutes: number
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
  PENDING: "Aguardando confirmação",
  AWAITING_PAYMENT: "Aguardando pagamento",
  CONFIRMED: "Confirmado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  NO_SHOW: "Não compareceu",
  REJECTED: "Recusado",
  EXPIRED: "Expirado",
}

export const STATUS_BADGE: Record<AppointmentStatus, "confirmed" | "completed" | "cancelled" | "missed" | "pending"> = {
  PENDING: "pending",
  AWAITING_PAYMENT: "pending",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_SHOW: "missed",
  REJECTED: "cancelled",
  EXPIRED: "cancelled",
}
