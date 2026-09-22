import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * Aplica a migration inicial num Postgres embarcado (PGlite).
 *
 * Isso prova que o SQL versionado realmente roda — e não só que o Prisma
 * conseguiu gerá-lo — sem depender de um servidor Postgres na máquina.
 */
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')

let db: PGlite

before(async () => {
  db = new PGlite()
  await db.waitReady
})

after(async () => {
  await db?.close()
})

describe('migration inicial', () => {
  it('aplica todas as migrations sem erro', async () => {
    const folders = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()

    assert.ok(folders.length > 0, 'nenhuma migration encontrada')

    for (const folder of folders) {
      const sql = readFileSync(join(MIGRATIONS_DIR, folder, 'migration.sql'), 'utf8')
      await db.exec(sql)
    }
  })

  it('cria as tabelas esperadas', async () => {
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    )
    const tables = result.rows.map(row => row.table_name)

    assert.deepEqual(tables, ['admin_audit_logs', 'otp_challenges', 'refresh_tokens', 'users'])
  })

  it('garante telefone único — dois clientes não podem usar o mesmo número', async () => {
    await db.exec(
      `INSERT INTO users (id, phone, role, status, created_at, updated_at)
       VALUES (gen_random_uuid(), '+5571999991111', 'CUSTOMER', 'PENDING', now(), now())`,
    )

    await assert.rejects(
      () =>
        db.exec(
          `INSERT INTO users (id, phone, role, status, created_at, updated_at)
           VALUES (gen_random_uuid(), '+5571999991111', 'CUSTOMER', 'PENDING', now(), now())`,
        ),
      /duplicate key value violates unique constraint/,
      'o índice único de phone não está protegendo contra duplicidade',
    )
  })

  it('aplica os defaults de role e status', async () => {
    await db.exec(
      `INSERT INTO users (id, phone, created_at, updated_at)
       VALUES (gen_random_uuid(), '+5571999992222', now(), now())`,
    )

    const result = await db.query<{ role: string; status: string }>(
      `SELECT role::text, status::text FROM users WHERE phone = '+5571999992222'`,
    )

    assert.equal(result.rows[0]?.role, 'CUSTOMER')
    assert.equal(result.rows[0]?.status, 'PENDING')
  })

  it('rejeita status fora do enum', async () => {
    await assert.rejects(
      () =>
        db.exec(
          `INSERT INTO users (id, phone, status, created_at, updated_at)
           VALUES (gen_random_uuid(), '+5571999993333', 'SUPERUSER', now(), now())`,
        ),
      /invalid input value for enum/,
    )
  })

  it('apaga refresh tokens em cascata ao remover o usuário', async () => {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO users (id, phone, created_at, updated_at)
       VALUES (gen_random_uuid(), '+5571999994444', now(), now()) RETURNING id`,
    )
    const userId = inserted.rows[0]!.id

    await db.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
       VALUES (gen_random_uuid(), $1, 'hash-exemplo', now() + interval '30 days', now())`,
      [userId],
    )

    await db.query(`DELETE FROM users WHERE id = $1`, [userId])

    const remaining = await db.query(`SELECT 1 FROM refresh_tokens WHERE user_id = $1`, [userId])
    assert.equal(remaining.rows.length, 0)
  })
})
