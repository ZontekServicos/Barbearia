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
    contactHandle: registered.body.data.contactHandle as string,
  }
}
/**
 * Chega ao estado em que o Pix pode ser pago.
 *
 * Desde que a cobrança nasce COM a solicitação, não existe passo de aprovação
 * para chegar aqui: criar o pedido já abre o Pix, e o agendamento fica em
 * PENDING até a barbearia conferir o extrato. Este atalho só LÊ o que o painel
 * mostra nesse instante, para os testes continuarem inspecionando o agendamento
 * logo depois do setup.
 *
 * Antes esta função aprovava o pedido, porque era a aprovação que abria a
 * cobrança. O nome mudou junto com o fluxo de propósito: `approve` aqui passaria
 * a mentir sobre o que o setup faz.
 */
const payable = (access: string, id: string) => call(`/admin/appointments/${id}`, { access })

/** A decisão administrativa de verdade, para quem testa a própria rota. */
const decideRequest = (
  access: string,
  id: string,
  body: { decision: "CONFIRMED" | "REJECTED"; acknowledgePaidReport?: boolean },
) => call(`/admin/requests/${id}/decide`, { access, body })

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

    const decided = await payable(access, appointmentId)
    assert.equal(decided.status, 200)
    assert.equal(decided.body.data.appointment.status, "PENDING")

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
    await payable(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(payment.amountCents, 4000)
    const view = await call(`/booking/requests/${publicToken}`)
    assert.ok(view.body.data.pix.copyPaste.includes("540540.00"), "QR gerado com 40.00")
  })

  it("serviço mais caro gera QR com o valor daquele serviço", async () => {
    const service = await makeService(12_050)
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)
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
    await payable(access, appointmentId)

    // Consultar repetidamente é o que a tela faz enquanto a pessoa paga.
    for (let attempt = 0; attempt < 6; attempt++) {
      const view = await call(`/booking/requests/${publicToken}`)
      assert.equal(view.body.data.appointment.status, "PENDING")
      assert.equal(view.body.data.payment.status, "PENDING")
      assert.equal(view.body.data.whatsappUrl, null, "nunca oferece confirmação antes de pagar")
    }

    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.equal(appointment.status, "PENDING")
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status,
      "PENDING",
    )
  })

  it("nenhuma rota pública permite o cliente declarar que pagou", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)

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
      "PENDING",
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
    await payable(access, appointmentId)

    const response = await call("/booking/payments/webhook", {
      body: { eventId: "x", status: "PAID", amountCents: 4000, currency: "BRL", reference: "EC-AAAAAA" },
    })
    assert.ok(response.status >= 400, `webhook devolveu ${response.status}`)
    assert.equal(await prisma.paymentWebhookEvent.count(), 0)
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "PENDING",
    )
  })

  // -------------------------------------------------------------------------
  // Confirmação administrativa
  // -------------------------------------------------------------------------

  it("a barbearia confirma o Pix recebido e o agendamento fecha", async () => {
    const service = await makeService()
    const { access, id: adminId } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)

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
    await payable(access, appointmentId)

    const failed = await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "FAILED" },
    })
    assert.equal(failed.status, 200)
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status,
      "PENDING",
    )
    // A reserva continua na janela: dá para tentar de novo dentro do prazo.
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "PENDING",
    )
    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.whatsappUrl, null, "recusado não oferece confirmação")
  })

  it("a confirmação administrativa exige ADMIN ativo e recusa campos extras", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await book(service.id)
    await payable(access, appointmentId)

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
      "PENDING",
    )
  })

  it("janela vencida libera o horário e o Pix sai da tela", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)

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
    assert.equal(late.status, 409, "reserva vencida nao pode ser reativada")
    const unchanged = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(unchanged.status, "PENDING")
    assert.equal(unchanged.paidAt, null)
    assert.equal(await prisma.adminAuditLog.count({ where: { action: "PAYMENT_PAID" } }), 0)
  })

  it("serviço gratuito não pede Pix: aprovar confirma direto", async () => {
    const free = await prisma.service.create({
      data: { name: "Retoque cortesia", description: "", priceCents: 0, durationMinutes: 30, active: true },
    })
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(free.id)

    // Sem valor a cobrar não nasce cobrança, então aqui a aprovação de verdade
    // ainda é o caminho — e ela confirma direto, como numa instalação sem Pix.
    const decided = await decideRequest(access, appointmentId, { decision: "CONFIRMED" })
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
    await payable(access, appointmentId)

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
    await payable(access, appointmentId)
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

  it("a janela do Pix estático é de 120 minutos, decidida em um só lugar", async () => {
    const rules = await import("../modules/booking/booking.rules.js")
    // Duas horas para o CLIENTE pagar e informar. Trinta minutos derrubavam
    // reservas que seriam pagas: o prazo de conferência é que cobre a barbearia.
    assert.equal(rules.BookingRules.staticPixPaymentWindowMinutes, 120)
    // O prazo do provedor continua 15: quem confirma lá é webhook, em segundos.
    assert.equal(rules.BookingRules.paymentWindowMinutes, 15)
    assert.equal(rules.paymentWindowMinutesFor("STATIC_PIX"), 120)
    assert.equal(rules.paymentWindowMinutesFor("DYNAMIC_PROVIDER_PIX"), 15)
    assert.equal(rules.paymentWindowMinutesFor("NONE"), 15)

    // E a política pública informa a janela da forma vigente, não a constante.
    const policy = await call("/booking/policy")
    assert.equal(policy.body.data.paymentWindowMinutes, 120)

    // O prazo gravado na aprovação é o de 30 minutos.
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await book(service.id)
    const before = Date.now()
    await payable(access, appointmentId)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const minutes = (payment.expiresAt.getTime() - before) / 60_000
    assert.ok(minutes > 119 && minutes < 121, `janela de ${minutes} minutos`)
  })

  it("o painel recebe método, valor, status e referência — sem dado interno", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)

    // A cobrança já existe sem nenhuma decisão: é o ponto do fluxo. Antes só
    // nascia na aprovação, e quem acabara de pedir horário não tinha o que pagar.
    const pending = await call(`/admin/appointments/${appointmentId}`, { access })
    assert.equal(pending.status, 200)
    assert.ok(pending.body.data.appointment.payment, "o Pix nasce com a solicitação")
    assert.equal(pending.body.data.appointment.payment.status, "PENDING")
    assert.equal(pending.body.data.appointment.status, "PENDING", "ver o Pix não aprova nada")
    // A referência já existe: é ela que liga o aviso recebido no WhatsApp ao
    // pedido na agenda.
    assert.match(pending.body.data.appointment.reference, /^EC-/)

    const detail = await call(`/admin/appointments/${appointmentId}`, { access })
    const payment = detail.body.data.appointment.payment
    assert.equal(detail.body.data.appointment.status, "PENDING")
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
    await payable(access, appointmentId)

    const agenda = await call(`/admin/agenda?from=${nextTuesday()}`, { access })
    assert.equal(agenda.status, 200)
    const item = agenda.body.data.appointments.find((entry: any) => entry.id === appointmentId)
    assert.ok(item, "o agendamento aparece na agenda")
    assert.equal(item.status, "PENDING")
    assert.equal(item.payment.method, "PIX_MANUAL")
    assert.equal(item.payment.canConfirmManually, true)
    assert.match(item.reference, /^EC-/)
  })

  it("canConfirmManually só é verdadeiro no estado exato que permite confirmar", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()

    // Esperando o dinheiro (PENDING): pode confirmar desde a criação, porque a
    // cobrança nasce junto com a solicitação.
    const waiting = await book(service.id, "09:00")
    const pendingDetail = await call(`/admin/appointments/${waiting.appointmentId}`, { access })
    assert.equal(pendingDetail.body.data.appointment.status, "PENDING")
    assert.equal(pendingDetail.body.data.appointment.payment.canConfirmManually, true)

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
    await payable(access, lapsing.appointmentId)
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
    await payable(first.access, appointmentId)

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
    await payable(access, appointmentId)

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
    await payable(access, appointmentId)
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
    await payable(access, appointmentId)

    const failed = await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "FAILED" },
    })
    assert.equal(failed.status, 200)
    // O agendamento NÃO é cancelado: continua na janela.
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.equal(appointment.status, "PENDING")
    assert.notEqual(appointment.pendingExpiresAt, null, "o prazo continua valendo")
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status,
      "PENDING",
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
    await payable(access, appointmentId)

    // Antes: aguardando pagamento, com QR.
    const paying = await call(`/booking/requests/${publicToken}`)
    assert.equal(paying.body.data.appointment.status, "PENDING")
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

  // -------------------------------------------------------------------------
  // "Já fiz o Pix" — comunicação, nunca confirmação
  // -------------------------------------------------------------------------

  it('o CTA "já fiz o Pix" existe só com Pix da barbearia aguardando pagamento', async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)

    // PENDING já traz o Pix na tela — e, com ele, o CTA. É o ponto do fluxo:
    // quem acabou de pedir horário paga agora, não depois de uma aprovação.
    const paying = await call(`/booking/requests/${publicToken}`)
    assert.equal(paying.body.data.appointment.status, "PENDING")
    assert.equal(paying.body.data.pix.source, "STATIC_PIX")
    const url: string = paying.body.data.pixPaidUrl
    assert.ok(url, "aguardando Pix manual oferece o CTA")
    assert.ok(url.startsWith("https://wa.me/5571999990000?text="), url.slice(0, 44))

    // Confirmado: o Pix e o CTA saem da tela.
    await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "PAID" },
    })
    const done = await call(`/booking/requests/${publicToken}`)
    assert.equal(done.body.data.appointment.status, "CONFIRMED")
    assert.equal(done.body.data.pix, null)
    assert.equal(done.body.data.pixPaidUrl, null, "não há mais o que avisar")
    assert.ok(done.body.data.whatsappUrl, "o CTA final de confirmação assume")
  })

  it("a mensagem traz valor e referência reais, e nenhum dado interno", async () => {
    const service = await makeService(12_050)
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)

    const view = await call(`/booking/requests/${publicToken}`)
    const message = decodeURIComponent(view.body.data.pixPaidUrl.split("?text=")[1])

    assert.match(message, /Realizei o pagamento via Pix/)
    assert.ok(message.includes("Valor: R$ 120,50"), "o valor é o da cobrança")
    assert.ok(message.includes(`Referência: ${view.body.data.reference}`))
    assert.ok(message.includes("Guilherme"), "nome do cadastro")
    assert.match(message, /Poderia confirmar o recebimento/)
    // Pede, não anuncia.
    assert.doesNotMatch(message, /pagamento confirmado|agendamento confirmado/i)

    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    for (const secret of [publicToken, appointmentId, payment.id, appointment.userId, PIX_KEY]) {
      assert.ok(!message.includes(secret), "nada interno na mensagem")
    }
    assert.ok(!message.includes(view.body.data.pix.copyPaste), "o BR Code não vai na mensagem")
    assert.doesNotMatch(message, /eyJ|Bearer|v2\.|00020101|secret/i)
  })

  it("consultar a tela do Pix não muda pagamento nem agendamento", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)

    const before = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    const paymentBefore = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const auditBefore = await prisma.adminAuditLog.count()

    // É o que a tela faz enquanto a pessoa paga e volta do WhatsApp.
    for (let attempt = 0; attempt < 5; attempt++) {
      const view = await call(`/booking/requests/${publicToken}`)
      assert.equal(view.body.data.appointment.status, "PENDING")
      assert.equal(view.body.data.payment.status, "PENDING")
      assert.ok(view.body.data.pixPaidUrl, "o CTA continua disponível")
      assert.equal(view.body.data.whatsappUrl, null, "nunca oferece confirmação")
    }

    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(after.status, "PENDING")
    assert.equal(paymentAfter.status, "PENDING")
    assert.equal(paymentAfter.paidAt, null)
    assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), "agendamento intocado")
    assert.equal(
      paymentAfter.updatedAt.getTime(),
      paymentBefore.updatedAt.getTime(),
      "cobrança intocada",
    )
    assert.equal(
      await prisma.adminAuditLog.count(),
      auditBefore,
      "nenhuma auditoria financeira criada",
    )
  })

  it("prazo vencido não oferece o CTA: reserva expirada não deve receber Pix", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)

    const past = new Date(Date.now() - 60_000)
    await prisma.payment.updateMany({ where: { appointmentId }, data: { expiresAt: past } })
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { pendingExpiresAt: past },
    })

    const view = await call(`/booking/requests/${publicToken}`)
    assert.equal(view.body.data.appointment.status, "EXPIRED")
    assert.equal(view.body.data.pix, null)
    assert.equal(view.body.data.pixPaidUrl, null)
    assert.equal(view.body.data.paymentHelpUrl, null)
  })
  it("CTA: matriz completa de estados do agendamento e pagamento", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)
    const appointments = ["PENDING", "AWAITING_PAYMENT", "CONFIRMED", "REJECTED", "EXPIRED", "CANCELLED", "COMPLETED", "NO_SHOW"] as const
    const payments = ["PENDING", "PAID", "FAILED", "EXPIRED", "CANCELED"] as const
    for (const status of appointments) {
      await prisma.appointment.update({ where: { id: appointmentId }, data: { status } })
      for (const paymentStatus of payments) {
        await prisma.payment.updateMany({ where: { appointmentId }, data: { status: paymentStatus, paidAt: paymentStatus === "PAID" ? new Date() : null } })
        limits.publicRequestLookupRateLimit.resetKey("127.0.0.1")
        const response = await call("/booking/requests/" + publicToken)
        assert.equal(response.status, 200)
        /**
         * FAILED entra junto com PENDING.
         *
         * "A barbearia não achou o Pix" com prazo de sobra é exatamente o caso de
         * tentar outra vez — e para isso o cliente precisa do QR e do CTA de
         * volta. Antes a tela prometia nova tentativa no painel e não oferecia
         * nenhuma do lado do cliente.
         */
        const chargeOpen = paymentStatus === "PENDING" || paymentStatus === "FAILED"
        /**
         * Dois estados do agendamento oferecem o CTA: `PENDING`, que é o normal
         * desde que o Pix nasce com a solicitação, e `AWAITING_PAYMENT`, das
         * reservas criadas antes dessa mudança. Nos demais não há pagamento em
         * aberto para declarar.
         */
        const waitingMoney = status === "AWAITING_PAYMENT" || status === "PENDING"
        assert.equal(Boolean(response.body.data.pixPaidUrl), waitingMoney && chargeOpen, status + "/" + paymentStatus)
      }
    }
  })

  it("CTA: sem WhatsApp, referencia ou cobranca", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)
    const number = env.env.BARBERSHOP_WHATSAPP_NUMBER
    try {
      delete env.env.BARBERSHOP_WHATSAPP_NUMBER
      const response = await call("/booking/requests/" + publicToken)
      assert.equal(response.body.data.pixPaidUrl, null)
      assert.ok(response.body.data.pix)
    } finally { env.env.BARBERSHOP_WHATSAPP_NUMBER = number }
    await prisma.appointment.update({ where: { id: appointmentId }, data: { publicReference: null } })
    assert.equal((await call("/booking/requests/" + publicToken)).body.data.pixPaidUrl, null)
    await prisma.payment.deleteMany({ where: { appointmentId } })
    assert.equal((await call("/booking/requests/" + publicToken)).body.data.pixPaidUrl, null)
  })

  it("CTA: provider dinamico nunca oferece caminho manual paralelo", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)
    const payload = (await call("/booking/requests/" + publicToken)).body.data.pix.copyPaste
    for (const pixQrCode of [payload, "invalid", null]) {
      await prisma.payment.updateMany({ where: { appointmentId }, data: { provider: "manual", providerPaymentId: "provider-private-id", pixQrCode } })
      const response = await call("/booking/requests/" + publicToken)
      assert.equal(response.body.data.pixPaidUrl, null)
      if (pixQrCode === payload) {
        assert.equal(response.body.data.pix.source, "DYNAMIC_PROVIDER_PIX")
        assert.equal(response.body.data.pix.requiresManualConfirmation, false)
      } else assert.equal(response.body.data.pix, null)
      assert.equal((await call("/admin/appointments/" + appointmentId + "/payment", { access, body: { decision: "PAID" } })).status, 409)
    }
  })

  for (const deadline of ["payment", "appointment"] as const) {
    it("CTA: prazo isolado de " + deadline + " no limite exato, sem reativacao", async () => {
      const service = await makeService()
      const { access, id: adminId } = await makeAdmin()
      const { appointmentId, publicToken } = await book(service.id)
      await payable(access, appointmentId)
      const now = new Date()
      if (deadline === "payment") await prisma.payment.updateMany({ where: { appointmentId }, data: { expiresAt: now } })
      else await prisma.appointment.update({ where: { id: appointmentId }, data: { pendingExpiresAt: now } })
      const before = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
      const paymentBefore = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
      const auditBefore = await prisma.adminAuditLog.count()
      const { getPublicRequest } = await import("../modules/booking/public-booking.service.js")
      const view = await getPublicRequest(publicToken, now)
      assert.equal(view.appointment.status, "EXPIRED")
      assert.equal(view.pix, null)
      assert.equal(view.pixPaidUrl, null)
      assert.equal(view.paymentHelpUrl, null)
      const { settleStaticPayment } = await import("../modules/payment/payment.service.js")
      await assert.rejects(settleStaticPayment(adminId, appointmentId, "PAID", now))
      assert.deepEqual(await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } }), before)
      assert.deepEqual(await prisma.payment.findUniqueOrThrow({ where: { appointmentId } }), paymentBefore)
      assert.equal(await prisma.adminAuditLog.count(), auditBefore)
    })
  }

  it("CTA: verbos e estados manipulados nas rotas publicas nunca escrevem", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)
    const before = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    const paymentBefore = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const auditBefore = await prisma.adminAuditLog.count()
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      for (const status of ["PAID", "CONFIRMED", "RECEIVED"]) {
        for (const suffix of ["", "/payment", "/paid", "/confirm", "/receipt"]) {
          limits.globalRateLimit.resetKey("127.0.0.1")
          const response = await call("/booking/requests/" + publicToken + suffix, { method, body: { status, decision: status, amountCents: 1 } })
          assert.ok([400, 401, 403, 404].includes(response.status), method + suffix + ": " + response.status)
        }
      }
    }
    assert.deepEqual(await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } }), before)
    assert.deepEqual(await prisma.payment.findUniqueOrThrow({ where: { appointmentId } }), paymentBefore)
    assert.equal(await prisma.adminAuditLog.count(), auditBefore)
  })

  for (const [amountCents, formatted] of [[4000, "40,00"], [12050, "120,50"]] as const) {
    it("CTA: mensagem persistida R$ " + formatted + " sem dados internos ou segredos", async () => {
      const service = await makeService(amountCents)
      const { access } = await makeAdmin()
      const { appointmentId, publicToken, contactHandle } = await book(service.id)
      await payable(access, appointmentId)
      const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
      const session = await tokens.issueSession(appointment.userId)
      const customer = await prisma.user.findUniqueOrThrow({ where: { id: appointment.userId } })
      const providerPaymentId = "provider-private-" + randomBytes(12).toString("hex")
      await prisma.payment.updateMany({ where: { appointmentId }, data: { providerPaymentId } })
      // Alterar o catálogo e adulterar a query não podem substituir o valor da cobrança.
      await prisma.service.update({ where: { id: service.id }, data: { priceCents: 1, name: "Catalogo alterado" } })
      const response = await call("/booking/requests/" + publicToken + "?amountCents=1&amountFormatted=0,01&phone=5511000000000&status=PAID")
      assert.equal(response.status, 200)
      const view = response.body.data
      const url = new URL(view.pixPaidUrl)
      assert.equal(url.origin, "https://wa.me")
      assert.equal(url.pathname, "/5571999990000")
      assert.notEqual(url.pathname.slice(1), customer.phone.replace(/[^0-9]/g, ""))
      assert.deepEqual([...url.searchParams.keys()], ["text"])
      const message = url.searchParams.get("text")!
      const [year, month, day] = view.appointment.date.split("-")
      assert.ok(message.includes("Cliente: " + customer.fullName))
      assert.ok(message.includes("Serviço: " + appointment.serviceName))
      assert.ok(message.includes("Data: " + day + "/" + month + "/" + year))
      assert.ok(message.includes("Horário: " + view.appointment.startsAtClock + " às " + view.appointment.endsAtClock))
      assert.ok(message.includes("Valor: R$ " + formatted))
      assert.ok(message.includes("Referência: " + appointment.publicReference))
      assert.ok(!message.includes("Catalogo alterado"))
      const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
      for (const forbidden of [publicToken, contactHandle, appointmentId, payment.id, providerPaymentId, customer.id, access, session.accessToken, session.refreshToken, PIX_KEY, view.pix.copyPaste, env.env.DATABASE_URL, env.env.JWT_ACCESS_SECRET]) {
        assert.ok(!decodeURIComponent(url.href).includes(forbidden), "URL nao inclui campos privados")
      }
      assert.doesNotMatch(message, /publicToken|contactHandle|appointmentId|paymentId|providerPaymentId|userId|JWT|refresh.?token|DATABASE_URL|webhook.?secret|provider.?secret|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)
      assert.doesNotMatch(message, /pagamento confirmado|agendamento confirmado/i)
      assert.match(message, /Poderia confirmar o recebimento/)
    })
  }


  // -------------------------------------------------------------------------
  // Declaração de pagamento pelo cliente
  // -------------------------------------------------------------------------

  const report = (token: string) =>
    call(`/booking/requests/${token}/payment-reported`, { body: {} })

  // -------------------------------------------------------------------------
  // A decisão final da barbearia
  // -------------------------------------------------------------------------

  it("aprovar sem conferir o Pix é recusado: confirmar passa pelo pagamento", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await book(service.id)

    // Uma porta só quando há dinheiro envolvido. Aprovar "no seco" confirmaria o
    // horário de quem não pagou.
    const attempt = await decideRequest(access, appointmentId, { decision: "CONFIRMED" })
    assert.equal(attempt.status, 409)
    assert.match(attempt.body.error.message, /Confirmar pagamento e agendamento/)

    const untouched = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: { payment: true },
    })
    assert.equal(untouched.status, "PENDING", "a recusa não mexeu no agendamento")
    assert.equal(untouched.payment!.status, "PENDING")

    // A porta certa marca pagamento E agendamento no mesmo ato.
    const settled = await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "PAID" },
    })
    assert.equal(settled.status, 200)
    const after = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: { payment: true },
    })
    assert.equal(after.status, "CONFIRMED")
    assert.equal(after.payment!.status, "PAID")
    assert.notEqual(after.payment!.paidAt, null)
  })

  it("recusar quem declarou pagamento exige confirmação explícita e nunca devolve dinheiro", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    assert.equal((await report(publicToken)).status, 200)

    // Primeiro clique barrado: há dinheiro de outra pessoa em jogo, e desfazer
    // uma recusa depende de transferência manual.
    const blocked = await decideRequest(access, appointmentId, { decision: "REJECTED" })
    assert.equal(blocked.status, 409)
    assert.match(blocked.body.error.message, /informou que já pagou/)
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "PENDING",
      "a guarda não pode decidir pela metade",
    )

    const done = await decideRequest(access, appointmentId, {
      decision: "REJECTED",
      acknowledgePaidReport: true,
    })
    assert.equal(done.status, 200)
    const after = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: { payment: true },
    })
    assert.equal(after.status, "REJECTED")
    // A cobrança morre para ninguém pagar horário recusado. E NÃO há devolução
    // automática: nada aqui afirma que o dinheiro voltou.
    assert.equal(after.payment!.status, "CANCELED")
    assert.equal(after.payment!.paidAt, null)

    // O registro guarda o que havia, para sustentar a devolução feita por fora.
    const log = await prisma.adminAuditLog.findFirstOrThrow({
      where: { action: "APPOINTMENT_REQUEST_REJECTED" },
      orderBy: { createdAt: "desc" },
    })
    const metadata = log.metadata as Record<string, { refunded: boolean; amountCents: number; paymentReportedAt?: string }>
    assert.equal(metadata.rejectedWithPayment.refunded, false)
    assert.equal(metadata.rejectedWithPayment.amountCents, 4000)
    assert.ok(metadata.rejectedWithPayment.paymentReportedAt, "guarda quando foi declarado")
  })

  it("recusar pagamento já confirmado preserva o PAID: devolução é por fora", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await book(service.id)
    await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "PAID" },
    })
    // Volta a PENDING apenas para alcançar a rota de decisão com cobrança PAID —
    // é o caso de alguém pagar e a barbearia ainda assim não poder atender.
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: "PENDING", pendingExpiresAt: new Date(Date.now() + 60 * 60_000) },
    })

    const blocked = await decideRequest(access, appointmentId, { decision: "REJECTED" })
    assert.equal(blocked.status, 409, "pagamento confirmado também exige reconhecimento")

    const done = await decideRequest(access, appointmentId, {
      decision: "REJECTED",
      acknowledgePaidReport: true,
    })
    assert.equal(done.status, 200)
    const after = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: { payment: true },
    })
    assert.equal(after.status, "REJECTED")
    // PAID permanece: o dinheiro entrou, e apagar isso esconderia que existe
    // devolução pendente.
    assert.equal(after.payment!.status, "PAID")
    assert.notEqual(after.payment!.paidAt, null)
  })

  it("recusar pedido sem pagamento declarado não pede confirmação extra", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId } = await book(service.id)

    const done = await decideRequest(access, appointmentId, { decision: "REJECTED" })
    assert.equal(done.status, 200)
    const after = await prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: { payment: true },
    })
    assert.equal(after.status, "REJECTED")
    assert.equal(after.payment!.status, "CANCELED", "QR vivo em reserva morta convida a pagar")
  })

  it("audit: review remains readable and confirmable past payment expiry", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)
    assert.equal((await report(publicToken)).status, 200)
    await prisma.payment.update({ where: { appointmentId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const view = await call("/booking/requests/" + publicToken)
    assert.equal(view.body.data.appointment.status, "PENDING")
    assert.equal(view.body.data.paymentReported, true)
    assert.equal(view.body.data.pix, null)
    assert.equal((await call("/admin/appointments/" + appointmentId + "/payment", { access, body: { decision: "PAID" } })).status, 200)
  })

  it("audit: report requires PENDING and refuses terminal states", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)
    for (const status of ["FAILED", "EXPIRED", "CANCELED"] as const) {
      await prisma.payment.update({ where: { appointmentId }, data: { status } })
      assert.equal((await report(publicToken)).status, 409, status)
    }
    await prisma.payment.update({ where: { appointmentId }, data: { status: "PENDING" } })
    assert.equal((await report(publicToken)).status, 200)
    await call("/admin/appointments/" + appointmentId + "/payment", { access, body: { decision: "PAID" } })
    assert.equal((await report(publicToken)).status, 409)
  })

  it("audit: absent body is accepted", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)
    assert.equal((await call("/booking/requests/" + publicToken + "/payment-reported", { method: "POST" })).status, 200)
  })


  it("declarar não confirma nada, mas transfere o prazo para a conferência", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)

    const before = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const apptBefore = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    // Sem declaração, a reserva vale pelo prazo de PAGAMENTO.
    assert.equal(apptBefore.pendingExpiresAt!.getTime(), before.expiresAt.getTime())

    const response = await report(publicToken)
    assert.equal(response.status, 200)

    const after = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const apptAfter = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.notEqual(after.paymentReportedAt, null)
    assert.notEqual(after.reviewExpiresAt, null)
    // NÃO confirma: essas duas linhas são a razão de existir do teste.
    assert.equal(after.status, "PENDING")
    assert.equal(after.paidAt, null)
    assert.equal(apptAfter.status, "PENDING")
    // O prazo original é preservado, e a reserva passa a valer pelo da conferência.
    assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime())
    assert.equal(apptAfter.pendingExpiresAt!.getTime(), after.reviewExpiresAt!.getTime())
    // Nenhuma trilha financeira: declarar não é decidir.
    assert.equal(
      await prisma.adminAuditLog.count({ where: { action: { startsWith: "PAYMENT_" } } }),
      0,
    )
  })

  it("declarar é idempotente: dez cliques valem um", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)

    const first = await report(publicToken)
    assert.equal(first.status, 200)
    const results = await Promise.all(Array.from({ length: 10 }, () => report(publicToken)))
    assert.ok(results.every(r => r.status === 200), JSON.stringify(results.map(r => r.status)))
    // Nem o instante se move, nem o prazo estica — senão o cliente esticaria a
    // reserva à vontade clicando de novo.
    assert.equal(new Set(results.map(r => r.body.data.reportedAt)).size, 1)
    assert.equal(results[0]!.body.data.reportedAt, first.body.data.reportedAt)
    assert.equal(results[0]!.body.data.reviewExpiresAt, first.body.data.reviewExpiresAt)
  })

  it("o horário segue protegido depois do prazo de pagamento, durante a conferência", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)
    await report(publicToken)

    // O prazo de PAGAMENTO vence — mas o de conferência não.
    await prisma.payment.updateMany({
      where: { appointmentId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    const availability = await call(
      `/booking/availability?date=${nextTuesday()}&serviceId=${service.id}`,
    )
    assert.equal(
      availability.body.data.slots.some((slot: any) => slot.startsAtClock === "09:00"),
      false,
      "quem informou o pagamento não perde o horário",
    )
    limits.publicBookingRateLimit.resetKey("127.0.0.1")
    limits.publicContactRateLimit.resetKey("127.0.0.1")
    const rival = await call("/booking/contacts", {
      body: { fullName: "Outro Cliente", phone: phone() },
    })
    const stolen = await call("/booking/requests", {
      body: {
        contactHandle: rival.body.data.contactHandle,
        serviceId: service.id,
        date: nextTuesday(),
        startsAt: "09:00",
      },
    })
    assert.equal(stolen.status, 409, "o horário não pode ser tomado")
    assert.equal(
      await prisma.appointment.count({
        where: { status: { in: ["PENDING", "AWAITING_PAYMENT", "CONFIRMED"] } },
      }),
      1,
    )
  })

  it("atendimento perto demais recusa a declaração e orienta falar com a barbearia", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)
    // Dentro da folga de uma hora não cabe conferência nenhuma.
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { startsAt: new Date(Date.now() + 30 * 60_000) },
    })

    const refused = await report(publicToken)
    assert.equal(refused.status, 409)
    assert.match(refused.body.error.message, /Fale com a barbearia/i)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(payment.paymentReportedAt, null, "nada é gravado numa recusa")
    assert.equal(payment.reviewExpiresAt, null)
    // A saída honesta continua na tela.
    const view = await call(`/booking/requests/${publicToken}`)
    assert.ok(view.body.data.paymentHelpUrl)
  })

  it("a tela troca o QR por 'pagamento informado' e nunca diz confirmado", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)

    const paying = await call(`/booking/requests/${publicToken}`)
    assert.ok(paying.body.data.pix, "antes: QR presente")
    assert.equal(paying.body.data.paymentReported, false)

    await report(publicToken)
    const reported = await call(`/booking/requests/${publicToken}`)
    assert.equal(reported.body.data.paymentReported, true)
    // O QR sai: manter o convite a pagar levaria a pagamento duplicado.
    assert.equal(reported.body.data.pix, null)
    assert.equal(reported.body.data.pixPaidUrl, null)
    // E continua sem prometer confirmação.
    assert.equal(reported.body.data.appointment.status, "PENDING")
    assert.equal(reported.body.data.payment.status, "PENDING")
    assert.equal(reported.body.data.whatsappUrl, null)
    // O prazo mostrado passa a ser o da conferência.
    assert.equal(reported.body.data.payment.expiresAt, reported.body.data.payment.reviewExpiresAt)
    assert.ok(reported.body.data.payment.expiresInSeconds > 3600)
  })

  it("o painel distingue 'aguardando pagamento' de 'pagamento informado'", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)

    let detail = await call(`/admin/appointments/${appointmentId}`, { access })
    assert.equal(detail.body.data.appointment.payment.reportedAt, null)

    await report(publicToken)
    detail = await call(`/admin/appointments/${appointmentId}`, { access })
    const payment = detail.body.data.appointment.payment
    assert.ok(payment.reportedAt, "o painel vê quando o cliente informou")
    assert.ok(payment.reviewExpiresAt)
    assert.equal(payment.expiresAt, payment.reviewExpiresAt, "prazo vigente é o de conferência")
    assert.equal(payment.canConfirmManually, true, "a barbearia pode confirmar")
    assert.equal(payment.reviewOverdue, false)
    // A agenda também, para a lista poder sinalizar.
    const agenda = await call(`/admin/agenda?from=${nextTuesday()}`, { access })
    const item = agenda.body.data.appointments.find((entry: any) => entry.id === appointmentId)
    assert.ok(item.payment.reportedAt)
  })

  it("conferência vencida sem decisão fica sinalizada, e o alerta sobrevive à varredura", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)
    await report(publicToken)

    // A declaração foi 25h atrás, então o prazo de 24h venceu há uma hora. Esta
    // forma respeita o CHECK do banco (reviewExpiresAt > paymentReportedAt) em
    // vez de burlá-lo.
    const reportedLongAgo = new Date(Date.now() - 25 * 60 * 60_000)
    const past = new Date(Date.now() - 60 * 60_000)
    await prisma.payment.updateMany({
      where: { appointmentId },
      data: { paymentReportedAt: reportedLongAgo, reviewExpiresAt: past },
    })
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { pendingExpiresAt: past },
    })

    let detail = await call(`/admin/appointments/${appointmentId}`, { access })
    assert.equal(detail.body.data.appointment.payment.reviewOverdue, true)
    // Nunca confirma sozinho.
    assert.notEqual(detail.body.data.appointment.payment.status, "PAID")
    assert.notEqual(detail.body.data.appointment.status, "CONFIRMED")

    // Uma nova reserva dispara a varredura, que marca a cobrança EXPIRED. O
    // alerta NÃO pode desaparecer justamente aí — é quando ele importa.
    limits.publicBookingRateLimit.resetKey("127.0.0.1")
    limits.publicContactRateLimit.resetKey("127.0.0.1")
    await book(service.id)
    detail = await call(`/admin/appointments/${appointmentId}`, { access })
    assert.equal(detail.body.data.appointment.payment.reviewOverdue, true, "alerta persiste")
    assert.ok(detail.body.data.appointment.payment.reportedAt, "a declaração fica registrada")
    assert.equal(
      await prisma.appointment.count({
        where: { status: { in: ["PENDING", "AWAITING_PAYMENT", "CONFIRMED"] } },
      }),
      1,
      "sem double booking",
    )
  })

  it("'pagamento não localizado' desfaz a declaração e devolve a chance de tentar", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)
    await report(publicToken)
    const original = (await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).expiresAt

    const failed = await call(`/admin/appointments/${appointmentId}/payment`, {
      access,
      body: { decision: "FAILED" },
    })
    assert.equal(failed.status, 200)

    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.equal(payment.status, "PENDING")
    // Declaração desfeita: sem isso a tela do cliente ficaria presa em
    // "pagamento informado", escondendo o QR e impedindo nova tentativa.
    assert.equal(payment.paymentReportedAt, null)
    assert.equal(payment.reviewExpiresAt, null)
    assert.equal(appointment.status, "PENDING", "a reserva não é destruída")
    assert.equal(appointment.pendingExpiresAt!.getTime(), original.getTime())
    // A declaração desfeita sobrevive na auditoria.
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { action: "PAYMENT_FAILED" },
    })
    assert.ok((audit.metadata as any).paymentReportedAt)

    // E o cliente pode pagar e declarar de novo.
    const again = await call(`/booking/requests/${publicToken}`)
    assert.ok(again.body.data.pix, "o QR volta")
    assert.equal((await report(publicToken)).status, 200)
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status,
      "PENDING",
      "nova declaração recoloca a cobrança em aberto",
    )
    // Só o ADMIN confirma.
    assert.equal(
      (await call(`/admin/appointments/${appointmentId}/payment`, {
        access,
        body: { decision: "PAID" },
      })).status,
      200,
    )
    assert.equal(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status,
      "CONFIRMED",
    )
  })

  it("a rota de declaração é estrita e só serve ao próprio pedido", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)

    for (const key of [
      "paidAt", "status", "paymentStatus", "amount", "amountCents", "appointmentStatus",
      "reviewExpiresAt", "paymentReportedAt", "provider", "userId", "reportedAt",
    ]) {
      const response = await call(`/booking/requests/${publicToken}/payment-reported`, {
        body: { [key]: "injetado" },
      })
      assert.equal(response.status, 400, key)
    }
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).paymentReportedAt,
      null,
    )

    // Token de outro pedido não declara este.
    limits.publicBookingRateLimit.resetKey("127.0.0.1")
    limits.publicContactRateLimit.resetKey("127.0.0.1")
    const other = await book(service.id, "10:20")
    await payable(access, other.appointmentId)
    await report(other.publicToken)
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).paymentReportedAt,
      null,
      "cada token declara só o seu",
    )

    assert.equal((await call("/booking/requests/xxx/payment-reported", { body: {} })).status, 400)
    const unknown = await call(
      `/booking/requests/${randomBytes(32).toString("base64url")}/payment-reported`,
      { body: {} },
    )
    assert.equal(unknown.status, 404)
    assert.doesNotMatch(JSON.stringify(unknown.body), /EC-|\+55/)
  })

  it("declarar depois do prazo de pagamento é recusado", async () => {
    const service = await makeService()
    const { access } = await makeAdmin()
    const { appointmentId, publicToken } = await book(service.id)
    await payable(access, appointmentId)

    const past = new Date(Date.now() - 60_000)
    await prisma.payment.updateMany({ where: { appointmentId }, data: { expiresAt: past } })
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { pendingExpiresAt: past },
    })

    const refused = await report(publicToken)
    assert.equal(refused.status, 409)
    assert.match(refused.body.error.message, /prazo para pagamento já venceu/i)
    assert.equal(
      (await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).paymentReportedAt,
      null,
    )
  })
  async function auditFixture() {
    const service = await makeService()
    const admin = await makeAdmin()
    const booking = await book(service.id)
    assert.equal((await payable(admin.access, booking.appointmentId)).status, 200)
    return { service, admin, ...booking }
  }

  it("audit: 2 and 10 sequential reports plus 10 fresh simultaneous reports are immutable", async () => {
    const { appointmentId, publicToken } = await auditFixture()
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => report(publicToken)))
    assert.ok(concurrent.every(r => r.status === 200))
    const first = concurrent[0]!.body.data
    for (const r of concurrent) assert.deepEqual(r.body.data, first)
    for (let i = 0; i < 10; i++) {
      const again = await report(publicToken)
      assert.equal(again.status, 200)
      assert.deepEqual(again.body.data, first)
    }
    assert.equal(await prisma.payment.count({ where: { appointmentId } }), 1)
    assert.equal(await prisma.adminAuditLog.count({ where: { action: "PAYMENT_PAID" } }), 0)
  })

  for (const minutes of [61, 60, 59]) {
    it("audit: fixed clock report boundary " + minutes + " minutes", async () => {
      const { appointmentId, publicToken } = await auditFixture()
      const { reportStaticPixPayment } = await import("../modules/payment/payment.service.js")
      const { digestPublicToken } = await import("../modules/booking/public-token.js")
      const now = new Date("2026-10-01T23:30:00Z")
      await prisma.appointment.update({ where: { id: appointmentId }, data: {
        startsAt: new Date(+now + minutes * 60_000),
        endsAt: new Date(+now + (minutes + 40) * 60_000),
        reservedEndsAt: new Date(+now + (minutes + 40) * 60_000),
        pendingExpiresAt: new Date(+now + 120 * 60_000),
      } })
      await prisma.payment.update({ where: { appointmentId }, data: { expiresAt: new Date(+now + 120 * 60_000) } })
      if (minutes > 60) {
        const result = await reportStaticPixPayment(digestPublicToken(publicToken), now)
        assert.equal(+result.reviewExpiresAt, +now + 60_000)
      } else {
        await assert.rejects(reportStaticPixPayment(digestPublicToken(publicToken), now), { statusCode: 409 })
        const p = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
        assert.equal(p.paymentReportedAt, null)
        assert.equal(p.reviewExpiresAt, null)
      }
    })
  }

  for (const decision of ["PAID", "FAILED"] as const) {
    it("audit: concurrent report x admin " + decision, async () => {
      const { admin, appointmentId, publicToken } = await auditFixture()
      const results = await Promise.all([
        report(publicToken),
        call("/admin/appointments/" + appointmentId + "/payment", { access: admin.access, body: { decision } }),
      ])
      assert.ok(results.every(r => [200, 409].includes(r.status)), JSON.stringify(results))
      assert.equal(results[1]!.status, 200)
      const p = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
      const a = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
      assert.equal(p.status, decision === "PAID" ? "PAID" : "PENDING")
      assert.equal(a.status, decision === "PAID" ? "CONFIRMED" : "PENDING")
      if (decision === "FAILED") assert.equal(p.paidAt, null)
    })
  }

  it("audit: retry preserves original report and review timestamps", async () => {
    const { admin, appointmentId, publicToken } = await auditFixture()
    const first = (await report(publicToken)).body.data
    const original = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal((await call("/admin/appointments/" + appointmentId + "/payment", { access: admin.access, body: { decision: "FAILED" } })).status, 200)
    const retry = await call("/booking/requests/" + publicToken)
    assert.equal(retry.body.data.payment.status, "PENDING")
    assert.ok(retry.body.data.pix)
    const again = await report(publicToken)
    assert.equal(again.status, 200)
    assert.deepEqual(again.body.data, first)
    assert.equal(await prisma.payment.count({ where: { appointmentId } }), 1)
    assert.equal(+(await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).expiresAt, +original.expiresAt)
  })

  it("audit: rejection after payment expiry releases slot immediately", async () => {
    const { admin, appointmentId, publicToken } = await auditFixture()
    await report(publicToken)
    await prisma.payment.update({ where: { appointmentId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    assert.equal((await call("/admin/appointments/" + appointmentId + "/payment", { access: admin.access, body: { decision: "FAILED" } })).status, 200)
    const p = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(p.status, "EXPIRED")
    assert.equal(p.paidAt, null)
    assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status, "EXPIRED")
    assert.equal((await report(publicToken)).status, 409)
  })

  it("audit: expired review x 10 competing bookings x repeated report", async () => {
    const { service, admin, appointmentId, publicToken } = await auditFixture()
    await report(publicToken)
    const past = new Date(Date.now() - 1000)
    await prisma.payment.update({ where: { appointmentId }, data: {
      paymentReportedAt: new Date(+past - 86_400_000), reviewExpiresAt: past,
    } })
    await prisma.appointment.update({ where: { id: appointmentId }, data: { pendingExpiresAt: past } })
    const { createAppointment } = await import("../modules/booking/appointments.service.js")
    const results = await Promise.allSettled(Array.from({ length: 10 }, () =>
      createAppointment({ userId: admin.id, serviceId: service.id, date: nextTuesday(), startsAt: "09:00" }, new Date(), "PUBLIC")))
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1)
    for (const r of results) if (r.status === "rejected") assert.equal(r.reason.statusCode, 409)
    assert.equal((await report(publicToken)).status, 409)
    assert.equal(await prisma.appointment.count({ where: { status: { in: ["PENDING", "AWAITING_PAYMENT", "CONFIRMED"] } } }), 1)
    const p = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(p.status, "EXPIRED")
    assert.equal(p.paidAt, null)
    const detail = await call("/admin/appointments/" + appointmentId, { access: admin.access })
    assert.equal(detail.body.data.appointment.payment.reviewOverdue, true)
  })

  it("audit: report x expiration cleanup rechecks deadline after row lock", async () => {
    const { service, admin, appointmentId, publicToken } = await auditFixture()
    const { createAppointment } = await import("../modules/booking/appointments.service.js")
    const { reportStaticPixPayment } = await import("../modules/payment/payment.service.js")
    const { digestPublicToken } = await import("../modules/booking/public-token.js")
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    const future = new Date(+payment.expiresAt + 1000)
    let unlock!: () => void
    let locked!: () => void
    const lockReady = new Promise<void>(resolve => { locked = resolve })
    const release = new Promise<void>(resolve => { unlock = resolve })
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId}::uuid FOR UPDATE`
      locked()
      await release
    }, { timeout: 15_000 })
    await lockReady
    // Wait for the report's SELECT FOR UPDATE to actually queue in PostgreSQL.
    const reportPromise = reportStaticPixPayment(digestPublicToken(publicToken), new Date())
    const waitFor = async (pattern: string) => {
      for (let i = 0; i < 100; i++) {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE ${pattern}`
        if (Number(rows[0]!.count) > 0) return
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw new Error("Expected blocked SQL not observed: " + pattern)
    }
    let rival!: ReturnType<typeof createAppointment>
    try {
      await waitFor("%FOR UPDATE%")
      rival = createAppointment({ userId: admin.id, serviceId: service.id, date: nextTuesday(), startsAt: "09:00" }, future, "PUBLIC")
      // Attach rejection handler before releasing the barrier.
      void rival.catch(() => {})
      await waitFor("%UPDATE%appointments%")
    } finally { unlock() }
    await blocker
    const reported = await reportPromise
    assert.ok(+reported.reviewExpiresAt > +future)
    await assert.rejects(rival, { statusCode: 409 })
    const a = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.equal(a.status, "PENDING")
    assert.equal(+a.pendingExpiresAt!, +reported.reviewExpiresAt)
  })

  it("audit: CHECKs reject unpaired or nonpositive review windows", async () => {
    const { appointmentId } = await auditFixture()
    for (const data of [
      { paymentReportedAt: new Date(), reviewExpiresAt: null },
      { paymentReportedAt: null, reviewExpiresAt: new Date() },
      { paymentReportedAt: new Date("2026-10-01"), reviewExpiresAt: new Date("2026-10-01") },
    ]) {
      await assert.rejects(prisma.payment.update({ where: { appointmentId }, data }))
    }
    const p = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(p.paymentReportedAt, null)
    assert.equal(p.reviewExpiresAt, null)
  })

  it("audit: dynamic provider and unapproved request cannot report", async () => {
    const { appointmentId, publicToken } = await auditFixture()
    await prisma.payment.update({ where: { appointmentId }, data: { provider: "DYNAMIC_TEST" } })
    assert.equal((await report(publicToken)).status, 409)
    const p = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.equal(p.paymentReportedAt, null)
    assert.equal(p.reviewExpiresAt, null)
    await prisma.payment.update({ where: { appointmentId }, data: { provider: "static-pix" } })

    /**
     * `PENDING` agora é justamente o estado que ACEITA declaração: o Pix nasce
     * com a solicitação e a pessoa paga antes de qualquer decisão. O que
     * continua recusado é declarar sobre um pedido já decidido — aí não há
     * pagamento em aberto, e aceitar criaria a ilusão de que alguém vai conferir.
     */
    assert.equal((await report(publicToken)).status, 200, "PENDING aceita declaração")

    for (const status of ["REJECTED", "CANCELLED", "CONFIRMED"] as const) {
      await prisma.payment.update({
        where: { appointmentId },
        data: { paymentReportedAt: null, reviewExpiresAt: null },
      })
      await prisma.appointment.update({ where: { id: appointmentId }, data: { status } })
      assert.equal((await report(publicToken)).status, 409, status + " não aceita declaração")
    }
  })

  it("audit: repeated rejection cannot extend a short review hold", async () => {
    const { admin, appointmentId, publicToken } = await auditFixture()
    const { reportStaticPixPayment, settleStaticPayment } = await import("../modules/payment/payment.service.js")
    const { getPublicRequest } = await import("../modules/booking/public-booking.service.js")
    const { digestPublicToken } = await import("../modules/booking/public-token.js")
    const now = new Date()
    await prisma.appointment.update({ where: { id: appointmentId }, data: {
      startsAt: new Date(+now + 90 * 60_000), endsAt: new Date(+now + 130 * 60_000),
      reservedEndsAt: new Date(+now + 130 * 60_000),
    } })
    const first = await reportStaticPixPayment(digestPublicToken(publicToken), now)
    for (let i = 0; i < 2; i++) await settleStaticPayment(admin.id, appointmentId, "FAILED", now)
    const a = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.equal(+a.pendingExpiresAt!, +first.reviewExpiresAt)
    const view = await getPublicRequest(publicToken, now)
    assert.equal(view.payment!.expiresAt, first.reviewExpiresAt.toISOString())
    const repeated = await reportStaticPixPayment(digestPublicToken(publicToken), new Date(+now + 60_000))
    assert.equal(+repeated.reportedAt, +first.reportedAt)
    assert.equal(+repeated.reviewExpiresAt, +first.reviewExpiresAt)
    await assert.rejects(reportStaticPixPayment(digestPublicToken(publicToken), first.reviewExpiresAt), { statusCode: 409 })
  })

  it("audit: expired review is discoverable in admin EXPIRED filter before cleanup", async () => {
    const { admin, appointmentId, publicToken } = await auditFixture()
    await report(publicToken)
    const past = new Date(Date.now() - 1000)
    await prisma.payment.update({ where: { appointmentId }, data: { paymentReportedAt: new Date(+past - 86_400_000), reviewExpiresAt: past } })
    await prisma.appointment.update({ where: { id: appointmentId }, data: { pendingExpiresAt: past } })
    const response = await call("/admin/agenda?from=" + nextTuesday() + "&status=EXPIRED", { access: admin.access })
    assert.equal(response.status, 200)
    const item = response.body.data.appointments.find((a: any) => a.id === appointmentId)
    assert.ok(item)
    assert.equal(item.payment.reviewOverdue, true)
  })

})
