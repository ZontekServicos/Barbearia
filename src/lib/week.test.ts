import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { addDaysISO, mondayOf, sameWeek, weekRangeFor } from "./week.js"

describe("mondayOf", () => {
  it("segunda devolve ela mesma", () => {
    assert.equal(mondayOf("2026-09-21"), "2026-09-21")
  })

  it("qualquer dia da semana cai na mesma segunda", () => {
    for (const day of [
      "2026-09-21", // segunda
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26", // sábado
      "2026-09-27", // domingo
    ]) {
      assert.equal(mondayOf(day), "2026-09-21", day)
    }
  })

  it("domingo pertence à semana que começou na segunda anterior", () => {
    // O erro clássico aqui é recuar 1 dia e mandar domingo para a semana
    // seguinte, deslocando a faixa inteira.
    assert.equal(mondayOf("2026-09-27"), "2026-09-21")
    assert.equal(mondayOf("2026-09-28"), "2026-09-28")
  })

  it("atravessa mês e ano", () => {
    assert.equal(mondayOf("2026-01-01"), "2025-12-29")
    assert.equal(mondayOf("2026-03-01"), "2026-02-23")
  })
})

describe("weekRangeFor", () => {
  it("cobre segunda a sábado", () => {
    const week = weekRangeFor("2026-09-24")
    assert.equal(week.from, "2026-09-21")
    assert.equal(week.to, "2026-09-26")
    assert.deepEqual(week.days, [
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
    ])
  })
})

/*
 * Estes testes são a regressão do loop da Agenda.
 *
 * A causa raiz era uma dependência de efeito que trocava de identidade a cada
 * render (`startOfWeek()` devolvendo uma `Date` nova). Aqui provamos a
 * invariante que a correção estabelece: a chave da semana é estável por VALOR,
 * então o efeito que depende dela não pode disparar sozinho.
 *
 * Isto é um teste de lógica, não de renderização — o projeto não tem DOM de
 * teste montado, e trazer um só para isso custaria mais do que entrega.
 */
describe("regressão do loop da Agenda", () => {
  it("a chave da semana é igual por valor entre chamadas repetidas", () => {
    // Simula renders sucessivos com o mesmo estado.
    const renders = Array.from({ length: 50 }, () => weekRangeFor("2026-09-24"))
    for (const render of renders) {
      assert.equal(render.from, renders[0]!.from)
      assert.equal(render.to, renders[0]!.to)
    }
    // O ponto: a chave que entra em [weekFrom, weekTo] não muda sozinha.
    const keys = new Set(renders.map(r => `${r.from}..${r.to}`))
    assert.equal(keys.size, 1, "render sem mudança de estado não pode gerar nova chave")
  })

  it("trocar de dia dentro da mesma semana não muda a chave: zero requisições novas", () => {
    const week = weekRangeFor("2026-09-21")
    for (const day of week.days) {
      const afterClick = weekRangeFor(day)
      assert.equal(afterClick.from, week.from, `clicar em ${day} não pode refazer a consulta`)
      assert.equal(afterClick.to, week.to)
      assert.ok(sameWeek(day, "2026-09-21"))
    }
  })

  it("trocar de semana muda a chave exatamente uma vez", () => {
    const start = "2026-09-24"
    const next = addDaysISO(start, 7)
    const previous = addDaysISO(start, -7)

    assert.notEqual(weekRangeFor(next).from, weekRangeFor(start).from)
    assert.notEqual(weekRangeFor(previous).from, weekRangeFor(start).from)
    assert.ok(!sameWeek(start, next))

    // Avançar e voltar retorna à mesma chave: nada de deriva acumulada.
    assert.equal(weekRangeFor(addDaysISO(next, -7)).from, weekRangeFor(start).from)
  })

  it("navegar entre semanas preserva o dia da semana", () => {
    // Quinta -> quinta, não segunda. Quem procura uma sexta continua na sexta.
    const thursday = "2026-09-24"
    const nextThursday = addDaysISO(thursday, 7)
    assert.equal(nextThursday, "2026-10-01")
    assert.equal(
      new Date(nextThursday + "T00:00:00Z").getUTCDay(),
      new Date(thursday + "T00:00:00Z").getUTCDay(),
    )
  })
})
