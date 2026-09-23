import { Router } from 'express'
import { requireAuth } from '../../middlewares/auth.js'
import { loginRateLimit, registerRateLimit } from '../../middlewares/rate-limit.js'
import { validate } from '../../middlewares/validate.js'
import { loginSchema, refreshSchema, registerSchema } from './auth.schemas.js'
import {
  loginController,
  logoutController,
  meController,
  refreshController,
  registerController,
} from './auth.controller.js'

export const authRouter = Router()

/*
 * Autenticação por telefone + senha. Não existe rota alternativa de login:
 * o fluxo por OTP foi removido junto com a tabela de desafios, e não há
 * caminho que dispense a senha.
 */

authRouter.post(
  '/register',
  registerRateLimit,
  validate({ body: registerSchema }),
  registerController,
)

authRouter.post(
  '/login',
  loginRateLimit,
  validate({ body: loginSchema }),
  loginController,
)

authRouter.post('/refresh', validate({ body: refreshSchema }), refreshController)

authRouter.post('/logout', validate({ body: refreshSchema }), logoutController)

authRouter.get('/me', requireAuth, meController)
