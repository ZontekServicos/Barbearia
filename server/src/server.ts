import { existsSync } from 'node:fs'

// Carrega .env antes de qualquer import que leia process.env.
if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

const { createApp } = await import('./app.js')
const { env, isProduction } = await import('./config/env.js')
const { logger } = await import('./utils/logger.js')
const { disconnectPrisma } = await import('./config/prisma.js')

const app = createApp()

const server = app.listen(env.PORT, () => {
  logger.info('Servidor iniciado', {
    port: env.PORT,
    environment: env.NODE_ENV,
    otpDevMode: env.AUTH_OTP_DEV_MODE,
    smsProvider: env.SMS_PROVIDER,
  })

  if (!isProduction && env.AUTH_OTP_DEV_MODE) {
    logger.warn('AUTH_OTP_DEV_MODE ativo — códigos OTP aparecem no log. Nunca use assim em produção.')
  }
})

async function shutdown(signal: string) {
  logger.info('Encerrando servidor', { signal })
  server.close(async () => {
    await disconnectPrisma()
    process.exit(0)
  })
  // Rede de segurança caso alguma conexão não feche.
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
