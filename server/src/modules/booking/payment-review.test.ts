import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"

Object.assign(process.env, {
  DATABASE_URL: "postgresql://unused@127.0.0.1:1/erickcorttes_test",
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
  FRONTEND_URL: "http://localhost:8443",
})

const { BookingRules, canReviewPayment, paymentReviewDeadline, paymentWindowMinutesFor } =
  await import("./booking.rules.js")

/**
 * Prazos com relógio CONTROLADO.
 *
 * Nada aqui usa `new Date()`: os instantes são fixos, então o teste vale igual às
 * três da manhã e no horário de verão. Depender do relógio real transformaria um
 * limite exato em teste instável.
 */
const at = (iso: string) => new Date(iso)
const MINUTE = 60_000
const HOUR = 60 * MINUTE

describe("configuração dos prazos de Pix manual", () => {
  it("separa o prazo do cliente do prazo da barbearia", () => {
    // Duas horas para pagar: o cliente pode estar sem o app do banco à mão.
    assert.equal(BookingRules.staticPixPaymentWindowMinutes, 120)
    // Um dia para conferir: olhar extrato é trabalho humano.
    assert.equal(BookingRules.staticPixReviewWindowHours, 24)
    // Uma hora de folga: descobrir problema com o cliente na cadeira não serve.
    assert.equal(BookingRules.minimumReviewBufferBeforeAppointmentMinutes, 60)
    // O provedor continua em 15: lá a confirmação chega em segundos.
    assert.equal(BookingRules.paymentWindowMinutes, 15)
    assert.equal(paymentWindowMinutesFor("STATIC_PIX"), 120)
    assert.equal(paymentWindowMinutesFor("DYNAMIC_PROVIDER_PIX"), 15)
  })
})

describe("prazo de conferência: min(declarado + 24h, início − 1h)", () => {
  const reported = at("2026-10-01T10:00:00Z")

  it("atendimento distante: manda as 24 horas", () => {
    // Quatro dias à frente — a folga antes do atendimento nem chega perto.
    const deadline = paymentReviewDeadline(reported, at("2026-10-05T14:00:00Z"))
    assert.equal(deadline.getTime(), reported.getTime() + 24 * HOUR)
    assert.equal(deadline.toISOString(), "2026-10-02T10:00:00.000Z")
  })

  it("atendimento em 8 horas: manda a folga antes do atendimento", () => {
    const startsAt = at("2026-10-01T18:00:00Z")
    const deadline = paymentReviewDeadline(reported, startsAt)
    assert.equal(deadline.getTime(), startsAt.getTime() - 60 * MINUTE)
    assert.equal(deadline.toISOString(), "2026-10-01T17:00:00.000Z")
  })

  it("atendimento em 90 minutos: sobram 30 de conferência", () => {
    const deadline = paymentReviewDeadline(reported, at("2026-10-01T11:30:00Z"))
    assert.equal(deadline.getTime() - reported.getTime(), 30 * MINUTE)
  })

  it("no limite exato os dois prazos coincidem", () => {
    // Início 25h à frente: 24h depois da declaração é exatamente 1h antes.
    const deadline = paymentReviewDeadline(reported, at("2026-10-02T11:00:00Z"))
    assert.equal(deadline.getTime(), reported.getTime() + 24 * HOUR)
    assert.equal(deadline.getTime(), at("2026-10-02T11:00:00Z").getTime() - 60 * MINUTE)
  })

  it("um minuto além do limite volta a mandar as 24 horas", () => {
    const deadline = paymentReviewDeadline(reported, at("2026-10-02T11:01:00Z"))
    assert.equal(deadline.getTime(), reported.getTime() + 24 * HOUR)
  })
})

describe("existe conferência possível?", () => {
  const reported = at("2026-10-01T10:00:00Z")

  it("aceita enquanto sobrar qualquer margem", () => {
    // 61 minutos: sobra 1 minuto. Curto, mas existe.
    assert.equal(canReviewPayment(reported, at("2026-10-01T11:01:00Z")), true)
    assert.equal(canReviewPayment(reported, at("2026-10-01T12:00:00Z")), true)
    assert.equal(canReviewPayment(reported, at("2026-10-08T12:00:00Z")), true)
  })

  it("recusa em exatamente 60 minutos: a janela seria zero", () => {
    assert.equal(canReviewPayment(reported, at("2026-10-01T11:00:00Z")), false)
  })

  it("recusa quando o atendimento está mais perto que a folga", () => {
    for (const minutes of [59, 30, 10, 1, 0]) {
      const startsAt = new Date(reported.getTime() + minutes * MINUTE)
      assert.equal(canReviewPayment(reported, startsAt), false, `${minutes}min`)
    }
  })

  it("recusa atendimento já começado ou no passado", () => {
    assert.equal(canReviewPayment(reported, reported), false)
    assert.equal(canReviewPayment(reported, at("2026-10-01T09:00:00Z")), false)
  })

  it("quando aceita, o prazo é sempre futuro — nunca negativo", () => {
    for (const minutes of [61, 90, 120, 240, 1440, 10_080]) {
      const startsAt = new Date(reported.getTime() + minutes * MINUTE)
      if (!canReviewPayment(reported, startsAt)) continue
      assert.ok(
        paymentReviewDeadline(reported, startsAt).getTime() > reported.getTime(),
        `${minutes}min gerou prazo não-futuro`,
      )
    }
  })
})

describe("fuso horário", () => {
  it("o cálculo é sobre instantes, então o fuso da entrada não muda o resultado", () => {
    // O mesmo instante escrito de três formas: o prazo tem de ser idêntico.
    const utc = at("2026-10-01T13:00:00Z")
    const saoPaulo = at("2026-10-01T10:00:00-03:00")
    const tokyo = at("2026-10-01T22:00:00+09:00")
    const startsAt = at("2026-10-03T13:00:00Z")
    const expected = paymentReviewDeadline(utc, startsAt).getTime()
    assert.equal(paymentReviewDeadline(saoPaulo, startsAt).getTime(), expected)
    assert.equal(paymentReviewDeadline(tokyo, startsAt).getTime(), expected)
  })

  it("atravessar a virada do dia não altera a aritmética", () => {
    const reported = at("2026-10-01T23:30:00Z")
    const deadline = paymentReviewDeadline(reported, at("2026-10-06T10:00:00Z"))
    assert.equal(deadline.toISOString(), "2026-10-02T23:30:00.000Z")
  })
})
