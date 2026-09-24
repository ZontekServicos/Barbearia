import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import type { Server } from "node:http"
import { addDaysToShopDate, instantToShopDate, shopWallClockToInstant } from "../utils/time.js"
import { BookingRules } from "../modules/booking/booking.rules.js"

// Mesmo contrato de opt-in da suíte de autenticação: sem TEST_DATABASE_URL,
// a suíte é pulada; com ela, só aceita o banco de teste local dedicado.
const database = process.env.TEST_DATABASE_URL
const enabled = Boolean(database)
if (database) {
  const url = new URL(database)
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/erickcorttes_test"
  ) {
    throw new Error(
      "TEST_DATABASE_URL must point to local erickcorttes_test; refusing cleanup.",
    )
  }
}
Object.assign(process.env, {
  DATABASE_URL: database ?? "postgresql://unused@127.0.0.1:1/erickcorttes_test",
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
  JWT_REFRESH_SECRET: randomBytes(48).toString("hex"),
  FRONTEND_URL: "http://localhost:8443",
  TRUST_PROXY_HOPS: "0",
})

let prisma: typeof import("../config/prisma.js").prisma
let tokens: typeof import("../modules/auth/token.service.js")
let appointments: typeof import("../modules/booking/appointments.service.js")
let availability: typeof import("../modules/booking/availability.service.js")
let schedule: typeof import("../modules/booking/schedule.service.js")
let limits: typeof import("../middlewares/rate-limit.js")
let server: Server
let base: string

let phoneCounter = 0
const phone = () => "+55719" + String(20000000 + phoneCounter++)

/** Próxima terça-feira: dia sempre aberto no expediente padrão. */
function nextTuesday(): string {
  const now = new Date()
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  do {
    date.setUTCDate(date.getUTCDate() + 1)
  } while (date.getUTCDay() !== 2)
  return date.toISOString().slice(0, 10)
}

async function call(
  path: string,
  opts: { method?: string; body?: unknown; access?: string } = {},
) {
  const response = await fetch(base + path, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:8443",
      ...(opts.access ? { Authorization: "Bearer " + opts.access } : {}),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  })
  return { status: response.status, body: await response.json() }
}

async function login(role: "ADMIN" | "CUSTOMER" = "CUSTOMER", status: "ACTIVE" | "PENDING" = "ACTIVE") {
  const user = await prisma.user.create({
    data: { phone: phone(), fullName: "Pessoa QA", role, status },
  })
  const session = await tokens.issueSession(user.id)
  return { user, access: session.accessToken }
}

async function makeService(overrides: Partial<{ name: string; priceCents: number; durationMinutes: number; active: boolean }> = {}) {
  return prisma.service.create({
    data: {
      name: overrides.name ?? "Corte",
      description: "Corte masculino",
      priceCents: overrides.priceCents ?? 3500,
      durationMinutes: overrides.durationMinutes ?? 40,
      active: overrides.active ?? true,
    },
  })
}

async function cleanup() {
  await prisma.adminAuditLog.deleteMany()
  await prisma.appointment.deleteMany()
  await prisma.scheduleBlock.deleteMany()
  await prisma.service.deleteMany()
  await prisma.businessHours.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.user.deleteMany()
}

