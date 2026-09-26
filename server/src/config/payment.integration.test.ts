import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { createHmac, randomBytes, randomUUID } from "node:crypto"
import type { Server } from "node:http"

/**
 * Confirmação mediante pagamento, contra PostgreSQL real.
 *
 * Nenhum teste aqui movimenta dinheiro: o provedor é o adaptador "manual", que
 * não fala com serviço nenhum. O que ele faz de verdade é validar a assinatura
 * HMAC sobre os bytes do corpo — então o caminho de validação exercitado aqui é
 * o mesmo que um provedor real usaria.
 */

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

const WEBHOOK_SECRET = randomBytes(32).toString("hex")
const SHOP_WHATSAPP = "+5571999990000"

Object.assign(process.env, {
  DATABASE_URL: database ?? "postgresql://unused@127.0.0.1:1/erickcorttes_test",
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
  FRONTEND_URL: "http://localhost:8443",
  TRUST_PROXY_HOPS: "0",
  PAYMENT_PROVIDER: "manual",
  PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET,
  BARBERSHOP_WHATSAPP_NUMBER: SHOP_WHATSAPP,
})

let prisma: typeof import("./prisma.js").prisma
let tokens: typeof import("../modules/auth/token.service.js")
let rules: typeof import("../modules/booking/booking.rules.js").BookingRules
let limits: typeof import("../middlewares/rate-limit.js")
let server: Server
let base: string

let phoneCounter = 0
const phone = () => "+55719" + String(30000000 + phoneCounter++)

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
  opts: {
    method?: string
    body?: unknown
    access?: string
    headers?: Record<string, string>
    rawBody?: string
  } = {},
) {
  const response = await fetch(base + path, {
    method: opts.method ?? (opts.body === undefined && opts.rawBody === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:8443",
      "X-CSRF-Protection": "1",
      ...opts.headers,
      ...(opts.access ? { Authorization: "Bearer " + opts.access } : {}),
    },
    ...(opts.rawBody !== undefined
      ? { body: opts.rawBody }
      : opts.body === undefined
        ? {}
        : { body: JSON.stringify(opts.body) }),
  })
  return { status: response.status, body: (await response.json()) as any }
}

