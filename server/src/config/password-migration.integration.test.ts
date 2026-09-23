import { it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
const database = process.env.TEST_DATABASE_URL
if (database) {
  const url = new URL(database)
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/erickcorttes_test")
    throw new Error("Only dedicated local erickcorttes_test is allowed")
}
it("password migration preserves populated accounts, IDs, ownership and audit history", { skip: !database }, async () => {
  const adapterRequire = createRequire(import.meta.resolve("@prisma/adapter-pg"))
  const { Client } = adapterRequire("pg")
  const db = new Client({ connectionString: database })
  const schema = "password_upgrade_" + randomUUID().replaceAll("-", "")
  const migration = (folder: string) => readFileSync(join(process.cwd(), "prisma/migrations", folder, "migration.sql"), "utf8")
  await db.connect()
  await db.query("BEGIN")
  try {
    await db.query(`CREATE SCHEMA "${schema}"`)
    await db.query(`SET LOCAL search_path TO "${schema}"`)
    for (const folder of ["20260921120000_init", "20260921220000_auth_integrity", "20260922100000_booking_domain"])
      await db.query(migration(folder))
    const admin = randomUUID(), customer = randomUUID(), service = randomUUID(), appointment = randomUUID(), refresh = randomUUID(), audit = randomUUID()
    await db.query(`INSERT INTO users (id, phone, full_name, role, status, phone_verified_at, updated_at) VALUES
      ($1, '+5571999911111', 'Admin legado', 'ADMIN', 'ACTIVE', '2026-01-01', NOW()),
      ($2, '+5571999922222', 'Cliente legado', 'CUSTOMER', 'ACTIVE', '2026-01-02', NOW())`, [admin, customer])
    await db.query(`INSERT INTO services (id, name, price_cents, duration_minutes, updated_at) VALUES ($1, 'Corte legado', 3500, 30, NOW())`, [service])
    await db.query(`INSERT INTO appointments (id, user_id, service_id, starts_at, ends_at, service_name, service_price_cents, updated_at)
      VALUES ($1, $2, $3, '2026-10-01 12:00:00Z', '2026-10-01 12:30:00Z', 'Corte legado', 3500, NOW())`, [appointment, customer, service])
    await db.query(`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, NOW() + interval '1 day')`, [refresh, customer, "a".repeat(64)])
    await db.query(`INSERT INTO admin_audit_logs (id, actor_id, target_user_id, action) VALUES ($1, $2, $3, 'USER_STATUS_CHANGED')`, [audit, admin, customer])
    await db.query(`INSERT INTO otp_challenges (id, phone, code_hash, expires_at) VALUES ($1, '+5571999922222', 'synthetic-old-hash', NOW() + interval '5 minutes')`, [randomUUID()])
    const before = (await db.query("SELECT id, phone, full_name, role, status, phone_verified_at FROM users ORDER BY phone")).rows
    await db.query(migration("20260922160000_password_auth"))
    assert.deepEqual((await db.query("SELECT id, phone, full_name, role, status, phone_verified_at FROM users ORDER BY phone")).rows, before)
    assert.ok((await db.query("SELECT password_hash, failed_login_attempts FROM users")).rows.every((r: any) => r.password_hash === null && r.failed_login_attempts === 0))
    assert.deepEqual((await db.query("SELECT id, user_id, service_id FROM appointments")).rows, [{ id: appointment, user_id: customer, service_id: service }])
    assert.deepEqual((await db.query("SELECT id, actor_id, target_user_id FROM admin_audit_logs")).rows, [{ id: audit, actor_id: admin, target_user_id: customer }])
    assert.ok((await db.query("SELECT revoked_at FROM refresh_tokens WHERE id=$1", [refresh])).rows[0].revoked_at)
    assert.equal((await db.query("SELECT to_regclass('otp_challenges') AS name")).rows[0].name, null)
    for (const [sql, params, expectedCode] of [
      ["INSERT INTO users (id, phone, updated_at) VALUES ($1, '+5571999922222', NOW())", [randomUUID()], "23505"],
      ["UPDATE users SET password_hash='plaintext' WHERE id=$1", [customer], "23514"],
      ["UPDATE users SET failed_login_attempts=-1 WHERE id=$1", [customer], "23514"],
    ] as const) {
      await db.query("SAVEPOINT constraint_check")
      await assert.rejects(db.query(sql, params), { code: expectedCode })
      await db.query("ROLLBACK TO SAVEPOINT constraint_check")
    }
  } finally {
    await db.query("ROLLBACK")
    await db.end()
  }
})
