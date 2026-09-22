import { Router } from "express"
import { z } from "zod"
import { requireAuth } from "../../middlewares/auth.js"
import { validate } from "../../middlewares/validate.js"
import { prisma } from "../../config/prisma.js"
import { sendSuccess } from "../../utils/http.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { toPublicUser } from "./users.mapper.js"

export const usersRouter = Router()

/**
 * Só o nome é editável pelo próprio usuário. Telefone, papel e status ficam de
 * fora de propósito — mudar qualquer um deles exige outro fluxo (OTP ou admin).
 */
const updateMeSchema = z.strictObject({
  fullName: z.string().trim().min(2, "Informe ao menos 2 caracteres.").max(120),
})

usersRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user)
    throw AppError.notFound(
      ErrorCodes.USER_NOT_FOUND,
      "Usuário não encontrado.",
    )
  return sendSuccess(res, { user: toPublicUser(user) })
})

usersRouter.patch(
  "/me",
  requireAuth,
  validate({ body: updateMeSchema }),
  async (req, res) => {
    const { fullName } = req.body as z.infer<typeof updateMeSchema>

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { fullName },
    })

    return sendSuccess(res, { user: toPublicUser(user) })
  },
)
