import { Router } from "express"
import type { z } from "zod"
import { validate } from "../../middlewares/validate.js"
import { settleStaticPayment } from "../payment/payment.service.js"
import { sendSuccess } from "../../utils/http.js"
import {
  decideRequestSchema,
  settlePaymentSchema,
  adminAgendaQuerySchema,
  createBlockSchema,
  createServiceSchema,
  listBlocksQuerySchema,
  listServicesQuerySchema,
  updateAppointmentStatusSchema,
  updateBusinessHoursSchema,
  updateServiceSchema,
  uuidParamSchema,
} from "./booking.schemas.js"
import {
  createService,
  listServicesForAdmin,
  setServiceActive,
  updateService,
} from "./catalog.service.js"
import {
  createBlock,
  deleteBlock,
  listBlocks,
  listBusinessHours,
  replaceBusinessHours,
} from "./schedule.service.js"
import {
  decidePendingRequest,
  getAppointmentForAdmin,
  getCustomerSummary,
  listAgenda,
  listCustomerAppointments,
  updateAppointmentStatus,
} from "./appointments.service.js"

/**
 * Rotas administrativas do domínio de agenda.
 *
 * Este router é montado dentro do adminRouter, que já aplica requireAuth +
 * requireRole("ADMIN"). A autorização não depende do frontend.
 */
export const bookingAdminRouter = Router()

// --------------------------------------------------------------------------
// Serviços
// --------------------------------------------------------------------------

bookingAdminRouter.get(
  "/services",
  validate({ query: listServicesQuerySchema }),
  async (req, res) => {
    const { includeInactive } = req.validatedQuery as z.infer<typeof listServicesQuerySchema>
    return sendSuccess(res, { services: await listServicesForAdmin(includeInactive) })
  },
)

bookingAdminRouter.post("/services", validate({ body: createServiceSchema }), async (req, res) => {
  const body = req.body as z.infer<typeof createServiceSchema>
  return sendSuccess(res, { service: await createService(body) }, 201)
})

bookingAdminRouter.patch(
  "/services/:id",
  validate({ params: uuidParamSchema, body: updateServiceSchema }),
  async (req, res) => {
    const body = req.body as z.infer<typeof updateServiceSchema>
    const service = await updateService(req.params.id as string, body)
    return sendSuccess(res, { service })
  },
)

bookingAdminRouter.post(
  "/services/:id/activate",
  validate({ params: uuidParamSchema }),
  async (req, res) => {
    return sendSuccess(res, { service: await setServiceActive(req.params.id as string, true) })
  },
)

bookingAdminRouter.post(
  "/services/:id/deactivate",
  validate({ params: uuidParamSchema }),
  async (req, res) => {
    return sendSuccess(res, { service: await setServiceActive(req.params.id as string, false) })
  },
)

// --------------------------------------------------------------------------
// Horário de funcionamento
// --------------------------------------------------------------------------

bookingAdminRouter.get("/business-hours", async (_req, res) => {
  return sendSuccess(res, { days: await listBusinessHours() })
})

bookingAdminRouter.put(
  "/business-hours",
  validate({ body: updateBusinessHoursSchema }),
  async (req, res) => {
    const { days } = req.body as z.infer<typeof updateBusinessHoursSchema>
    return sendSuccess(res, { days: await replaceBusinessHours(days) })
  },
)

// --------------------------------------------------------------------------
// Bloqueios
// --------------------------------------------------------------------------

bookingAdminRouter.get("/blocks", validate({ query: listBlocksQuerySchema }), async (req, res) => {
  const { from, to } = req.validatedQuery as z.infer<typeof listBlocksQuerySchema>
  return sendSuccess(res, { blocks: await listBlocks(from, to) })
})

bookingAdminRouter.post("/blocks", validate({ body: createBlockSchema }), async (req, res) => {
  const body = req.body as z.infer<typeof createBlockSchema>
  return sendSuccess(res, { block: await createBlock(body) }, 201)
})

bookingAdminRouter.delete("/blocks/:id", validate({ params: uuidParamSchema }), async (req, res) => {
  await deleteBlock(req.params.id as string)
  return sendSuccess(res, { deleted: true })
})

// --------------------------------------------------------------------------
// Agenda
// --------------------------------------------------------------------------

bookingAdminRouter.get("/agenda", validate({ query: adminAgendaQuerySchema }), async (req, res) => {
  const { from, to, status } = req.validatedQuery as z.infer<typeof adminAgendaQuerySchema>
  return sendSuccess(res, { appointments: await listAgenda(from, to, status) })
})

bookingAdminRouter.get(
  "/appointments/:id",
  validate({ params: uuidParamSchema }),
  async (req, res) => {
    return sendSuccess(res, { appointment: await getAppointmentForAdmin(req.params.id as string) })
  },
)

bookingAdminRouter.patch(
  "/appointments/:id/status",
  validate({ params: uuidParamSchema, body: updateAppointmentStatusSchema }),
  async (req, res) => {
    const { status } = req.body as z.infer<typeof updateAppointmentStatusSchema>
    const appointment = await updateAppointmentStatus(
      req.user!.id,
      req.params.id as string,
      status,
    )
    return sendSuccess(res, { appointment })
  },
)

// --------------------------------------------------------------------------
// Ficha do cliente (usuários reais + agendamentos reais)
// --------------------------------------------------------------------------

bookingAdminRouter.get(
  "/customers/:id/summary",
  validate({ params: uuidParamSchema }),
  async (req, res) => {
    const userId = req.params.id as string
    const [summary, appointments] = await Promise.all([
      getCustomerSummary(userId),
      listCustomerAppointments(userId),
    ])
    return sendSuccess(res, { summary, appointments })
  },
)

/**
 * Confirma ou recusa uma solicitação pública pendente.
 *
 * Herda `requireAuth + requireActiveAccount + requireRole("ADMIN")` do router:
 * a decisão é sempre da barbearia, nunca de quem solicitou.
 */
bookingAdminRouter.post(
  "/requests/:id/decide",
  validate({ params: uuidParamSchema, body: decideRequestSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof uuidParamSchema>
    const { decision } = req.body as z.infer<typeof decideRequestSchema>
    const appointment = await decidePendingRequest(req.user!.id, id, decision)
    return sendSuccess(res, { appointment })
  },
)

/**
 * Confirma (ou recusa) um pagamento recebido por Pix ESTÁTICO.
 *
 * Herda `requireAuth + requireActiveAccount + requireRole("ADMIN")` do router.
 *
 * Existe porque o Pix estático não tem quem notifique: o dinheiro cai na conta
 * e alguém da barbearia confere no extrato. Sem isto, um agendamento pago
 * ficaria preso aguardando pagamento até a janela vencer.
 *
 * Recusada para cobrança de provedor — ali quem confirma é o webhook. E o
 * cliente não alcança esta rota: exige sessão administrativa ativa.
 */
bookingAdminRouter.post(
  "/appointments/:id/payment",
  validate({ params: uuidParamSchema, body: settlePaymentSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof uuidParamSchema>
    const { decision } = req.body as z.infer<typeof settlePaymentSchema>
    await settleStaticPayment(req.user!.id, id, decision)
    return sendSuccess(res, { appointment: await getAppointmentForAdmin(id) })
  },
)
