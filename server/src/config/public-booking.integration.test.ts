import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import type { Server } from "node:http"

// Opt-in explícito. Só apaga dados do banco de teste dedicado.
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
  FRONTEND_URL: "http://localhost:8443",
  TRUST_PROXY_HOPS: "0",
  // Número configurado, provedor de pagamento AUSENTE: é a configuração de
  // produção, e é nela que a confirmação pelo WhatsApp precisa funcionar.
  BARBERSHOP_WHATSAPP_NUMBER: "+5571999990000",
})

let prisma: typeof import("./prisma.js").prisma
let tokens: typeof import("../modules/auth/token.service.js")
let availability: typeof import("../modules/booking/availability.service.js")
let rules: typeof import("../modules/booking/booking.rules.js").BookingRules
let limits: typeof import("../middlewares/rate-limit.js")
let server: Server
let base: string

let phoneCounter = 0
const phone = () => "+55719" + String(20000000 + phoneCounter++)

/** Próxima terça: sempre aberta no expediente padrão (09:00–19:00). */
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
  opts: { method?: string; body?: unknown; access?: string; headers?: Record<string,string> } = {},
) {
  const response = await fetch(base + path, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:8443",
      "X-CSRF-Protection":"1",
      ...opts.headers,
      ...(opts.access ? { Authorization: "Bearer " + opts.access } : {}),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  })
  return { headers: response.headers, status: response.status, body: (await response.json()) as any }
}

async function makeService(durationMinutes = 30) {
  return prisma.service.create({
    data: {
      name: "Corte",
      description: "Corte masculino",
      priceCents: 3500,
      durationMinutes,
      active: true,
    },
  })
}

/** Corpo válido de solicitação pública. */
/** Etapa de cadastro: grava o contato e devolve o handle das etapas seguintes. */
async function registerContact(
  overrides: { phone?: string; fullName?: string } = {},
) {
  return call("/booking/contacts", {
    body: {
      phone: overrides.phone ?? "(71) 98888-1234",
      fullName: overrides.fullName ?? "Cliente Público",
    },
  })
}

/**
 * Corpo válido de solicitação.
 *
 * Passa pela etapa de cadastro primeiro — é assim que o fluxo público
 * funciona agora: nada é escolhido antes de o contato existir.
 */
async function request(overrides: Record<string, unknown> = {}) {
  const { phone, fullName, ...rest } = overrides as {
    phone?: string
    fullName?: string
  }
  const registered = await registerContact({ phone, fullName })
  return {
    contactHandle: registered.body?.data?.contactHandle,
    date: nextTuesday(),
    startsAt: "09:00",
    ...rest,
  }
}

async function cleanup() {
  // Quotas e handles são DURÁVEIS: vivem no banco para valer entre réplicas.
  // Sem limpá-los, um teste que esgota o orçamento por IP faz todos os
  // seguintes receberem 429 — e a suíte passa a depender da ordem.
  await prisma.publicBookingQuota.deleteMany()
  await prisma.publicContactHandle.deleteMany()
  await prisma.adminAuditLog.deleteMany()
  await prisma.appointment.deleteMany()
  await prisma.scheduleBlock.deleteMany()
  await prisma.service.deleteMany()
  await prisma.businessHours.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.user.deleteMany()
}

