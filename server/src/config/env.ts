import { z } from "zod"

/**
 * Toda configuração sensível entra por variável de ambiente e é validada na
 * inicialização. Se algo estiver errado o processo morre aqui, e não no meio de
 * uma requisição de autenticação.
 */
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().max(65535).default(3333),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    REFRESH_COOKIE_PATH: z
      .string()
      .regex(/^\/(?:[a-zA-Z0-9_-]+\/)*auth$/)
      .default("/auth"),
    REFRESH_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),

    DATABASE_URL: z
      .url()
      .refine(
        (value) => /^postgres(ql)?:\/\//.test(value),
        "Use uma URL PostgreSQL.",
      ),

    FRONTEND_URL: z.string().min(1).default("http://localhost:8443"),

    JWT_ACCESS_SECRET: z
      .string()
      .min(32, "JWT_ACCESS_SECRET precisa de ao menos 32 caracteres"),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .max(60)
      .default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce
      .number()
      .int()
      .positive()
      .max(365)
      .default(30),

    OTP_TTL_MINUTES: z.coerce.number().int().positive().max(30).default(5),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(5),
    AUTH_OTP_DEV_MODE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),

    SMS_PROVIDER: z.enum(["console", "twilio"]).default("console"),
    SMS_API_KEY: z.string().optional(),
    SMS_API_SECRET: z.string().optional(),
    SMS_FROM_NUMBER: z.string().optional(),

    BOOTSTRAP_ADMIN_PHONE: z.string().optional(),
    BOOTSTRAP_ADMIN_NAME: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().trim().min(2).max(120).optional(),
    ),
    BOOTSTRAP_ADMIN_ALLOW_PROMOTION: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  })
  .superRefine((env, ctx) => {
    const origins = env.FRONTEND_URL.split(",").map((o) => o.trim())
    if (
      !origins.every((origin) => {
        try {
          const u = new URL(origin)
          return (
            ["http:", "https:"].includes(u.protocol) &&
            u.origin === origin &&
            (env.NODE_ENV !== "production" || u.protocol === "https:")
          )
        } catch {
          return false
        }
      })
    )
      ctx.addIssue({
        code: "custom",
        path: ["FRONTEND_URL"],
        message:
          "Informe origens exatas http/https; HTTPS obrigatório em produção.",
      })
    if (
      env.REFRESH_COOKIE_SAME_SITE === "none" &&
      env.NODE_ENV !== "production"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["REFRESH_COOKIE_SAME_SITE"],
        message: "SameSite=None exige HTTPS em produção.",
      })
    }
    if (env.NODE_ENV === "production")
      for (const key of ["JWT_ACCESS_SECRET"] as const) {
        if (
          new Set(env[key]).size < 12 ||
          /secret|example|change.?me|replace|development|teste?/i.test(env[key])
        ) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message:
              "Gere um segredo aleatório forte; placeholders são proibidos em produção.",
          })
        }
      }

    // Trava de segurança: o modo de OTP em desenvolvimento expõe o código no log.
    // Ele jamais pode subir junto com NODE_ENV=production.
    if (env.NODE_ENV === "production" && env.AUTH_OTP_DEV_MODE) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_OTP_DEV_MODE"],
        message: "AUTH_OTP_DEV_MODE não pode ser habilitado em produção",
      })
    }

    if (env.NODE_ENV === "production" && env.SMS_PROVIDER === "console") {
      ctx.addIssue({
        code: "custom",
        path: ["SMS_PROVIDER"],
        message:
          "Em produção configure um provider real de SMS (SMS_PROVIDER=twilio)",
      })
    }

    if (env.SMS_PROVIDER === "twilio" && !env.SMS_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["SMS_API_KEY"],
        message: "SMS_API_KEY é obrigatória quando SMS_PROVIDER=twilio",
      })
    }
  })

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    const details = parsed.error.issues
      .map(
        (issue) => `  - ${issue.path.join(".") || "(raiz)"}: ${issue.message}`,
      )
      .join("\n")
    throw new Error(`Configuração de ambiente inválida:\n${details}`)
  }

  return parsed.data
}

export const env: Env = loadEnv()

export const isProduction = env.NODE_ENV === "production"

/** Origens aceitas pelo CORS, derivadas de FRONTEND_URL (lista separada por vírgula). */
export const allowedOrigins: string[] = env.FRONTEND_URL.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
