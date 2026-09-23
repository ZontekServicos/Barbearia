import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"

/**
 * Invariantes do domínio de agenda verificadas em PostgreSQL de verdade
 * (embarcado), sem depender de credenciais.
 *
 * O foco é a EXCLUDE constraint: ela é o que impede reserva dupla mesmo com
 * requisições concorrentes. Aqui provamos o comportamento da constraint; o
 * teste de duas transações realmente paralelas vive na suíte de integração,
 * que precisa de múltiplas conexões.
 */
let db: PGlite
let userId: string
let serviceId: string

const at = (clock: string) => `2026-09-22T${clock}:00-03:00`

async function insertAppointment(
  start: string,
  end: string,
  status = "CONFIRMED",
): Promise<void> {
  await db.query(
    `INSERT INTO appointments
       (id, user_id, service_id, starts_at, ends_at, status, service_name, service_price_cents, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::"AppointmentStatus", 'Corte', 3500, now(), now())`,
    [userId, serviceId, at(start), at(end), status],
  )
}

before(async () => {
  db = new PGlite()
  await db.waitReady

  const dir = join(process.cwd(), "prisma", "migrations")
  const folders = readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()

  for (const folder of folders) {
    await db.exec(readFileSync(join(dir, folder, "migration.sql"), "utf8"))
  }
})

after(async () => {
  await db?.close()
})

beforeEach(async () => {
  await db.exec("DELETE FROM appointments; DELETE FROM services; DELETE FROM users;")

  const user = await db.query<{ id: string }>(
    `INSERT INTO users (id, phone, status, created_at, updated_at)
     VALUES (gen_random_uuid(), '+5571999991111', 'ACTIVE', now(), now()) RETURNING id`,
  )
  userId = user.rows[0]!.id

  const service = await db.query<{ id: string }>(
    `INSERT INTO services (id, name, price_cents, duration_minutes, created_at, updated_at)
     VALUES (gen_random_uuid(), 'Corte', 3500, 40, now(), now()) RETURNING id`,
  )
  serviceId = service.rows[0]!.id
})

describe("proteção contra reserva dupla", () => {
  it("recusa dois agendamentos confirmados no mesmo horário", async () => {
    await insertAppointment("09:00", "09:40")

    await assert.rejects(
      () => insertAppointment("09:00", "09:40"),
      /appointments_no_overlap|conflicting key value/,
    )
  })

  it("recusa sobreposição parcial", async () => {
    await insertAppointment("09:00", "09:40")

    await assert.rejects(() => insertAppointment("09:20", "10:00"), /appointments_no_overlap/)
    await assert.rejects(() => insertAppointment("08:40", "09:20"), /appointments_no_overlap/)
  })

  it("recusa agendamento contido em outro", async () => {
    await insertAppointment("09:00", "10:00")
    await assert.rejects(() => insertAppointment("09:15", "09:30"), /appointments_no_overlap/)
  })

  it("aceita horários que apenas se encostam — intervalo [início, fim)", async () => {
    await insertAppointment("09:00", "09:40")
    await insertAppointment("09:40", "10:20")

    const count = await db.query<{ total: string }>(`SELECT count(*)::text AS total FROM appointments`)
    assert.equal(count.rows[0]?.total, "2")
  })

  it("cancelar libera o horário para outra pessoa", async () => {
    await insertAppointment("09:00", "09:40")
    await db.query(`UPDATE appointments SET status = 'CANCELLED', cancelled_at = now()`)

    await insertAppointment("09:00", "09:40")

    const confirmed = await db.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM appointments WHERE status = 'CONFIRMED'`,
    )
    assert.equal(confirmed.rows[0]?.total, "1")
  })

  it("falta (NO_SHOW) também libera o horário", async () => {
    await insertAppointment("09:00", "09:40")
    await db.query(`UPDATE appointments SET status = 'NO_SHOW'`)
    await insertAppointment("09:00", "09:40")
  })

  it("concluído não bloqueia um novo agendamento no mesmo horário", async () => {
    await insertAppointment("09:00", "09:40", "COMPLETED")
    await insertAppointment("09:00", "09:40")
  })

  it("a constraint vale mesmo dentro de uma única transação", async () => {
    await assert.rejects(async () => {
      await db.transaction(async tx => {
        await tx.query(
          `INSERT INTO appointments (id, user_id, service_id, starts_at, ends_at, status, service_name, service_price_cents, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'CONFIRMED', 'Corte', 3500, now(), now())`,
          [userId, serviceId, at("14:00"), at("14:40")],
        )
        await tx.query(
          `INSERT INTO appointments (id, user_id, service_id, starts_at, ends_at, status, service_name, service_price_cents, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'CONFIRMED', 'Corte', 3500, now(), now())`,
          [userId, serviceId, at("14:20"), at("15:00")],
        )
      })
    }, /appointments_no_overlap/)

    const count = await db.query<{ total: string }>(`SELECT count(*)::text AS total FROM appointments`)
    assert.equal(count.rows[0]?.total, "0", "a transação deveria ter sido revertida inteira")
  })
})

describe("invariantes de dados", () => {
  it("recusa preço negativo", async () => {
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO services (id, name, price_cents, duration_minutes, created_at, updated_at)
           VALUES (gen_random_uuid(), 'Inválido', -1, 30, now(), now())`,
        ),
      /services_price_cents_non_negative/,
    )
  })

  it("recusa duração zero ou negativa", async () => {
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO services (id, name, price_cents, duration_minutes, created_at, updated_at)
           VALUES (gen_random_uuid(), 'Inválido', 1000, 0, now(), now())`,
        ),
      /services_duration_positive/,
    )
  })

  it("recusa agendamento que termina antes de começar", async () => {
    await assert.rejects(() => insertAppointment("10:00", "09:00"), /appointments_window/)
  })

  it("recusa bloqueio invertido", async () => {
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO schedule_blocks (id, starts_at, ends_at, reason, created_at)
           VALUES (gen_random_uuid(), $1, $2, 'Inválido', now())`,
          [at("12:00"), at("11:00")],
        ),
      /schedule_blocks_window/,
    )
  })

  it("recusa expediente com fechamento antes da abertura", async () => {
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO business_hours (id, weekday, open_minute, close_minute, updated_at)
           VALUES (gen_random_uuid(), 2, 1140, 540, now())`,
        ),
      /business_hours_window/,
    )
  })

  it("recusa intervalo fora do expediente", async () => {
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO business_hours (id, weekday, open_minute, close_minute, break_start_minute, break_end_minute, updated_at)
           VALUES (gen_random_uuid(), 3, 540, 1140, 480, 600, now())`,
        ),
      /business_hours_break/,
    )
  })

  it("recusa dia da semana fora de 0..6", async () => {
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO business_hours (id, weekday, open_minute, close_minute, updated_at)
           VALUES (gen_random_uuid(), 7, 540, 1140, now())`,
        ),
      /business_hours_weekday_range/,
    )
  })

  it("impede apagar serviço que já tem agendamento", async () => {
    await insertAppointment("09:00", "09:40")
    await assert.rejects(
      () => db.query(`DELETE FROM services WHERE id = $1`, [serviceId]),
      /foreign key|violates/i,
    )
  })
})
