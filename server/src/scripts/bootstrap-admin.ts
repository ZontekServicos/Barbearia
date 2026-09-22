import { existsSync } from "node:fs"
if (existsSync(".env")) process.loadEnvFile(".env")
const { env } = await import("../config/env.js")
const { disconnectPrisma } = await import("../config/prisma.js")
const { bootstrapAdmin } = await import("../modules/admin/bootstrap.service.js")
try {
  if (!env.BOOTSTRAP_ADMIN_PHONE)
    throw new Error("Defina BOOTSTRAP_ADMIN_PHONE explicitamente.")
  const result = await bootstrapAdmin(
    env.BOOTSTRAP_ADMIN_PHONE,
    env.BOOTSTRAP_ADMIN_NAME ?? null,
    env.BOOTSTRAP_ADMIN_ALLOW_PROMOTION,
  )
  console.log(
    result.changed
      ? "ADMIN configurado. Autenticação continua exigindo OTP."
      : "Nada a fazer: ADMIN já ativo.",
  )
} catch (error) {
  const { AppError } = await import("../utils/errors.js")
  console.error(
    error instanceof AppError
      ? error.message
      : "Falha no bootstrap. Verifique a configuração e o banco.",
  )
  process.exitCode = 1
} finally {
  await disconnectPrisma()
}
