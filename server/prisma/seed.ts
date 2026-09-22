import { existsSync } from 'node:fs'

if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

const { prisma, disconnectPrisma } = await import('../src/config/prisma.js')
const { isProduction } = await import('../src/config/env.js')
const { normalizePhone } = await import('../src/utils/phone.js')

/**
 * Seed de desenvolvimento: popula alguns clientes para que a tela de
 * administração tenha o que listar. Idempotente e bloqueado em produção.
 */
const DEMO_USERS = [
  { fullName: 'João Silva', phone: '(71) 99999-1111', status: 'ACTIVE' as const },
  { fullName: 'Lucas Santos', phone: '(71) 99999-2222', status: 'ACTIVE' as const },
  { fullName: 'Pedro Lima', phone: '(71) 99999-3333', status: 'PENDING' as const },
  { fullName: 'Rafael Costa', phone: '(71) 99999-4444', status: 'PENDING' as const },
  { fullName: 'Diego Rocha', phone: '(71) 99999-7777', status: 'BLOCKED' as const },
]

async function main() {
  if (isProduction) {
    console.error('Seed bloqueado: NODE_ENV=production.')
    process.exitCode = 1
    return
  }

  for (const demo of DEMO_USERS) {
    const phone = normalizePhone(demo.phone)
    await prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        phone,
        fullName: demo.fullName,
        role: 'CUSTOMER',
        status: demo.status,
        phoneVerifiedAt: demo.status === 'PENDING' ? new Date() : new Date(),
      },
    })
  }

  const total = await prisma.user.count()
  console.log(`Seed concluído. Usuários no banco: ${total}.`)
}

try {
  await main()
} catch (error) {
  console.error('Falha no seed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await disconnectPrisma()
}
