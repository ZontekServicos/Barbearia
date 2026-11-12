import type { Prisma } from "../generated/prisma/client.js"

/**
 * ORDEM CANÔNICA DE AQUISIÇÃO — respeite ao escrever caminho novo.
 *
 *   1. admin-status
 *   2. auth:<telefone>
 *   3. booking-day:<data>
 *   4. schedule-rules          (compartilhado na reserva, exclusivo na escrita)
 *   5. lockUser / SELECT … FOR UPDATE   (sempre com os ids em ordem crescente)
 *
 * Hoje não existe inversão: os caminhos que disputam com a criação de reserva
 * tomam UM lock só — escrita de expediente pega apenas `schedule-rules`,
 * bloqueio pega apenas `booking-day` — então não há ciclo possível. E
 * `admin.service` ordena os ids antes de travar duas linhas, que é o que
 * impede dois administradores de se bloquearem mutuamente.
 *
 * Esta nota existe porque essa propriedade é fácil de perder sem perceber:
 * basta um caminho futuro pegar `schedule-rules` e depois `booking-day` para
 * criar o ciclo que hoje não existe, e o sintoma seria deadlock intermitente
 * só sob carga — o tipo de defeito que não aparece em teste.
 */

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
