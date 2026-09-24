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
const migration = (folder: string) => readFileSync(join(process.cwd(), "prisma/migrations", folder, "migration.sql"), "utf8")

async function withLegacySchema(check: (db: any) => Promise<void>) {
  const adapterRequire = createRequire(import.meta.resolve("@prisma/adapter-pg"))
  const { Client } = adapterRequire("pg")
  const db = new Client({ connectionString: database })
  const schema = "buffer_upgrade_" + randomUUID().replaceAll("-", "")
  await db.connect()
  try {
    await db.query(`CREATE SCHEMA "${schema}"`)
    await db.query(`SET search_path TO "${schema}"`)
    for (const folder of ["20260921120000_init", "20260921220000_auth_integrity", "20260922100000_booking_domain", "20260922160000_password_auth"])
      await db.query(migration(folder))
    const user = randomUUID(), service = randomUUID()
    await db.query("INSERT INTO users (id, phone, updated_at) VALUES ($1, '+5571999912345', now())", [user])
    await db.query("INSERT INTO services (id, name, description, price_cents, duration_minutes, updated_at) VALUES ($1, 'Corte legado', 'Preservar', 3500, 30, now())", [service])
    await db.query(`INSERT INTO appointments (id, user_id, service_id, starts_at, ends_at, service_name, service_price_cents, updated_at)
      VALUES ($1, $2, $3, '2026-10-01T12:00:00Z', '2026-10-01T12:30:00Z', 'Corte historico', 3000, now())`, [randomUUID(), user, service])
    await check(db)
  } finally {
    // The disabling migration owns a transaction; rollback also recovers its failure.
    await db.query("ROLLBACK")
    await db.query("SET search_path TO public")
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await db.end()
  }
}

it("buffer migrations preserve populated services and appointment snapshots, enforce zero for every writer", { skip: !database }, async () => {
  await withLegacySchema(async db => {
    const beforeServices = (await db.query("SELECT * FROM services")).rows
    const beforeAppointments = (await db.query("SELECT * FROM appointments")).rows
    await db.query(migration("20260924100000_service_buffers"))
    await db.query(migration("20260924110000_disable_service_buffers"))
    for (const [table, expected] of [["services", beforeServices], ["appointments", beforeAppointments]] as const) {
      const rows = (await db.query(`SELECT * FROM ${table}`)).rows
      assert.deepEqual(rows.map(({ buffer_before_minutes, buffer_after_minutes, ...rest }: any) => {
        assert.equal(buffer_before_minutes, 0)
        assert.equal(buffer_after_minutes, 0)
        return rest
      }), expected)
      for (const column of ["buffer_before_minutes", "buffer_after_minutes"]) {
        for (const value of [1, 10, 120, -1]) {
          await assert.rejects(db.query(`UPDATE ${table} SET ${column} = $1`, [value]), { code: "23514" })
        }
      }
    }
    // The existing half-open exclusion remains effective after both migrations.
    const old = beforeAppointments[0]
    const insert = (start: string, end: string) => db.query(`INSERT INTO appointments
      (id, user_id, service_id, starts_at, ends_at, service_name, service_price_cents, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'Corte', 3500, now())`, [randomUUID(), old.user_id, old.service_id, start, end])
    await insert("2026-10-01T12:30:00Z", "2026-10-01T13:00:00Z")
    await assert.rejects(insert("2026-10-01T12:15:00Z", "2026-10-01T12:45:00Z"), { code: "23P01", constraint: "appointments_no_overlap" })
  })
})

it("disabling migration fails atomically instead of erasing an existing nonzero appointment buffer", { skip: !database }, async () => {
  await withLegacySchema(async db => {
    await db.query(migration("20260924100000_service_buffers"))
    await db.query("UPDATE appointments SET buffer_after_minutes = 10")
    await assert.rejects(db.query(migration("20260924110000_disable_service_buffers")), { code: "23514", constraint: "appointments_buffers_disabled" })
    await db.query("ROLLBACK")
    const constraints = await db.query(`SELECT conname FROM pg_constraint WHERE conrelid IN ('services'::regclass, 'appointments'::regclass) AND conname IN ('services_buffers_disabled', 'appointments_buffers_disabled')`)
    assert.equal(constraints.rows.length, 0, "first ALTER must rollback when second ALTER fails")
    assert.equal((await db.query("SELECT buffer_after_minutes FROM appointments")).rows[0].buffer_after_minutes, 10)
  })
})
