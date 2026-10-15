import type { Prisma } from "../generated/prisma/client.js"

// Transaction-scoped database locks also coordinate independent API processes.
export async function lockKey(
  tx: Prisma.TransactionClient,
  key: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
}

/**
 * Lock COMPARTILHADO sobre a mesma chave.
 *
 * Vários detentores do modo compartilhado convivem; o modo exclusivo
 * (`lockKey`) espera por todos eles e, enquanto o segura, nenhum novo
 * compartilhado entra.
 *
 * É o que separa "ler as regras da agenda" de "reescrever as regras da agenda".
 * A criação de reserva toma o compartilhado — então reservas simultâneas não
 * esperam uma à outra, o que importa porque elas são o caminho quente — e a
 * alteração de expediente toma o exclusivo. Sem isso, uma reserva poderia
 * conferir a janela, o administrador fechá-la, e a reserva gravar depois, dentro
 * de uma janela que já não existe.
 */
export async function lockKeyShared(
  tx: Prisma.TransactionClient,
  key: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`
}

export async function lockUser(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`
}
