import { Router } from "express"
import type { z } from "zod"
import { requireActiveAccount, requireAuth } from "../../middlewares/auth.js"
import { validate } from "../../middlewares/validate.js"
import { sendSuccess } from "../../utils/http.js"
import {
  availabilityQuerySchema,
  createAppointmentSchema,
  listMyAppointmentsQuerySchema,
  createContactSchema,
  publicBookingRequestSchema,
  publicTokenParamSchema,
  uuidParamSchema,
} from "./booking.schemas.js"
import {
  paymentWebhookRateLimit,
  publicBookingRateLimit,
  publicContactRateLimit,
  publicRequestLookupRateLimit,
} from "../../middlewares/rate-limit.js"
import { processPaymentWebhook } from "../payment/payment.service.js"
import { paymentsEnabled } from "../../config/env.js"
import type { RequestWithRawBody } from "../../app.js"
import {
  getPublicRequest,
  registerPublicContact,
  requestPublicAppointment,
} from "./public-booking.service.js"
import { BookingRules } from "./booking.rules.js"
import { listActiveServices } from "./catalog.service.js"
import { getAvailability } from "./availability.service.js"
import {
  cancelMyAppointment,
  createAppointment,
  getMyAppointment,
  listMyAppointments,
} from "./appointments.service.js"
import { listBusinessHours } from "./schedule.service.js"

import { enforcePublicIpQuota } from "./public-quota.js"

export const bookingRouter = Router()

/**
 * Catálogo e expediente são públicos: a landing precisa deles antes do login.
 * Só serviços ativos saem daqui.
 */
bookingRouter.get("/services", async (_req, res) => {
  return sendSuccess(res, { services: await listActiveServices() })
})

bookingRouter.get("/business-hours", async (_req, res) => {
  return sendSuccess(res, { days: await listBusinessHours() })
})

/**
 * Disponibilidade também é pública.
 *
 * A consulta mostra apenas horários livres, sem dados de quem reservou.
 * Solicitações públicas usam /requests; /appointments continua restrita à
 * conta autenticada e aprovada.
 */
bookingRouter.get(
  "/availability",
  validate({ query: availabilityQuerySchema }),
  async (req, res) => {
    const { date, serviceId } = req.validatedQuery as z.infer<typeof availabilityQuerySchema>
    return sendSuccess(res, await getAvailability(date, serviceId))
  },
)

/** Criar reserva exige conta aprovada: PENDING e BLOCKED não agendam. */
bookingRouter.post(
  "/appointments",
  requireAuth,
  requireActiveAccount,
  validate({ body: createAppointmentSchema }),
  async (req, res) => {
    const body = req.body as z.infer<typeof createAppointmentSchema>

    // O dono da reserva é sempre a sessão — nunca um userId vindo do corpo.
    const placed = await createAppointment({ ...body, userId: req.user!.id })

    return sendSuccess(res, { appointment: placed.appointment }, 201)
  },
)

bookingRouter.get(
  "/appointments/me",
  requireAuth,
  requireActiveAccount,
  validate({ query: listMyAppointmentsQuerySchema }),
  async (req, res) => {
    const { scope } = req.validatedQuery as z.infer<typeof listMyAppointmentsQuerySchema>
    return sendSuccess(res, { appointments: await listMyAppointments(req.user!.id, scope) })
  },
)

bookingRouter.get(
  "/appointments/:id",
  requireAuth,
  requireActiveAccount,
  validate({ params: uuidParamSchema }),
  async (req, res) => {
    const appointment = await getMyAppointment(req.user!.id, req.params.id as string)
    return sendSuccess(res, { appointment })
  },
)

bookingRouter.post(
  "/appointments/:id/cancel",
  requireAuth,
  requireActiveAccount,
  validate({ params: uuidParamSchema }),
  async (req, res) => {
    const appointment = await cancelMyAppointment(req.user!.id, req.params.id as string)
    return sendSuccess(res, { appointment })
  },
)

// ---------------------------------------------------------------------------
// Solicitação pública — sem JWT
// ---------------------------------------------------------------------------

/**
 * Cria uma solicitação de agendamento identificada apenas pelo WhatsApp.
 *
 * Público por decisão de produto: qualquer visitante pode solicitar, mas
 * o pedido depende de aprovação administrativa. Telefone não comprova
 * titularidade; a cota e a EXCLUDE reduzem abuso e impedem sobreposição.
 *
 * O telefone NÃO vira credencial: esta rota não devolve histórico, não
 * identifica reservas anteriores e não abre sessão. A resposta traz apenas o
 * pedido recém-criado e um token aleatório para acompanhá-lo.
 *
 * Nada de `userId`, `status`, `priceCents` ou `durationMinutes` é aceito do
 * navegador: o schema é estrito e o servidor deriva tudo do banco.
 */
