import { prisma } from "../../config/prisma.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { logger } from "../../utils/logger.js"
import { formatPhoneForDisplay } from "../../utils/phone.js"
import {
  addDaysToShopDate,
  clockToMinutes,
  instantToShopDate,
  shopWallClockToInstant,
} from "../../utils/time.js"
import type { AppointmentStatus } from "../../generated/prisma/enums.js"
import {
  toAdminAppointment,
  toPublicAppointment,
  type AdminAppointment,
  type PublicAppointment,
} from "./booking.mapper.js"
import { BookingRules } from "./booking.rules.js"
import { getBookableService } from "./catalog.service.js"
import { findBlocksOverlapping, getDayWindow } from "./schedule.service.js"
import {
  blockedRange,
  fitsInAnyWindow,
  isStartOnSlotGrid,
  overlaps,
  windowsFromBusinessHours,
} from "./availability.engine.js"

/** Violação da EXCLUDE constraint de sobreposição (SQLSTATE 23P01). */
function isOverlapViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const candidate = error as { code?: string; meta?: { constraint?: unknown }; message?: string }
  if (candidate.code === "23P01") return true
  const constraint = candidate.meta?.constraint
  if (typeof constraint === "string" && constraint.includes("appointments_no_overlap")) return true
  return typeof candidate.message === "string" && candidate.message.includes("appointments_no_overlap")
}

export interface CreateAppointmentInput {
  userId: string
  serviceId: string
  date: string
  startsAt: string
  notes?: string
}

/**
 * Cria um agendamento.
 *
 * Nada de duração, preço ou horário final vem do cliente: o servidor lê o
 * serviço no banco e calcula. O cliente informa apenas o que quer e quando
 * começa.
 *
 * As validações abaixo dão mensagens boas ao usuário, mas a garantia dura
 * contra reserva dupla é a EXCLUDE constraint do PostgreSQL — ela é o que
 * segura duas requisições simultâneas pedindo o mesmo horário.
 */
export async function createAppointment(
  input: CreateAppointmentInput,
  now: Date = new Date(),
): Promise<PublicAppointment> {
  const service = await getBookableService(input.serviceId)

  const startMinute = clockToMinutes(input.startsAt)
  const startsAt = shopWallClockToInstant(input.date, startMinute)
  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000)

  // Antecedência mínima.
  const earliest = new Date(now.getTime() + BookingRules.minimumAdvanceMinutes * 60_000)
  if (startsAt.getTime() < earliest.getTime()) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_ERROR,
      `Agende com pelo menos ${BookingRules.minimumAdvanceMinutes} minutos de antecedência.`,
    )
  }

  // Antecedência máxima.
  const lastBookableDate = addDaysToShopDate(instantToShopDate(now), BookingRules.maximumAdvanceDays)
  if (input.date > lastBookableDate) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_ERROR,
      `Só é possível agendar até ${BookingRules.maximumAdvanceDays} dias à frente.`,
    )
  }

  // Expediente. A mesma engine que lista os horários decide se este cabe —
  // duas implementações paralelas divergiriam, e a divergência apareceria
  // para o cliente como "o horário aparecia livre mas foi recusado".
  const day = await getDayWindow(input.date)
  if (!day) {
    throw AppError.badRequest(ErrorCodes.CONFLICT, "A barbearia está fechada nesta data.")
  }

  const windows = windowsFromBusinessHours(day)
  if (!fitsInAnyWindow(windows, startMinute, service.durationMinutes)) {
    throw AppError.badRequest(
      ErrorCodes.CONFLICT,
      "Horário fora do expediente para a duração deste serviço.",
    )
  }

  if (!isStartOnSlotGrid(windows, startMinute, BookingRules.slotIntervalMinutes)) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_ERROR,
      "Escolha um dos horários oferecidos na disponibilidade.",
    )
  }

  // Bloqueios administrativos, comparados já com os buffers do serviço.
  const candidate = blockedRange(
    startMinute,
    service.durationMinutes,
    service.bufferBeforeMinutes,
    service.bufferAfterMinutes,
  )
  const dayStart = shopWallClockToInstant(input.date, 0)
  const toMinutes = (instant: Date) =>
    (instant.getTime() - dayStart.getTime()) / 60_000

  const blocks = await findBlocksOverlapping(
    new Date(dayStart.getTime() + candidate.startMinute * 60_000),
    new Date(dayStart.getTime() + candidate.endMinute * 60_000),
  )
  if (
    blocks.some(block =>
      overlaps(
        candidate.startMinute,
        candidate.endMinute,
        toMinutes(block.startsAt),
        toMinutes(block.endsAt),
      ),
    )
  ) {
    throw AppError.conflict(ErrorCodes.CONFLICT, "Esse horário está bloqueado na agenda.")
  }

  try {
    const appointment = await prisma.appointment.create({
      data: {
        userId: input.userId,
        serviceId: service.id,
        startsAt,
        endsAt,
        status: "CONFIRMED",
        notes: input.notes ?? null,
        // Congelados: mudar o preço do serviço depois não reescreve esta reserva.
        serviceName: service.name,
        servicePriceCents: service.priceCents,
        bufferBeforeMinutes: service.bufferBeforeMinutes,
        bufferAfterMinutes: service.bufferAfterMinutes,
      },
    })

    return toPublicAppointment(appointment)
  } catch (error) {
    if (isOverlapViolation(error)) {
      logger.info("Reserva recusada por conflito de horário", { serviceId: service.id })
      throw AppError.conflict(
        ErrorCodes.CONFLICT,
        "Esse horário acabou de ser reservado. Escolha outro.",
      )
    }
    throw error
  }
}

