import { existsSync } from "node:fs"
if (existsSync(".env")) process.loadEnvFile(".env")
const { env } = await import("../config/env.js")
const { disconnectPrisma } = await import("../config/prisma.js")
const { bootstrapAdmin } = await import("../modules/admin/bootstrap.service.js")

const MESSAGES = {
  unchanged: "Nada a fazer: ADMIN já ativo e com senha definida.",
  created: "ADMIN criado. Entre com o telefone e a senha que você definiu.",
  promoted: "Conta promovida a ADMIN. Sessões anteriores foram encerradas.",
  "credential-established":
    "Senha do ADMIN definida. Sessões anteriores foram encerradas.",
} as const

try {
  if (!env.BOOTSTRAP_ADMIN_PHONE)
    throw new Error("Defina BOOTSTRAP_ADMIN_PHONE explicitamente.")

  const result = await bootstrapAdmin(
    env.BOOTSTRAP_ADMIN_PHONE,
    env.BOOTSTRAP_ADMIN_NAME ?? null,
    env.BOOTSTRAP_ADMIN_PASSWORD ?? null,
    env.BOOTSTRAP_ADMIN_ALLOW_PROMOTION,
    env.BOOTSTRAP_ADMIN_RESET_PASSWORD,
  )

  // A senha nunca é impressa: quem executou o script já a conhece.
  console.log(MESSAGES[result.outcome])
  console.log("Remova BOOTSTRAP_ADMIN_PASSWORD do ambiente agora.")
} catch (error) {
  const { AppError } = await import("../utils/errors.js")
  console.error(
    error instanceof AppError || error instanceof Error
      ? error.message
      : "Falha no bootstrap. Verifique a configuração e o banco.",
  )
  process.exitCode = 1
} finally {
  await disconnectPrisma()
}
