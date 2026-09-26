import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import type { Server } from "node:http"

/**
 * Pix ESTÁTICO: a barbearia recebe no próprio Pix e alguém de lá confere.
 *
 * Nenhum dinheiro se move aqui. O ponto desta suíte é justamente provar que
 * NADA no caminho do cliente consegue marcar um pagamento como recebido — nem
 * exibir o QR, nem copiar, nem consultar mil vezes.
 */

const database = process.env.TEST_DATABASE_URL
const enabled = Boolean(database)
if (database) {
  const url = new URL(database)
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/erickcorttes_test"
  ) {
    throw new Error("TEST_DATABASE_URL must point to local erickcorttes_test; refusing cleanup.")
  }
}

const PIX_KEY = "5f79a1c2-3b4d-4e5f-8a9b-0c1d2e3f8c21"
const RECEIVER = "ErickCorttes Barbearia"

Object.assign(process.env, {
  DATABASE_URL: database ?? "postgresql://unused@127.0.0.1:1/erickcorttes_test",
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
  FRONTEND_URL: "http://localhost:8443",
  TRUST_PROXY_HOPS: "0",
  BARBERSHOP_PIX_KEY: PIX_KEY,
  BARBERSHOP_PIX_RECEIVER_NAME: RECEIVER,
  BARBERSHOP_PIX_RECEIVER_CITY: "Salvador",
  BARBERSHOP_WHATSAPP_NUMBER: "+5571999990000",
})
// Sem provedor: é o que faz esta instalação ser STATIC_PIX.
delete process.env.PAYMENT_PROVIDER
delete process.env.PAYMENT_WEBHOOK_SECRET

let prisma: typeof import("./prisma.js").prisma
let tokens: typeof import("../modules/auth/token.service.js")
let limits: typeof import("../middlewares/rate-limit.js")
let brcode: typeof import("../modules/payment/pix/brcode.js")
let env: typeof import("./env.js")
let server: Server
let base: string

let counter = 0
const phone = () => "+55719" + String(50000000 + counter++)

function nextTuesday(): string {
  const now = new Date()
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  do {
    date.setUTCDate(date.getUTCDate() + 1)
  } while (date.getUTCDay() !== 2)
  return date.toISOString().slice(0, 10)
}

async function call(path: string, opts: { method?: string; body?: unknown; access?: string } = {}) {
  const response = await fetch(base + path, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:8443",
      "X-CSRF-Protection": "1",
      ...(opts.access ? { Authorization: "Bearer " + opts.access } : {}),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  })
  return { status: response.status, body: (await response.json()) as any }
}

