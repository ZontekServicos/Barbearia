import express, { type Express } from "express"
import helmet from "helmet"
import cors from "cors"
import cookieParser from "cookie-parser"
import { allowedOrigins, env, isProduction } from "./config/env.js"
import { globalRateLimit } from "./middlewares/rate-limit.js"
import { errorHandler, notFoundHandler } from "./middlewares/error-handler.js"
import { authRouter } from "./modules/auth/auth.routes.js"
import { usersRouter } from "./modules/users/users.routes.js"
import { adminRouter } from "./modules/admin/admin.routes.js"
import { bookingRouter } from "./modules/booking/booking.routes.js"
import { AppError, ErrorCodes } from "./utils/errors.js"
import { sendSuccess } from "./utils/http.js"

export function createApp(): Express {
  const app = express()

  // Atrás do proxy do Railway/Render o IP real vem no X-Forwarded-For — sem
  // isso o rate limit contaria todo mundo como o mesmo cliente.
  app.set("trust proxy", env.TRUST_PROXY_HOPS)
  app.disable("x-powered-by")

  app.use(helmet())

  app.use(
    cors({
      origin(origin, callback) {
        // Sem Origin = chamada server-to-server ou ferramenta local.
        if (!origin) return callback(null, true)
        if (allowedOrigins.includes(origin)) return callback(null, true)
        return callback(
          AppError.forbidden(ErrorCodes.FORBIDDEN, "Origem não autorizada."),
        )
      },
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Protection"],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  )

  app.use(express.json({ limit: "100kb" }))
  app.use(cookieParser())
  app.use(globalRateLimit)

  app.get("/health", (_req, res) =>
    sendSuccess(res, {
      status: "ok",
      environment: isProduction ? "production" : "development",
    }),
  )

  app.use(["/auth", "/users", "/admin", "/booking"], (_req, res, next) => {
    res.set("Cache-Control", "no-store")
    next()
  })
  // Custom header + exact origin allow-list: cross-site forms cannot rotate/login/logout.
  app.use(
    "/auth",
    (req, _res, next) => {
      if (req.method === "POST" && req.get("X-CSRF-Protection") !== "1") {
        return next(
          AppError.forbidden(
            ErrorCodes.FORBIDDEN,
            "Cabeçalho de proteção CSRF obrigatório.",
          ),
        )
      }
      next()
    },
    authRouter,
  )
  app.use("/users", usersRouter)
  app.use("/admin", adminRouter)
  app.use("/booking", bookingRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
