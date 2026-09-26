import { isOverlapViolation } from "./booking-conflict.js"
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
import {
  BookingRules,
  paymentAmountCents,
  paymentWindowMinutesFor,
  reservedMinutesFor,
} from "./booking.rules.js"
import { getBookableService } from "./catalog.service.js"
import { listBookableStartMinutes } from "./availability.service.js"
import { fitsInAnyWindow, windowsFromBusinessHours } from "./availability.engine.js"
import { getDayWindow } from "./schedule.service.js"
import type { Prisma } from "../../generated/prisma/client.js"
import { lockUser } from "../../utils/locks.js"
import { generateUniquePublicReference } from "./public-reference.js"
import {
  createPaymentForAppointment,
  paymentRequestFor,
} from "../payment/payment.service.js"
import { paymentMethod } from "../../config/env.js"
import { STATIC_PIX_PROVIDER } from "../payment/pix/pix.service.js"
import { requirePaymentProvider } from "../payment/payment.registry.js"
import { generatePublicToken, digestPublicToken } from "./public-token.js"

/**
 * Perda de corrida ao gravar.
 *
 * 23P01 é a violação da EXCLUDE. 40P01 (deadlock) aparece quando várias
 * transações disputam o mesmo intervalo e o PostgreSQL resolve o impasse
 * abortando uma delas — do ponto de vista de quem pediu, é o mesmo caso: o
 * horário foi para outra pessoa. Tratar como 500 puniria o cliente por uma
 * condição de corrida normal.
 */

export interface CreateAppointmentInput {
  userId: string
  serviceId: string
  date: string
  startsAt: string
  notes?: string
}

/**
 * Como a reserva nasce.
 *
 *   SESSION — cliente autenticado ou administração: já nasce CONFIRMED.
 *   PUBLIC  — solicitação sem login vinda da landing. Nasce PENDING quando a
 *             barbearia exige aprovação (ver BookingRules), e recebe um token
 *             para a pessoa acompanhar o próprio pedido sem criar conta.
 */
export type AppointmentOrigin = "SESSION" | "PUBLIC"

export interface PlacedAppointment {
  appointment: PublicAppointment
  /** Só existe em solicitação pública. Entregue uma única vez. */
  publicToken?: string
}


/**
 * Cria um agendamento.
 *
 * Nada de duração, preço, fim ou status vem do cliente: o servidor lê o
 * serviço no banco e calcula tudo. O cliente informa apenas o que quer e
 * quando começa.
 *
 * A validação do horário é feita por PARTICIPAÇÃO na lista de inícios que a
 * agenda realmente oferece, em vez de repetir as regras aqui. Duas
 * implementações paralelas divergiriam com o tempo, e a divergência apareceria
 * como "o horário aparecia livre mas foi recusado". Essa checagem cobre
 * expediente, almoço, bloqueios, ocupação, antecedência, grade e reancoragem.
 *
 * As validações dão mensagens boas; a garantia dura contra reserva dupla é a
 * EXCLUDE constraint do PostgreSQL, que protege o intervalo OPERACIONAL
 * (`starts_at` .. `reserved_ends_at`) e inclui as solicitações pendentes.
 */
