import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeSlotGrid, computeSlotStarts, type TaggedBusyInterval } from "./availability.engine.js"

/**
 * Grade completa: o que aparece cinza, e por quê.
 *
 * Função pura sobre minutos do dia — sem banco, sem fuso, sem relógio. Os
 * horários são escritos em minutos desde a meia-noite para o teste falar da
 * mesma coisa que a engine.
 */

const h = (hour: number, minute = 0) => hour * 60 + minute
/** Expediente padrão: 09:00–12:00 e 14:00–19:00 (almoço parte o dia). */
const windows = [
  { startMinute: h(9), endMinute: h(12) },
  { startMinute: h(14), endMinute: h(19) },
]
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`

/** Grade com os parâmetros reais do produto: grade de 40 min, corte de 30. */
function grid(busy: TaggedBusyInterval[] = [], over: Record<string, unknown> = {}) {
  return computeSlotGrid({
    windows,
    busy,
    durationMinutes: 30,
    reservedMinutes: 40,
    slotIntervalMinutes: 40,
    adaptive: true,
    ...over,
  })
}
const at = (entries: ReturnType<typeof grid>, minutes: number) =>
  entries.find(entry => entry.startMinute === minutes)

describe("grade completa do dia", () => {
  it("mostra todos os inícios da grade, livres e ocupados", () => {
    const entries = grid()
    // 09:00, 09:40, 10:20, 11:00, 11:40 na manhã; a tarde a partir de 14:00.
    assert.ok(entries.length > 5, `apenas ${entries.length} entradas`)
    assert.ok(at(entries, h(9))?.available)
    assert.ok(at(entries, h(9, 40))?.available)
    // Sem nada ocupado, nenhum motivo.
    assert.ok(entries.filter(entry => entry.available).every(entry => entry.reason === null))
  })

  it("não pula o intervalo de almoço nem oferece início dentro dele", () => {
    const entries = grid()
    assert.equal(at(entries, h(12)), undefined, "12:00 não é início de janela")
    assert.equal(at(entries, h(13)), undefined, "13:00 está fora do expediente")
    assert.ok(at(entries, h(14)), "a tarde começa na grade")
  })

  it("vem ordenada e sem início repetido", () => {
    const entries = grid([{ startMinute: h(10), endMinute: h(10, 40), kind: "APPOINTMENT" }])
    const minutes = entries.map(entry => entry.startMinute)
    assert.deepEqual([...minutes].sort((a, b) => a - b), minutes, "fora de ordem")
    assert.equal(new Set(minutes).size, minutes.length, "início repetido")
  })
})

describe("motivo da indisponibilidade", () => {
  it("agendamento marca APPOINTMENT", () => {
    const entries = grid([{ startMinute: h(9), endMinute: h(9, 40), kind: "APPOINTMENT" }])
    const slot = at(entries, h(9))!
    assert.equal(slot.available, false)
    assert.equal(slot.reason, "APPOINTMENT")
  })

  it("bloqueio manual marca BLOCK", () => {
    const entries = grid([{ startMinute: h(9), endMinute: h(9, 40), kind: "BLOCK" }])
    const slot = at(entries, h(9))!
    assert.equal(slot.available, false)
    assert.equal(slot.reason, "BLOCK")
  })

  it("agendamento vence bloqueio quando os dois cobrem o mesmo horário", () => {
    // É o que a barbearia NÃO pode liberar por aqui: mostrar BLOCK ali ofereceria
    // um botão de "liberar" que apagaria a reserva de alguém.
    const entries = grid([
      { startMinute: h(9), endMinute: h(9, 40), kind: "BLOCK" },
      { startMinute: h(9), endMinute: h(9, 40), kind: "APPOINTMENT" },
    ])
    assert.equal(at(entries, h(9))!.reason, "APPOINTMENT")
  })

  it("antes da antecedência mínima marca PAST", () => {
    const entries = grid([], { earliestStartMinute: h(10, 30) })
    assert.equal(at(entries, h(9))!.reason, "PAST")
    assert.equal(at(entries, h(9, 40))!.reason, "PAST")
    assert.ok(at(entries, h(11))?.available, "11:00 continua livre")
  })

  it("passado vence conflito: nada reverte o tempo", () => {
    const entries = grid([{ startMinute: h(9), endMinute: h(9, 40), kind: "BLOCK" }], {
      earliestStartMinute: h(10),
    })
    assert.equal(at(entries, h(9))!.reason, "PAST")
  })

  it("início cujo atendimento não cabe na janela marca OUTSIDE_HOURS", () => {
    // Grade de 40 em janela que fecha às 12:00: 11:40 + 30 min passaria de 12:10.
    const entries = grid()
    const tail = at(entries, h(11, 40))!
    assert.equal(tail.available, false)
    assert.equal(tail.reason, "OUTSIDE_HOURS")
    // E continua VISÍVEL: sumir deixaria um buraco que parece defeito.
    assert.ok(tail, "o início que não cabe precisa aparecer na grade")
  })
})

describe("bloqueio por intervalo real, não por índice de slot", () => {
  it("um bloqueio de 09:30–11:00 derruba todos os inícios que ele intercepta", () => {
    // O bloqueio não coincide com nenhum início da grade — e tem de pegar os
    // três cujo intervalo reservado encosta nele.
    const entries = grid([{ startMinute: h(9, 30), endMinute: h(11), kind: "BLOCK" }])
    for (const minutes of [h(9), h(9, 40), h(10, 20)]) {
      const slot = at(entries, minutes)!
      assert.equal(slot.available, false, clock(minutes))
      assert.equal(slot.reason, "BLOCK", clock(minutes))
    }
    // 11:00 é o fim do bloqueio: intervalo meio-aberto, então já está livre.
    assert.equal(at(entries, h(11))!.available, true)
  })

  it("bloqueio de um minuto ainda derruba o início que ele toca", () => {
    const entries = grid([{ startMinute: h(10), endMinute: h(10, 1), kind: "BLOCK" }])
    assert.equal(at(entries, h(9, 40))!.available, false, "09:40 reserva até 10:20")
    assert.equal(at(entries, h(9))!.available, true, "09:00 reserva até 09:40")
  })

  it("bloqueio adjacente não derruba: o intervalo é meio-aberto", () => {
    // Reserva de 09:00 vai até 09:40. Um bloqueio que começa 09:40 não conflita.
    const entries = grid([{ startMinute: h(9, 40), endMinute: h(10), kind: "BLOCK" }])
    assert.equal(at(entries, h(9))!.available, true)
    assert.equal(at(entries, h(9, 40))!.available, false)
  })

  it("dia inteiro bloqueado deixa a grade visível e tudo indisponível", () => {
    const entries = grid([{ startMinute: 0, endMinute: 24 * 60, kind: "BLOCK" }])
    assert.ok(entries.length > 0, "a grade não pode esvaziar")
    assert.ok(entries.every(entry => entry.available === false))
    /**
     * O motivo é BLOCK na maioria, mas os inícios do fim de cada janela saem
     * como OUTSIDE_HOURS — e isso é certo: 11:40 não hospeda um corte de 30 min
     * antes das 12:00 nem sem bloqueio nenhum. Geometria é checada antes de
     * circunstância, então o motivo exibido é o que explica melhor.
     */
    assert.ok(
      entries.every(entry => entry.reason === "BLOCK" || entry.reason === "OUTSIDE_HOURS"),
      JSON.stringify(entries.map(entry => entry.reason)),
    )
    assert.ok(entries.some(entry => entry.reason === "BLOCK"), "o bloqueio precisa aparecer")
  })
})

describe("a grade descreve; quem decide o reservável é computeSlotStarts", () => {
  /**
   * Invariante central: tudo que a grade marca como disponível tem de estar na
   * lista de inícios reserváveis. Se divergir, a tela oferece um botão que a
   * criação de agendamento recusa — ou pior, esconde um horário vendável.
   */
  const scenarios: Array<{ nome: string; busy: TaggedBusyInterval[]; earliest?: number }> = [
    { nome: "dia vazio", busy: [] },
    { nome: "um agendamento", busy: [{ startMinute: h(10), endMinute: h(10, 40), kind: "APPOINTMENT" }] },
    { nome: "bloqueio atravessado", busy: [{ startMinute: h(9, 30), endMinute: h(11), kind: "BLOCK" }] },
    {
      nome: "agendamento e bloqueio",
      busy: [
        { startMinute: h(9), endMinute: h(9, 40), kind: "APPOINTMENT" },
        { startMinute: h(15), endMinute: h(16), kind: "BLOCK" },
      ],
    },
    { nome: "com antecedência mínima", busy: [], earliest: h(11) },
    { nome: "dia inteiro bloqueado", busy: [{ startMinute: 0, endMinute: 24 * 60, kind: "BLOCK" }] },
  ]

  for (const scenario of scenarios) {
    it(`concorda com os inícios reserváveis: ${scenario.nome}`, () => {
      const shared = {
        windows,
        durationMinutes: 30,
        reservedMinutes: 40,
        slotIntervalMinutes: 40,
        adaptive: true,
        ...(scenario.earliest === undefined ? {} : { earliestStartMinute: scenario.earliest }),
      }
      const bookable = new Set(computeSlotStarts({ ...shared, busy: scenario.busy }))
      const described = computeSlotGrid({ ...shared, busy: scenario.busy })

      for (const entry of described) {
        assert.equal(
          entry.available,
          bookable.has(entry.startMinute),
          `${clock(entry.startMinute)}: grade diz ${entry.available}, reservável diz ${bookable.has(entry.startMinute)}`,
        )
      }
      // E nenhum início reservável fica fora da grade.
      for (const minutes of bookable) {
        assert.ok(
          described.some(entry => entry.startMinute === minutes),
          `${clock(minutes)} é reservável mas não aparece na grade`,
        )
      }
    })
  }
})

describe("entradas inválidas", () => {
  it("devolve grade vazia em vez de inventar horário", () => {
    for (const broken of [
      { durationMinutes: 0 },
      { durationMinutes: -30 },
      { slotIntervalMinutes: 0 },
      { reservedMinutes: 0 },
      { durationMinutes: Number.NaN },
    ]) {
      assert.deepEqual(grid([], broken), [], JSON.stringify(broken))
    }
  })

  it("dia sem expediente devolve grade vazia", () => {
    assert.deepEqual(grid([], { windows: [] }), [])
  })
})
