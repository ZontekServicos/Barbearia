import { existsSync } from 'node:fs'
import { defineConfig, env } from 'prisma/config'

// O Prisma 7 não carrega .env automaticamente; fazemos isso aqui para que
// `prisma migrate`, `studio` e `seed` enxerguem DATABASE_URL em desenvolvimento.
if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

/**
 * Configuração usada pela CLI do Prisma (migrate, studio, seed).
 * O runtime da aplicação não passa por aqui — ele usa o driver adapter em
 * src/config/prisma.ts.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