describe("Agendamento público sem login — PostgreSQL real", { skip: !enabled }, () => {
  before(async () => {
    ;({ prisma } = await import("./prisma.js"))
    tokens = await import("../modules/auth/token.service.js")
    availability = await import("../modules/booking/availability.service.js")
    ;({ BookingRules: rules } = await import("../modules/booking/booking.rules.js"))
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
    for (const limiter of [
      limits.globalRateLimit,
      limits.publicBookingRateLimit,
      limits.publicContactRateLimit,
      limits.publicRequestLookupRateLimit,
      limits.loginRateLimit,
    ])
      limiter.resetKey("127.0.0.1")
  })

  it("audit: contact handle never discloses the account identifier", async () => {
    const r=await registerContact()
    const user=await prisma.user.findFirstOrThrow()
    assert.ok(!r.body.data.contactHandle.includes(user.id))
  })

  it("audit: successful handle is consumed even after the appointment is rejected", async () => {
    const service=await makeService()
    const payload=await request({serviceId:service.id})
    const first=await call("/booking/requests",{body:payload})
    assert.equal(first.status,201)
    await prisma.appointment.update({where:{id:first.body.data.appointment.id},data:{status:"REJECTED"}})
    const replay=await call("/booking/requests",{body:{...payload,startsAt:"09:40"}})
    assert.equal(replay.status,400)
    assert.equal(await prisma.appointment.count(),1)
  })

  it("audit: contact IP quota persists when process memory is reset", async () => {
    for(let i=0;i<11;i++){
      limits.publicContactRateLimit.resetKey("127.0.0.1")
      const r=await registerContact({phone:phone()})
      assert.equal(r.status,i<10?201:429)
    }
    assert.equal(await prisma.user.count(),10)
  })

  // ------------------------------------------------------------- fluxo feliz

  it("cliente novo solicita agendamento informando só WhatsApp e nome", async () => {
    const service = await makeService()
    const response = await call("/booking/requests", {
      body: await request({ serviceId: service.id }),
    })

    assert.equal(response.status, 201)
    const { appointment, publicToken, awaitingApproval } = response.body.data
    assert.equal(appointment.startsAtClock, "09:00")
    assert.equal(appointment.endsAtClock, "09:30")
    assert.equal(appointment.durationMinutes, 30, "a duração real do serviço é preservada")
    assert.equal(appointment.reservedMinutes, 40, "a agenda reserva a grade operacional")
    assert.equal(appointment.status, rules.publicRequestsRequireApproval ? "PENDING" : "CONFIRMED")
    assert.equal(awaitingApproval, rules.publicRequestsRequireApproval)
    assert.match(publicToken, /^[A-Za-z0-9_-]{43}$/)

    // Nenhuma sessão foi aberta: não há cookie nem access token na resposta.
    assert.equal(response.body.data.accessToken, undefined)
    assert.doesNotMatch(JSON.stringify(response.body), /passwordHash|refreshToken|accessToken/i)

    // O contato foi criado sem credencial: telefone não vira conta.
    const contact = await prisma.user.findUniqueOrThrow({ where: { phone: "+5571988881234" } })
    assert.equal(contact.passwordHash, null)
    assert.equal(contact.role, "CUSTOMER")
  })

  it("telefone já cadastrado reaproveita o contato em vez de duplicar", async () => {
    const service = await makeService()
    const existing = await prisma.user.create({
      data: { phone: "+5571988881234", fullName: "Nome Original", role: "CUSTOMER", status: "ACTIVE" },
    })

    const response = await call("/booking/requests", {
      body: await request({ serviceId: service.id, fullName: "Nome Diferente" }),
    })
    assert.equal(response.status, 201)

    assert.equal(await prisma.user.count(), 1)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })
    // Nome existente NÃO é sobrescrito: bastaria saber o telefone para renomear.
    assert.equal(after.fullName, "Nome Original")
    assert.equal(after.status, "ACTIVE", "status preservado")
  })

  it("mesmo telefone em formatos diferentes não cria dois contatos", async () => {
    const service = await makeService()
    const date = nextTuesday()
    for (const [value, startsAt] of [
      ["(71) 98888-1234", "09:00"],
      ["71988881234", "09:40"],
      ["+55 71 98888-1234", "10:20"],
    ] as const) {
      const response = await call("/booking/requests", {
        body: await request({ serviceId: service.id, phone: value, date, startsAt }),
      })
      assert.equal(response.status, 201, value)
    }
    assert.equal(await prisma.user.count(), 1)
    assert.equal(await prisma.appointment.count(), 3)
  })

  it("conta ADMIN que agenda com o próprio número não é rebaixada", async () => {
    const service = await makeService()
    const admin = await prisma.user.create({
      data: { phone: "+5571988881234", fullName: "Erick", role: "ADMIN", status: "ACTIVE" },
    })

    assert.equal(
      (await call("/booking/requests", { body: await request({ serviceId: service.id }) })).status,
      201,
    )

    const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
    assert.equal(after.role, "ADMIN")
    assert.equal(after.status, "ACTIVE")
  })

  // ------------------------------------------------------------- validações

  it("recusa telefone inválido, nome vazio e horário fora da grade", async () => {
    const service = await makeService()
    for (const invalid of [
      { phone: "123" },
      { phone: "(71) 3333-3333" },
      { fullName: "" },
      { fullName: "   " },
      { startsAt: "09:01" },
      { date: "2026-02-30" },
    ]) {
      const response = await call("/booking/requests", {
        body: await request({ serviceId: service.id, ...invalid }),
      })
      assert.ok([400, 409].includes(response.status), JSON.stringify(invalid) + " -> " + response.status)
    }
    assert.equal(await prisma.appointment.count(), 0)
  })

  it("não aceita userId, status, preço ou duração vindos do navegador", async () => {
    const service = await makeService()
    const victim = await prisma.user.create({
      data: { phone: phone(), fullName: "Vítima", role: "CUSTOMER", status: "ACTIVE" },
    })

    for (const extra of [
      { userId: victim.id },
      { status: "CONFIRMED" },
      { servicePriceCents: 1 },
      { durationMinutes: 5 },
      { publicToken: "forjado" },
    ]) {
      const response = await call("/booking/requests", {
        body: await request({ serviceId: service.id, ...extra }),
      })
      assert.equal(response.status, 400, JSON.stringify(extra))
    }
    assert.equal(await prisma.appointment.count(), 0)
  })

  it("serviço inativo não pode ser solicitado", async () => {
    const service = await makeService()
    await prisma.service.update({ where: { id: service.id }, data: { active: false } })
    const response = await call("/booking/requests", { body: await request({ serviceId: service.id }) })
    assert.equal(response.status, 404)
  })

  // --------------------------------------------------------------- segurança

  it("informar o telefone de outra pessoa não revela nada sobre ela", async () => {
    const service = await makeService()
    const other = await prisma.user.create({
      data: { phone: "+5571988881234", fullName: "Pessoa Existente", role: "CUSTOMER", status: "ACTIVE" },
    })
    await prisma.appointment.create({
      data: {
        userId: other.id,
        serviceId: service.id,
        startsAt: new Date("2026-01-05T12:00:00Z"),
        endsAt: new Date("2026-01-05T12:30:00Z"),
        reservedEndsAt: new Date("2026-01-05T12:40:00Z"),
        status: "COMPLETED",
        serviceName: "Corte",
        servicePriceCents: 3500,
      },
    })

    const response = await call("/booking/requests", {
      body: await request({ serviceId: service.id }),
    })
    assert.equal(response.status, 201)

    const payload = JSON.stringify(response.body)
    assert.doesNotMatch(payload, /Pessoa Existente/, "não devolve o nome cadastrado")
    assert.doesNotMatch(payload, /COMPLETED/, "não devolve histórico anterior")
    assert.equal(response.body.data.appointment.status !== "COMPLETED", true)
  })

  it("o token abre apenas a própria solicitação, e nunca lista nada", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const first = await call("/booking/requests", {
      body: await request({ serviceId: service.id, date, startsAt: "09:00" }),
    })
    const second = await call("/booking/requests", {
      body: await request({ serviceId: service.id, date, startsAt: "09:40", phone: "(71) 97777-4321" }),
    })

    const lookup = await call("/booking/requests/" + first.body.data.publicToken)
    assert.equal(lookup.status, 200)
    assert.equal(lookup.body.data.appointment.id, first.body.data.appointment.id)
    assert.notEqual(lookup.body.data.appointment.id, second.body.data.appointment.id)

    // Token inexistente não confirma nem nega existência de nada.
    const missing = await call("/booking/requests/" + "a".repeat(43))
    assert.equal(missing.status, 404)

    // Nenhuma rota pública lista solicitações.
    assert.equal((await call("/booking/requests")).status, 404)
  })

  it("telefone não autentica: rotas de sessão e de administração seguem fechadas", async () => {
    const service = await makeService()
    const created = await call("/booking/requests", { body: await request({ serviceId: service.id }) })
    assert.equal(created.status, 201)

    for (const path of ["/auth/me", "/users/me", "/booking/appointments/me"]) {
      assert.equal((await call(path)).status, 401, path)
    }
    assert.equal((await call("/admin/users")).status, 401)
    assert.equal((await call("/admin/agenda?from=" + nextTuesday())).status, 401)
  })

  it("não é possível cancelar a reserva de terceiro com o próprio token", async () => {
    const service = await makeService()
    const created = await call("/booking/requests", { body: await request({ serviceId: service.id }) })
    const id = created.body.data.appointment.id

    // Sem sessão, nenhuma rota de cancelamento aceita a chamada.
    assert.equal((await call(`/booking/appointments/${id}/cancel`, { body: {} })).status, 401)
    assert.equal(
      (await call(`/admin/requests/${id}/decide`, { body: { decision: "REJECTED" } })).status,
      401,
    )
    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id } })
    assert.notEqual(stored.status, "CANCELLED")
  })

  // ---------------------------------------------------- aprovação e expiração

  it("solicitação pendente segura o horário e some da disponibilidade", async () => {
    const service = await makeService()
    const date = nextTuesday()
    await call("/booking/requests", { body: await request({ serviceId: service.id, date, startsAt: "09:00" }) })

    const result = await availability.getAvailability(date, service.id)
    assert.equal(result.slots.some(slot => slot.startsAtClock === "09:00"), false)

    // Outra pessoa pedindo o mesmo horário recebe conflito tratável.
    const rival = await call("/booking/requests", {
      body: await request({ serviceId: service.id, date, startsAt: "09:00", phone: "(71) 97777-9999" }),
    })
    assert.equal(rival.status, 409)
  })

  it("admin confirma a solicitação e ela deixa de ser pendente", async () => {
    const service = await makeService()
    const adminUser = await prisma.user.create({
      data: { phone: phone(), fullName: "Erick", role: "ADMIN", status: "ACTIVE" },
    })
    const session = await tokens.issueSession(adminUser.id)

    const created = await call("/booking/requests", { body: await request({ serviceId: service.id }) })
    const id = created.body.data.appointment.id

    const decided = await call(`/admin/requests/${id}/decide`, {
      body: { decision: "CONFIRMED" },
      access: session.accessToken,
    })
    assert.equal(decided.status, 200)
    assert.equal(decided.body.data.appointment.status, "CONFIRMED")

    const stored = await prisma.appointment.findUniqueOrThrow({ where: { id } })
    assert.equal(stored.pendingExpiresAt, null, "confirmada deixa de expirar")
    assert.notEqual(stored.decidedAt, null)

    const audit = await prisma.adminAuditLog.findFirstOrThrow()
    assert.equal(audit.action, "APPOINTMENT_REQUEST_CONFIRMED")
    assert.equal(audit.actorId, adminUser.id)
  })

  it("admin recusa e o horário volta a ser oferecido", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const adminUser = await prisma.user.create({
      data: { phone: phone(), fullName: "Erick", role: "ADMIN", status: "ACTIVE" },
    })
    const session = await tokens.issueSession(adminUser.id)

    const created = await call("/booking/requests", {
      body: await request({ serviceId: service.id, date, startsAt: "09:00" }),
    })
    const id = created.body.data.appointment.id

    assert.equal(
      (await call(`/admin/requests/${id}/decide`, {
        body: { decision: "REJECTED" },
        access: session.accessToken,
      })).status,
      200,
    )

    const result = await availability.getAvailability(date, service.id)
    assert.ok(result.slots.some(slot => slot.startsAtClock === "09:00"))

    // A pessoa vê a recusa pelo próprio token.
    const lookup = await call("/booking/requests/" + created.body.data.publicToken)
    assert.equal(lookup.body.data.appointment.status, "REJECTED")
  })

  it("CUSTOMER autenticado não decide solicitação — só ADMIN", async () => {
    const service = await makeService()
    const customer = await prisma.user.create({
      data: { phone: phone(), fullName: "Cliente", role: "CUSTOMER", status: "ACTIVE" },
    })
    const session = await tokens.issueSession(customer.id)
    const created = await call("/booking/requests", { body: await request({ serviceId: service.id }) })

    const attempt = await call(`/admin/requests/${created.body.data.appointment.id}/decide`, {
      body: { decision: "CONFIRMED" },
      access: session.accessToken,
    })
    assert.equal(attempt.status, 403)
  })

  it("solicitação vencida libera o horário e é apresentada como expirada", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const created = await call("/booking/requests", {
      body: await request({ serviceId: service.id, date, startsAt: "09:00" }),
    })
    const id = created.body.data.appointment.id

    // Envelhece o pedido além do prazo.
    await prisma.appointment.update({
      where: { id },
      data: { pendingExpiresAt: new Date(Date.now() - 60_000) },
    })

    const result = await availability.getAvailability(date, service.id)
    assert.ok(
      result.slots.some(slot => slot.startsAtClock === "09:00"),
      "pendente vencida não pode segurar a agenda para sempre",
    )

    const lookup = await call("/booking/requests/" + created.body.data.publicToken)
    assert.equal(lookup.body.data.appointment.status, "EXPIRED")

    // E outra pessoa consegue reservar o horário liberado.
    const rival = await call("/booking/requests", {
      body: await request({ serviceId: service.id, date, startsAt: "09:00", phone: "(71) 97777-8888" }),
    })
    assert.equal(rival.status, 201)
    const expired = await prisma.appointment.findUniqueOrThrow({ where: { id } })
    assert.equal(expired.status, "EXPIRED")
  })

  // ------------------------------------------------------------ antiabuso

  it("limita solicitações ativas por telefone", async () => {
    const service = await makeService()
    const date = nextTuesday()
    for (const startsAt of ["09:00", "09:40", "10:20"]) {
      assert.equal(
        (await call("/booking/requests", { body: await request({ serviceId: service.id, date, startsAt }) }))
          .status,
        201,
        startsAt,
      )
    }
    const excess = await call("/booking/requests", {
      body: await request({ serviceId: service.id, date, startsAt: "11:00" }),
    })
    assert.equal(excess.status, 409)
    assert.doesNotMatch(excess.body.error.message, /3|em aberto|bloquead/i)
  })

  it("contato bloqueado não consegue solicitar, com mensagem neutra", async () => {
    const service = await makeService()
    await prisma.user.create({
      data: { phone: "+5571988881234", fullName: "Bloqueado", role: "CUSTOMER", status: "BLOCKED" },
    })

    // O cadastro responde como qualquer outro: sinalizar o bloqueio aqui
    // diria a um estranho que aquele telefone existe e está banido.
    const registered = await registerContact()
    assert.equal(registered.status, 201)

    // A recusa vem no envio, com mensagem neutra e sem criar nada.
    const response = await call("/booking/requests", {
      body: {
        contactHandle: registered.body.data.contactHandle,
        serviceId: service.id,
        date: nextTuesday(),
        startsAt: "09:00",
      },
    })
    assert.equal(response.status, 409)
    assert.doesNotMatch(response.body.error.message, /bloquead/i, "não confirma o bloqueio")
    assert.equal(await prisma.appointment.count(), 0)
  })

  it("duas solicitações simultâneas do mesmo telefone não duplicam o contato", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const results = await Promise.all([
      call("/booking/requests", { body: await request({ serviceId: service.id, date, startsAt: "09:00" }) }),
      call("/booking/requests", { body: await request({ serviceId: service.id, date, startsAt: "09:40" }) }),
    ])
    assert.deepEqual(results.map(r => r.status).sort(), [201, 201])
    assert.equal(await prisma.user.count(), 1)
  })

  it("dez solicitações simultâneas no mesmo horário: só uma vence", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const results = await Promise.all(
      Array.from({ length: 10 }, async (_, index) =>
        call("/booking/requests", {
          body: await request({
            serviceId: service.id,
            date,
            startsAt: "09:00",
            phone: "(71) 9" + String(6000000 + index).padStart(7, "0") + "0".slice(0, 0) + "1",
          }),
        }),
      ),
    )
    assert.equal(results.filter(r => r.status === 201).length, 1)
    assert.equal(results.filter(r => r.status === 409).length, 9, JSON.stringify(results.map(r => r.status)))
    assert.equal(
      await prisma.appointment.count({ where: { status: { in: ["PENDING", "CONFIRMED"] } } }),
      1,
    )
  })

  it("regression: concurrent requests cannot exceed the durable phone quota", async () => {
    const service = await makeService()
    const responses = await Promise.all(["09:00", "09:40", "10:20", "11:00"].map(async startsAt => call("/booking/requests", { body: await request({ serviceId: service.id, startsAt }) })))
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 201, 201, 409])
    assert.equal(await prisma.appointment.count(), 3)
  })

  it("regression: an expired request cannot be confirmed", async () => {
    const service = await makeService()
    const created = await call("/booking/requests", { body: await request({ serviceId: service.id }) })
    const id = created.body.data.appointment.id
    await prisma.appointment.update({where:{id},data:{pendingExpiresAt:new Date(Date.now()-1000)}})
    const admin = await prisma.user.create({data:{phone:phone(),role:"ADMIN",status:"ACTIVE"}})
    const session = await tokens.issueSession(admin.id)
    const r = await call("/admin/requests/"+id+"/decide", {access:session.accessToken,body:{decision:"CONFIRMED"}})
    assert.equal(r.status,409)
    assert.notEqual((await prisma.appointment.findUniqueOrThrow({where:{id}})).status,"CONFIRMED")
    assert.equal(await prisma.adminAuditLog.count(),0)
    const detail = await call("/admin/appointments/"+id, {access:session.accessToken})
    assert.equal(detail.body.data.appointment.status,"EXPIRED")
    for (const status of ["PENDING","EXPIRED"]) {
      const agenda=await call("/admin/agenda?from="+nextTuesday()+"&to="+nextTuesday()+"&status="+status,{access:session.accessToken})
      assert.equal(agenda.status,200)
      assert.equal(agenda.body.data.appointments.length,status === "EXPIRED" ? 1 : 0)
    }
  })

  it("regression: concurrent opposing decisions have exactly one winner and one audit", async () => {
    const service = await makeService()
    const created = await call("/booking/requests", {body: await request({serviceId:service.id})})
    const id=created.body.data.appointment.id
    const admin=await prisma.user.create({data:{phone:phone(),role:"ADMIN",status:"ACTIVE"}})
    const session=await tokens.issueSession(admin.id)
    const r=await Promise.all(["CONFIRMED","REJECTED"].map(decision=>call("/admin/requests/"+id+"/decide",{access:session.accessToken,body:{decision}})))
    assert.deepEqual(r.map(v=>v.status).sort(),[200,409]);assert.equal(await prisma.adminAuditLog.count(),1)
  })

  it("regression: public token is stored only as a digest and never logged on error", async () => {
    const service=await makeService()
    const created=await call("/booking/requests",{body: await request({serviceId:service.id})})
    const token=created.body.data.publicToken
    const row=await prisma.appointment.findUniqueOrThrow({where:{id:created.body.data.appointment.id}})
    assert.notEqual(row.publicToken,token)
    const original=prisma.appointment.findUnique, originalLog=console.error
    const logs: string[]=[]
    try {
      console.error=(...args:unknown[])=>{logs.push(args.map(String).join(" "))}
      prisma.appointment.findUnique=async()=>{throw new Error("backend failure "+token)}
      const r=await call("/booking/requests/"+token)
      assert.equal(r.status,500);assert.ok(!JSON.stringify(r.body).includes(token))
      assert.ok(!logs.join(" ").includes(token))
    } finally {prisma.appointment.findUnique=original;console.error=originalLog}
  })
  it("all public mass assignment fields are rejected, never silently stripped", async () => {
    const service = await makeService()
    // Um cadastro legítimo, cujo handle é reutilizado em todas as tentativas —
    // assim o teste isola a injeção de campos, sem misturar a etapa anterior.
    const registered = await registerContact()
    assert.equal(registered.status, 201)
    const handle = registered.body.data.contactHandle

    for (const key of ["userId","customerId","role","status","servicePriceCents","durationMinutes","reservedMinutes","reservedEndsAt","publicToken","decidedAt","pendingExpiresAt","phone","fullName"]) {
      limits.publicBookingRateLimit.resetKey("127.0.0.1")
      const response = await call("/booking/requests", {
        body: {
          contactHandle: handle,
          serviceId: service.id,
          date: nextTuesday(),
          startsAt: "09:00",
          [key]: "injected",
        },
      })
      assert.equal(response.status, 400, key)
    }
    // Nenhuma reserva criada; o contato do cadastro legítimo permanece único.
    assert.equal(await prisma.appointment.count(), 0)
    assert.equal(await prisma.user.count(), 1)
  })

  it("phone-only login fails; ADMIN and password CUSTOMER retain normal auth; blocked and unknown fail", async () => {
    const {hashPassword}=await import("../modules/auth/password.service.js")
    const password="synthetic-public-audit-password", hash=await hashPassword(password)
    for(const [role,status,credential,expected] of [["CUSTOMER","PENDING",null,401],["ADMIN","ACTIVE",hash,200],["CUSTOMER","ACTIVE",hash,200],["CUSTOMER","BLOCKED",hash,403]] as const){
      const user=await prisma.user.create({data:{phone:phone(),role,status,passwordHash:credential}})
      const response=await call("/auth/login",{body:{phone:user.phone,password}})
      assert.equal(response.status,expected)
      if(expected!==200)assert.equal(await prisma.refreshToken.count({where:{userId:user.id}}),0)
    }
    assert.equal((await call("/auth/login",{body:{phone:phone(),password}})).status,401)
  })

  it("public request preserves every existing account field and session, even an unnamed ADMIN", async () => {
    const {hashPassword}=await import("../modules/auth/password.service.js")
    const hash=await hashPassword("synthetic-existing-password")
    const service=await makeService()
    for(const [role,startsAt] of [["ADMIN","09:00"],["CUSTOMER","09:40"]] as const){
      const user=await prisma.user.create({data:{phone:phone(),fullName:role==="ADMIN"?null:"João",role,status:"ACTIVE",passwordHash:hash,passwordUpdatedAt:new Date(),failedLoginAttempts:4,lockedUntil:new Date(Date.now()+10000)}})
      await tokens.issueSession(user.id)
      const sessions=await prisma.refreshToken.findMany({where:{userId:user.id}})
      const r=await call("/booking/requests",{body: await request({phone:user.phone,fullName:"Maria",serviceId:service.id,startsAt})})
      assert.equal(r.status,201);assert.equal(r.headers.get("set-cookie"),null)
      assert.deepEqual(await prisma.user.findUniqueOrThrow({where:{id:user.id}}),user)
      assert.deepEqual(await prisma.refreshToken.findMany({where:{userId:user.id}}),sessions)
      assert.doesNotMatch(JSON.stringify(r.body),/passwordHash|passwordUpdatedAt|lockedUntil|failedLoginAttempts|ADMIN|CUSTOMER|João|fullName|phone/)
    }
  })

  it("tokens are exact, unique, read-only, absent from admin lists, and never authenticate", async () => {
    const service=await makeService()
    const r=await call("/booking/requests",{body: await request({serviceId:service.id})})
    const token=r.body.data.publicToken,id=r.body.data.appointment.id
    for(const value of [token.slice(0,-1),"invalid","x".repeat(44)])assert.equal((await call("/booking/requests/"+value)).status,400)
    assert.equal((await call("/booking/requests/"+randomBytes(32).toString("base64url"))).status,404)
    for(const path of ["/users/me","/booking/appointments/me","/booking/appointments/"+id])assert.equal((await call(path,{access:token})).status,401)
    for(const method of ["PATCH","DELETE","POST"]) assert.equal((await call("/booking/requests/"+token,{method,body:{}})).status,404)
    const admin=await prisma.user.create({data:{phone:phone(),role:"ADMIN",status:"ACTIVE"}})
    const auth=await tokens.issueSession(admin.id)
    const list=await call("/admin/agenda?from="+nextTuesday()+"&status=PENDING",{access:auth.accessToken})
    assert.equal(list.status,200);assert.equal(list.body.data.appointments.length,1)
    assert.ok(!JSON.stringify(list.body).includes(token));assert.doesNotMatch(JSON.stringify(list.body),/publicToken/)
  })

  it("rate limit is 10 per IP and spoofed forwarding cannot evade it", async () => {
    for(let i=0;i<11;i++){
      const r=await call("/booking/requests",{body:{},headers:{"X-Forwarded-For":"198.51.100."+(i+1)}})
      assert.equal(r.status,i<10?400:429)
    }
  })

  it("expired/rejected requests release quota and reads do not mutate expiration", async () => {
    const service=await makeService()
    const records=[]
    for(const startsAt of ["09:00","09:40","10:20"])records.push((await call("/booking/requests",{body: await request({serviceId:service.id,startsAt})})).body.data)
    await prisma.appointment.update({where:{id:records[0].appointment.id},data:{pendingExpiresAt:new Date(Date.now()-1000)}})
    await prisma.appointment.update({where:{id:records[1].appointment.id},data:{status:"REJECTED"}})
    const before=await prisma.appointment.findMany({orderBy:{id:"asc"}})
    await availability.getAvailability(nextTuesday(),service.id)
    await call("/booking/requests/"+records[0].publicToken)
    assert.deepEqual(await prisma.appointment.findMany({orderBy:{id:"asc"}}),before)
    assert.equal((await call("/booking/requests",{body: await request({serviceId:service.id,startsAt:"11:00"})})).status,201)
  })

  it("expiry versus admin confirmation versus replacement never resurrects the old request", async () => {
    const service=await makeService()
    const r=await call("/booking/requests",{body: await request({serviceId:service.id})});const id=r.body.data.appointment.id
    await prisma.appointment.update({where:{id},data:{pendingExpiresAt:new Date(Date.now()-1000)}})
    const admin=await prisma.user.create({data:{phone:phone(),role:"ADMIN",status:"ACTIVE"}});const session=await tokens.issueSession(admin.id)
    const result=await Promise.all([call("/admin/requests/"+id+"/decide",{access:session.accessToken,body:{decision:"CONFIRMED"}}),call("/booking/requests",{body: await request({serviceId:service.id,phone:phone()})})])
    assert.deepEqual(result.map(r=>r.status),[409,201]);assert.equal((await prisma.appointment.findUniqueOrThrow({where:{id}})).status,"EXPIRED")
  })

  it("display cap never rejects a valid unlisted start; frozen durations survive service edits", async () => {
    const service=await makeService()
    const date=nextTuesday(), zero=new Date(date+"T00:00:00-03:00")
    await prisma.businessHours.create({data:{weekday:2,closed:false,openMinute:0,closeMinute:1439}})
    const owner=await prisma.user.create({data:{phone:phone()}})
    for(let minute=50;minute<1300;minute+=160)await prisma.appointment.create({data:{userId:owner.id,serviceId:service.id,startsAt:new Date(+zero+minute*60000),endsAt:new Date(+zero+(minute+1)*60000),reservedEndsAt:new Date(+zero+(minute+1)*60000),serviceName:"Historical short",servicePriceCents:100}})
    const full=await availability.listBookableStartMinutes(date,service.id)
    const shown=await availability.getAvailability(date,service.id)
    assert.ok(full.length>20);assert.equal(shown.slots.length,20)
    const displayed=new Set(shown.slots.map(s=>Number(s.startsAtClock.slice(0,2))*60+Number(s.startsAtClock.slice(3))))
    const omitted=full.find(n=>!displayed.has(n))!
    const startsAt=String(Math.floor(omitted/60)).padStart(2,"0")+":"+String(omitted%60).padStart(2,"0")
    const created=await call("/booking/requests",{body: await request({serviceId:service.id,startsAt})});assert.equal(created.status,201)
    const before=await prisma.appointment.findUniqueOrThrow({where:{id:created.body.data.appointment.id}})
    await prisma.service.update({where:{id:service.id},data:{durationMinutes:50,priceCents:9999}})
    assert.deepEqual(await prisma.appointment.findUniqueOrThrow({where:{id:before.id}}),before)
    const after=await availability.getAvailability(date,service.id);assert.equal(after.durationMinutes,50);assert.equal(after.reservedMinutes,50)
  })

  it("repeated simultaneous booking races return exactly one success and all other responses 409", async () => {
    const service=await makeService()
    for(const count of [2,10,10,10,10,10]){
      await prisma.appointment.deleteMany()
      // Contadores duráveis vivem no banco; zerar só os de memória deixaria
      // a etapa de cadastro estourando 429 no meio da corrida.
      await prisma.publicBookingQuota.deleteMany()
      await prisma.publicContactHandle.deleteMany()
      limits.publicBookingRateLimit.resetKey("127.0.0.1");limits.publicContactRateLimit.resetKey("127.0.0.1")
      const r=await Promise.all(Array.from({length:count},async()=>call("/booking/requests",{body: await request({phone:phone(),serviceId:service.id})})))
      assert.equal(r.filter(x=>x.status===201).length,1)
      assert.equal(r.filter(x=>x.status===409).length,count-1,JSON.stringify(r.map(x=>x.status)))
    }
  })

  // -------------------------------------------------------------- política

  it("enumeration comparison: accepted roles share shape; blocked refusal stays neutral", async () => {
    const service=await makeService()
    const cases = [
      {kind:"NEW",phone:phone()},
      {kind:"ADMIN",phone:phone()},
      {kind:"CUSTOMER",phone:phone()},
      {kind:"BLOCKED",phone:phone()},
    ]
    for(const c of cases.slice(1)) await prisma.user.create({data:{phone:c.phone,fullName:"Existing",role:c.kind === "ADMIN" ? "ADMIN" : "CUSTOMER",status:c.kind === "BLOCKED" ? "BLOCKED" : "ACTIVE"}})
    let shape: string | undefined
    const timings: Record<string,number[]>={}
    for(let round=0;round<8;round++) for(const c of cases){
      limits.publicBookingRateLimit.resetKey("127.0.0.1");limits.publicContactRateLimit.resetKey("127.0.0.1")
      // O assunto aqui é PARIDADE de resposta, não limite de uso — este tem
      // teste próprio. Sem zerar a quota durável, a 11a rodada viraria 429 e
      // mascararia a comparação.
      await prisma.publicBookingQuota.deleteMany()
      if(c.kind === "NEW") c.phone=phone()
      const began=performance.now()
      // A etapa de cadastro é onde a enumeração seria possível: é ela que
      // consulta o telefone. Contato novo, cliente existente e ADMIN precisam
      // responder igual; bloqueado recusa sem dizer por quê.
      const result=await call("/booking/contacts",{body:{phone:c.phone,fullName:"Pessoa QA"}})
      ;(timings[c.kind] ??= []).push(performance.now()-began)
      // Inclusive o bloqueado: nenhuma diferença observável nesta etapa.
      assert.equal(result.status,201, c.kind)
      assert.doesNotMatch(JSON.stringify(result.body),/passwordHash|passwordUpdatedAt|lockedUntil|failedLoginAttempts|CUSTOMER|ADMIN|BLOCKED|Existing/)
      {
        const keys=JSON.stringify(Object.keys(result.body.data).sort())
        shape ??= keys
        assert.equal(keys,shape,c.kind)
        // O nome devolvido é o que a pessoa digitou, nunca o cadastrado.
        assert.equal(result.body.data.fullName,"Pessoa QA")
        assert.match(result.body.data.phoneMasked,/^\(\d{2}\) \*{5}-\d{4}$/)
      }
      await prisma.appointment.deleteMany()
    }
    console.log("Public request latency medians ms (local samples, not constant-time proof):",Object.fromEntries(Object.entries(timings).map(([kind,values])=>[kind,Math.round(values.sort((a,b)=>a-b)[4]!)])))
  })

  it("a política é servida pelo backend, não decidida no navegador", async () => {
    const response = await call("/booking/policy")
    assert.equal(response.status, 200)
    assert.equal(response.body.data.requiresApproval, rules.publicRequestsRequireApproval)
    assert.equal(response.body.data.baseSlotMinutes, rules.baseSlotMinutes)
    assert.equal(response.body.data.pendingTtlMinutes, rules.pendingRequestTtlMinutes)
  })
  // -------------------------------------------------------------------------
  // Etapa de cadastro — a primeira do fluxo
  // -------------------------------------------------------------------------

  it("cadastro válido grava o contato e devolve handle, sem senha nem sessão", async () => {
    const response = await registerContact({ fullName: "Guilherme Santana" })

    assert.equal(response.status, 201)
    const { contactHandle, fullName, phoneMasked } = response.body.data
    assert.equal(fullName, "Guilherme Santana")
    assert.equal(phoneMasked, "(71) *****-1234")
    assert.match(contactHandle, /^v2\.[A-Za-z0-9_-]{43}\.[0-9]{13}\.[A-Za-z0-9_-]{43}$/)

    // Nada de credencial: sem token de acesso, sem cookie, sem refresh.
    assert.equal(response.body.data.accessToken, undefined)
    assert.doesNotMatch(JSON.stringify(response.body), /accessToken|refreshToken|password/i)
    assert.equal(await prisma.refreshToken.count(), 0)

    const contact = await prisma.user.findUniqueOrThrow({ where: { phone: "+5571988881234" } })
    assert.equal(contact.passwordHash, null)
    assert.equal(contact.role, "CUSTOMER")
    assert.equal(contact.status, "PENDING")
  })

  it("cadastro recusa nome e telefone inválidos antes de qualquer escolha", async () => {
    for (const invalid of [
      { fullName: "" },
      { fullName: "   " },
      { fullName: "A" },
      { phone: "123" },
      { phone: "(71) 3333-3333" },
      { phone: "(00) 99999-9999" },
    ]) {
      const response = await registerContact(invalid)
      assert.equal(response.status, 400, JSON.stringify(invalid))
    }
    assert.equal(await prisma.user.count(), 0)
  })

  it("cadastro não aceita papel, status nem senha vindos do navegador", async () => {
    for (const extra of [
      { role: "ADMIN" },
      { status: "ACTIVE" },
      { password: "qualquer-coisa" },
      { passwordHash: "$argon2id$forjado" },
    ]) {
      const response = await call("/booking/contacts", {
        body: { fullName: "Cliente", phone: "(71) 98888-1234", ...extra },
      })
      assert.equal(response.status, 400, JSON.stringify(extra))
    }
    assert.equal(await prisma.user.count(), 0)
  })

  it("cadastro repetido do mesmo telefone reutiliza o contato e preserva o nome", async () => {
    const first = await registerContact({ fullName: "Nome Original" })
    assert.equal(first.status, 201)

    const again = await registerContact({ fullName: "Nome Diferente", phone: "71988881234" })
    assert.equal(again.status, 201)

    assert.equal(await prisma.user.count(), 1, "formato diferente não duplica contato")
    const stored = await prisma.user.findUniqueOrThrow({ where: { phone: "+5571988881234" } })
    assert.equal(stored.fullName, "Nome Original", "nome existente não é sobrescrito")
  })

  it("cadastro com telefone de ADMIN não rebaixa a conta nem revela que ela existe", async () => {
    const admin = await prisma.user.create({
      data: {
        phone: "+5571988881234",
        fullName: "Erick",
        role: "ADMIN",
        status: "ACTIVE",
        passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$abc$def",
      },
    })

    const response = await registerContact({ fullName: "Impostor" })
    assert.equal(response.status, 201)
    assert.doesNotMatch(JSON.stringify(response.body), /Erick|ADMIN/)

    const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
    assert.equal(after.role, "ADMIN")
    assert.equal(after.status, "ACTIVE")
    assert.equal(after.fullName, "Erick")
    assert.equal(after.passwordHash, admin.passwordHash, "credencial intacta")
  })

  it("handle adulterado, de outro segredo ou vencido é recusado", async () => {
    const service = await makeService()
    const registered = await registerContact()
    const handle: string = registered.body.data.contactHandle
    const [prefix, userId, expiry, signature] = handle.split(".")

    const body = (contactHandle: string) => ({
      contactHandle,
      serviceId: service.id,
      date: nextTuesday(),
      startsAt: "09:00",
    })

    for (const forged of [
      "lixo",
      handle.slice(0, -1),
      `${prefix}.${userId}.${expiry}.${"a".repeat(signature!.length)}`,
      // Prazo estendido na mão: a assinatura deixa de bater.
      `${prefix}.${userId}.${Number(expiry) + 60_000}.${signature}`,
      // Outro contato, com a assinatura deste.
      `${prefix}.${randomBytes(16).toString("hex")}.${expiry}.${signature}`,
      // Já vencido.
      `${prefix}.${userId}.1.${signature}`,
    ]) {
      const response = await call("/booking/requests", { body: body(forged) })
      assert.equal(response.status, 400, forged.slice(0, 24))
      assert.doesNotMatch(response.body.error.message, /assinatura|token|handle/i)
    }
    assert.equal(await prisma.appointment.count(), 0)

    // O handle legítimo continua funcionando.
    assert.equal((await call("/booking/requests", { body: body(handle) })).status, 201)
  })

  it("o handle não autentica nada: nenhuma rota protegida o aceita", async () => {
    const registered = await registerContact()
    const handle = registered.body.data.contactHandle

    for (const path of ["/auth/me", "/users/me", "/admin/users", "/booking/appointments/me"]) {
      assert.equal((await call(path, { access: handle })).status, 401, path)
    }
    assert.equal(await prisma.refreshToken.count(), 0, "nenhuma sessão foi criada")
  })

  it("fluxo completo: cadastro, serviço, data, horário e solicitação PENDING", async () => {
    const service = await makeService()
    const date = nextTuesday()

    const registered = await registerContact({ fullName: "Guilherme Santana" })
    assert.equal(registered.status, 201)

    // Com o contato pronto, catálogo e disponibilidade são consultáveis.
    assert.equal((await call("/booking/services")).status, 200)
    const slots = await call(`/booking/availability?date=${date}&serviceId=${service.id}`)
    assert.equal(slots.status, 200)
    const chosen = slots.body.data.slots[0].startsAtClock

    const created = await call("/booking/requests", {
      body: {
        contactHandle: registered.body.data.contactHandle,
        serviceId: service.id,
        date,
        startsAt: chosen,
      },
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.appointment.status, "PENDING")
    assert.equal(created.body.data.awaitingApproval, true)

    // O horário sai da disponibilidade imediatamente.
    const after = await call(`/booking/availability?date=${date}&serviceId=${service.id}`)
    assert.equal(after.body.data.slots.some((slot: { startsAtClock: string }) => slot.startsAtClock === chosen), false)

    // E em nenhum momento houve sessão de cliente.
    assert.equal(await prisma.refreshToken.count(), 0)
  })
  // -------------------------------------------------------------------------
  // Regressão: "Dados inválidos." em produção
  //
  // Frontend e backend sobem separadamente (docs/deployment.md). Quando só o
  // backend sobe, o navegador segue rodando o pacote anterior, que manda nome e
  // telefone no envio final em vez do handle. O strictObject recusava os dois
  // campos e ainda cobrava o handle ausente — 400 "Dados inválidos.", exatamente
  // no último clique do fluxo.
  // -------------------------------------------------------------------------

  it("corpo do frontend anterior (nome + telefone) cria a solicitação, sem 'Dados inválidos.'", async () => {
    const service = await makeService()
    const date = nextTuesday()

    // Byte por byte o corpo que o pacote de eefe0ee envia.
    const response = await call("/booking/requests", {
      body: {
        phone: "(71) 98888-1234",
        fullName: "Guilherme Santana",
        serviceId: service.id,
        date,
        startsAt: "09:00",
      },
    })

    assert.equal(response.status, 201)
    assert.notEqual(response.body.error?.message, "Dados inválidos.")
    assert.equal(response.body.data.appointment.status, "PENDING")
    assert.equal(response.body.data.awaitingApproval, true)
    assert.match(response.body.data.publicToken, /^[A-Za-z0-9_-]{43}$/)

    // Passou pelo MESMO caminho: contato gravado, sem senha e sem sessão.
    const contact = await prisma.user.findUniqueOrThrow({ where: { phone: "+5571988881234" } })
    assert.equal(contact.passwordHash, null)
    assert.equal(contact.role, "CUSTOMER")
    assert.equal(await prisma.refreshToken.count(), 0)

    // O handle emitido internamente foi consumido: não sobra capacidade viva.
    const handles = await prisma.publicContactHandle.findMany()
    assert.equal(handles.length, 1)
    assert.notEqual(handles[0]!.consumedAt, null)
  })

  it("a forma anterior preserva as mesmas garantias: nome, ADMIN e preço do banco", async () => {
    const service = await makeService()
    const admin = await prisma.user.create({
      data: {
        phone: "+5571988881234",
        fullName: "Erick",
        role: "ADMIN",
        status: "ACTIVE",
        passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$abc$def",
      },
    })

    const response = await call("/booking/requests", {
      body: {
        phone: "(71) 98888-1234",
        fullName: "Impostor",
        serviceId: service.id,
        date: nextTuesday(),
        startsAt: "09:00",
        // Preço e duração continuam sendo do servidor.
        servicePriceCents: 1,
      },
    })
    // Campo extra segue recusado: a compatibilidade não afrouxa o strictObject.
    assert.equal(response.status, 400)

    const accepted = await call("/booking/requests", {
      body: {
        phone: "(71) 98888-1234",
        fullName: "Impostor",
        serviceId: service.id,
        date: nextTuesday(),
        startsAt: "09:00",
      },
    })
    assert.equal(accepted.status, 201)
    assert.equal(accepted.body.data.appointment.servicePriceCents, 3500)

    const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
    assert.equal(after.role, "ADMIN")
    assert.equal(after.status, "ACTIVE")
    assert.equal(after.fullName, "Erick", "nome existente não é sobrescrito")
    assert.equal(after.passwordHash, admin.passwordHash)
  })

  it("as duas formas juntas, ou nenhuma, são recusadas", async () => {
    const service = await makeService()
    const registered = await registerContact()
    const selection = { serviceId: service.id, date: nextTuesday(), startsAt: "09:00" }

    for (const contact of [
      // Handle e telefone ao mesmo tempo: ambiguidade não é aceita.
      { contactHandle: registered.body.data.contactHandle, phone: "(71) 98888-1234", fullName: "Cliente" },
      // Nenhuma identificação.
      {},
      // Forma anterior incompleta.
      { phone: "(71) 98888-1234" },
      { fullName: "Cliente" },
    ]) {
      const response = await call("/booking/requests", { body: { ...contact, ...selection } })
      assert.equal(response.status, 400, JSON.stringify(contact))
    }
    assert.equal(await prisma.appointment.count(), 0)
  })

  // -------------------------------------------------------------------------
  // Regressão: confirmação pelo WhatsApp SEM pagamento configurado
  //
  // Esta é a configuração de produção — pagamento é opcional e o padrão é estar
  // desligado. A referência pública nascia apenas no caminho de pagamento, então
  // um agendamento confirmado aqui ficava sem referência e o link do WhatsApp
  // nunca aparecia: exatamente o caso comum sem a funcionalidade.
  // -------------------------------------------------------------------------

  it("sem pagamento, aprovar confirma direto e libera a confirmação pelo WhatsApp", async () => {
    const service = await makeService()
    const admin = await prisma.user.create({
      data: { phone: phone(), fullName: "Erick", role: "ADMIN", status: "ACTIVE" },
    })
    const session = await tokens.issueSession(admin.id)

    const registered = await registerContact({ fullName: "Guilherme Santana" })
    const created = await call("/booking/requests", {
      body: {
        contactHandle: registered.body.data.contactHandle,
        serviceId: service.id,
        date: nextTuesday(),
        startsAt: "09:00",
      },
    })
    assert.equal(created.status, 201)
    const appointmentId = created.body.data.appointment.id
    const publicToken = created.body.data.publicToken

    // Aguardando o barbeiro: nada de WhatsApp ainda.
    const pending = await call(`/booking/requests/${publicToken}`)
    assert.equal(pending.body.data.appointment.status, "PENDING")
    assert.equal(pending.body.data.whatsappUrl, null)
    assert.equal(pending.body.data.payment, null, "sem provedor, sem cobrança")

    const decided = await call(`/admin/requests/${appointmentId}/decide`, {
      access: session.accessToken,
      body: { decision: "CONFIRMED" },
    })
    assert.equal(decided.status, 200)
    // Sem provedor configurado, aprovar confirma DIRETO — comportamento anterior.
    assert.equal(decided.body.data.appointment.status, "CONFIRMED")
    assert.equal(await prisma.payment.count(), 0)

    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.appointment.status, "CONFIRMED")
    assert.equal(view.body.data.payment, null)
    assert.match(view.body.data.reference, /^EC-[23456789ABCDEFGHJKLMNPQRTUVWXYZ]{6}$/)

    const url: string = view.body.data.whatsappUrl
    assert.ok(url, "confirmado com número configurado precisa oferecer o WhatsApp")
    assert.ok(url.startsWith("https://wa.me/5571999990000?text="), url.slice(0, 48))

    const message = decodeURIComponent(url.split("?text=")[1]!)
    assert.match(message, /confirmado/i)
    assert.ok(message.includes(view.body.data.reference))
    assert.ok(message.includes("Corte"))
    assert.ok(message.includes("09:00"))
    // Sem cobrança, a mensagem não fala de pagamento.
    assert.ok(!message.includes("Pagamento"), "sem cobrança, sem linha de pagamento")
    // E nenhum segredo circula.
    assert.ok(!message.includes(publicToken))
    assert.ok(!message.includes(appointmentId))
    assert.doesNotMatch(message, /v2\.|eyJ|Bearer|secret/i)
  })

  it("sem pagamento, recusar não cria referência nem WhatsApp", async () => {
    const service = await makeService()
    const admin = await prisma.user.create({
      data: { phone: phone(), fullName: "Erick", role: "ADMIN", status: "ACTIVE" },
    })
    const session = await tokens.issueSession(admin.id)
    const registered = await registerContact()
    const created = await call("/booking/requests", {
      body: {
        contactHandle: registered.body.data.contactHandle,
        serviceId: service.id,
        date: nextTuesday(),
        startsAt: "09:00",
      },
    })
    const rejected = await call(`/admin/requests/${created.body.data.appointment.id}/decide`, {
      access: session.accessToken,
      body: { decision: "REJECTED" },
    })
    assert.equal(rejected.status, 200)

    const view = await call(`/booking/requests/${created.body.data.publicToken}`)
    assert.equal(view.body.data.appointment.status, "REJECTED")
    assert.equal(view.body.data.reference, null, "recusado não recebe referência")
    assert.equal(view.body.data.whatsappUrl, null)
  })
})