export async function createAppointment(
  input: CreateAppointmentInput,
  now: Date = new Date(),
  origin: AppointmentOrigin = "SESSION",
  beforeInsert?: (tx: Prisma.TransactionClient) => Promise<string>,
): Promise<PlacedAppointment> {
  const service = await getBookableService(input.serviceId)

  const startMinute = clockToMinutes(input.startsAt)
  const startsAt = shopWallClockToInstant(input.date, startMinute)
  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000)

  // Reserva operacional: pode ser maior que o atendimento. É ela que a agenda
  // bloqueia; `endsAt` continua sendo o que o cliente vê.
  const reservedMinutes = reservedMinutesFor(
    service.durationMinutes,
    service.bufferBeforeMinutes,
    service.bufferAfterMinutes,
  )
  const reservedEndsAt = new Date(startsAt.getTime() + reservedMinutes * 60_000)

  // Antecedência máxima antes de qualquer consulta pesada.
  const lastBookableDate = addDaysToShopDate(instantToShopDate(now), BookingRules.maximumAdvanceDays)
  if (input.date > lastBookableDate) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_ERROR,
      `Só é possível agendar até ${BookingRules.maximumAdvanceDays} dias à frente.`,
    )
  }

  // As checagens abaixo existem pela MENSAGEM. A decisão final é a
  // participação na lista oferecida, logo adiante — mas "esse horário não está
  // disponível" não ajuda quem tentou agendar às 22h ou num domingo. Cada uma
  // devolve o motivo real.
  const earliest = new Date(now.getTime() + BookingRules.minimumAdvanceMinutes * 60_000)
  if (startsAt.getTime() < earliest.getTime()) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_ERROR,
      `Agende com pelo menos ${BookingRules.minimumAdvanceMinutes} minutos de antecedência.`,
    )
  }

  const day = await getDayWindow(input.date)
  if (!day) {
    throw AppError.badRequest(ErrorCodes.CONFLICT, "A barbearia está fechada nesta data.")
  }

  if (!fitsInAnyWindow(windowsFromBusinessHours(day), startMinute, reservedMinutes)) {
    throw AppError.badRequest(
      ErrorCodes.CONFLICT,
      "Horário fora do expediente para a duração deste serviço.",
    )
  }

  const offered = await listBookableStartMinutes(input.date, service.id, now)
  if (!offered.includes(startMinute)) {
    throw AppError.conflict(
      ErrorCodes.CONFLICT,
      "Esse horário não está mais disponível. Escolha outro.",
    )
  }

  const requiresApproval =
    origin === "PUBLIC" && BookingRules.publicRequestsRequireApproval
  const publicToken = origin === "PUBLIC" ? generatePublicToken() : undefined

  try {
    const appointment = await prisma.$transaction(async tx => {
      const userId = beforeInsert ? await beforeInsert(tx) : input.userId;
      // Solicitações pendentes vencidas que cobrem este intervalo são
      // liberadas AQUI, na mesma transação do insert e restritas ao período
      // em disputa. Assim a EXCLUDE não recusa a reserva por causa de um
      // pedido abandonado, sem precisar de varredura global no caminho de
      // leitura — que era o que gerava disputa de lock.
      // Cobre os dois prazos que seguram um horário: aguardando o barbeiro
      // (PENDING) e aguardando o pagamento (AWAITING_PAYMENT). Os dois usam
      // `pendingExpiresAt` como "até quando esta reserva vale", então a mesma
      // varredura serve para ambos.
      const expired = await tx.appointment.findMany({
        where: {
          status: { in: ["PENDING", "AWAITING_PAYMENT"] },
          pendingExpiresAt: { lte: now },
          startsAt: { lt: reservedEndsAt },
          reservedEndsAt: { gt: startsAt },
        },
        select: { id: true },
      })
      if (expired.length > 0) {
        const ids = expired.map(entry => entry.id)
        await tx.appointment.updateMany({
          where: { id: { in: ids } },
          data: { status: "EXPIRED", decidedAt: now },
        })
        // A cobrança morre com a reserva. Sem isto, um pagamento continuaria
        // PENDING apontando para um horário que já é de outra pessoa.
        await tx.payment.updateMany({
          where: { appointmentId: { in: ids }, status: "PENDING" },
          data: { status: "EXPIRED" },
        })
      }

      return tx.appointment.create({
      data: {
        userId,
        serviceId: service.id,
        startsAt,
        endsAt,
        reservedEndsAt,
        status: requiresApproval ? "PENDING" : "CONFIRMED",
        notes: input.notes ?? null,
        // Congelados: mudar o serviço depois não reescreve esta reserva.
        serviceName: service.name,
        servicePriceCents: service.priceCents,
        bufferBeforeMinutes: service.bufferBeforeMinutes,
        bufferAfterMinutes: service.bufferAfterMinutes,
        ...(publicToken ? { publicToken: digestPublicToken(publicToken) } : {}),
        ...(requiresApproval
          ? {
              pendingExpiresAt: new Date(
                now.getTime() + BookingRules.pendingRequestTtlMinutes * 60_000,
              ),
            }
          : {}),
        },
      })
    })

    return { appointment: toPublicAppointment(appointment), publicToken }
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
      ...(status === "PENDING"
        ? { status, pendingExpiresAt: { gt: new Date() } }
        : status === "EXPIRED"
          ? { OR: [{ status: "EXPIRED" as const }, { status: "PENDING" as const, pendingExpiresAt: { lte: new Date() } }] }
          : status ? { status } : {}),
    },
    orderBy: { startsAt: "asc" },
    include: {
      user: { select: { id: true, fullName: true, phone: true } },
      // A cobrança acompanha o agendamento no painel: é por ela que a
      // barbearia sabe se falta pagar e se pode confirmar o recebimento.
      payment: { select: { provider: true, status: true, amountCents: true, expiresAt: true, paidAt: true } },
    },
    take: 500,
  })

  return appointments.map(appointment => toAdminAppointment(appointment, formatPhoneForDisplay))
}

