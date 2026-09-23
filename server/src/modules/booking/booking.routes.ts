import { Router } from "express"
import type { z } from "zod"
import { requireActiveAccount, requireAuth } from "../../middlewares/auth.js"
import { validate } from "../../middlewares/validate.js"
import { sendSuccess } from "../../utils/http.js"
import {
  availabilityQuerySchema,
  createAppointmentSchema,
  listMyAppointmentsQuerySchema,
  uuidParamSchema,
} from "./booking.schemas.js"
import { listActiveServices } from "./catalog.service.js"
import { getAvailability } from "./availability.service.js"
import {
  cancelMyAppointment,
  createAppointment,
  getMyAppointment,
  listMyAppointments,
} from "./appointments.service.js"
import { listBusinessHours } from "./schedule.service.js"

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
 * O fluxo de agendamento começa antes do login: quem chega pela landing
 * escolhe serviço, data e horário e só então cria conta ou entra. Sem isso a
 * pessoa teria de se cadastrar às cegas, sem saber se existe horário.
 *
 * O que sai daqui é agregado e sem dado pessoal — apenas os horários livres,
 * a mesma informação que qualquer vitrine de agendamento exibe. Quem reservou
 * o que continua exigindo sessão. Criar a reserva, abaixo, segue exigindo
 * conta aprovada.
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
    const appointment = await createAppointment({ ...body, userId: req.user!.id })

    return sendSuccess(res, { appointment }, 201)
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