describe("Agenda — Express + Prisma + PostgreSQL real", { skip: !enabled }, () => {
  before(async () => {
    ;({ prisma } = await import("../config/prisma.js"))
    tokens = await import("../modules/auth/token.service.js")
    appointments = await import("../modules/booking/appointments.service.js")
    availability = await import("../modules/booking/availability.service.js")
    schedule = await import("../modules/booking/schedule.service.js")

    limits = await import("../middlewares/rate-limit.js")

    const { createApp } = await import("../app.js")
    server = createApp().listen(0, "127.0.0.1")
    await new Promise<void>(resolve => server.once("listening", resolve))
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    base = "http://127.0.0.1:" + address.port
  })

  after(async () => {
    await cleanup()
    server?.close()
    await prisma?.$disconnect()
  })

  beforeEach(async () => {
    await cleanup()
    limits.globalRateLimit.resetKey("127.0.0.1")
  })

  // -------------------------------------------------------------------------
  // Serviços
  // -------------------------------------------------------------------------

  it("admin cria serviço e ele aparece no catálogo do cliente", async () => {
    const admin = await login("ADMIN")

    const created = await call("/admin/services", {
      body: { name: "Barba", description: "Modelagem", priceCents: 2500, durationMinutes: 30 },
      access: admin.access,
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.service.priceCents, 2500)
    assert.equal(created.body.data.service.priceFormatted, "25,00")

    const catalog = await call("/booking/services")
    assert.equal(catalog.body.data.services.length, 1)
    assert.equal(catalog.body.data.services[0].name, "Barba")
  })

  it("serviço inativo não aparece para o cliente nem pode ser agendado", async () => {
    const service = await makeService({ active: false })
    const customer = await login()

    const catalog = await call("/booking/services")
    assert.equal(catalog.body.data.services.length, 0)

    const attempt = await call("/booking/appointments", {
      body: { serviceId: service.id, date: nextTuesday(), startsAt: "10:00" },
      access: customer.access,
    })
    assert.equal(attempt.status, 404)
    assert.equal(attempt.body.error.code, "NOT_FOUND")
  })

  it("recusa preço negativo e duração zero", async () => {
    const admin = await login("ADMIN")

    const negative = await call("/admin/services", {
      body: { name: "X", priceCents: -100, durationMinutes: 30 },
      access: admin.access,
    })
    assert.equal(negative.status, 400)

    const zero = await call("/admin/services", {
      body: { name: "X", priceCents: 1000, durationMinutes: 0 },
      access: admin.access,
    })
    assert.equal(zero.status, 400)
  })

  // -------------------------------------------------------------------------
  // Disponibilidade
  // -------------------------------------------------------------------------

  it("disponibilidade respeita a duração do serviço", async () => {
    const short = await makeService({ name: "Curto", durationMinutes: 30 })
    const long = await makeService({ name: "Longo", durationMinutes: 120 })
    const date = nextTuesday()

    const shortResult = await availability.getAvailability(date, short.id)
    const longResult = await availability.getAvailability(date, long.id)

    assert.ok(shortResult.slots.length > longResult.slots.length)
    // Último slot precisa caber antes do fechamento (19:00 na terça padrão).
    assert.equal(longResult.slots.at(-1)?.endsAtClock, "19:00")
  })

  it("dia fechado não oferece horários", async () => {
    const service = await makeService()
    // Segunda-feira é fechada no expediente padrão.
    const date = new Date(nextTuesday() + "T12:00:00Z")
    date.setUTCDate(date.getUTCDate() - 1)
    const monday = date.toISOString().slice(0, 10)

    const result = await availability.getAvailability(monday, service.id)
    assert.equal(result.open, false)
    assert.equal(result.reason, "CLOSED")
    assert.equal(result.slots.length, 0)
  })

  it("bloqueio administrativo remove os horários afetados", async () => {
    const service = await makeService({ durationMinutes: 30 })
    const date = nextTuesday()

    const before = await availability.getAvailability(date, service.id)
    assert.ok(before.slots.some(slot => slot.startsAtClock === "10:00"))

    await schedule.createBlock({ date, startsAt: "10:00", endsAt: "11:00", reason: "Almoço" })

    const after = await availability.getAvailability(date, service.id)
    assert.equal(after.slots.some(slot => slot.startsAtClock === "09:45"), false)
    assert.equal(after.slots.some(slot => slot.startsAtClock === "10:45"), false)
    assert.ok(after.slots.some(slot => slot.startsAtClock === "09:30"))
    assert.equal(after.slots.some(slot => slot.startsAtClock === "10:00"), false)
    assert.equal(after.slots.some(slot => slot.startsAtClock === "10:30"), false)
    assert.ok(after.slots.some(slot => slot.startsAtClock === "11:00"))
  })

  it("horário já reservado some da disponibilidade", async () => {
    const service = await makeService({ durationMinutes: 40 })
    const customer = await login()
    const date = nextTuesday()

    await appointments.createAppointment({
      userId: customer.user.id,
      serviceId: service.id,
      date,
      startsAt: "14:00",
    })

    const result = await availability.getAvailability(date, service.id)
    assert.equal(result.slots.some(slot => slot.startsAtClock === "14:00"), false)
    assert.equal(result.slots.some(slot => slot.startsAtClock === "14:15"), false)
    assert.ok(result.slots.some(slot => slot.startsAtClock === "14:45"))
  })

  // -------------------------------------------------------------------------
  // Agendamento
  // -------------------------------------------------------------------------

  it("cliente agenda e o servidor calcula fim e preço", async () => {
    const service = await makeService({ durationMinutes: 40, priceCents: 3500 })
    const customer = await login()

    const created = await call("/booking/appointments", {
      body: { serviceId: service.id, date: nextTuesday(), startsAt: "14:00" },
      access: customer.access,
    })

    assert.equal(created.status, 201)
    const appointment = created.body.data.appointment
    assert.equal(appointment.startsAtClock, "14:00")
    assert.equal(appointment.endsAtClock, "14:40")
    assert.equal(appointment.servicePriceCents, 3500)
    assert.equal(appointment.status, "CONFIRMED")
  })

  it("recusa agendamento fora do expediente", async () => {
    const service = await makeService()
    const customer = await login()

    const result = await call("/booking/appointments", {
      body: { serviceId: service.id, date: nextTuesday(), startsAt: "22:00" },
      access: customer.access,
    })

    assert.equal(result.status, 400)
    assert.equal(result.body.error.code, "CONFLICT")
  })

  it("recusa agendamento em horário bloqueado", async () => {
    const service = await makeService({ durationMinutes: 30 })
    const customer = await login()
    const date = nextTuesday()

    await schedule.createBlock({ date, startsAt: "15:00", endsAt: "16:00", reason: "Folga" })

    const result = await call("/booking/appointments", {
      body: { serviceId: service.id, date, startsAt: "15:00" },
      access: customer.access,
    })

    assert.equal(result.status, 409)
  })

  it("recusa conflito com agendamento existente", async () => {
    const service = await makeService({ durationMinutes: 40 })
    const first = await login()
    const second = await login()
    const date = nextTuesday()

    await appointments.createAppointment({
      userId: first.user.id,
      serviceId: service.id,
      date,
      startsAt: "16:00",
    })

    const result = await call("/booking/appointments", {
      body: { serviceId: service.id, date, startsAt: "16:15" },
      access: second.access,
    })

    assert.equal(result.status, 409)
    assert.equal(result.body.error.code, "CONFLICT")
  })

  it("recusa agendamento sem a antecedência mínima", async () => {
    const service = await makeService()
    const customer = await login()
    const now = new Date()

    await assert.rejects(
      () =>
        appointments.createAppointment(
          {
            userId: customer.user.id,
            serviceId: service.id,
            date: now.toISOString().slice(0, 10),
            startsAt: "09:00",
          },
          new Date(now.getTime() + 24 * 60 * 60 * 1000),
        ),
      /antecedência|fechada|expediente/i,
    )
  })

  for (const contenders of [2, 10]) {
    it(contenders + " reservas HTTP simultâneas: uma vence, demais recebem conflito tratável", async () => {
      const service = await makeService({ durationMinutes: 40 })
      const date = nextTuesday()
      const users = await Promise.all(Array.from({ length: contenders }, () => login()))
      // Erros de transporte, 500 e rejeições não podem ser mascarados.
      const results = await Promise.all(users.map(user => call("/booking/appointments", {
        body: { serviceId: service.id, date, startsAt: "17:00" },
        access: user.access,
      })))
      assert.equal(results.filter(result => result.status === 201).length, 1)
      const conflicts = results.filter(result => result.status === 409)
      assert.equal(conflicts.length, contenders - 1, JSON.stringify(results))
      for (const conflict of conflicts) {
        assert.equal(conflict.body.error.code, "CONFLICT")
        assert.match(conflict.body.error.message, /horário|reservado/i)
      }
      assert.equal(await prisma.appointment.count({ where: { status: "CONFIRMED" } }), 1)
    })
  }

  // -------------------------------------------------------------------------
  // Propriedade e cancelamento
  // -------------------------------------------------------------------------

  it("cliente só enxerga os próprios agendamentos", async () => {
    const service = await makeService()
    const owner = await login()
    const other = await login()
    const date = nextTuesday()

    const created = await appointments.createAppointment({
      userId: owner.user.id,
      serviceId: service.id,
      date,
      startsAt: "09:00",
    })

    const asOwner = await call(`/booking/appointments/${created.id}`, { access: owner.access })
    assert.equal(asOwner.status, 200)

    const asOther = await call(`/booking/appointments/${created.id}`, { access: other.access })
    assert.equal(asOther.status, 404, "não pode confirmar nem a existência do agendamento alheio")

    const list = await call("/booking/appointments/me", { access: other.access })
    assert.equal(list.body.data.appointments.length, 0)
  })

  it("cliente cancela o próprio agendamento e libera o horário", async () => {
    const service = await makeService({ durationMinutes: 40 })
    const customer = await login()
    const date = nextTuesday()

    const created = await appointments.createAppointment({
      userId: customer.user.id,
      serviceId: service.id,
      date,
      startsAt: "13:00",
    })

    const occupied = await call(`/booking/availability?date=${date}&serviceId=${service.id}`)
    assert.equal(occupied.body.data.slots.some((slot: { startsAtClock: string }) => slot.startsAtClock === "13:00"), false)

    const cancelled = await call(`/booking/appointments/${created.id}/cancel`, {
      method: "POST",
      access: customer.access,
    })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.body.data.appointment.status, "CANCELLED")

    const released = await call(`/booking/availability?date=${date}&serviceId=${service.id}`)
    assert.ok(released.body.data.slots.some((slot: { startsAtClock: string }) => slot.startsAtClock === "13:00"))

    // Horário volta a ficar livre.
    const other = await login()
    const rebook = await call("/booking/appointments", {
      body: { serviceId: service.id, date, startsAt: "13:00" },
      access: other.access,
    })
    assert.equal(rebook.status, 201)
  })

  it("cliente não cancela agendamento de outra pessoa", async () => {
    const service = await makeService()
    const owner = await login()
    const attacker = await login()

    const created = await appointments.createAppointment({
      userId: owner.user.id,
      serviceId: service.id,
      date: nextTuesday(),
      startsAt: "09:00",
    })

    const result = await call(`/booking/appointments/${created.id}/cancel`, {
      method: "POST",
      access: attacker.access,
    })
    assert.equal(result.status, 404)

    const stored = await prisma.appointment.findUnique({ where: { id: created.id } })
    assert.equal(stored?.status, "CONFIRMED")
  })

  // -------------------------------------------------------------------------
  // Autorização
  // -------------------------------------------------------------------------

  it("CUSTOMER não acessa endpoints ADMIN da agenda", async () => {
    const customer = await login()
    const date = nextTuesday()

    for (const path of [
      `/admin/agenda?from=${date}`,
      "/admin/services?includeInactive=true",
      `/admin/blocks?from=${date}&to=${date}`,
    ]) {
      const result = await call(path, { access: customer.access })
      assert.equal(result.status, 403, `esperava 403 em ${path}`)
    }

    const created = await call("/admin/services", {
      body: { name: "Hack", priceCents: 100, durationMinutes: 10 },
      access: customer.access,
    })
    assert.equal(created.status, 403)
    assert.equal(await prisma.service.count(), 0)
  })


  it("preflight permite PUT do expediente apenas para a origem autorizada", async () => {
    const request = (origin: string) => fetch(base + "/admin/business-hours", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "Authorization,Content-Type,X-CSRF-Protection",
      },
    })
    const allowed = await request("http://localhost:8443")
    assert.equal(allowed.status, 204)
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:8443")
    assert.ok(allowed.headers.get("access-control-allow-methods")?.split(",").includes("PUT"))
    const denied = await request("https://evil.example")
    assert.equal(denied.status, 403)
    assert.equal(denied.headers.get("access-control-allow-origin"), null)
  })

  it("conta PENDING consulta disponibilidade pública mas não agenda", async () => {
    const service = await makeService()
    const pending = await login("CUSTOMER", "PENDING")
    const date = nextTuesday()

    const slots = await call(`/booking/availability?date=${date}&serviceId=${service.id}`, {
      access: pending.access,
    })
    assert.equal(slots.status, 200)
    assert.doesNotMatch(JSON.stringify(slots.body), /userId|phone|fullName|passwordHash/)

    const booking = await call("/booking/appointments", {
      body: { serviceId: service.id, date, startsAt: "10:00" },
      access: pending.access,
    })
    assert.equal(booking.status, 403)
    assert.equal(booking.body.error.code, "ACCOUNT_PENDING")
  })

  it("sem sessão não agenda", async () => {
    const service = await makeService()
    const result = await call("/booking/appointments", {
      body: { serviceId: service.id, date: nextTuesday(), startsAt: "10:00" },
    })
    assert.equal(result.status, 401)
  })

  it("ignora userId enviado no corpo — o dono é sempre a sessão", async () => {
    const service = await makeService()
    const customer = await login()
    const victim = await login()

    const created = await call("/booking/appointments", {
      body: {
        serviceId: service.id,
        date: nextTuesday(),
        startsAt: "10:00",
        userId: victim.user.id,
      },
      access: customer.access,
    })

    assert.equal(created.status, 201)
    const stored = await prisma.appointment.findFirst()
    assert.equal(stored?.userId, customer.user.id)
  })

  // -------------------------------------------------------------------------
  // Agenda administrativa
  // -------------------------------------------------------------------------

  it("admin lista a agenda do dia com os dados do cliente", async () => {
    const service = await makeService()
    const customer = await login()
    const admin = await login("ADMIN")
    const date = nextTuesday()

    await appointments.createAppointment({
      userId: customer.user.id,
      serviceId: service.id,
      date,
      startsAt: "09:00",
    })

    const agenda = await call(`/admin/agenda?from=${date}`, { access: admin.access })
    assert.equal(agenda.status, 200)
    assert.equal(agenda.body.data.appointments.length, 1)
    assert.equal(agenda.body.data.appointments[0].customer.id, customer.user.id)
    assert.ok(agenda.body.data.appointments[0].customer.phoneFormatted.startsWith("("))
  })

  it("admin conclui, cancela e marca falta — e registra auditoria", async () => {
    const service = await makeService({ durationMinutes: 30 })
    const admin = await login("ADMIN")
    const date = nextTuesday()

    for (const [clock, status] of [
      ["09:00", "COMPLETED"],
      ["10:00", "CANCELLED"],
      ["11:00", "NO_SHOW"],
    ] as const) {
      const customer = await login()
      const created = await appointments.createAppointment({
        userId: customer.user.id,
        serviceId: service.id,
        date,
        startsAt: clock,
      })

      const updated = await call(`/admin/appointments/${created.id}/status`, {
        method: "PATCH",
        body: { status },
        access: admin.access,
      })

      assert.equal(updated.status, 200)
      assert.equal(updated.body.data.appointment.status, status)
    }

    const audit = await prisma.adminAuditLog.count()
    assert.equal(audit, 3)
  })

  it("não altera status de agendamento já encerrado", async () => {
    const service = await makeService()
    const customer = await login()
    const admin = await login("ADMIN")

    const created = await appointments.createAppointment({
      userId: customer.user.id,
      serviceId: service.id,
      date: nextTuesday(),
      startsAt: "09:00",
    })

    await call(`/admin/appointments/${created.id}/status`, {
      method: "PATCH",
      body: { status: "COMPLETED" },
      access: admin.access,
    })

    const again = await call(`/admin/appointments/${created.id}/status`, {
      method: "PATCH",
      body: { status: "NO_SHOW" },
      access: admin.access,
    })

    assert.equal(again.status, 409)
  })

  it("ficha do cliente soma atendimentos, cancelamentos e faltas reais", async () => {
    const service = await makeService({ durationMinutes: 30 })
    const customer = await login()
    const admin = await login("ADMIN")
    const date = nextTuesday()

    const created = await Promise.all(
      ["09:00", "10:00", "11:00"].map(clock =>
        appointments.createAppointment({
          userId: customer.user.id,
          serviceId: service.id,
          date,
          startsAt: clock,
        }),
      ),
    )

    await prisma.appointment.update({
      where: { id: created[0]!.id },
      data: { status: "COMPLETED" },
    })
    await prisma.appointment.update({
      where: { id: created[1]!.id },
      data: { status: "NO_SHOW" },
    })

    const result = await call(`/admin/customers/${customer.user.id}/summary`, {
      access: admin.access,
    })

    assert.equal(result.status, 200)
    assert.equal(result.body.data.summary.totalAppointments, 3)
    assert.equal(result.body.data.summary.completed, 1)
    assert.equal(result.body.data.summary.noShow, 1)
    assert.equal(result.body.data.appointments.length, 3)
  })

  it("admin configura expediente e a disponibilidade obedece", async () => {
    const service = await makeService({ durationMinutes: 30 })
    const admin = await login("ADMIN")
    const date = nextTuesday()

    const days = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      closed: weekday !== 2,
      opensAt: "10:00",
      closesAt: "12:00",
      breakStartsAt: null,
      breakEndsAt: null,
    }))

    const saved = await call("/admin/business-hours", {
      method: "PUT",
      body: { days },
      access: admin.access,
    })
    assert.equal(saved.status, 200)

    const result = await availability.getAvailability(date, service.id)
    assert.equal(result.slots[0]?.startsAtClock, "10:00")
    assert.equal(result.slots.at(-1)?.endsAtClock, "12:00")
  })
  // -------------------------------------------------------------------------
  // Grade de início, janelas e duração (engine nova)
  // -------------------------------------------------------------------------

  it("os inícios seguem a grade de 15 min, não a duração do serviço", async () => {
    const date = nextTuesday()
    for (const durationMinutes of [30, 40, 45, 50]) {
      const service = await makeService({ name: "Serviço " + durationMinutes, durationMinutes })
      const result = await availability.getAvailability(date, service.id)

      assert.equal(result.slotIntervalMinutes, 15)
      assert.equal(result.durationMinutes, durationMinutes)
      for (const slot of result.slots) {
        const [hour, minute] = slot.startsAtClock.split(":").map(Number)
        assert.equal(
          (hour! * 60 + minute!) % 15,
          0,
          `${slot.startsAtClock} fora da grade (duração ${durationMinutes})`,
        )
      }
    }
  })

  it("com almoço configurado, a tarde recomeça no fim do intervalo", async () => {
    const admin = await login("ADMIN")
    const date = nextTuesday()
    const days = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({
      weekday,
      closed: weekday !== 2,
      opensAt: "09:00",
      closesAt: "20:00",
      breakStartsAt: "12:00",
      breakEndsAt: "14:00",
    }))
    assert.equal(
      (await call("/admin/business-hours", { method: "PUT", body: { days }, access: admin.access }))
        .status,
      200,
    )

    const service = await makeService({ name: "Completo", durationMinutes: 50 })
    const result = await availability.getAvailability(date, service.id)
    const clocks = result.slots.map(slot => slot.startsAtClock)

    assert.deepEqual(
      result.windows,
      [
        { opensAt: "09:00", closesAt: "12:00" },
        { opensAt: "14:00", closesAt: "20:00" },
      ],
      "o dia precisa ter duas janelas",
    )
    assert.ok(clocks.includes("14:00"), "a tarde começa exatamente às 14:00")
    assert.ok(!clocks.some(clock => clock >= "12:00" && clock < "14:00"), "nada durante o almoço")
    // 11:30 + 50 min terminaria 12:20, atravessando o almoço.
    assert.ok(!clocks.includes("11:30"))
    assert.equal(clocks.filter(clock => clock < "12:00").at(-1), "11:00")
    // 19:15 + 50 min passaria das 20:00.
    assert.equal(clocks.at(-1), "19:00")
  })

  it("mudar a duração do serviço vale já na consulta seguinte e não move reservas antigas", async () => {
    const admin = await login("ADMIN")
    const customer = await login("CUSTOMER")
    const date = nextTuesday()
    const service = await makeService({ name: "Corte", durationMinutes: 30 })

    const created = await call("/booking/appointments", {
      method: "POST",
      body: { serviceId: service.id, date, startsAt: "15:00" },
      access: customer.access,
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.appointment.endsAtClock, "15:30")

    const before = await availability.getAvailability(date, service.id)

    const updated = await call("/admin/services/" + service.id, {
      method: "PATCH",
      body: { durationMinutes: 45, name: "Corte atualizado", priceCents: 4900 },
      access: admin.access,
    })
    assert.equal(updated.status, 200)

    const after = await availability.getAvailability(date, service.id)
    assert.equal(after.durationMinutes, 45)
    assert.ok(after.slots.length < before.slots.length, "45 min cabe em menos horários que 30")

    // A reserva antiga continua 15:00–15:30: o histórico não é reescrito.
    const mine = await call("/booking/appointments/me", { access: customer.access })
    const stored = mine.body.data.appointments.find(
      (appointment: { id: string }) => appointment.id === created.body.data.appointment.id,
    )
    assert.equal(stored.startsAtClock, "15:00")
    assert.equal(stored.endsAtClock, "15:30")
    assert.equal(stored.durationMinutes, 30)
    assert.equal(stored.startsAt, created.body.data.appointment.startsAt)
    assert.equal(stored.endsAt, created.body.data.appointment.endsAt)
    assert.equal(stored.serviceName, "Corte")
    assert.equal(stored.servicePriceCents, 3500)
  })

  it("horário livre imediatamente após um atendimento é oferecido", async () => {
    const customer = await login("CUSTOMER")
    const date = nextTuesday()
    const service = await makeService({ name: "Corte", durationMinutes: 30 })

    assert.equal(
      (
        await call("/booking/appointments", {
          method: "POST",
          body: { serviceId: service.id, date, startsAt: "15:00" },
          access: customer.access,
        })
      ).status,
      201,
    )

    const result = await availability.getAvailability(date, service.id)
    const clocks = result.slots.map(slot => slot.startsAtClock)

    // Intervalo semiaberto: 15:30 encosta no fim e continua livre.
    assert.ok(clocks.includes("15:30"))
    assert.ok(!clocks.includes("15:00"))
    assert.ok(!clocks.includes("15:15"), "15:15–15:45 invadiria a reserva")
    assert.ok(clocks.includes("14:30"), "14:30–15:00 encosta no início e é válido")
  })
  it("rota real entrega grade, janelas e limites corretos para quatro durações", async () => {
    const admin = await login("ADMIN")
    const date = nextTuesday()
    const days = Array.from({ length: 7 }, (_, weekday) => ({
      weekday, closed: weekday !== 2, opensAt: "09:00", closesAt: "20:00",
      breakStartsAt: "12:00", breakEndsAt: "14:00",
    }))
    assert.equal((await call("/admin/business-hours", {
      method: "PUT", body: { days }, access: admin.access,
    })).status, 200)
    for (const [durationMinutes, morningLast, afternoonLast] of [
      [30, "11:30", "19:30"], [40, "11:15", "19:15"],
      [45, "11:15", "19:15"], [50, "11:00", "19:00"],
    ] as const) {
      const service = await makeService({ durationMinutes })
      const response = await call("/booking/availability?date=" + date + "&serviceId=" + service.id)
      assert.equal(response.status, 200)
      const result = response.body.data
      assert.equal(result.slotIntervalMinutes, 15)
      assert.equal(result.durationMinutes, durationMinutes)
      assert.deepEqual(result.windows, [
        { opensAt: "09:00", closesAt: "12:00" }, { opensAt: "14:00", closesAt: "20:00" },
      ])
      const slots = result.slots as Array<{
        startsAtClock: string; endsAtClock: string; startsAt: string; endsAt: string
      }>
      // Derivação independente: floor((tamanho da janela - duração)/15)+1.
      const count = [180, 360].reduce((sum, length) => sum + Math.floor((length - durationMinutes) / 15) + 1, 0)
      assert.equal(slots.length, count)
      assert.equal(slots.filter(slot => slot.startsAtClock < "12:00").at(-1)?.startsAtClock, morningLast)
      assert.equal(slots.at(-1)?.startsAtClock, afternoonLast)
      for (const slot of slots) {
        assert.ok((slot.startsAtClock >= "09:00" && slot.endsAtClock <= "12:00") ||
          (slot.startsAtClock >= "14:00" && slot.endsAtClock <= "20:00"))
        assert.equal(Date.parse(slot.endsAt) - Date.parse(slot.startsAt), durationMinutes * 60_000)
      }
    }
  })

  it("rota availability rejeita IDs e datas inválidos mesmo fora do horizonte", async () => {
    const service = await makeService()
    const date = nextTuesday()
    for (const invalidDate of ["2026-02-30", "2026-13-01", "2020-00-15", "2099-02-30", "24/09/2026"]) {
      const result = await call("/booking/availability?date=" + invalidDate + "&serviceId=" + service.id)
      assert.equal(result.status, 400, invalidDate + ": " + JSON.stringify(result.body))
      assert.equal(result.body.error.code, "VALIDATION_ERROR")
    }
    assert.equal((await call("/booking/availability?date=" + date + "&serviceId=bad-id")).status, 400)
    assert.equal((await call("/booking/availability?date=" + date + "&serviceId=" + randomUUID())).status, 404)
    await prisma.service.update({ where: { id: service.id }, data: { active: false } })
    assert.equal((await call("/booking/availability?date=" + date + "&serviceId=" + service.id)).status, 404)
  })

  it("rota availability informa dia fechado e passado com listas vazias coerentes", async () => {
    const service = await makeService()
    const monday = addDaysToShopDate(nextTuesday(), -1)
    const yesterday = addDaysToShopDate(instantToShopDate(new Date()), -1)
    for (const [date, reason] of [[monday, "CLOSED"], [yesterday, "PAST_DATE"]]) {
      const result = await call("/booking/availability?date=" + date + "&serviceId=" + service.id)
      assert.equal(result.status, 200)
      assert.equal(result.body.data.reason, reason)
      assert.equal(result.body.data.open, false)
      assert.equal(result.body.data.slotIntervalMinutes, 15)
      assert.deepEqual(result.body.data.windows, [])
      assert.deepEqual(result.body.data.slots, [])
    }
  })

  it("API usa relógio do servidor e não oferece passado nem antecedência insuficiente", async () => {
    const service = await makeService({ durationMinutes: 30 })
    await schedule.replaceBusinessHours(Array.from({ length: 7 }, (_, weekday) => ({
      weekday, closed: false, opensAt: "00:00", closesAt: "23:59", breakStartsAt: null, breakEndsAt: null,
    })))
    const requestedAt = new Date()
    const date = instantToShopDate(requestedAt)
    const result = await call("/booking/availability?date=" + date + "&serviceId=" + service.id)
    assert.equal(result.status, 200)
    const cutoff = requestedAt.getTime() + BookingRules.minimumAdvanceMinutes * 60_000
    for (const slot of result.body.data.slots as Array<{ startsAt: string }>) {
      assert.ok(Date.parse(slot.startsAt) >= cutoff)
    }
    // Evita um teste vacuamente aprovado quando a API real roda após fechar.
    const futureDate = nextTuesday()
    const early = await availability.getAvailability(futureDate, service.id, shopWallClockToInstant(futureDate, 1))
    assert.equal(early.slots[0]?.startsAtClock, "01:15")
    const late = await availability.getAvailability(futureDate, service.id, shopWallClockToInstant(futureDate, 23 * 60 + 59))
    assert.deepEqual(late.slots, [])
    assert.equal(late.reason, "FULLY_BOOKED")
  })

  it("EXCLUDE PostgreSQL impede SQL concorrente que ignora validação da aplicação", async () => {
    const service = await makeService({ durationMinutes: 30 })
    const customer = await login()
    const date = nextTuesday()
    const constraints = await prisma.$queryRaw<Array<{ kind: string; definition: string }>>`
      SELECT contype::text AS kind, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conname = 'appointments_no_overlap'`
    assert.equal(constraints.length, 1)
    assert.equal(constraints[0]?.kind, "x")
    assert.match(constraints[0]!.definition, /EXCLUDE USING gist/)
    assert.match(constraints[0]!.definition, /\[\)/)
    assert.match(constraints[0]!.definition, /CONFIRMED/)
    const insert = (startMinute: number, status = "CONFIRMED") => {
      const startsAt = shopWallClockToInstant(date, startMinute)
      const endsAt = new Date(startsAt.getTime() + 30 * 60_000)
      return prisma.$executeRaw`
        INSERT INTO appointments
          (id, user_id, service_id, starts_at, ends_at, status, service_name, service_price_cents, updated_at)
        VALUES (${randomUUID()}::uuid, ${customer.user.id}::uuid, ${service.id}::uuid,
          ${startsAt}, ${endsAt}, ${status}::"AppointmentStatus", 'Corte', 3500, NOW())`
    }
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => insert(9 * 60)))
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1)
    const failures = results.filter(result => result.status === "rejected")
    assert.equal(failures.length, 9)
    for (const failure of failures) assert.match(String(failure.reason), /23P01|appointments_no_overlap/)
    assert.equal(await prisma.appointment.count(), 1)
    assert.equal(await insert(9 * 60 + 30), 1)
    await assert.rejects(() => insert(9 * 60 + 15), /23P01|appointments_no_overlap/)
    assert.equal(await insert(9 * 60 + 15, "CANCELLED"), 1)
    assert.equal(await prisma.appointment.count({ where: { status: "CONFIRMED" } }), 2)
  })

  it("bloqueio com segundos mantém sobreposição real sem arredondar slot para livre", async () => {
    const service = await makeService({ durationMinutes: 30 })
    const customer = await login()
    const date = nextTuesday()
    await prisma.scheduleBlock.create({ data: {
      startsAt: shopWallClockToInstant(date, 9 * 60),
      endsAt: new Date(shopWallClockToInstant(date, 10 * 60).getTime() + 1000), reason: "Fim fracionário",
    } })
    const result = await availability.getAvailability(date, service.id)
    assert.equal(result.slots.some(slot => slot.startsAtClock === "10:00"), false)
    assert.ok(result.slots.some(slot => slot.startsAtClock === "10:15"))
    const booking = await call("/booking/appointments", {
      body: { serviceId: service.id, date, startsAt: "10:00" }, access: customer.access,
    })
    assert.equal(booking.status, 409)
    assert.equal(booking.body.error.code, "CONFLICT")
  })

  it("bloqueios que encostam no expediente e em reserva respeitam [start,end)", async () => {
    const service = await makeService({ durationMinutes: 30 })
    const customer = await login()
    const date = nextTuesday()
    const before = await availability.getAvailability(date, service.id)
    await schedule.createBlock({ date, startsAt: "08:00", endsAt: "09:00", reason: "Antes da abertura" })
    await schedule.createBlock({ date, startsAt: "19:00", endsAt: "20:00", reason: "Depois de fechar" })
    assert.deepEqual((await availability.getAvailability(date, service.id)).slots, before.slots)
    await appointments.createAppointment({ userId: customer.user.id, serviceId: service.id, date, startsAt: "09:00" })
    await schedule.createBlock({ date, startsAt: "09:30", endsAt: "10:00", reason: "Depois do corte" })
    const result = await availability.getAvailability(date, service.id)
    assert.equal(result.slots.some(slot => slot.startsAtClock === "09:30"), false)
    assert.ok(result.slots.some(slot => slot.startsAtClock === "10:00"))
    await schedule.createBlock({ date, startsAt: "00:00", endsAt: "23:59", reason: "Folga integral" })
    const closed = await availability.getAvailability(date, service.id)
    assert.deepEqual(closed.slots, [])
    assert.equal(closed.reason, "FULLY_BOOKED")
  })

  it("consulta encontra reserva e bloqueio que atravessam meia-noite local", async () => {
    const service = await makeService({ durationMinutes: 30 })
    const customer = await login()
    const date = nextTuesday()
    const previous = addDaysToShopDate(date, -1)
    await schedule.replaceBusinessHours(Array.from({ length: 7 }, (_, weekday) => ({
      weekday, closed: false, opensAt: "00:00", closesAt: "02:00", breakStartsAt: null, breakEndsAt: null,
    })))
    await prisma.appointment.create({ data: {
      userId: customer.user.id, serviceId: service.id,
      startsAt: shopWallClockToInstant(previous, 23 * 60 + 59), endsAt: shopWallClockToInstant(date, 30),
      serviceName: service.name, servicePriceCents: service.priceCents,
    } })
    await prisma.scheduleBlock.create({ data: {
      startsAt: shopWallClockToInstant(previous, 23 * 60 + 59),
      endsAt: shopWallClockToInstant(date, 45), reason: "Virada de dia",
    } })
    const result = await availability.getAvailability(date, service.id)
    assert.equal(result.slots[0]?.startsAtClock, "00:45")
    assert.equal(result.slots[0]?.startsAt, date + "T03:45:00.000Z")
    const agenda = await appointments.listAgenda(date, date)
    assert.equal(agenda.length, 1)
    assert.equal(agenda[0]?.startsAtClock, "23:59")
    assert.equal(agenda[0]?.endsAtClock, "00:30")
  })

  it("serviços preservam descrição e inatividade em PATCH parcial e reativam explicitamente", async () => {
    const admin = await login("ADMIN")
    const created = await call("/admin/services", {
      body: { name: "Corte QA", description: "Descrição original", priceCents: 3500, durationMinutes: 30, active: false },
      access: admin.access,
    })
    assert.equal(created.status, 201)
    const id = created.body.data.service.id
    const edited = await call("/admin/services/" + id, {
      method: "PATCH", body: { durationMinutes: 45 }, access: admin.access,
    })
    assert.equal(edited.status, 200)
    assert.equal(edited.body.data.service.durationMinutes, 45)
    assert.equal(edited.body.data.service.description, "Descrição original")
    assert.equal(edited.body.data.service.priceCents, 3500)
    assert.equal(edited.body.data.service.active, false)
    assert.equal((await call("/booking/services")).body.data.services.length, 0)
    assert.equal((await call("/admin/services/" + id, {
      method: "PATCH", body: {}, access: admin.access,
    })).status, 400)
    const activated = await call("/admin/services/" + id, {
      method: "PATCH", body: { active: true, priceCents: 4200, description: "Descrição nova" }, access: admin.access,
    })
    assert.equal(activated.status, 200)
    assert.equal(activated.body.data.service.priceFormatted, "42,00")
    const catalog = await call("/booking/services")
    assert.equal(catalog.body.data.services.length, 1)
    assert.equal(catalog.body.data.services[0].description, "Descrição nova")
    const available = await call("/booking/availability?date=" + nextTuesday() + "&serviceId=" + id)
    assert.equal(available.body.data.durationMinutes, 45)
    assert.equal((await call("/admin/services/" + id, {
      method: "PATCH", body: { active: false }, access: admin.access,
    })).status, 200)
    assert.equal((await call("/booking/services")).body.data.services.length, 0)
  })

  it("buffers ficam zero e API rejeita tentativa explícita de configurá-los", async () => {
    const admin = await login("ADMIN")
    const service = await makeService({ durationMinutes: 30 })
    assert.equal(service.bufferBeforeMinutes, 0)
    assert.equal(service.bufferAfterMinutes, 0)
    for (const buffer of ["bufferBeforeMinutes", "bufferAfterMinutes"]) {
      assert.equal((await call("/admin/services", {
        body: { name: "Buffer", priceCents: 3500, durationMinutes: 30, [buffer]: 15 }, access: admin.access,
      })).status, 400)
      assert.equal((await call("/admin/services/" + service.id, {
        method: "PATCH", body: { name: "Buffer", [buffer]: 15 }, access: admin.access,
      })).status, 400)
    }
    const customer = await login()
    const created = await appointments.createAppointment({
      userId: customer.user.id, serviceId: service.id, date: nextTuesday(), startsAt: "09:00",
    })
    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id: created.id } })
    assert.equal(stored.bufferBeforeMinutes, 0)
    assert.equal(stored.bufferAfterMinutes, 0)
  })

  it("POST de reserva recusa horário fora da grade mesmo dentro do expediente", async () => {
    const service = await makeService({ durationMinutes: 30 })
    const customer = await login()
    const result = await call("/booking/appointments", {
      body: { serviceId: service.id, date: nextTuesday(), startsAt: "09:01" }, access: customer.access,
    })
    assert.equal(result.status, 400)
    assert.equal(result.body.error.code, "VALIDATION_ERROR")
    assert.equal(await prisma.appointment.count(), 0)
  })
})
