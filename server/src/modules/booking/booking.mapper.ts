import type { AppointmentStatus } from "../../generated/prisma/enums.js"
import { instantToShopDate, instantToShopMinutes, minutesToClock } from "../../utils/time.js"

/** Centavos -> "35,00" (pt-BR, sem símbolo, para o frontend compor). */
function formatCents(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",")
}

export interface PublicService {
  id: string
  name: string
  description: string
  priceCents: number
  priceFormatted: string
  durationMinutes: number
  active: boolean
}

interface ServiceRecord {
  id: string
  name: string
  description: string
  priceCents: number
  durationMinutes: number
  active: boolean
}

/** Allow-list: campos novos no banco não vazam sem passar por aqui. */
export function toPublicService(service: ServiceRecord): PublicService {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    priceCents: service.priceCents,
    priceFormatted: formatCents(service.priceCents),
    durationMinutes: service.durationMinutes,
    active: service.active,
  }
}

export interface PublicBusinessHours {
  weekday: number
  closed: boolean
  opensAt: string
  closesAt: string
  breakStartsAt: string | null
  breakEndsAt: string | null
}

interface BusinessHoursRecord {
  weekday: number
  closed: boolean
  openMinute: number
  closeMinute: number
  breakStartMinute: number | null
  breakEndMinute: number | null
}

export function toPublicBusinessHours(record: BusinessHoursRecord): PublicBusinessHours {
  return {
    weekday: record.weekday,
    closed: record.closed,
    opensAt: minutesToClock(record.openMinute),
    closesAt: minutesToClock(record.closeMinute),
    breakStartsAt: record.breakStartMinute === null ? null : minutesToClock(record.breakStartMinute),
    breakEndsAt: record.breakEndMinute === null ? null : minutesToClock(record.breakEndMinute),
  }
}

export interface PublicScheduleBlock {
  id: string
  startsAt: string
  endsAt: string
  date: string
  startsAtClock: string
  endsAtClock: string
  reason: string
}

interface ScheduleBlockRecord {
  id: string
  startsAt: Date
  endsAt: Date
  reason: string
}

export function toPublicScheduleBlock(block: ScheduleBlockRecord): PublicScheduleBlock {
  return {
    id: block.id,
    startsAt: block.startsAt.toISOString(),
    endsAt: block.endsAt.toISOString(),
    date: instantToShopDate(block.startsAt),
    startsAtClock: minutesToClock(instantToShopMinutes(block.startsAt)),
    endsAtClock: minutesToClock(instantToShopMinutes(block.endsAt)),
    reason: block.reason,
  }
}

export interface PublicAppointment {
  id: string
  serviceId: string
  serviceName: string
  servicePriceCents: number
  servicePriceFormatted: string
  /** Instante absoluto em ISO-8601 com offset — nunca hora local ambígua. */
  startsAt: string
  endsAt: string
  /** Pré-formatados no fuso da barbearia, para o cliente não recalcular. */
  date: string
  startsAtClock: string
  endsAtClock: string
  /** Duração real do serviço — o que o cliente compra e vê. */
  durationMinutes: number
  /** Minutos que a agenda reservou. Pode ser maior; nunca exibido como duração. */
  reservedMinutes: number
  status: AppointmentStatus
  notes: string | null
  createdAt: string
  cancelledAt: string | null
}

interface AppointmentRecord {
  id: string
  serviceId: string
  serviceName: string
  servicePriceCents: number
  startsAt: Date
  endsAt: Date
  reservedEndsAt: Date
  status: AppointmentStatus
  pendingExpiresAt?: Date | null
  notes: string | null
  createdAt: Date
  cancelledAt: Date | null
}