export async function listMyAppointments(
  userId: string,
  scope: "upcoming" | "history" | "all",
  now: Date = new Date(),
): Promise<PublicAppointment[]> {
  const upcomingFilter = { status: "CONFIRMED" as const, endsAt: { gte: now } }

  const where =
    scope === "upcoming"
      ? { userId, ...upcomingFilter }
      : scope === "history"
        ? { userId, NOT: upcomingFilter }
        : { userId }

  const appointments = await prisma.appointment.findMany({
    where,
    orderBy: { startsAt: scope === "upcoming" ? "asc" : "desc" },
    take: 200,
  })

  return appointments.map(toPublicAppointment)
}

/** Busca um agendamento garantindo que ele pertence a quem pediu. */
export async function getMyAppointment(
  userId: string,
  appointmentId: string,
): Promise<PublicAppointment> {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } })

  // Mesma resposta para "não existe" e "é de outra pessoa": não confirmamos a
  // existência de agendamentos alheios.
  if (!appointment || appointment.userId !== userId) {
    throw AppError.notFound(ErrorCodes.NOT_FOUND, "Agendamento não encontrado.")
  }

  return toPublicAppointment(appointment)
}

/** Cancelamento pelo cliente, respeitando o prazo mínimo. */
export async function cancelMyAppointment(
  userId: string,
  appointmentId: string,
  now: Date = new Date(),
): Promise<PublicAppointment> {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } })

  if (!appointment || appointment.userId !== userId) {
    throw AppError.notFound(ErrorCodes.NOT_FOUND, "Agendamento não encontrado.")
  }

  if (appointment.status !== "CONFIRMED") {
    throw AppError.conflict(ErrorCodes.CONFLICT, "Este agendamento já foi encerrado.")
  }

  const minutesUntilStart = (appointment.startsAt.getTime() - now.getTime()) / 60_000
  if (minutesUntilStart < BookingRules.customerCancellationCutoffMinutes) {
    throw AppError.conflict(
      ErrorCodes.CONFLICT,
      `Cancelamentos pelo app são aceitos até ${BookingRules.customerCancellationCutoffMinutes / 60} horas antes. Fale com a barbearia.`,
    )
  }

  const cancelled = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "CANCELLED", cancelledAt: now },
  })

  return toPublicAppointment(cancelled)
}

