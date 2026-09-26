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

    BOOTSTRAP_ADMIN_PHONE: z.string().optional(),
    BOOTSTRAP_ADMIN_NAME: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().trim().min(2).max(120).optional(),
    ),
    /** Senha do primeiro admin. Fornecida pelo operador, nunca versionada. */
    BOOTSTRAP_ADMIN_PASSWORD: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().max(512).transform((v) => v.normalize("NFKC"))
        .refine((v) => Array.from(v).length >= 15 && Array.from(v).length <= 128, "Use de 15 a 128 caracteres.").optional(),
    ),
    /** Intenção explícita de substituir a senha de um admin existente. */
    BOOTSTRAP_ADMIN_RESET_PASSWORD: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    BOOTSTRAP_ADMIN_ALLOW_PROMOTION: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),

    /**
     * Provedor de pagamento ativo. Ausente = pagamento desligado, e aprovar
     * uma solicitação confirma direto, como antes desta versão.
     *
     * "manual" é adaptador de teste e é RECUSADO em produção (ver superRefine):
     * confirmar dinheiro que não entrou não pode ser possível por descuido de
     * configuração.
     */
    PAYMENT_PROVIDER: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.enum(["manual"]).optional(),
    ),
    /** Segredo que autentica a notificação do provedor. Exigido com provedor. */
    PAYMENT_WEBHOOK_SECRET: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().min(32, "PAYMENT_WEBHOOK_SECRET precisa de ao menos 32 caracteres").optional(),
    ),

    /**
     * WhatsApp oficial da barbearia, em E.164 — o destino do botão de
     * confirmação. Uma configuração só, em vez do número repetido em
     * componentes. Ausente = botão não é oferecido.
     */
    /**
     * Pix ESTÁTICO da barbearia — o recebimento manual, sem provedor.
     *
     * Chave, nome e cidade do recebedor entram no BR Code. Prefira chave
     * ALEATÓRIA: telefone, CPF e e-mail ficam estampados no QR de todo mundo
     * que for pagar, e a chave aleatória não expõe dado pessoal nenhum.
     *
     * Ausente = Pix estático desligado.
     */
    BARBERSHOP_PIX_KEY: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().trim().min(4, "Chave Pix muito curta.").max(77, "Chave Pix muito longa.").optional(),
    ),
    BARBERSHOP_PIX_RECEIVER_NAME: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().trim().min(2).max(25, "O padrão do BR Code limita o nome a 25 caracteres.").optional(),
    ),
    BARBERSHOP_PIX_RECEIVER_CITY: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().trim().min(2).max(15, "O padrão do BR Code limita a cidade a 15 caracteres.").optional(),
    ),

    BARBERSHOP_WHATSAPP_NUMBER: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z
        .string()
        .trim()
        .regex(/^\+[1-9]\d{7,14}$/, "Use o formato internacional, ex.: +5571999999999")
        .optional(),
    ),
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

    // Adaptador de teste jamais em produção: ele confirma pagamento sem
    // provedor real, e um deploy configurado por engano confirmaria reservas
    // sem dinheiro nenhum ter entrado.
    if (env.NODE_ENV === "production" && env.PAYMENT_PROVIDER === "manual") {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER"],
        message:
          "O provedor 'manual' é de teste e não pode ser usado em produção. Configure um provedor real.",
      })
    }
    // Chave Pix sem nome/cidade do recebedor gera BR Code que o aplicativo do
    // banco recusa. Ou os três, ou nenhum.
    const pixParts = [
      env.BARBERSHOP_PIX_KEY,
      env.BARBERSHOP_PIX_RECEIVER_NAME,
      env.BARBERSHOP_PIX_RECEIVER_CITY,
    ]
    if (pixParts.some(Boolean) && !pixParts.every(Boolean)) {
      ctx.addIssue({
        code: "custom",
        path: ["BARBERSHOP_PIX_KEY"],
        message:
          "Pix estático exige BARBERSHOP_PIX_KEY, BARBERSHOP_PIX_RECEIVER_NAME e BARBERSHOP_PIX_RECEIVER_CITY juntos.",
      })
    }
    // Sem segredo não há como distinguir a notificação do provedor de um POST
    // qualquer na internet — e o webhook é o que confirma o pagamento.
    if (env.PAYMENT_PROVIDER && !env.PAYMENT_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_WEBHOOK_SECRET"],
        message: "Configurar PAYMENT_PROVIDER exige PAYMENT_WEBHOOK_SECRET.",
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

/**
 * Pagamento ligado?
 *
 * Derivado da configuração, não de uma flag solta: sem provedor não há como
 * receber dinheiro, então não faz sentido pedir pagamento. Nessa situação a
 * aprovação do barbeiro confirma a reserva direto — o comportamento anterior
 * a esta versão, preservado.
 */
/**
 * Como esta instalação recebe pagamento.
 *
 *   DYNAMIC_PROVIDER_PIX — provedor real: cobrança por cobrança, com QR próprio
 *                          e confirmação automática por webhook. Tem PRIORIDADE
 *                          sobre o Pix estático quando os dois estão configurados,
 *                          porque só ele confirma sozinho.
 *   STATIC_PIX           — Pix estático da barbearia: o cliente paga e ALGUÉM da
 *                          barbearia confere. Não existe confirmação automática.
 *   NONE                 — sem pagamento. Aprovar confirma direto, como antes.
 */
export type PaymentMethod = "DYNAMIC_PROVIDER_PIX" | "STATIC_PIX" | "NONE"

export const paymentMethod: PaymentMethod = env.PAYMENT_PROVIDER
  ? "DYNAMIC_PROVIDER_PIX"
  : env.BARBERSHOP_PIX_KEY
    ? "STATIC_PIX"
    : "NONE"

export const paymentsEnabled = paymentMethod !== "NONE"

/** Configuração do Pix estático, quando completa. */
export const staticPix =
  env.BARBERSHOP_PIX_KEY && env.BARBERSHOP_PIX_RECEIVER_NAME && env.BARBERSHOP_PIX_RECEIVER_CITY
    ? {
        key: env.BARBERSHOP_PIX_KEY,
        receiverName: env.BARBERSHOP_PIX_RECEIVER_NAME,
        receiverCity: env.BARBERSHOP_PIX_RECEIVER_CITY,
      }
    : null
