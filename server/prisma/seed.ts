import { existsSync } from 'node:fs'

if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

const { prisma, disconnectPrisma } = await import('../src/config/prisma.js')
const { isProduction } = await import('../src/config/env.js')
const { normalizePhone } = await import('../src/utils/phone.js')
const { hashPassword } = await import('../src/modules/auth/password.service.js')
const { generateTemporaryPassword } = await import('../src/utils/crypto.js')

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

/** Catálogo inicial. Preço em centavos — dinheiro nunca em ponto flutuante. */
const DEMO_SERVICES = [
  { name: 'Corte', description: 'Corte masculino clássico e moderno', priceCents: 3500, durationMinutes: 40, active: true },
  { name: 'Barba', description: 'Modelagem, aparar e acabamento', priceCents: 2500, durationMinutes: 30, active: true },
  { name: 'Corte + Barba', description: 'Combo completo com desconto', priceCents: 5500, durationMinutes: 60, active: true },
  { name: 'Hidratação Capilar', description: 'Tratamento com produtos premium', priceCents: 4000, durationMinutes: 30, active: true },
  { name: 'Sobrancelha', description: 'Design e acabamento', priceCents: 1500, durationMinutes: 15, active: false },
]

/** Expediente inicial: fecha domingo e segunda. Minutos a partir da meia-noite local. */
const DEMO_WEEK = [
  { weekday: 0, closed: true, openMinute: 9 * 60, closeMinute: 13 * 60 },
  { weekday: 1, closed: true, openMinute: 9 * 60, closeMinute: 19 * 60 },
  { weekday: 2, closed: false, openMinute: 9 * 60, closeMinute: 19 * 60 },
  { weekday: 3, closed: false, openMinute: 9 * 60, closeMinute: 19 * 60 },
  { weekday: 4, closed: false, openMinute: 9 * 60, closeMinute: 19 * 60 },
  { weekday: 5, closed: false, openMinute: 9 * 60, closeMinute: 20 * 60 },
  { weekday: 6, closed: false, openMinute: 8 * 60, closeMinute: 18 * 60 },
]

async function main() {
  if (isProduction) {
    console.error('Seed bloqueado: NODE_ENV=production.')
    process.exitCode = 1
    return
  }

  // Senha dos clientes de demonstração. Vem do ambiente ou é sorteada a cada
  // execução — nunca um valor fixo no código, mesmo sendo seed de dev. O seed
  // já recusa NODE_ENV=production algumas linhas acima.
  const demoPassword =
    process.env.SEED_DEMO_PASSWORD ?? generateTemporaryPassword()
  const passwordHash = await hashPassword(demoPassword)

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
        passwordHash,
        passwordUpdatedAt: new Date(),
      },
    })
  }

  // Serviços: idempotente pelo nome, sem sobrescrever preço já ajustado.
  for (const service of DEMO_SERVICES) {
    const existing = await prisma.service.findFirst({ where: { name: service.name } })
    if (!existing) await prisma.service.create({ data: service })
  }

  for (const day of DEMO_WEEK) {
    await prisma.businessHours.upsert({
      where: { weekday: day.weekday },
      update: {},
      create: day,
    })
  }

  const [users, services, hours] = await Promise.all([
    prisma.user.count(),
    prisma.service.count(),
    prisma.businessHours.count(),
  ])
  console.log(
    `Seed concluído. Usuários: ${users} · Serviços: ${services} · Dias configurados: ${hours}.`,
  )
  console.log("Credencial de demonstração não é exibida. Para login local, informe SEED_DEMO_PASSWORD antes do seed.")
}

try {
  await main()
} catch (error) {
  console.error('Falha no seed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await disconnectPrisma()
}