export function toPublicAppointment(appointment: AppointmentRecord): PublicAppointment {
  const durationMinutes = Math.round(
    (appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000,
  )

  return {
    id: appointment.id,
    serviceId: appointment.serviceId,
    serviceName: appointment.serviceName,
    servicePriceCents: appointment.servicePriceCents,
    servicePriceFormatted: formatCents(appointment.servicePriceCents),
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    date: instantToShopDate(appointment.startsAt),
    startsAtClock: minutesToClock(instantToShopMinutes(appointment.startsAt)),
    endsAtClock: minutesToClock(instantToShopMinutes(appointment.endsAt)),
    durationMinutes,
    /**
     * Minutos que a agenda reservou. Pode ser maior que `durationMinutes`
     * quando a grade operacional é maior que o serviço. Vai separado para a
     * interface poder ser honesta: mostramos a duração real do corte e, se
     * quisermos, explicamos a reserva — nunca inflamos uma como se fosse a outra.
     */
    reservedMinutes: Math.round(
      (appointment.reservedEndsAt.getTime() - appointment.startsAt.getTime()) / 60_000,
    ),
    // Prazo vencido é apresentado como expirado mesmo antes de alguém reservar
    // o horário — vale para os dois estados com prazo: aguardando o barbeiro e
    // aguardando o pagamento.
    status:
      (appointment.status === "PENDING" || appointment.status === "AWAITING_PAYMENT") &&
      appointment.pendingExpiresAt &&
      appointment.pendingExpiresAt.getTime() <= Date.now()
        ? "EXPIRED"
        : appointment.status,
    notes: appointment.notes,
    createdAt: appointment.createdAt.toISOString(),
    cancelledAt: appointment.cancelledAt?.toISOString() ?? null,
  }
}

/**
 * Cobrança como a barbearia a vê no painel.
 *
 * O que NÃO está aqui, de propósito: id do pagamento, id da cobrança no
 * provedor e nome do adaptador. Nenhum deles ajuda o barbeiro a decidir, e
 * todos são identificadores internos. O que ele precisa saber é: quanto, como,
 * em que estado, e se ele pode confirmar pelo painel — e é isso que sai.
 */
export interface AdminPayment {
  /**
   * `PIX_MANUAL` — Pix da barbearia, confirmação pelo painel.
   * `PROVIDER`   — cobrança de provedor, confirmação por webhook.
   */
  method: "PIX_MANUAL" | "PROVIDER"
  status: "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELED"
  amountCents: number
  /** "40,00" — já formatado, para a tela não reimplementar moeda. */
  amountFormatted: string
  /**
   * A barbearia pode confirmar o recebimento pelo painel AGORA?
   *
   * Quem decide é o servidor. Assim o botão não depende de o navegador
   * recombinar quatro condições e acertar todas.
   */
  canConfirmManually: boolean
  /** Fim da janela de pagamento. */
  expiresAt: string
  /** Segundos restantes, nunca negativo. */
  expiresInSeconds: number
  /** Janela vencida com a cobrança ainda em aberto: exige tratamento manual. */
  windowClosed: boolean
  paidAt: string | null
}

export interface AdminAppointment extends PublicAppointment {
  customer: {
    id: string
    fullName: string | null
    phone: string
    phoneFormatted: string
  }
  /** Referência pública curta ("EC-7F3K2Q"). Nasce na aprovação. */
  reference: string | null
  /** Cobrança, quando existe. `null` sem pagamento configurado. */
  payment: AdminPayment | null
}

export interface AdminPaymentRecord {
  provider: string
  status: "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELED"
  amountCents: number
  expiresAt: Date
  paidAt: Date | null
}

/** Nome do adaptador de Pix estático. Duplicado aqui para o mapper não
 * depender do módulo de pagamento, que importa configuração de ambiente. */
const STATIC_PIX = "static-pix"

export function toAdminAppointment(
  appointment: AppointmentRecord & {
    publicReference?: string | null
    payment?: AdminPaymentRecord | null
    user: { id: string; fullName: string | null; phone: string }
  },
  formatPhone: (phone: string) => string,
  now: Date = new Date(),
): AdminAppointment {
  const view = toPublicAppointment(appointment)
  const payment = appointment.payment ?? null
  const windowClosed =
    payment !== null && payment.status === "PENDING" && payment.expiresAt.getTime() <= now.getTime()

  return {
    ...view,
    customer: {
      id: appointment.user.id,
      fullName: appointment.user.fullName,
      phone: appointment.user.phone,
      phoneFormatted: formatPhone(appointment.user.phone),
    },
    reference: appointment.publicReference ?? null,
    payment: payment
      ? {
          method: payment.provider === STATIC_PIX ? "PIX_MANUAL" : "PROVIDER",
          status: payment.status,
          amountCents: payment.amountCents,
          amountFormatted: formatCents(payment.amountCents),
          /**
           * Confirmação manual exige as quatro condições juntas:
           * Pix da barbearia, cobrança em aberto, horário aguardando pagamento
           * e prazo ainda válido. Cobrança de provedor nunca — ali quem
           * confirma é o webhook dele.
           */
          canConfirmManually:
            payment.provider === STATIC_PIX &&
            payment.status === "PENDING" &&
            view.status === "AWAITING_PAYMENT" &&
            !windowClosed,
          expiresAt: payment.expiresAt.toISOString(),
          expiresInSeconds: Math.max(
            0,
            Math.floor((payment.expiresAt.getTime() - now.getTime()) / 1000),
          ),
          windowClosed,
          paidAt: payment.paidAt?.toISOString() ?? null,
        }
      : null,
  }
}