bookingRouter.post(
  "/requests",
  publicBookingRateLimit,
  validate({ body: publicBookingRequestSchema }),
  async (req, res) => {
    const body = req.body as z.infer<typeof publicBookingRequestSchema>
    await enforcePublicIpQuota("requests", req.ip ?? "unknown")
    const result = await requestPublicAppointment({
      // O schema já garantiu que veio exatamente uma das duas formas.
      ...(body.contactHandle
        ? { contactHandle: body.contactHandle }
        : { fullName: body.fullName!, phone: body.phone! }),
      serviceId: body.serviceId,
      date: body.date,
      startsAt: body.startsAt,
      ...(body.notes ? { notes: body.notes } : {}),
    })

    return sendSuccess(
      res,
      {
        appointment: result.appointment,
        publicToken: result.publicToken,
        awaitingApproval: result.awaitingApproval,
        pendingTtlMinutes: BookingRules.pendingRequestTtlMinutes,
      },
      201,
    )
  },
)

/**
 * Situação de UMA solicitação, pelo token entregue na criação.
 *
 * O token é a chave — o telefone não abre nada. Sem listagem e sem histórico:
 * quem tem o link vê aquele pedido e mais nada.
 */
bookingRouter.get(
  "/requests/:token",
  publicRequestLookupRateLimit,
  validate({ params: publicTokenParamSchema }),
  async (req, res) => {
    const { token } = req.params as z.infer<typeof publicTokenParamSchema>
    // Traz o pedido, a cobrança (quando há) e o link do WhatsApp (só quando
    // confirmado). Nenhum dado de outra reserva, nenhum histórico.
    return sendSuccess(res, await getPublicRequest(token))
  },
)

/**
 * Notificação do provedor de pagamento — a ÚNICA forma de confirmar dinheiro.
 *
 * Pública por necessidade: quem chama é o provedor, que não tem sessão nossa.
 * O que a protege não é autenticação de usuário, é a assinatura sobre os bytes
 * do corpo, validada pelo adaptador antes de qualquer acesso ao banco.
 *
 * Responde 200 mesmo quando a notificação é descartada (repetida, valor
 * divergente, cobrança desconhecida): provedor que recebe erro reenvia em
 * laço, e esses casos já foram processados — a decisão está gravada em
 * `payment_webhook_events.outcome`. Assinatura inválida é o caso que responde
 * erro, porque aí não houve notificação nenhuma.
 */
bookingRouter.post("/payments/webhook", paymentWebhookRateLimit, async (req, res) => {
  const { outcome } = await processPaymentWebhook({
    headers: req.headers as Record<string, string | undefined>,
    rawBody: (req as unknown as RequestWithRawBody).rawBody ?? "",
  })
  // Só o reconhecimento. Nada sobre o agendamento, o cliente ou o valor: a
  // resposta de um webhook não é lugar de devolver dado de ninguém.
  return sendSuccess(res, { received: true, outcome })
})

/**
 * Política pública da agenda.
 *
 * O frontend precisa saber se o pedido será confirmado na hora ou ficará
 * aguardando o barbeiro — é a diferença entre o botão dizer "Confirmar" ou
 * "Solicitar". Em vez de duplicar a regra de negócio no navegador, ela é
 * servida daqui: quem manda continua sendo `BookingRules`.
 */
bookingRouter.get("/policy", async (_req, res) => {
  return sendSuccess(res, {
    requiresApproval: BookingRules.publicRequestsRequireApproval,
    baseSlotMinutes: BookingRules.baseSlotMinutes,
    pendingTtlMinutes: BookingRules.pendingRequestTtlMinutes,
    minimumAdvanceMinutes: BookingRules.minimumAdvanceMinutes,
    /**
     * Confirmar exige pagamento nesta instalação?
     *
     * A tela precisa saber antes de prometer qualquer coisa: com pagamento, a
     * aprovação do barbeiro leva a "aguardando pagamento"; sem, leva direto a
     * confirmado. Servido daqui em vez de duplicado no navegador.
     */
    paymentRequired: paymentsEnabled,
    paymentWindowMinutes: BookingRules.paymentWindowMinutes,
  })
})

/**
 * Etapa de cadastro do fluxo público — a PRIMEIRA do agendamento.
 *
 * Valida nome e WhatsApp, normaliza para E.164 e grava o contato. Não cria
 * senha, JWT, refresh token nem sessão; devolve apenas um handle de uso
 * restrito para as etapas seguintes (ver contact-handle).
 *
 * Informar o telefone de outra pessoa não devolve nada dela: o nome que volta
 * é o que acabou de ser digitado, e o telefone volta mascarado.
 */
bookingRouter.post(
  "/contacts",
  publicContactRateLimit,
  validate({ body: createContactSchema }),
  async (req, res) => {
    const body = req.body as z.infer<typeof createContactSchema>
    await enforcePublicIpQuota("contacts", req.ip ?? "unknown")
    return sendSuccess(res, await registerPublicContact(body), 201)
  },
)
