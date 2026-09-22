import { Router } from 'express'
import { requireAuth } from '../../middlewares/auth.js'
import { requestOtpRateLimit, verifyOtpRateLimit } from '../../middlewares/rate-limit.js'
import { validate } from '../../middlewares/validate.js'
import { refreshSchema, requestOtpSchema, verifyOtpSchema } from './auth.schemas.js'
import {
  logoutController,
  meController,
  refreshController,
  requestOtpController,
  verifyOtpController,
} from './auth.controller.js'

export const authRouter = Router()

authRouter.post(
  '/request-otp',
  requestOtpRateLimit,
  validate({ body: requestOtpSchema }),
  requestOtpController,
)

authRouter.post(
  '/verify-otp',
  verifyOtpRateLimit,
  validate({ body: verifyOtpSchema }),
  verifyOtpController,
)

authRouter.post('/refresh', validate({ body: refreshSchema }), refreshController)

authRouter.post('/logout', validate({ body: refreshSchema }), logoutController)

authRouter.get('/me', requireAuth, meController)