/** Notificação assinada como o provedor assinaria: HMAC sobre os bytes. */
async function notify(payload: Record<string, unknown>, options: { secret?: string } = {}) {
  const rawBody = JSON.stringify(payload)
  const signature = createHmac("sha256", options.secret ?? WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex")
  return call("/booking/payments/webhook", {
    rawBody,
    headers: { "x-payment-signature": signature },
  })
}

async function makeService(durationMinutes = 30, priceCents = 3500) {
  return prisma.service.create({
    data: { name: "Corte", description: "Corte masculino", priceCents, durationMinutes, active: true },
  })
}

async function makeAdmin() {
  const admin = await prisma.user.create({
    data: { phone: phone(), fullName: "Erick Corttes", role: "ADMIN", status: "ACTIVE" },
  })
  const session = await tokens.issueSession(admin.id)
  return { admin, access: session.accessToken }
}

/** Cadastro + solicitação pública. Devolve o token de acompanhamento. */
async function requestBooking(
  overrides: { startsAt?: string; serviceId?: string; fullName?: string } = {},
) {
  const registered = await call("/booking/contacts", {
    body: { fullName: overrides.fullName ?? "Guilherme Santana", phone: phone() },
  })
  assert.equal(registered.status, 201, "cadastro: " + registered.status)
  const created = await call("/booking/requests", {
    body: {
      contactHandle: registered.body.data.contactHandle,
      serviceId: overrides.serviceId,
      date: nextTuesday(),
      startsAt: overrides.startsAt ?? "09:00",
    },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  return {
    appointmentId: created.body.data.appointment.id as string,
    publicToken: created.body.data.publicToken as string,
  }
}

async function approve(access: string, appointmentId: string) {
  return call(`/admin/requests/${appointmentId}/decide`, {
    access,
    body: { decision: "CONFIRMED" },
  })
}

async function cleanup() {
  await prisma.paymentWebhookEvent.deleteMany()
  await prisma.payment.deleteMany()
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

describe("Confirmação mediante pagamento — PostgreSQL real", { skip: !enabled }, () => {
  before(async () => {
    ;({ prisma } = await import("./prisma.js"))
    tokens = await import("../modules/auth/token.service.js")
    ;({ BookingRules: rules } = await import("../modules/booking/booking.rules.js"))
    limits = await import("../middlewares/rate-limit.js")
    const { createApp } = await import("../app.js")
    server = createApp().listen(0, "127.0.0.1")
    await new Promise(resolve => server.once("listening", resolve))
    const address = server.address()
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
  })

  after(async () => {
    await cleanup()
    await new Promise(resolve => server.close(resolve))
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await cleanup()
    for (const limiter of [
      // O limite GLOBAL (120/min por IP) também entra: a suíte inteira sai do
      // mesmo IP e, somada, passava do teto — os últimos testes recebiam 429
      // por causa dos anteriores, não por defeito do produto.
      limits.globalRateLimit,
      limits.publicBookingRateLimit,
      limits.publicContactRateLimit,
      limits.publicRequestLookupRateLimit,
      limits.paymentWebhookRateLimit,
    ]) {
      limiter.resetKey("127.0.0.1")
    }
    for (let weekday = 0; weekday < 7; weekday++) {
      await prisma.businessHours.create({
        data: { weekday, closed: false, openMinute: 9 * 60, closeMinute: 19 * 60 },
      })
    }
  })

  // -------------------------------------------------------------------------
  // Ordem do fluxo: cobrar só depois da aprovação
  // -------------------------------------------------------------------------

  it("solicitação nasce PENDING e NÃO gera cobrança antes da aprovação", async () => {
    const service = await makeService()
    const { publicToken } = await requestBooking({ serviceId: service.id })

    assert.equal(await prisma.payment.count(), 0, "não cobra quem ainda pode ser recusado")

    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.appointment.status, "PENDING")
    assert.equal(view.body.data.payment, null)
    assert.equal(view.body.data.whatsappUrl, null, "nada de WhatsApp antes de confirmar")
  })

  it("aprovar leva a AWAITING_PAYMENT, cria a cobrança e mantém o horário reservado", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await requestBooking({ serviceId: service.id })

    const decided = await approve(access, appointmentId)
    assert.equal(decided.status, 200, JSON.stringify(decided.body))
    assert.equal(decided.body.data.appointment.status, "AWAITING_PAYMENT")

    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.equal(appointment.status, "AWAITING_PAYMENT")
    assert.match(appointment.publicReference!, /^EC-[23456789ABCDEFGHJKLMNPQRTUVWXYZ]{6}$/)
    // A janela de pagamento passa a ser o prazo da reserva.
    const windowMs = rules.paymentWindowMinutes * 60_000
    const remaining = appointment.pendingExpiresAt!.getTime() - Date.now()
    assert.ok(remaining > windowMs - 60_000 && remaining <= windowMs, `janela: ${remaining}ms`)

    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(payment.status, "PENDING")
    assert.equal(payment.amountCents, 3500, "valor do catálogo, não do navegador")
    assert.equal(payment.currency, "BRL")
    assert.equal(payment.mode, "FULL")
    assert.equal(payment.provider, "manual")

    // O horário continua fora da disponibilidade durante o pagamento.
    const availability = await call(
      `/booking/availability?date=${nextTuesday()}&serviceId=${service.id}`,
    )
    assert.equal(
      availability.body.data.slots.some((slot: any) => slot.startsAtClock === "09:00"),
      false,
      "reserva segue protegida na janela de pagamento",
    )

    // O cliente vê a cobrança e ainda NÃO vê confirmação.
    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.appointment.status, "AWAITING_PAYMENT")
    assert.equal(view.body.data.payment.status, "PENDING")
    assert.equal(view.body.data.payment.amountFormatted, "35,00")
    assert.ok(view.body.data.payment.expiresInSeconds > 0)
    assert.equal(view.body.data.whatsappUrl, null)
  })

  it("recusar não cria cobrança e libera o horário", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })

    const decided = await call(`/admin/requests/${appointmentId}/decide`, {
      access,
      body: { decision: "REJECTED" },
    })
    assert.equal(decided.status, 200)
    assert.equal(await prisma.payment.count(), 0)

    const availability = await call(
      `/booking/availability?date=${nextTuesday()}&serviceId=${service.id}`,
    )
    assert.equal(
      availability.body.data.slots.some((slot: any) => slot.startsAtClock === "09:00"),
      true,
    )
  })

  // -------------------------------------------------------------------------
  // Webhook: a única porta de confirmação
  // -------------------------------------------------------------------------

  it("notificação PAID válida confirma o agendamento", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })

    const response = await notify({
      eventId: randomUUID(),
      providerPaymentId: payment.providerPaymentId,
      status: "PAID",
      amountCents: payment.amountCents,
      currency: "BRL",
      reference: appointment.publicReference,
    })
    assert.equal(response.status, 200)
    assert.equal(response.body.data.outcome, "CONFIRMED")

    const paid = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(paid.status, "PAID")
    assert.notEqual(paid.paidAt, null)

    const confirmed = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.equal(confirmed.status, "CONFIRMED")
    assert.equal(confirmed.pendingExpiresAt, null, "confirmado não depende mais de prazo")

    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.appointment.status, "CONFIRMED")
    assert.equal(view.body.data.payment.status, "PAID")
  })

  it("notificação sem assinatura, com assinatura errada ou de outro segredo é recusada", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    const payload = {
      eventId: randomUUID(),
      providerPaymentId: payment.providerPaymentId,
      status: "PAID",
      amountCents: payment.amountCents,
      currency: "BRL",
      reference: appointment.publicReference,
    }

    // Sem cabeçalho de assinatura.
    const bare = await call("/booking/payments/webhook", { rawBody: JSON.stringify(payload) })
    assert.equal(bare.status, 400)

    // Assinatura inventada.
    const forged = await call("/booking/payments/webhook", {
      rawBody: JSON.stringify(payload),
      headers: { "x-payment-signature": "a".repeat(64) },
    })
    assert.equal(forged.status, 400)

    // Assinada com outro segredo.
    const wrongKey = await notify(payload, { secret: randomBytes(32).toString("hex") })
    assert.equal(wrongKey.status, 400)

    // Assinatura legítima de OUTRO corpo: adulterar o valor invalida.
    const rawBody = JSON.stringify(payload)
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex")
    const tampered = await call("/booking/payments/webhook", {
      rawBody: JSON.stringify({ ...payload, amountCents: 1 }),
      headers: { "x-payment-signature": signature },
    })
    assert.equal(tampered.status, 400)

    // Nada foi confirmado, e nenhuma notificação foi registrada.
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "AWAITING_PAYMENT",
    )
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status, "PENDING")
    assert.equal(await prisma.paymentWebhookEvent.count(), 0)
  })

  it("a mesma notificação reenviada confirma uma vez só", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    const payload = {
      eventId: randomUUID(),
      providerPaymentId: payment.providerPaymentId,
      status: "PAID",
      amountCents: payment.amountCents,
      currency: "BRL",
      reference: appointment.publicReference,
    }

    const outcomes: string[] = []
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await notify(payload)
      assert.equal(response.status, 200)
      outcomes.push(response.body.data.outcome)
    }

    assert.equal(outcomes[0], "CONFIRMED")
    assert.deepEqual(outcomes.slice(1), ["DUPLICATE", "DUPLICATE", "DUPLICATE", "DUPLICATE"])
    // Uma linha de evento, uma confirmação, um pagamento.
    assert.equal(await prisma.paymentWebhookEvent.count(), 1)
    assert.equal(await prisma.payment.count(), 1)
    const paid = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(paid.status, "PAID")
  })

  it("reenvios SIMULTÂNEOS da mesma notificação confirmam uma vez só", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    const payload = {
      eventId: randomUUID(),
      providerPaymentId: payment.providerPaymentId,
      status: "PAID",
      amountCents: payment.amountCents,
      currency: "BRL",
      reference: appointment.publicReference,
    }

    const responses = await Promise.all(Array.from({ length: 8 }, () => notify(payload)))
    for (const response of responses) assert.equal(response.status, 200)
    const confirmed = responses.filter(r => r.body.data.outcome === "CONFIRMED")
    assert.equal(confirmed.length, 1, "exatamente uma confirmação")
    assert.equal(await prisma.paymentWebhookEvent.count(), 1)
  })

  it("valor divergente NUNCA confirma", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })

    for (const amountCents of [1, payment.amountCents - 1, payment.amountCents + 1, 0, -3500]) {
      const response = await notify({
        eventId: randomUUID(),
        providerPaymentId: payment.providerPaymentId,
        status: "PAID",
        amountCents,
        currency: "BRL",
        reference: appointment.publicReference,
      })
      assert.equal(response.status, 200)
      assert.equal(response.body.data.outcome, "AMOUNT_MISMATCH", `valor ${amountCents}`)
    }

    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status, "PENDING")
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "AWAITING_PAYMENT",
    )
  })

  it("referência ou moeda divergente NUNCA confirma", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })

    const referenceMismatch = await notify({
      eventId: randomUUID(),
      providerPaymentId: payment.providerPaymentId,
      status: "PAID",
      amountCents: payment.amountCents,
      currency: "BRL",
      reference: "EC-XXXXXX",
    })
    assert.equal(referenceMismatch.body.data.outcome, "REFERENCE_MISMATCH")

    const currencyMismatch = await notify({
      eventId: randomUUID(),
      providerPaymentId: payment.providerPaymentId,
      status: "PAID",
      amountCents: payment.amountCents,
      currency: "USD",
      reference: appointment.publicReference,
    })
    assert.equal(currencyMismatch.body.data.outcome, "CURRENCY_MISMATCH")

    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "AWAITING_PAYMENT",
    )
  })

  it("notificação de cobrança desconhecida não cria nada", async () => {
    const response = await notify({
      eventId: randomUUID(),
      providerPaymentId: "manual-inexistente",
      status: "PAID",
      amountCents: 3500,
      currency: "BRL",
      reference: "EC-ABCDEF",
    })
    assert.equal(response.status, 200)
    assert.equal(response.body.data.outcome, "PAYMENT_NOT_FOUND")
    assert.equal(await prisma.payment.count(), 0)
    assert.equal(await prisma.appointment.count(), 0)
  })

  it("pagamento recusado mantém a reserva na janela, sem confirmar", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })

    const response = await notify({
      eventId: randomUUID(),
      providerPaymentId: payment.providerPaymentId,
      status: "FAILED",
      amountCents: payment.amountCents,
      currency: "BRL",
      reference: appointment.publicReference,
    })
    assert.equal(response.body.data.outcome, "FAILED")

    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status, "FAILED")
    // A reserva NÃO é confirmada e NÃO é destruída: dentro do prazo a pessoa
    // ainda pode pagar de novo.
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "AWAITING_PAYMENT",
    )
    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.payment.status, "FAILED")
    assert.equal(view.body.data.whatsappUrl, null)
  })

  it("notificação PENDING que chega depois de PAID não rebaixa a confirmação", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    const common = {
      providerPaymentId: payment.providerPaymentId,
      amountCents: payment.amountCents,
      currency: "BRL",
      reference: appointment.publicReference,
    }

    assert.equal(
      (await notify({ eventId: randomUUID(), status: "PAID", ...common })).body.data.outcome,
      "CONFIRMED",
    )
    // Fora de ordem: uma notificação antiga chegando atrasada.
    for (const status of ["PENDING", "FAILED", "EXPIRED", "CANCELED"]) {
      const late = await notify({ eventId: randomUUID(), status, ...common })
      assert.equal(late.body.data.outcome, "DUPLICATE", status)
    }

    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status, "PAID")
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "CONFIRMED",
    )
  })

  it("pagamento após a expiração da janela não ressuscita a reserva", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })

    // A janela vence. Mexer no relógio do banco é o único jeito honesto de
    // testar isto sem esperar quinze minutos.
    const past = new Date(Date.now() - 60_000)
    await prisma.payment.update({ where: { id: payment.id }, data: { expiresAt: past } })
    await prisma.appointment.update({ where: { id: appointmentId }, data: { pendingExpiresAt: past } })

    const response = await notify({
      eventId: randomUUID(),
      providerPaymentId: payment.providerPaymentId,
      status: "PAID",
      amountCents: payment.amountCents,
      currency: "BRL",
      reference: appointment.publicReference,
    })
    assert.equal(response.status, 200)
    assert.equal(response.body.data.outcome, "WINDOW_CLOSED")

    // O agendamento NÃO é confirmado.
    assert.notEqual(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "CONFIRMED",
    )
    // E o cliente vê expirado, não confirmado.
    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.appointment.status, "EXPIRED")
    assert.equal(view.body.data.whatsappUrl, null)
  })

  it("janela vencida libera o horário para outra pessoa", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)

    const past = new Date(Date.now() - 60_000)
    await prisma.appointment.update({ where: { id: appointmentId }, data: { pendingExpiresAt: past } })

    const availability = await call(
      `/booking/availability?date=${nextTuesday()}&serviceId=${service.id}`,
    )
    assert.equal(
      availability.body.data.slots.some((slot: any) => slot.startsAtClock === "09:00"),
      true,
      "prazo vencido devolve o horário",
    )

    // E outra pessoa consegue reservar de fato: a EXCLUDE não recusa.
    limits.publicBookingRateLimit.resetKey("127.0.0.1")
    limits.publicContactRateLimit.resetKey("127.0.0.1")
    const other = await requestBooking({ serviceId: service.id })
    assert.ok(other.appointmentId)
    // A reserva abandonada foi expirada, e sua cobrança também.
    const abandoned = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.equal(abandoned.status, "EXPIRED")
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status, "EXPIRED")
  })

  it("admin recusando enquanto o pagamento está pendente não é permitido duas vezes", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })

    assert.equal((await approve(access, appointmentId)).status, 200)
    // Já decidida: uma segunda decisão é recusada, e nenhuma segunda cobrança
    // é criada.
    const again = await call(`/admin/requests/${appointmentId}/decide`, {
      access,
      body: { decision: "REJECTED" },
    })
    assert.equal(again.status, 409)
    assert.equal(await prisma.payment.count(), 1)
  })

  it("duas aprovações simultâneas criam uma cobrança só", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })

    const results = await Promise.all([
      approve(access, appointmentId),
      approve(access, appointmentId),
    ])
    const ok = results.filter(r => r.status === 200)
    assert.equal(ok.length, 1, "uma aprovação vence")
    assert.equal(await prisma.payment.count(), 1)
  })

  // -------------------------------------------------------------------------
  // WhatsApp
  // -------------------------------------------------------------------------

  it("link do WhatsApp só existe com o agendamento confirmado, e aponta para a barbearia", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await requestBooking({
      serviceId: service.id,
      fullName: "Guilherme Santana",
    })

    // PENDING: sem link.
    assert.equal((await call(`/booking/requests/${publicToken}`)).body.data.whatsappUrl, null)

    // AWAITING_PAYMENT: ainda sem link.
    await approve(access, appointmentId)
    assert.equal((await call(`/booking/requests/${publicToken}`)).body.data.whatsappUrl, null)

    // PAGO: agora sim.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    await notify({
      eventId: randomUUID(),
      providerPaymentId: payment.providerPaymentId,
      status: "PAID",
      amountCents: payment.amountCents,
      currency: "BRL",
      reference: appointment.publicReference,
    })

    const view = await call(`/booking/requests/${publicToken}`)
    const url: string = view.body.data.whatsappUrl
    assert.ok(url, "link disponível após o pagamento")

    // Destino: o número da barbearia, nunca o do cliente.
    assert.ok(url.startsWith(`https://wa.me/${SHOP_WHATSAPP.slice(1)}?text=`), url.slice(0, 60))

    const message = decodeURIComponent(url.split("?text=")[1]!)
    assert.match(message, /confirmado/i)
    assert.ok(message.includes("Corte"), "serviço na mensagem")
    assert.ok(message.includes("09:00"), "horário na mensagem")
    assert.ok(message.includes(appointment.publicReference!), "referência pública na mensagem")
    assert.ok(message.includes("35,00"), "valor pago na mensagem")
    assert.ok(message.includes("Guilherme"), "primeiro nome na mensagem")

    // E NADA de segredo na mensagem.
    assert.ok(!message.includes(publicToken), "publicToken não circula por WhatsApp")
    assert.ok(!message.includes(appointmentId), "id interno do agendamento fora")
    assert.ok(!message.includes(payment.id), "id interno do pagamento fora")
    assert.ok(!message.includes(payment.providerPaymentId!), "id do provedor fora")
    assert.ok(!message.includes(appointment.userId), "id interno do cliente fora")
    assert.doesNotMatch(message, /eyJ|Bearer|v2\.|secret|token/i)

    // O estado da reserva não depende de o WhatsApp abrir: consultar de novo
    // devolve exatamente a mesma coisa.
    const again = await call(`/booking/requests/${publicToken}`)
    assert.equal(again.body.data.appointment.status, "CONFIRMED")
    assert.equal(again.body.data.payment.status, "PAID")
    assert.equal(again.body.data.whatsappUrl, url)
  })

  // -------------------------------------------------------------------------
  // Segurança
  // -------------------------------------------------------------------------

  it("a rota de webhook não aceita campos fora do contrato nem corpo inválido", async () => {
    for (const rawBody of ["", "não é json", "{}", '{"eventId":"x"}', "[]", "null"]) {
      const signature = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex")
      const response = await call("/booking/payments/webhook", {
        rawBody,
        headers: { "x-payment-signature": signature },
      })
      assert.equal(response.status, 400, JSON.stringify(rawBody))
    }
    assert.equal(await prisma.paymentWebhookEvent.count(), 0)
  })

  it("a resposta do webhook não devolve dado de ninguém", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })

    const response = await notify({
      eventId: randomUUID(),
      providerPaymentId: payment.providerPaymentId,
      status: "PAID",
      amountCents: payment.amountCents,
      currency: "BRL",
      reference: appointment.publicReference,
    })
    assert.deepEqual(Object.keys(response.body.data).sort(), ["outcome", "received"])
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /\+55|passwordHash|publicToken|userId|Guilherme/,
    )
  })

  it("o cliente não pode confirmar o próprio pagamento por rota nenhuma", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)

    // Não existe rota pública que aceite "pago". As tentativas plausíveis
    // precisam falhar — e nenhuma pode confirmar.
    for (const [path, body] of [
      [`/booking/requests/${publicToken}/pay`, { status: "PAID" }],
      [`/booking/requests/${publicToken}/confirm`, {}],
      [`/booking/payments/${appointmentId}/paid`, {}],
    ] as Array<[string, unknown]>) {
      const response = await call(path, { body })
      assert.ok(response.status === 404 || response.status >= 400, `${path} -> ${response.status}`)
    }
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "AWAITING_PAYMENT",
    )
  })

  it("a política pública informa que a confirmação exige pagamento", async () => {
    const policy = await call("/booking/policy")
    assert.equal(policy.status, 200)
    assert.equal(policy.body.data.paymentRequired, true)
    assert.equal(policy.body.data.paymentWindowMinutes, rules.paymentWindowMinutes)
    // A política não vaza configuração de provedor nem segredo.
    assert.doesNotMatch(JSON.stringify(policy.body), /manual|secret|WEBHOOK/i)
  })

  it("consultar a solicitação exige o token, e um token errado não revela nada", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)

    const wrong = await call(`/booking/requests/${randomBytes(32).toString("base64url")}`)
    assert.equal(wrong.status, 404)
    assert.doesNotMatch(JSON.stringify(wrong.body), /Corte|\+55|EC-/)
  })

  // -------------------------------------------------------------------------
  // Regressões encontradas na auditoria independente
  // -------------------------------------------------------------------------

  it("a barbearia pode CANCELAR um agendamento que aguarda pagamento", async () => {
    // Antes: `updateAppointmentStatus` só aceitava partir de CONFIRMED. Com
    // pagamento ligado, aprovar leva a AWAITING_PAYMENT — e a barbearia perdia
    // a capacidade de cancelar um agendamento aprovado, que sempre teve. Ficava
    // presa até a janela vencer, e um pagamento podia confirmar no meio disso.
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })

    const cancelled = await call(`/admin/appointments/${appointmentId}/status`, {
      access,
      method: "PATCH",
      body: { status: "CANCELLED" },
    })
    assert.equal(cancelled.status, 200)

    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.equal(after.status, "CANCELLED")
    assert.notEqual(after.cancelledAt, null)
    assert.equal(after.pendingExpiresAt, null, "a reserva deixa de ter prazo")
    // A cobrança morre com a reserva: nada de cobrança pagável órfã.
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status, "CANCELED")

    // O horário volta a ser oferecido.
    const availability = await call(`/booking/availability?date=${nextTuesday()}&serviceId=${service.id}`)
    assert.equal(availability.body.data.slots.some((slot: any) => slot.startsAtClock === "09:00"), true)

    // E um PAID atrasado não ressuscita o cancelado.
    const late = await notify({
      eventId: randomUUID(),
      providerPaymentId: payment.providerPaymentId,
      status: "PAID",
      amountCents: payment.amountCents,
      currency: "BRL",
      reference: appointment.publicReference,
    })
    assert.equal(late.status, 200)
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "CANCELLED",
    )
    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.whatsappUrl, null, "cancelado não oferece WhatsApp")
  })

  it("concluir ou marcar falta continua exigindo CONFIRMED", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)

    for (const status of ["COMPLETED", "NO_SHOW"]) {
      const response = await call(`/admin/appointments/${appointmentId}/status`, {
        access,
        method: "PATCH",
        body: { status },
      })
      assert.equal(response.status, 409, status)
    }
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "AWAITING_PAYMENT",
    )
  })

  it("cancelamento e webhook simultâneos resolvem num único estado", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })

    const [cancelled, hook] = await Promise.all([
      call(`/admin/appointments/${appointmentId}/status`, {
        access,
        method: "PATCH",
        body: { status: "CANCELLED" },
      }),
      notify({
        eventId: randomUUID(),
        providerPaymentId: payment.providerPaymentId,
        status: "PAID",
        amountCents: payment.amountCents,
        currency: "BRL",
        reference: appointment.publicReference,
      }),
    ])

    assert.ok(cancelled.status < 500, `cancelamento ${cancelled.status}`)
    assert.ok(hook.status < 500, `webhook ${hook.status}`)
    const final = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    // Um dos dois vence; nunca os dois. O lock da linha decide.
    assert.ok(["CANCELLED", "CONFIRMED"].includes(final.status), final.status)
    const live = await prisma.appointment.count({
      where: { status: { in: ["PENDING", "AWAITING_PAYMENT", "CONFIRMED"] } },
    })
    assert.ok(live <= 1, `${live} reservas vivas`)
  })

  it("serviço de preço zero é aprovado sem cobrança, mesmo com pagamento ligado", async () => {
    // Antes: abrir cobrança de zero violava o CHECK `amount_cents > 0`, a
    // aprovação devolvia 500 e o pedido ficava preso em PENDING para sempre.
    const free = await prisma.service.create({
      data: { name: "Retoque cortesia", description: "", priceCents: 0, durationMinutes: 30, active: true },
    })
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await requestBooking({ serviceId: free.id })

    const decided = await approve(access, appointmentId)
    assert.equal(decided.status, 200, JSON.stringify(decided.body))
    assert.equal(decided.body.data.appointment.status, "CONFIRMED", "sem valor, confirma direto")
    assert.equal(await prisma.payment.count(), 0, "nenhuma cobrança de zero")

    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.appointment.status, "CONFIRMED")
    assert.equal(view.body.data.payment, null)
    // Confirmado tem referência e, com número configurado, link do WhatsApp.
    assert.match(view.body.data.reference, /^EC-/)
    assert.ok(view.body.data.whatsappUrl)
  })

  it("a referência pública é reservada em toda aprovação e reaproveitada", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await requestBooking({ serviceId: service.id })
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).publicReference,
      null,
      "PENDING nasce sem referência",
    )

    // Duas aprovações simultâneas: uma vence, uma cobrança, uma referência.
    const results = await Promise.all([approve(access, appointmentId), approve(access, appointmentId)])
    assert.equal(results.filter(r => r.status === 200).length, 1)
    assert.equal(await prisma.payment.count(), 1, "nunca duas cobranças")
    const first = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.match(first.publicReference!, /^EC-[23456789ABCDEFGHJKLMNPQRTUVWXYZ]{6}$/)

    // Reabrir e aprovar de novo reutiliza a MESMA referência: a reserva é
    // idempotente, então uma retentativa não abre cobrança com outra referência.
    await prisma.payment.deleteMany()
    await prisma.paymentWebhookEvent.deleteMany()
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: "PENDING", pendingExpiresAt: new Date(Date.now() + 3_600_000), decidedAt: null },
    })
    assert.equal((await approve(access, appointmentId)).status, 200)
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).publicReference,
      first.publicReference,
    )
  })

  it("pagamento tardio não reabre reserva cujo horário outra pessoa já ocupou", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const first = await requestBooking({ serviceId: service.id })
    await approve(access, first.appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { appointmentId: first.appointmentId },
    })
    const appointment = await prisma.appointment.findUniqueOrThrow({
      where: { id: first.appointmentId },
    })

    // A janela vence e o horário é liberado.
    const past = new Date(Date.now() - 60_000)
    await prisma.payment.update({ where: { id: payment.id }, data: { expiresAt: past } })
    await prisma.appointment.update({
      where: { id: first.appointmentId },
      data: { pendingExpiresAt: past },
    })

    // OUTRA pessoa reserva o mesmo horário.
    limits.publicBookingRateLimit.resetKey("127.0.0.1")
    limits.publicContactRateLimit.resetKey("127.0.0.1")
    const second = await requestBooking({ serviceId: service.id })

    // Só então chega o PAID do primeiro.
    const late = await notify({
      eventId: randomUUID(),
      providerPaymentId: payment.providerPaymentId,
      status: "PAID",
      amountCents: payment.amountCents,
      currency: "BRL",
      reference: appointment.publicReference,
    })
    assert.equal(late.status, 200, "responder erro faria o provedor reenviar em laço")

    const a = await prisma.appointment.findUniqueOrThrow({ where: { id: first.appointmentId } })
    const b = await prisma.appointment.findUniqueOrThrow({ where: { id: second.appointmentId } })
    assert.notEqual(a.status, "CONFIRMED", "confirmar aqui seria double booking")
    assert.equal(b.status, "PENDING", "a reserva de quem chegou depois fica intacta")
    const live = await prisma.appointment.count({
      where: { status: { in: ["PENDING", "AWAITING_PAYMENT", "CONFIRMED"] } },
    })
    assert.equal(live, 1, "exatamente uma reserva viva no horário")
    // O dinheiro fica registrado para a barbearia resolver o estorno.
    const settled = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    assert.ok(["PAID", "EXPIRED"].includes(settled.status), settled.status)
    const event = await prisma.paymentWebhookEvent.findFirst({ orderBy: { receivedAt: "desc" } })
    assert.ok(event?.outcome, "desfecho gravado para auditoria")
  })
})
