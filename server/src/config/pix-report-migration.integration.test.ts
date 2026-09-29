import { it } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"

const database = process.env.TEST_DATABASE_URL
if (database) {
  const url = new URL(database)
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/erickcorttes_test") {
    throw new Error("Only isolated localhost erickcorttes_test allowed")
  }
}

it("Pix report migration preserves existing data and rolls back atomically on lock timeout", { skip: !database }, async () => {
  const { Client } = createRequire(import.meta.resolve("@prisma/adapter-pg"))("pg")
  const db = new Client({ connectionString: database })
  const reader = new Client({ connectionString: database })
  const schema = "pix_upgrade_" + randomUUID().replaceAll("-", "")
  await db.connect()
  await reader.connect()
  try {
    await db.query(`CREATE SCHEMA "${schema}"`)
    for (const c of [db, reader]) await c.query(`SET search_path TO "${schema}"`)
    const root = "prisma/migrations", target = "20260929120000_pix_payment_report"
    for (const folder of readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && d.name < target).map(d => d.name).sort()) {
      await db.query(readFileSync(`${root}/${folder}/migration.sql`, "utf8"))
    }
    const user = randomUUID(), service = randomUUID(), appointment = randomUUID(), payment = randomUUID()
    await db.query("INSERT INTO users(id,phone,updated_at) VALUES($1,'+5571999912312',now())", [user])
    await db.query("INSERT INTO services(id,name,price_cents,duration_minutes,updated_at) VALUES($1,'Legacy',1000,30,now())", [service])
    await db.query("INSERT INTO appointments(id,user_id,service_id,starts_at,ends_at,reserved_ends_at,status,pending_expires_at,service_name,service_price_cents,updated_at) VALUES($1,$2,$3,'2026-10-01T12:00Z','2026-10-01T12:30Z','2026-10-01T12:40Z','AWAITING_PAYMENT','2026-09-30T12:00Z','Original',1000,now())", [appointment, user, service])
    await db.query("INSERT INTO payments(id,appointment_id,provider,mode,amount_cents,expires_at,updated_at) VALUES($1,$2,'PIX_MANUAL','FULL',1000,'2026-09-30T12:00Z',now())", [payment, appointment])
    const beforePayment = (await db.query("SELECT * FROM payments")).rows[0]
    const beforeAppointment = (await db.query("SELECT * FROM appointments")).rows[0]
    const sql = readFileSync(`${root}/${target}/migration.sql`, "utf8")
    await reader.query("BEGIN")
    await reader.query("SELECT * FROM payments")
    await db.query("SET lock_timeout='250ms'")
    await assert.rejects(db.query(sql), { code: "55P03" })
    await db.query("ROLLBACK")
    assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='payments' AND column_name='payment_reported_at'", [schema])).rowCount, 0)
    await reader.query("ROLLBACK")
    await db.query("SET lock_timeout='5s'")
    await db.query(sql)
    const { payment_reported_at, review_expires_at, ...unchanged } = (await db.query("SELECT * FROM payments")).rows[0]
    assert.deepEqual(unchanged, beforePayment)
    assert.equal(payment_reported_at, null)
    assert.equal(review_expires_at, null)
    assert.deepEqual((await db.query("SELECT * FROM appointments")).rows[0], beforeAppointment)
    for (const [reported, deadline] of [
      ["2026-09-29T12:00Z", null],
      [null, "2026-09-30T12:00Z"],
      ["2026-09-29T12:00Z", "2026-09-29T12:00Z"],
      ["2026-09-29T12:00Z", "2026-09-29T11:59Z"],
    ]) await assert.rejects(db.query("UPDATE payments SET payment_reported_at=$1, review_expires_at=$2", [reported, deadline]), { code: "23514" })
    const indexes = await db.query("SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='payments_reported_review_idx'", [schema])
    assert.equal(indexes.rowCount, 1)
    assert.match(indexes.rows[0].indexdef, /WHERE \(payment_reported_at IS NOT NULL\)/)
    const exclude = (await db.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='appointments'::regclass AND conname='appointments_no_overlap'")).rows[0].def
    for (const status of ["PENDING", "AWAITING_PAYMENT", "CONFIRMED"]) assert.ok(exclude.includes(status))
  } finally {
    await reader.query("ROLLBACK")
    await db.query("ROLLBACK")
    await reader.end()
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await db.end()
  }
})
