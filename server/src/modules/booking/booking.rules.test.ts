import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { BookingRules, overlapScanFrom, reservedMinutesFor } from "./booking.rules.js"
import { createServiceSchema } from "./booking.schemas.js"

/**
 * O recuo da varredura de sobreposição não pode envelhecer em silêncio.
 *
 * `overlapLookbackMinutes` existe por desempenho: sem limite inferior em
 * `starts_at` a condição deixa de ser faixa e o PostgreSQL varre o histórico.
 * Mas um recuo CURTO DEMAIS deixa de fora um atendimento que começou ontem e
 * invade a manhã de hoje — e aí o horário ocupado volta a ser oferecido, que é
 * um defeito muito pior que lentidão.
 *
 * Estes testes descobrem o teto de duração pelo PRÓPRIO schema, em vez de
 * repetir o número. Se alguém levantar o limite de duração ou reintroduzir
 * buffers a ponto de encostar no recuo, isto falha antes de virar
 * disponibilidade errada.
 */

/** Maior duração que o catálogo aceita hoje, perguntada ao schema. */
function largestAcceptedDuration(): number {
  const base = { name: "Sonda", priceCents: 1000, active: true }
  let accepted = 0
  // Teto generoso: se um dia o schema aceitar mais que isto, o laço revela.
  for (const durationMinutes of [30, 60, 120, 240, 480, 720, 960, 1440, 2880]) {
    const result = createServiceSchema.safeParse({ ...base, durationMinutes })
    if (result.success) accepted = durationMinutes
  }
  assert.ok(accepted > 0, "o schema não aceitou nenhuma duração — sonda quebrada")
  return accepted
}

describe("recuo da varredura de sobreposição", () => {
  it("cobre a maior reserva que o catálogo consegue produzir", () => {
    const maxDuration = largestAcceptedDuration()
    const maxReserved = reservedMinutesFor(maxDuration)

    assert.ok(
      BookingRules.overlapLookbackMinutes >= maxReserved,
      `recuo de ${BookingRules.overlapLookbackMinutes}min não cobre reserva de ` +
        `${maxReserved}min. Aumente overlapLookbackMinutes — senão um atendimento ` +
        `iniciado no dia anterior sai da busca e o horário é oferecido duas vezes.`,
    )
  })

  it("mantém folga de pelo menos 2x sobre a maior reserva", () => {
    // Folga para mudanças de catálogo não encostarem no limite sem aviso.
    const maxReserved = reservedMinutesFor(largestAcceptedDuration())
    assert.ok(
      BookingRules.overlapLookbackMinutes >= maxReserved * 2,
      `folga insuficiente: recuo ${BookingRules.overlapLookbackMinutes}min para ` +
        `reserva máxima de ${maxReserved}min.`,
    )
  })

  it("nunca recua menos que um dia inteiro", () => {
    // Bloqueios vão de meia-noite a meia-noite (`blockWholeDay`): recuar menos
    // que 24h deixaria de encontrar um bloqueio de dia inteiro que termina
    // exatamente no início do dia consultado.
    assert.ok(BookingRules.overlapLookbackMinutes >= 24 * 60)
  })

  it("overlapScanFrom subtrai exatamente o recuo configurado", () => {
    const dayStart = new Date("2026-06-10T03:00:00.000Z")
    const scanFrom = overlapScanFrom(dayStart)
    assert.equal(
      dayStart.getTime() - scanFrom.getTime(),
      BookingRules.overlapLookbackMinutes * 60_000,
    )
    // E não mexe no original.
    assert.equal(dayStart.toISOString(), "2026-06-10T03:00:00.000Z")
  })

  it("a grade e a reserva mínima seguem como estavam", () => {
    // Guardas de regressão: a auditoria mexeu em desempenho, não em regra.
    assert.equal(BookingRules.baseSlotMinutes, 40)
    assert.equal(BookingRules.adaptiveSchedulingEnabled, true)
  })
})
