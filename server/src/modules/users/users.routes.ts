import { passwordChangeRateLimit } from "../../middlewares/rate-limit.js"
import { Router } from "express"
import { z } from "zod"
import { requireAuth } from "../../middlewares/auth.js"
import { validate } from "../../middlewares/validate.js"
import { prisma } from "../../config/prisma.js"
import { sendSuccess } from "../../utils/http.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { toPublicUser } from "./users.mapper.js"
import { fullNameSchema, newPasswordSchema, confirmationSchema } from "../auth/auth.schemas.js"
import { setUserPassword } from "../auth/auth.service.js"
import { verifyPassword } from "../auth/password.service.js"

export const usersRouter = Router()

/**
 * Só o nome é editável pelo próprio usuário.
 *
 * O telefone fica de fora deliberadamente: ele é o identificador de login e a
 * chave única da conta. Sem um canal que prove posse do novo número — que
 * deixou de existir junto com o SMS — permitir a troca abriria três buracos:
 * tomar o número de outra pessoa, colidir com um cadastro existente e perder
 * o acesso por digitar errado. Enquanto não houver verificação de titularidade,
 * a alteração é operação administrativa, feita pela barbearia com a pessoa
 * presente e registrada em auditoria.
 *
 * `strictObject` garante que enviar `phone`, `role` ou `status` aqui seja
 * rejeitado em vez de ignorado em silêncio — sem mass assignment.
 */
const updateMeSchema = z.strictObject({
  fullName: fullNameSchema,
})

/**
 * Troca de senha pelo próprio usuário. Exige a senha atual: uma sessão
 * sequestrada não deve conseguir trocar a credencial e expulsar o dono.
 */
const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1, "Informe sua senha atual.").max(512),
    password: newPasswordSchema,
    confirmPassword: confirmationSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não conferem.",
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

/**
 * Trocar a senha encerra todas as sessões, inclusive a que fez a troca: é o
 * comportamento esperado de quem desconfia que a conta foi acessada. O
 * frontend trata o 401 seguinte pedindo login de novo.
 */
usersRouter.patch(
  "/me/password",
  requireAuth,
  passwordChangeRateLimit,
  validate({ body: changePasswordSchema }),
  async (req, res) => {
    const { currentPassword, password } = req.body as z.infer<
      typeof changePasswordSchema
    >

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user)
      throw AppError.notFound(
        ErrorCodes.USER_NOT_FOUND,
        "Usuário não encontrado.",
      )

    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new AppError(
        ErrorCodes.INVALID_CREDENTIALS,
        "Senha atual incorreta.",
        401,
      )
    }

    await setUserPassword(user.id, password, user.passwordHash!)
    return sendSuccess(res, { passwordChanged: true })
  },
)
