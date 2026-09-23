import { newPasswordSchema, confirmationSchema } from "../auth/auth.schemas.js"
import { passwordChangeRateLimit } from "../../middlewares/rate-limit.js"
import { Router } from "express"
import { z } from "zod"
import {
  requireActiveAccount,
  requireAuth,
  requireRole,
} from "../../middlewares/auth.js"
import { validate } from "../../middlewares/validate.js"
import { sendSuccess } from "../../utils/http.js"
import {
  countPendingUsers,
  getUserById,
  listAuditLog,
  listUsers,
  updateUserStatus,
  resetUserPassword,
} from "./admin.service.js"
import { bookingAdminRouter } from "../booking/booking.admin.routes.js"

export const adminRouter = Router()

// Toda rota daqui para baixo exige sessão válida E papel ADMIN, verificados no
// banco a cada requisição. O frontend não participa dessa decisão.
adminRouter.use(requireAuth, requireActiveAccount, requireRole("ADMIN"))

// Agenda, serviços, bloqueios e fichas de cliente herdam a mesma proteção.
adminRouter.use(bookingAdminRouter)

const listUsersQuerySchema = z.object({
  status: z.enum(["PENDING", "ACTIVE", "BLOCKED"]).optional(),
  role: z.enum(["CUSTOMER", "ADMIN"]).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().positive().max(100000).default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
})

const userIdParamsSchema = z.object({
  id: z.uuid("Identificador inválido."),
})

const updateStatusSchema = z.strictObject({
  status: z.enum(["PENDING", "ACTIVE", "BLOCKED"]),
})

adminRouter.get(
  "/users",
  validate({ query: listUsersQuerySchema }),
  async (req, res) => {
    const filters = req.validatedQuery as z.infer<typeof listUsersQuerySchema>
    const result = await listUsers(filters)
    return sendSuccess(res, result)
  },
)

adminRouter.get("/users/pending-count", async (_req, res) => {
  return sendSuccess(res, { pending: await countPendingUsers() })
})

adminRouter.get(
  "/users/:id",
  validate({ params: userIdParamsSchema }),
  async (req, res) => {
    return sendSuccess(res, {
      user: await getUserById(req.params.id as string),
    })
  },
)

adminRouter.patch(
  "/users/:id/status",
  validate({ params: userIdParamsSchema, body: updateStatusSchema }),
  async (req, res) => {
    const { status } = req.body as z.infer<typeof updateStatusSchema>
    const user = await updateUserStatus(
      req.user!.id,
      req.params.id as string,
      status,
    )
    return sendSuccess(res, { user })
  },
)

adminRouter.get("/audit-log", async (_req, res) => {
  return sendSuccess(res, { entries: await listAuditLog() })
})

/** Redefinição assistida; a resposta nunca contém senha. */
const resetPasswordSchema = z.strictObject({ password: newPasswordSchema, confirmPassword: confirmationSchema })
  .refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "As senhas não conferem." })
adminRouter.post(
  "/users/:id/reset-password",
  passwordChangeRateLimit,
  validate({ params: userIdParamsSchema, body: resetPasswordSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof userIdParamsSchema>
    const { password } = req.body as z.infer<typeof resetPasswordSchema>
    return sendSuccess(res, await resetUserPassword(req.user!.id, id, password))
  },
)
