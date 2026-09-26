import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"

Object.assign(process.env, {
  DATABASE_URL: "postgresql://unused@127.0.0.1:1/erickcorttes_test",
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
  FRONTEND_URL: "http://localhost:8443",
  BARBERSHOP_WHATSAPP_NUMBER: "+5571999990000",
})

const { buildConfirmationMessage, buildWhatsappLink } = await import("./whatsapp.js")
const { generatePublicReference, generateUniquePublicReference } = await import(
  "./public-reference.js"
)
const { paymentAmountCents, BookingRules } = await import("./booking.rules.js")

const confirmation = {
  serviceName: "Corte",
  date: "2026-09-29",
  startsAtClock: "18:20",
  reference: "EC-7F3K2Q",
  amountFormatted: "35,00",
  firstName: "Guilherme",
}

describe("mensagem de confirmação do WhatsApp", () => {
  it("traz serviço, data brasileira, horário, valor e referência", () => {
    const message = buildConfirmationMessage(confirmation)
    assert.match(message, /confirmado/i)
    assert.ok(message.includes("Serviço: Corte"))
    assert.ok(message.includes("Data: 29/09/2026"), "data em DD/MM/AAAA")
    assert.ok(message.includes("Horário: 18:20"))
    assert.ok(message.includes("R$ 35,00"))
    assert.ok(message.includes("Referência: EC-7F3K2Q"))
    assert.ok(message.includes("Nome: Guilherme"))
  })

  it("funciona sem valor e sem nome", () => {
    const message = buildConfirmationMessage({
      serviceName: "Barba",
      date: "2026-01-05",
      startsAtClock: "09:00",
      reference: "EC-ABCDEF",
    })
    assert.ok(message.includes("Data: 05/01/2026"))
    assert.ok(!message.includes("Pagamento"), "sem cobrança, sem linha de pagamento")
    assert.ok(!message.includes("Nome:"))
  })

  it("não contém segredo nenhum", () => {
    // A referência pública existe justamente para ocupar o lugar do token.
    const message = buildConfirmationMessage(confirmation)
    assert.doesNotMatch(message, /token|handle|bearer|eyJ|secret|senha|password/i)
  })
})

describe("link do WhatsApp", () => {
  it("aponta para o número da barbearia, só com dígitos", () => {
    const url = buildWhatsappLink(confirmation)!
    assert.ok(url.startsWith("https://wa.me/5571999990000?text="), url)
  })

  it("codifica a mensagem, incluindo quebras de linha e acentos", () => {
    const url = buildWhatsappLink(confirmation)!
    const encoded = url.split("?text=")[1]!
    // Nada de quebra de linha ou espaço cru na query.
    assert.ok(!encoded.includes("\n"))
    assert.ok(!encoded.includes(" "))
    assert.ok(encoded.includes("%0A"), "quebra de linha codificada")
    // E a volta é exatamente a mensagem.
    assert.equal(decodeURIComponent(encoded), buildConfirmationMessage(confirmation))
    assert.ok(decodeURIComponent(encoded).includes("Serviço"), "acento sobrevive")
  })

  it("o número do cliente nunca define o destinatário", () => {
    // Não há parâmetro por onde passar um destinatário: o único número que
    // entra na função vem do ambiente.
    const url = buildWhatsappLink({ ...confirmation, serviceName: "+5511888887777" })!
    assert.ok(url.startsWith("https://wa.me/5571999990000?"), "destino inalterado")
  })
})

describe("referência pública do agendamento", () => {
  it("usa o formato EC- e um alfabeto sem caracteres ambíguos", () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const reference = generatePublicReference()
      assert.match(reference, /^EC-[23456789ABCDEFGHJKLMNPQRTUVWXYZ]{6}$/)
      // 0, O, 1, I e S ficam de fora: a referência é ditada por telefone. O 5
      // fica porque, sem o S, deixa de ser ambíguo.
      assert.doesNotMatch(reference.slice(3), /[01IOS]/)
    }
  })

  it("tenta de novo quando colide e desiste com erro claro", async () => {
    let calls = 0
    const reference = await generateUniquePublicReference(async () => {
      calls += 1
      return calls < 3
    })
    assert.match(reference, /^EC-/)
    assert.equal(calls, 3)

    await assert.rejects(
      () => generateUniquePublicReference(async () => true, 4),
      /referência pública única/,
    )
  })
})

describe("valor cobrado", () => {
  it("modo FULL cobra o preço do catálogo", () => {
    assert.equal(BookingRules.paymentMode, "FULL")
    assert.equal(paymentAmountCents(3500), 3500)
    assert.equal(paymentAmountCents(12_000), 12_000)
  })

  it("o valor sai do preço, não de entrada do navegador", () => {
    // A função só aceita o preço congelado da reserva. Não há parâmetro de
    // valor, então não há por onde o cliente influenciar quanto se cobra.
    assert.equal(paymentAmountCents.length, 1)
  })
})