async function makeService(priceCents = 4000) {
  return prisma.service.create({
    data: { name: "Corte + Barba", description: "", priceCents, durationMinutes: 40, active: true },
  })
}
async function makeAdmin() {
  const admin = await prisma.user.create({
    data: { phone: phone(), fullName: "Erick Corttes", role: "ADMIN", status: "ACTIVE" },
  })
  return { id: admin.id, access: (await tokens.issueSession(admin.id)).accessToken }
}
async function book(serviceId: string, startsAt = "09:00") {
  const registered = await call("/booking/contacts", {
    body: { fullName: "Guilherme Santana", phone: phone() },
  })
  assert.equal(registered.status, 201, "cadastro: " + registered.status)
  const created = await call("/booking/requests", {
    body: {
      contactHandle: registered.body.data.contactHandle,
      serviceId,
      date: nextTuesday(),
      startsAt,
    },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  return {
    appointmentId: created.body.data.appointment.id as string,
    publicToken: created.body.data.publicToken as string,
  }
}
const approve = (access: string, id: string) =>
  call(`/admin/requests/${id}/decide`, { access, body: { decision: "CONFIRMED" } })

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

describe("Pagamento por Pix estático — PostgreSQL real", { skip: !enabled }, () => {
  before(async () => {
    ;({ prisma } = await import("./prisma.js"))
    tokens = await import("../modules/auth/token.service.js")
    limits = await import("../middlewares/rate-limit.js")
    brcode = await import("../modules/payment/pix/brcode.js")
    env = await import("./env.js")
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
      limits.globalRateLimit,
      limits.publicBookingRateLimit,
      limits.publicContactRateLimit,
      limits.publicRequestLookupRateLimit,
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
  // Configuração
  // -------------------------------------------------------------------------

  it("chave configurada liga o pagamento em modo estático", () => {
    assert.equal(env.paymentMethod, "STATIC_PIX")
    assert.equal(env.paymentsEnabled, true)
    assert.equal(env.staticPix?.key, PIX_KEY)
  })

  it("a política pública informa o método sem entregar a configuração", async () => {
    const policy = await call("/booking/policy")
    assert.equal(policy.status, 200)
    assert.equal(policy.body.data.paymentRequired, true)
    assert.equal(policy.body.data.paymentMethod, "STATIC_PIX")
    // Chave e recebedor não saem daqui: quem precisa deles é a tela de
    // pagamento de UM pedido, e lá eles vêm junto da cobrança.
    const text = JSON.stringify(policy.body)
    assert.ok(!text.includes(PIX_KEY), "a chave não vaza na política")
    assert.ok(!text.includes(RECEIVER))
  })

  // -------------------------------------------------------------------------
  // A tela de pagamento
  // -------------------------------------------------------------------------

  it("aprovar entrega QR, chave e Copia e Cola, com valor do banco", async () => {
    const service = await makeService(4000)
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)

    const decided = await approve(access, appointmentId)
    assert.equal(decided.status, 200)
    assert.equal(decided.body.data.appointment.status, "AWAITING_PAYMENT")

    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(payment.provider, "static-pix")
    assert.equal(payment.providerPaymentId, null, "não há cobrança de terceiro")
    assert.equal(payment.amountCents, 4000, "valor do catálogo")

    const view = await call(`/booking/requests/${publicToken}`)
    const pix = view.body.data.pix
    assert.ok(pix, "bloco de Pix presente")
    assert.equal(pix.source, "STATIC_PIX")
    assert.equal(pix.requiresManualConfirmation, true)

    // O QR é um BR Code de verdade, não a chave em texto cru.
    assert.ok(brcode.isValidBrCode(pix.copyPaste), "CRC do BR Code confere")
    assert.ok(pix.copyPaste.includes(PIX_KEY), "a chave está no payload")
    assert.ok(pix.copyPaste.includes("540540.00"), "o valor 40.00 está no payload")
    assert.ok(
      pix.copyPaste.includes(view.body.data.reference.replace("-", "")),
      "a referência viaja como txid",
    )
    assert.match(pix.qrCodeSvg, /<svg/, "QR entregue como SVG")
    assert.ok(!pix.qrCodeSvg.includes(PIX_KEY), "o SVG é gráfico, não texto da chave")

    assert.equal(pix.key, PIX_KEY, "a chave é exibida para copiar")
    assert.equal(pix.keyMasked, "5f79…8c21")
    assert.equal(pix.receiverName, RECEIVER)
    assert.equal(view.body.data.payment.amountFormatted, "40,00")
  })

  it("o valor cobrado é o do banco, nunca o que o navegador enviar", async () => {
    const service = await makeService(4000)
    const { access } = await makeAdmin()
    const registered = await call("/booking/contacts", {
      body: { fullName: "Guilherme Santana", phone: phone() },
    })

    // Tentativas de definir o valor pelo corpo da solicitação.
    for (const injected of [
      { amountCents: 1 },
      { amount: 1 },
      { servicePriceCents: 1 },
      { paymentAmountCents: 1 },
      { priceCents: 1 },
    ]) {
      limits.publicBookingRateLimit.resetKey("127.0.0.1")
      const response = await call("/booking/requests", {
        body: {
          contactHandle: registered.body.data.contactHandle,
          serviceId: service.id,
          date: nextTuesday(),
          startsAt: "09:00",
          ...injected,
        },
      })
      assert.equal(response.status, 400, JSON.stringify(injected))
    }

    // E o caminho limpo cobra o preço do catálogo.
    const { appointmentId, publicToken } = await book(service.id)
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(payment.amountCents, 4000)
    const view = await call(`/booking/requests/${publicToken}`)
    assert.ok(view.body.data.pix.copyPaste.includes("540540.00"), "QR gerado com 40.00")
  })

  it("serviço mais caro gera QR com o valor daquele serviço", async () => {
    const service = await makeService(12_050)
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await approve(access, appointmentId)
    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.payment.amountFormatted, "120,50")
    assert.ok(view.body.data.pix.copyPaste.includes("5406120.50"))
    assert.ok(brcode.isValidBrCode(view.body.data.pix.copyPaste))
  })

  // -------------------------------------------------------------------------
  // Pix estático NÃO confirma pagamento
  // -------------------------------------------------------------------------

  it("exibir o QR, copiar ou consultar não muda estado nenhum", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await approve(access, appointmentId)

    // Consultar repetidamente é o que a tela faz enquanto a pessoa paga.
    for (let attempt = 0; attempt < 6; attempt++) {
      const view = await call(`/booking/requests/${publicToken}`)
      assert.equal(view.body.data.appointment.status, "AWAITING_PAYMENT")
      assert.equal(view.body.data.payment.status, "PENDING")
      assert.equal(view.body.data.whatsappUrl, null, "nunca oferece confirmação antes de pagar")
    }

    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.equal(appointment.status, "AWAITING_PAYMENT")
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status,
      "PENDING",
    )
  })

  it("nenhuma rota pública permite o cliente declarar que pagou", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await approve(access, appointmentId)

    for (const [path, body] of [
      [`/booking/requests/${publicToken}/pay`, { status: "PAID" }],
      [`/booking/requests/${publicToken}/paid`, {}],
      [`/booking/requests/${publicToken}/confirm`, {}],
      [`/booking/payments/webhook`, { status: "PAID" }],
      [`/admin/appointments/${appointmentId}/payment`, { decision: "PAID" }],
    ] as Array<[string, unknown]>) {
      const response = await call(path, { body })
      assert.ok(response.status >= 400, `${path} devolveu ${response.status}`)
    }

    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "AWAITING_PAYMENT",
    )
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status,
      "PENDING",
    )
  })

  it("sem provedor, não existe webhook que confirme", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await book(service.id)
    await approve(access, appointmentId)

    const response = await call("/booking/payments/webhook", {
      body: { eventId: "x", status: "PAID", amountCents: 4000, currency: "BRL", reference: "EC-AAAAAA" },
    })
    assert.ok(response.status >= 400, `webhook devolveu ${response.status}`)
    assert.equal(await prisma.paymentWebhookEvent.count(), 0)
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "AWAITING_PAYMENT",
    )
  })

  // -------------------------------------------------------------------------
  // Confirmação administrativa
  // -------------------------------------------------------------------------

  it("a barbearia confirma o Pix recebido e o agendamento fecha", async () => {
    const service = await makeService()
    const { access, id: adminId } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await approve(access, appointmentId)

    const settled = await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "PAID" },
    })
    assert.equal(settled.status, 200, JSON.stringify(settled.body))

    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(appointment.status, "CONFIRMED")
    assert.equal(appointment.pendingExpiresAt, null)
    assert.equal(payment.status, "PAID")
    assert.notEqual(payment.paidAt, null)

    const audit = await prisma.adminAuditLog.findFirst({ where: { action: "PAYMENT_PAID" } })
    assert.equal(audit?.actorId, adminId, "quem confirmou fica registrado")

    // A tela final: sem Pix, com confirmação.
    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.appointment.status, "CONFIRMED")
    assert.equal(view.body.data.pix, null, "o QR sai da tela depois de pago")
    assert.equal(view.body.data.paymentHelpUrl, null)
    assert.equal(view.body.data.payment.status, "PAID")
    const url: string = view.body.data.whatsappUrl
    assert.ok(url, "agora sim, confirmação pelo WhatsApp")
    const message = decodeURIComponent(url.split("?text=")[1]!)
    assert.match(message, /confirmado/i)
    assert.ok(message.includes("40,00"), "valor pago na mensagem")

    // Confirmar de novo é conflito, não segunda confirmação.
    const again = await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "PAID" },
    })
    assert.equal(again.status, 409)
  })

  it("a barbearia pode registrar que o pagamento não veio, sem destruir a reserva", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await approve(access, appointmentId)

    const failed = await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "FAILED" },
    })
    assert.equal(failed.status, 200)
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status,
      "FAILED",
    )
    // A reserva continua na janela: dá para tentar de novo dentro do prazo.
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "AWAITING_PAYMENT",
    )
    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.whatsappUrl, null, "recusado não oferece confirmação")
  })

  it("a confirmação administrativa exige ADMIN ativo e recusa campos extras", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await book(service.id)
    await approve(access, appointmentId)

    // Sem sessão.
    assert.equal(
      (await call(`/admin/appointments/${appointmentId}/payment`, { body: { decision: "PAID" } }))
        .status,
      401,
    )
    // Cliente autenticado não serve.
    const customer = await prisma.user.create({
      data: { phone: phone(), fullName: "Cliente", role: "CUSTOMER", status: "ACTIVE" },
    })
    const customerSession = await tokens.issueSession(customer.id)
    assert.equal(
      (await call(`/admin/appointments/${appointmentId}/payment`, {
        access: customerSession.accessToken,
        body: { decision: "PAID" },
      })).status,
      403,
    )
    // Campos além do contrato.
    for (const extra of [
      { amountCents: 1 },
      { paidAt: "2020-01-01" },
      { status: "PAID" },
      { provider: "outro" },
      { appointmentStatus: "CONFIRMED" },
    ]) {
      const response = await call(`/admin/appointments/${appointmentId}/payment`, {
        access,
        body: { decision: "PAID", ...extra },
      })
      assert.equal(response.status, 400, JSON.stringify(extra))
    }
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "AWAITING_PAYMENT",
    )
  })

  it("janela vencida libera o horário e o Pix sai da tela", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await approve(access, appointmentId)

    const past = new Date(Date.now() - 60_000)
    await prisma.payment.updateMany({ where: { appointmentId }, data: { expiresAt: past } })
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { pendingExpiresAt: past },
    })

    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.appointment.status, "EXPIRED")
    assert.equal(view.body.data.pix, null, "QR não pode continuar convidando a pagar")
    assert.equal(view.body.data.paymentHelpUrl, null)
    assert.equal(view.body.data.whatsappUrl, null)

    // E a confirmação administrativa já não vale para um horário liberado.
    const late = await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "PAID" },
    })
    assert.equal(late.status, 200, "ainda AWAITING_PAYMENT no banco: a barbearia pode conciliar")
    // O horário nunca deixou de estar protegido no banco, então confirmar aqui
    // não gera sobreposição — a EXCLUDE segue cobrindo AWAITING_PAYMENT.
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "CONFIRMED",
    )
  })

  it("serviço gratuito não pede Pix: aprovar confirma direto", async () => {
    const free = await prisma.service.create({
      data: { name: "Retoque cortesia", description: "", priceCents: 0, durationMinutes: 30, active: true },
    })
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(free.id)

    const decided = await approve(access, appointmentId)
    assert.equal(decided.status, 200)
    assert.equal(decided.body.data.appointment.status, "CONFIRMED")
    assert.equal(await prisma.payment.count(), 0)

    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.pix, null, "nada a pagar, nada de QR")
    assert.ok(view.body.data.whatsappUrl, "confirmado oferece WhatsApp")
  })

  it("a mensagem de pagamento fala com a barbearia sem dizer confirmado", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await approve(access, appointmentId)

    const view = await call(`/booking/requests/${publicToken}`)
    const url: string = view.body.data.paymentHelpUrl
    assert.ok(url, "oferece falar com a barbearia durante o pagamento")
    assert.ok(url.startsWith("https://wa.me/5571999990000?text="), url.slice(0, 40))

    const message = decodeURIComponent(url.split("?text=")[1]!)
    assert.match(message, /aprovado/i)
    assert.doesNotMatch(message, /confirmado/i, "não pode dizer confirmado antes de pagar")
    assert.match(message, /Pix/)
    assert.ok(message.includes(view.body.data.reference))
    assert.ok(message.includes("Guilherme"), "primeiro nome")

    // Nada interno na mensagem.
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.ok(!message.includes(publicToken))
    assert.ok(!message.includes(appointmentId))
    assert.ok(!message.includes(payment.id))
    assert.ok(!message.includes(appointment.userId))
    assert.ok(!message.includes(PIX_KEY), "a chave não vai na mensagem")
    assert.doesNotMatch(message, /v2\.|eyJ|Bearer|secret/i)
  })

  it("a resposta pública não traz identificador interno de pagamento", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })

    const view = await call(`/booking/requests/${publicToken}`)
    const text = JSON.stringify(view.body)
    assert.ok(!text.includes(payment.id), "id do pagamento fora")
    assert.ok(!text.includes(appointment.userId), "id do cliente fora")
    assert.ok(!text.includes(publicToken), "o token não volta na resposta")
    assert.ok(!/\+55\d{9,}/.test(text), "telefone fora")
    assert.doesNotMatch(text, /passwordHash|providerPaymentId|JWT_ACCESS_SECRET/)
  })

  // -------------------------------------------------------------------------
  // O que o painel administrativo recebe para confirmar o Pix
  // -------------------------------------------------------------------------

  it("a janela do Pix estático é de 30 minutos, decidida em um só lugar", async () => {
    const rules = await import("../modules/booking/booking.rules.js")
    assert.equal(rules.BookingRules.staticPixPaymentWindowMinutes, 30)
    // O prazo do provedor continua 15: quem confirma lá é webhook, em segundos.
    assert.equal(rules.BookingRules.paymentWindowMinutes, 15)
    assert.equal(rules.paymentWindowMinutesFor("STATIC_PIX"), 30)
    assert.equal(rules.paymentWindowMinutesFor("DYNAMIC_PROVIDER_PIX"), 15)
    assert.equal(rules.paymentWindowMinutesFor("NONE"), 15)

    // E a política pública informa a janela da forma vigente, não a constante.
    const policy = await call("/booking/policy")
    assert.equal(policy.body.data.paymentWindowMinutes, 30)

    // O prazo gravado na aprovação é o de 30 minutos.
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await book(service.id)
    const before = Date.now()
    await approve(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const minutes = (payment.expiresAt.getTime() - before) / 60_000
    assert.ok(minutes > 29 && minutes < 31, `janela de ${minutes} minutos`)
  })

  it("o painel recebe método, valor, status e referência — sem dado interno", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)

    // Antes de aprovar não há cobrança nenhuma.
    const pending = await call(`/admin/appointments/${appointmentId}`, { access })
    assert.equal(pending.status, 200)
    assert.equal(pending.body.data.appointment.payment, null)
    assert.equal(pending.body.data.appointment.reference, null)

    await approve(access, appointmentId)
    const detail = await call(`/admin/appointments/${appointmentId}`, { access })
    const payment = detail.body.data.appointment.payment
    assert.equal(detail.body.data.appointment.status, "AWAITING_PAYMENT")
    assert.equal(payment.method, "PIX_MANUAL")
    assert.equal(payment.status, "PENDING")
    assert.equal(payment.amountFormatted, "40,00")
    assert.equal(payment.canConfirmManually, true)
    assert.equal(payment.windowClosed, false)
    assert.equal(payment.paidAt, null)
    assert.ok(payment.expiresInSeconds > 1700, `${payment.expiresInSeconds}s`)
    assert.match(detail.body.data.appointment.reference, /^EC-/)

    // Identificadores internos ficam fora do painel.
    const stored = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const text = JSON.stringify(detail.body)
    assert.ok(!text.includes(stored.id), "id do pagamento fora")
    assert.ok(!text.includes("providerPaymentId"), "id do provedor fora")
    assert.ok(!text.includes("static-pix"), "nome do adaptador fora")
    assert.ok(!text.includes(publicToken), "token do cliente fora")
    assert.ok(!text.includes(PIX_KEY), "chave Pix fora do painel")
  })

  it("a agenda traz a cobrança de cada item, para a lista poder sinalizar", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await book(service.id)
    await approve(access, appointmentId)

    const agenda = await call(`/admin/agenda?from=${nextTuesday()}`, { access })
    assert.equal(agenda.status, 200)
    const item = agenda.body.data.appointments.find((entry: any) => entry.id === appointmentId)
    assert.ok(item, "o agendamento aparece na agenda")
    assert.equal(item.status, "AWAITING_PAYMENT")
    assert.equal(item.payment.method, "PIX_MANUAL")
    assert.equal(item.payment.canConfirmManually, true)
    assert.match(item.reference, /^EC-/)
  })

  it("canConfirmManually só é verdadeiro no estado exato que permite confirmar", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()

    // PENDING: nem cobrança existe.
    const waiting = await book(service.id, "09:00")
    const pendingDetail = await call(`/admin/appointments/${waiting.appointmentId}`, { access })
    assert.equal(pendingDetail.body.data.appointment.payment, null)

    // AWAITING_PAYMENT: pode.
    await approve(access, waiting.appointmentId)
    assert.equal(
      (await call(`/admin/appointments/${waiting.appointmentId}`, { access })).body.data.appointment
        .payment.canConfirmManually,
      true,
    )

    // CONFIRMED: já não há o que confirmar.
    await call(`/admin/appointments/${waiting.appointmentId}/payment`, {
      access,
      body: { decision: "PAID" },
    })
    const confirmed = await call(`/admin/appointments/${waiting.appointmentId}`, { access })
    assert.equal(confirmed.body.data.appointment.status, "CONFIRMED")
    assert.equal(confirmed.body.data.appointment.payment.canConfirmManually, false)
    assert.equal(confirmed.body.data.appointment.payment.status, "PAID")
    assert.notEqual(confirmed.body.data.appointment.payment.paidAt, null)

    // Prazo vencido: o painel não pode mais oferecer o botão.
    const lapsing = await book(service.id, "10:20")
    await approve(access, lapsing.appointmentId)
    const past = new Date(Date.now() - 60_000)
    await prisma.payment.updateMany({
      where: { appointmentId: lapsing.appointmentId },
      data: { expiresAt: past },
    })
    await prisma.appointment.update({
      where: { id: lapsing.appointmentId },
      data: { pendingExpiresAt: past },
    })
    const lapsed = await call(`/admin/appointments/${lapsing.appointmentId}`, { access })
    assert.equal(lapsed.body.data.appointment.status, "EXPIRED")
    assert.equal(lapsed.body.data.appointment.payment.windowClosed, true)
    assert.equal(lapsed.body.data.appointment.payment.canConfirmManually, false)
  })

  it("dois administradores confirmando ao mesmo tempo produzem uma confirmação", async () => {
    const service = await makeService()
    const first = await makeAdmin()
    const second = await makeAdmin()
    const { appointmentId } = await book(service.id)
    await approve(first.access, appointmentId)

    const results = await Promise.all([
      call(`/admin/appointments/${appointmentId}/payment`, {
        access: first.access,
        body: { decision: "PAID" },
      }),
      call(`/admin/appointments/${appointmentId}/payment`, {
        access: second.access,
        body: { decision: "PAID" },
      }),
    ])

    const ok = results.filter(r => r.status === 200)
    const conflict = results.filter(r => r.status === 409)
    assert.equal(ok.length, 1, "exatamente uma confirmação")
    assert.equal(conflict.length, 1, "a outra recebe conflito tratável")
    assert.ok(!results.some(r => r.status >= 500), "nenhum erro interno")

    // Um único pagamento, um único registro de auditoria da confirmação.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(payment.status, "PAID")
    assert.equal(await prisma.adminAuditLog.count({ where: { action: "PAYMENT_PAID" } }), 1)
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "CONFIRMED",
    )
  })

  it("confirmar em sequência: a segunda chamada informa conflito, não erro genérico", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await book(service.id)
    await approve(access, appointmentId)

    assert.equal(
      (await call(`/admin/appointments/${appointmentId}/payment`, {
        access,
        body: { decision: "PAID" },
      })).status,
      200,
    )
    const again = await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "PAID" },
    })
    assert.equal(again.status, 409)
    // Mensagem que o painel pode mostrar como aviso, não como falha.
    assert.match(again.body.error.message, /já foi confirmado/i)
    assert.equal(await prisma.adminAuditLog.count({ where: { action: "PAYMENT_PAID" } }), 1)
  })

  it("a trilha de auditoria registra quem, o quê e quando — sem segredo", async () => {
    const service = await makeService()
    const { access, id: adminId } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await approve(access, appointmentId)
    const before = Date.now()
    await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "PAID" },
    })

    const entry = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "PAYMENT_PAID" } })
    assert.equal(entry.actorId, adminId, "quem confirmou")
    const metadata = entry.metadata as Record<string, unknown>
    assert.equal(metadata.appointmentId, appointmentId, "qual agendamento")
    assert.equal(metadata.amountCents, 4000)
    assert.ok(entry.createdAt.getTime() >= before - 2000, "quando")

    // Nada de segredo ou payload na trilha.
    const text = JSON.stringify(entry)
    assert.ok(!text.includes(publicToken))
    assert.ok(!text.includes(PIX_KEY), "a chave não entra na auditoria")
    assert.doesNotMatch(text, /00020101|passwordHash|Bearer|eyJ/, "sem BR Code nem credencial")
  })

  it("marcar como não identificado preserva a chance de nova tentativa", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await book(service.id)
    await approve(access, appointmentId)

    const failed = await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "FAILED" },
    })
    assert.equal(failed.status, 200)
    // O agendamento NÃO é cancelado: continua na janela.
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.equal(appointment.status, "AWAITING_PAYMENT")
    assert.notEqual(appointment.pendingExpiresAt, null, "o prazo continua valendo")
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status,
      "FAILED",
    )
    assert.equal(await prisma.adminAuditLog.count({ where: { action: "PAYMENT_FAILED" } }), 1)

    // E depois dá para confirmar, se o Pix aparecer no extrato.
    const later = await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "PAID" },
    })
    assert.equal(later.status, 200)
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "CONFIRMED",
    )
  })

  it("o cliente vê a confirmação imediatamente depois de o barbeiro registrar", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await approve(access, appointmentId)

    // Antes: aguardando pagamento, com QR.
    const paying = await call(`/booking/requests/${publicToken}`)
    assert.equal(paying.body.data.appointment.status, "AWAITING_PAYMENT")
    assert.ok(paying.body.data.pix, "QR disponível enquanto falta pagar")
    assert.equal(paying.body.data.whatsappUrl, null)

    await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "PAID" },
    })

    // Depois: confirmado, sem QR, com WhatsApp.
    const done = await call(`/booking/requests/${publicToken}`)
    assert.equal(done.body.data.appointment.status, "CONFIRMED")
    assert.equal(done.body.data.payment.status, "PAID")
    assert.equal(done.body.data.pix, null, "o QR sai da tela")
    assert.equal(done.body.data.paymentHelpUrl, null)
    assert.ok(done.body.data.whatsappUrl, "confirmação pelo WhatsApp liberada")
    const message = decodeURIComponent(done.body.data.whatsappUrl.split("?text=")[1])
    assert.match(message, /confirmado/i)
    assert.ok(message.includes("40,00"))
  })
})