// ---------------------------------------------------------------------------
// Administração
// ---------------------------------------------------------------------------

export async function listAgenda(
  from: string,
  to: string,
  status?: AppointmentStatus,
): Promise<AdminAppointment[]> {
  const rangeStart = shopWallClockToInstant(from, 0)
  const rangeEnd = shopWallClockToInstant(addDaysToShopDate(to, 1), 0)

  const appointments = await prisma.appointment.findMany({
    where: {
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
      ...(status ? { status } : {}),
    },
    orderBy: { startsAt: "asc" },
    include: { user: { select: { id: true, fullName: true, phone: true } } },
    take: 500,
  })

  return appointments.map(appointment => toAdminAppointment(appointment, formatPhoneForDisplay))
}

export async function getAppointmentForAdmin(id: string): Promise<AdminAppointment> {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: { user: { select: { id: true, fullName: true, phone: true } } },
  })

  if (!appointment) {
    throw AppError.notFound(ErrorCodes.NOT_FOUND, "Agendamento não encontrado.")
  }

  return toAdminAppointment(appointment, formatPhoneForDisplay)
}

/**
 * Concluir, cancelar ou marcar falta. Só sai de CONFIRMED — um atendimento já
 * encerrado não muda de estado de novo.
 */
export async function updateAppointmentStatus(
  actorId: string,
  appointmentId: string,
  status: "COMPLETED" | "CANCELLED" | "NO_SHOW",
  now: Date = new Date(),
): Promise<AdminAppointment> {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } })

  if (!appointment) {
    throw AppError.notFound(ErrorCodes.NOT_FOUND, "Agendamento não encontrado.")
  }

  if (appointment.status !== "CONFIRMED") {
    throw AppError.conflict(ErrorCodes.CONFLICT, "Este agendamento já foi encerrado.")
  }

  await prisma.$transaction([
    prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status,
        ...(status === "CANCELLED" ? { cancelledAt: now } : {}),
      },
    }),
    prisma.adminAuditLog.create({
      data: {
        actorId,
        targetUserId: appointment.userId,
        action: `APPOINTMENT_${status}`,
        metadata: { appointmentId, from: appointment.status, to: status },
      },
    }),
  ])

  logger.info("Status de agendamento alterado", { actorId, appointmentId, to: status })

  return getAppointmentForAdmin(appointmentId)
}

export interface CustomerSummary {
  totalAppointments: number
  completed: number
  cancelled: number
  noShow: number
  upcoming: number
  lastVisitAt: string | null
}

/** Resumo do cliente derivado dos agendamentos reais. */
export async function getCustomerSummary(
  userId: string,
  now: Date = new Date(),
): Promise<CustomerSummary> {
  const [grouped, lastCompleted, upcoming] = await Promise.all([
    prisma.appointment.groupBy({
      by: ["status"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.appointment.findFirst({
      where: { userId, status: "COMPLETED" },
      orderBy: { startsAt: "desc" },
      select: { startsAt: true },
    }),
    prisma.appointment.count({
      where: { userId, status: "CONFIRMED", endsAt: { gte: now } },
    }),
  ])

  const countFor = (status: AppointmentStatus) =>
    grouped.find(entry => entry.status === status)?._count._all ?? 0

  return {
    totalAppointments: grouped.reduce((sum, entry) => sum + entry._count._all, 0),
    completed: countFor("COMPLETED"),
    cancelled: countFor("CANCELLED"),
    noShow: countFor("NO_SHOW"),
    upcoming,
    lastVisitAt: lastCompleted?.startsAt.toISOString() ?? null,
  }
}

/** Histórico completo de um cliente, para a ficha administrativa. */
export async function listCustomerAppointments(userId: string): Promise<PublicAppointment[]> {
  const appointments = await prisma.appointment.findMany({
    where: { userId },
    orderBy: { startsAt: "desc" },
    take: 200,
  })
  return appointments.map(toPublicAppointment)
}
