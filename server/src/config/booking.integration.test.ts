import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import type { Server } from "node:http"

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

  beforeEach(cleanup)

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
      body: { serviceId: service.id, date, startsAt: "16:20" },
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

  /**
   * O teste central de concorrência: duas requisições disparadas ao mesmo
   * tempo para o mesmo horário. Exatamente uma pode vencer.
   */
  it("duas reservas simultâneas no mesmo horário: só uma é criada", async () => {
    const service = await makeService({ durationMinutes: 40 })
    const a = await login()
    const b = await login()
    const date = nextTuesday()

    const results = await Promise.allSettled([
      call("/booking/appointments", {
        body: { serviceId: service.id, date, startsAt: "11:00" },
        access: a.access,
      }),
      call("/booking/appointments", {
        body: { serviceId: service.id, date, startsAt: "11:00" },
        access: b.access,
      }),
    ])

    const statuses = results.map(result =>
      result.status === "fulfilled" ? result.value.status : 500,
    )

    assert.equal(statuses.filter(status => status === 201).length, 1, "deveria criar exatamente uma")
    assert.equal(statuses.filter(status => status === 409).length, 1, "a outra deveria receber 409")

    const stored = await prisma.appointment.count({ where: { status: "CONFIRMED" } })
    assert.equal(stored, 1)
  })

  it("dez reservas simultâneas no mesmo horário: só uma sobrevive", async () => {
    const service = await makeService({ durationMinutes: 40 })
    const date = nextTuesday()
    const users = await Promise.all(Array.from({ length: 10 }, () => login()))

    await Promise.allSettled(
      users.map(user =>
        call("/booking/appointments", {
          body: { serviceId: service.id, date, startsAt: "17:00" },
          access: user.access,
        }),
      ),
    )

    const stored = await prisma.appointment.count({ where: { status: "CONFIRMED" } })
    assert.equal(stored, 1)
  })

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

    const cancelled = await call(`/booking/appointments/${created.id}/cancel`, {
      method: "POST",
      access: customer.access,
    })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.body.data.appointment.status, "CANCELLED")

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
})