export async function getAppointmentForAdmin(id: string): Promise<AdminAppointment> {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, phone: true } },
      // A cobrança acompanha o agendamento no painel: é por ela que a
      // barbearia sabe se falta pagar e se pode confirmar o recebimento.
      payment: { select: { provider: true, status: true, amountCents: true, expiresAt: true, paidAt: true } },
    },
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
  await prisma.$transaction(async tx => {
    // Lock da linha ANTES de decidir. A leitura ficava fora da transação, e um
    // webhook confirmando o pagamento ao mesmo tempo podia ser sobrescrito por
    // este cancelamento (ou o contrário). Quem pega a linha primeiro decide.
    await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId}::uuid FOR UPDATE`
    const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } })

    if (!appointment) {
      throw AppError.notFound(ErrorCodes.NOT_FOUND, "Agendamento não encontrado.")
    }

    /**
     * De onde cada transição pode partir.
     *
     * CANCELLED também parte de AWAITING_PAYMENT: com pagamento ligado, aprovar
     * leva a esse estado, e sem isto a barbearia perdia a capacidade de cancelar
     * um agendamento aprovado — algo que sempre pôde fazer quando aprovar
     * resultava direto em CONFIRMED. Ficaria presa até a janela vencer.
     *
     * COMPLETED e NO_SHOW continuam exigindo CONFIRMED: não se conclui nem se
     * registra falta de um atendimento que ainda não foi pago.
     */
    const allowedFrom: AppointmentStatus[] =
      status === "CANCELLED" ? ["CONFIRMED", "AWAITING_PAYMENT"] : ["CONFIRMED"]
    if (!allowedFrom.includes(appointment.status)) {
      throw AppError.conflict(ErrorCodes.CONFLICT, "Este agendamento já foi encerrado.")
    }

    await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status,
        ...(status === "CANCELLED"
          ? {
              cancelledAt: now,
              // A reserva deixa de valer: não há mais prazo a cumprir. CANCELLED
              // está fora da EXCLUDE, então o horário volta a ser oferecido.
              pendingExpiresAt: null,
            }
          : {}),
      },
    })

    if (status === "CANCELLED") {
      // A cobrança morre com a reserva. Deixá-la PENDING manteria uma cobrança
      // pagável apontando para um horário que já não existe.
      await tx.payment.updateMany({
        where: { appointmentId, status: "PENDING" },
        data: { status: "CANCELED" },
      })
    }

    await tx.adminAuditLog.create({
      data: {
        actorId,
        targetUserId: appointment.userId,
        action: `APPOINTMENT_${status}`,
        metadata: { appointmentId, from: appointment.status, to: status },
      },
    })
  })

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

/**
 * Decisão do barbeiro sobre uma solicitação pública pendente.
 *
 * Confirmar não recria a reserva: o horário já estava segurado desde o pedido,
 * e a EXCLUDE constraint inclui PENDING justamente para isso. O que muda é o
 * estado e o fim do prazo — uma solicitação confirmada deixa de expirar.
 *
 * Recusar libera o horário na consulta seguinte, sem apagar o registro: o
 * histórico de pedidos recusados continua visível para a barbearia.
 */
export async function decidePendingRequest(
  actorId: string,
  appointmentId: string,
  decision: "CONFIRMED" | "REJECTED",
  now?: Date,
): Promise<AdminAppointment> {
  const decidedAt = now ?? new Date()

  let prepared:
    | {
        reference: string
        expiresAt: Date
        created: {
          provider: string
          providerPaymentId?: string
          checkoutUrl?: string
          pixQrCode?: string
        }
      }
    | undefined

  if (decision === "CONFIRMED") {
    /**
     * A referência pública é RESERVADA e gravada em TODA aprovação — com ou sem
     * pagamento.
     *
     * Ligada só ao caminho de pagamento, um agendamento confirmado numa
     * instalação sem provedor ficava sem referência, e a confirmação pelo
     * WhatsApp nunca aparecia: o link exige a referência. Como pagamento é
     * opcional e o padrão é estar desligado, era o caso comum que ficava sem a
     * funcionalidade.
     *
     * Gravar antes de falar com o provedor também resolve outra coisa: sorteada
     * só na memória, duas aprovações simultâneas geravam referências diferentes
     * e DUAS cobranças, a do perdedor órfã — sem linha no banco e ainda
     * pagável. Sob lock da linha, as duas tentativas compartilham a mesma
     * referência e o provedor deduplica.
     *
     * Transação curta e só de reserva: a chamada de rede continua fora dela.
     */
    const pending = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId}::uuid FOR UPDATE`
      const current = await tx.appointment.findUnique({ where: { id: appointmentId } })
      if (!current) throw AppError.notFound(ErrorCodes.NOT_FOUND, "Solicitação não encontrada.")
      if (current.status !== "PENDING") {
        throw AppError.conflict(ErrorCodes.CONFLICT, "Esta solicitação já foi decidida ou expirou.")
      }
      if (current.publicReference) return current
      const reserved = await generateUniquePublicReference(async candidate =>
        (await tx.appointment.count({ where: { publicReference: candidate } })) > 0,
      )
      return tx.appointment.update({
        where: { id: appointmentId },
        data: { publicReference: reserved },
      })
    })
    const reference = pending.publicReference!

    /**
     * Só cobra quando existe valor a cobrar.
     *
     * Um serviço de preço zero é legítimo (cortesia, retoque incluso) — o
     * catálogo aceita `priceCents: 0`. Abrir cobrança de zero violava o CHECK
     * `amount_cents > 0` da tabela, a aprovação morria com erro interno e o
     * pedido ficava preso em PENDING: a barbearia não conseguia aprovar de jeito
     * nenhum. Sem valor, aprovar confirma direto, como numa instalação sem
     * pagamento configurado.
     */
    const amountCents = paymentAmountCents(pending.servicePriceCents)
    if (amountCents > 0 && paymentMethod !== "NONE") {
      const expiresAt = new Date(
        decidedAt.getTime() + paymentWindowMinutesFor(paymentMethod) * 60_000,
      )
      if (paymentMethod === "DYNAMIC_PROVIDER_PIX") {
        // Cobrança no provedor: uma por agendamento, com QR próprio e
        // confirmação automática por webhook.
        const provider = requirePaymentProvider()
        const created = await provider.createPayment(
          paymentRequestFor({ ...pending, publicReference: reference }, expiresAt),
        )
        prepared = { reference, expiresAt, created: { provider: provider.name, ...created } }
      } else {
        /**
         * Pix ESTÁTICO: não há terceiro a chamar. O BR Code é montado na hora de
         * exibir, a partir da chave configurada e do valor desta reserva, então
         * aqui basta abrir a cobrança e marcar o prazo.
         *
         * Ninguém nos avisa quando o dinheiro entra — a confirmação é
         * administrativa. É por isso que este caminho NÃO pode se apresentar
         * como pagamento confirmado em nenhum momento.
         */
        prepared = { reference, expiresAt, created: { provider: STATIC_PIX_PROVIDER } }
      }
    }
  }

  await prisma.$transaction(async tx => {
    await lockUser(tx, actorId)
    const actor = await tx.user.findUnique({ where: { id: actorId } })
    if (actor?.role !== "ADMIN" || actor.status !== "ACTIVE") throw AppError.forbidden()
    await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId}::uuid FOR UPDATE`
    const appointment = await tx.appointment.findUnique({where:{id:appointmentId}})
    if (!appointment) throw AppError.notFound(ErrorCodes.NOT_FOUND, "Solicitação não encontrada.")
    if (appointment.status !== "PENDING" || !appointment.pendingExpiresAt || appointment.pendingExpiresAt <= decidedAt) {
      throw AppError.conflict(ErrorCodes.CONFLICT, "Esta solicitação já foi decidida ou expirou.")
    }

    /**
     * Para onde a aprovação leva.
     *
     * Com pagamento configurado, aprovar NÃO confirma: leva a
     * AWAITING_PAYMENT, e `pendingExpiresAt` passa a marcar o fim da janela de
     * pagamento. O horário segue reservado — a EXCLUDE cobre AWAITING_PAYMENT —
     * e vencido o prazo a reserva expira como qualquer pendente abandonada.
     *
     * Sem pagamento configurado, aprovar confirma direto: o comportamento
     * anterior a esta versão, preservado inteiro.
     *
     * Cobrar antes da aprovação seria cobrar quem vai ser recusado. Por isso a
     * ordem é esta e não a inversa.
     */
    const target: AppointmentStatus =
      decision === "REJECTED" ? "REJECTED" : prepared ? "AWAITING_PAYMENT" : "CONFIRMED"

    await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status: target,
        decidedAt,
        pendingExpiresAt: prepared ? prepared.expiresAt : null,
        ...(decision === "REJECTED" ? { cancelledAt: decidedAt } : {}),
      },
    })

    if (prepared) {
      await createPaymentForAppointment(
        tx,
        { ...appointment, publicReference: prepared.reference },
        prepared.created,
        prepared.expiresAt,
      )
    }

    await tx.adminAuditLog.create({data:{actorId,targetUserId:appointment.userId,action: `APPOINTMENT_REQUEST_${decision}`,metadata:{appointmentId,from:"PENDING",to:target}}})
  })
  logger.info("Solicitação de agendamento decidida", { actorId, appointmentId, to: decision })
  return getAppointmentForAdmin(appointmentId)
}
