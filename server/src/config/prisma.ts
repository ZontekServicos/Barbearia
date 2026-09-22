import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma/client.js"
import { env } from "./env.js"

/**
 * Cliente único do Prisma. No Prisma 7 a conexão vem de um driver adapter,
 * então a DATABASE_URL entra aqui e não no schema.
 */
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  max: 10,
})

export const prisma = new PrismaClient({
  adapter,
  // Error responses/logging are sanitized centrally, without raw SQL or credentials.
  log: [],
})

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect()
}
