import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  blockedRange,
  computeSlotStarts,
  fitsInAnyWindow,
  isStartOnSlotGrid,
  overlaps,
  windowsFromBusinessHours,
  type BusyInterval,
  type OpenWindow,
} from "./availability.engine.js"

const at = (clock: string): number => {
  const [h, m] = clock.split(":").map(Number)
  return h! * 60 + m!
}
const clock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`

const CONTINUOUS: OpenWindow[] = [{ startMinute: at("09:00"), endMinute: at("12:00") }]
/** Expediente real da barbearia: manhã, almoço, tarde. */
const SPLIT: OpenWindow[] = [
  { startMinute: at("09:00"), endMinute: at("12:00") },
  { startMinute: at("14:00"), endMinute: at("20:00") },
]

/** Durações reais do catálogo em produção. */
const CORTE = 30
const CORTE_BARBA = 40
const CABELO_PIGMENTACAO = 45
const COMPLETO = 50

function starts(input: {
  windows: OpenWindow[]
  busy?: BusyInterval[]
  durationMinutes: number
  slotIntervalMinutes?: number
  bufferBeforeMinutes?: number
  bufferAfterMinutes?: number
  earliestStartMinute?: number
}): string[] {
  return computeSlotStarts({
    busy: [],
    slotIntervalMinutes: 15,
    ...input,
  }).map(clock)
}

const busyAt = (from: string, to: string): BusyInterval => ({
  startMinute: at(from),
  endMinute: at(to),
})

describe("grade de início x duração do serviço", () => {
  it("a grade é sempre de 15 em 15, qualquer que seja a duração", () => {
    for (const duration of [CORTE, CORTE_BARBA, CABELO_PIGMENTACAO, COMPLETO]) {
      const result = starts({ windows: CONTINUOUS, durationMinutes: duration })
      assert.deepEqual(
        result.slice(0, 4),
        ["09:00", "09:15", "09:30", "09:45"],
        `duração ${duration} não deveria mudar o passo da grade`,
      )
    }
  })

  it("a duração muda até onde a grade vai, não o passo", () => {
    // Fecha 12:00: o último início é o que ainda termina dentro da janela.
    const cases: Array<[number, string]> = [
      [CORTE, "11:30"],
      [CORTE_BARBA, "11:15"],
      [CABELO_PIGMENTACAO, "11:15"],
      [COMPLETO, "11:00"],
    ]
    for (const [duration, expectedLast] of cases) {
      const result = starts({ windows: CONTINUOUS, durationMinutes: duration })
      assert.equal(result.at(-1), expectedLast, `duração ${duration}`)
    }
  })

  it("regressão: nenhum início cai fora da grade de 15 minutos", () => {
    // O sintoma relatado em produção era 09:00, 09:35, 10:10 — passo de 35,
    // que só existe se a grade for a duração do serviço somada a um buffer.
    for (const duration of [CORTE, CORTE_BARBA, CABELO_PIGMENTACAO, COMPLETO]) {
      for (const value of starts({ windows: SPLIT, durationMinutes: duration })) {
        assert.equal(
          at(value) % 15,
          0,
          `${value} não está na grade de 15 min (duração ${duration})`,
        )
      }
    }
  })
})

describe("janelas de expediente", () => {
  it("deriva duas janelas quando há intervalo de almoço", () => {
    assert.deepEqual(
      windowsFromBusinessHours({
        openMinute: at("09:00"),
        closeMinute: at("20:00"),
        breakStartMinute: at("12:00"),
        breakEndMinute: at("14:00"),
      }),
      SPLIT,
    )
  })

  it("deriva uma janela só quando não há intervalo", () => {
    assert.deepEqual(
      windowsFromBusinessHours({
        openMinute: at("09:00"),
        closeMinute: at("12:00"),
        breakStartMinute: null,
        breakEndMinute: null,
      }),
      CONTINUOUS,
    )
  })

  it("a tarde começa no início da janela, não num múltiplo contado desde a abertura", () => {
    const result = starts({ windows: SPLIT, durationMinutes: CORTE })
    assert.ok(result.includes("14:00"), "14:00 precisa ser oferecido")
    assert.ok(!result.includes("12:15"), "não pode oferecer horário no almoço")
    assert.ok(!result.includes("13:45"), "não pode oferecer horário no almoço")
  })

  it("atendimento não atravessa o almoço mesmo havendo expediente depois", () => {
    // 50 min às 11:30 terminaria 12:20. A agenda não é retomada às 14:00.
    const result = starts({ windows: SPLIT, durationMinutes: COMPLETO })
    assert.ok(!result.includes("11:30"))
    assert.ok(!result.includes("11:15"))
    assert.equal(
      result.filter(value => at(value) < at("12:00")).at(-1),
      "11:00",
      "último da manhã deve terminar exatamente às 11:50",
    )
  })

  it("atendimento não ultrapassa o fechamento", () => {
    const result = starts({ windows: SPLIT, durationMinutes: CABELO_PIGMENTACAO })
    assert.equal(result.at(-1), "19:15", "19:15 + 45 min = 20:00, o limite exato")
    assert.ok(!result.includes("19:30"))
  })

  it("dia sem expediente não oferece nada", () => {
    assert.deepEqual(starts({ windows: [], durationMinutes: CORTE }), [])
    assert.deepEqual(
      windowsFromBusinessHours({
        openMinute: at("09:00"),
        closeMinute: at("09:00"),
        breakStartMinute: null,
        breakEndMinute: null,
      }),
      [],
    )
  })
})

describe("agendamentos existentes", () => {
  it("cenário do enunciado: 09:30–10:10 ocupado, corte de 30 min", () => {
    const result = starts({
      windows: CONTINUOUS,
      busy: [busyAt("09:30", "10:10")],
      durationMinutes: CORTE,
    })
    assert.ok(result.includes("09:00"), "09:00–09:30 cabe antes do ocupado")
    assert.ok(!result.includes("09:15"), "09:15–09:45 invade o ocupado")
    assert.ok(!result.includes("09:30"))
    assert.ok(!result.includes("09:45"))
    assert.ok(!result.includes("10:00"), "10:00–10:30 invade até 10:10")
    assert.ok(result.includes("10:15"), "10:15–10:45 é o primeiro livre depois")
  })

  it("intervalo semiaberto: encostar não é conflito", () => {
    // Ocupado 09:00–09:30. Um corte às 09:30 começa exatamente no fim.
    const result = starts({
      windows: CONTINUOUS,
      busy: [busyAt("09:00", "09:30")],
      durationMinutes: CORTE,
    })
    assert.ok(result.includes("09:30"), "09:30 deve estar livre")
    assert.ok(!result.includes("09:00"))
  })

  it("encostado no início e no fim da janela", () => {
    const abertura = starts({
      windows: CONTINUOUS,
      busy: [busyAt("09:00", "09:30")],
      durationMinutes: CORTE,
    })
    assert.equal(abertura[0], "09:30")

    const fechamento = starts({
      windows: CONTINUOUS,
      busy: [busyAt("11:30", "12:00")],
      durationMinutes: CORTE,
    })
    assert.equal(fechamento.at(-1), "11:00")
  })

  it("vários agendamentos no mesmo dia", () => {
    const result = starts({
      windows: CONTINUOUS,
      busy: [busyAt("09:00", "09:40"), busyAt("10:00", "10:45"), busyAt("11:00", "11:30")],
      durationMinutes: CORTE,
    })
    assert.deepEqual(result, ["11:30"])
  })

  it("cancelado libera o horário: basta não estar entre os ocupados", () => {
    const ocupado = starts({
      windows: CONTINUOUS,
      busy: [busyAt("09:00", "09:30")],
      durationMinutes: CORTE,
    })
    const liberado = starts({ windows: CONTINUOUS, durationMinutes: CORTE })
    assert.ok(!ocupado.includes("09:00"))
    assert.ok(liberado.includes("09:00"))
  })

  it("período que atravessa a meia-noite é comparado no eixo estendido", () => {
    // Atendimento da véspera terminando 09:20 do dia consultado.
    const result = starts({
      windows: CONTINUOUS,
      busy: [{ startMinute: -60, endMinute: at("09:20") }],
      durationMinutes: CORTE,
    })
    assert.ok(!result.includes("09:00"))
    assert.equal(result[0], "09:30")
  })
})

describe("bloqueios administrativos", () => {
  it("bloqueio no meio do dia se comporta como atendimento", () => {
    const result = starts({
      windows: SPLIT,
      busy: [busyAt("14:00", "16:00")], // médico
      durationMinutes: CORTE,
    })
    assert.ok(!result.includes("14:00"))
    assert.ok(!result.includes("15:30"))
    assert.ok(result.includes("16:00"))
  })

  it("nenhum serviço atravessa parcialmente um bloqueio", () => {
    const result = starts({
      windows: SPLIT,
      busy: [busyAt("15:00", "15:30")],
      durationMinutes: COMPLETO,
    })
    // 14:30 + 50 = 15:20, invade o bloqueio.
    assert.ok(!result.includes("14:30"))
    assert.ok(result.includes("14:00"), "14:00 + 50 = 14:50, cabe antes")
    assert.ok(result.includes("15:30"), "logo após o bloqueio")
  })

  it("folga de dia inteiro zera a disponibilidade", () => {
    const result = starts({
      windows: SPLIT,
      busy: [{ startMinute: 0, endMinute: 24 * 60 }],
      durationMinutes: CORTE,
    })
    assert.deepEqual(result, [])
  })
})

describe("horário passado e antecedência", () => {
  it("não oferece início anterior à antecedência mínima", () => {
    const result = starts({
      windows: CONTINUOUS,
      durationMinutes: CORTE,
      earliestStartMinute: at("10:20"),
    })
    assert.equal(result[0], "10:30", "10:15 está abaixo do mínimo")
  })

  it("antecedência que ultrapassa o dia inteiro não deixa nada", () => {
    const result = starts({
      windows: CONTINUOUS,
      durationMinutes: CORTE,
      earliestStartMinute: at("23:00"),
    })
    assert.deepEqual(result, [])
  })

  it("antecedência negativa (dia futuro) não restringe nada", () => {
    const result = starts({
      windows: CONTINUOUS,
      durationMinutes: CORTE,
      earliestStartMinute: -5000,
    })
    assert.equal(result[0], "09:00")
  })
})

describe("buffers", () => {
  it("por padrão não mudam nada", () => {
    const semBuffer = starts({ windows: CONTINUOUS, durationMinutes: CORTE })
    const comZero = starts({
      windows: CONTINUOUS,
      durationMinutes: CORTE,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    })
    assert.deepEqual(semBuffer, comZero)
  })

  it("buffer depois reserva espaço além da duração", () => {
    const result = starts({
      windows: CONTINUOUS,
      busy: [busyAt("10:00", "10:30")],
      durationMinutes: CORTE,
      bufferAfterMinutes: 15,
    })
    // 09:30 + 30 + 15 de limpeza = 10:15, invade o ocupado.
    assert.ok(!result.includes("09:30"))
    assert.ok(result.includes("09:15"), "09:15 + 30 + 15 = 10:00, encosta sem invadir")
  })

  it("buffer antes reserva espaço para o preparo", () => {
    const result = starts({
      windows: CONTINUOUS,
      busy: [busyAt("09:00", "09:30")],
      durationMinutes: CORTE,
      bufferBeforeMinutes: 10,
    })
    assert.ok(!result.includes("09:30"), "o preparo começaria 09:20, dentro do ocupado")
    assert.ok(result.includes("09:45"))
  })

  it("buffer não muda o limite da duração no fechamento", () => {
    const result = starts({
      windows: CONTINUOUS,
      durationMinutes: CORTE,
      bufferAfterMinutes: 15,
    })
    // A duração continua mandando no encaixe da janela; o buffer some depois
    // do fechamento, que é o comportamento pretendido — limpar depois de
    // fechar é permitido, atender depois de fechar não.
    assert.equal(result.at(-1), "11:30")
  })

  it("buffers de vizinhos diferentes somam: limpeza de um, preparo do outro", () => {
    const result = starts({
      windows: CONTINUOUS,
      // Atendimento anterior 09:00–09:30 com 5 min de limpeza já expandidos.
      busy: [{ startMinute: at("09:00"), endMinute: at("09:35") }],
      durationMinutes: CORTE,
      bufferBeforeMinutes: 10,
    })
    // 09:30 tem o preparo às 09:20, dentro da limpeza do vizinho.
    assert.ok(!result.includes("09:30"))
    // 09:45 tem o preparo exatamente às 09:35, quando a limpeza termina.
    // Encostar não é conflito, aqui como em qualquer outro ponto da engine.
    assert.equal(result[0], "09:45")
  })
})

describe("primitivas", () => {
  it("overlaps trata o intervalo como [início, fim)", () => {
    assert.equal(overlaps(0, 30, 30, 60), false, "encostar não conflita")
    assert.equal(overlaps(0, 31, 30, 60), true)
    assert.equal(overlaps(10, 20, 0, 60), true, "contido conflita")
    assert.equal(overlaps(0, 60, 10, 20), true, "contém conflita")
    assert.equal(overlaps(0, 10, 20, 30), false)
  })

  it("blockedRange expande pelos buffers", () => {
    assert.deepEqual(blockedRange(600, 30), { startMinute: 600, endMinute: 630 })
    assert.deepEqual(blockedRange(600, 30, 10, 5), { startMinute: 590, endMinute: 635 })
  })

  it("fitsInAnyWindow exige o atendimento inteiro dentro de uma janela", () => {
    assert.equal(fitsInAnyWindow(SPLIT, at("11:30"), CORTE), true)
    assert.equal(fitsInAnyWindow(SPLIT, at("11:30"), COMPLETO), false)
    assert.equal(fitsInAnyWindow(SPLIT, at("13:00"), CORTE), false, "almoço")
    assert.equal(fitsInAnyWindow(SPLIT, at("19:45"), CORTE), false, "passa do fechamento")
    assert.equal(fitsInAnyWindow(SPLIT, at("19:30"), CORTE), true)
  })
})

describe("troca de serviço recalcula", () => {
  it("um horário válido para 30 min pode não valer para 50", () => {
    const busy = [busyAt("10:00", "10:30")]
    const corte = starts({ windows: CONTINUOUS, busy, durationMinutes: CORTE })
    const completo = starts({ windows: CONTINUOUS, busy, durationMinutes: COMPLETO })

    assert.ok(corte.includes("09:30"), "09:30–10:00 cabe para 30 min")
    assert.ok(!completo.includes("09:30"), "09:30–10:20 invade o ocupado")
  })

  it("aumentar a duração do serviço reduz a grade imediatamente", () => {
    const antes = starts({ windows: CONTINUOUS, durationMinutes: CORTE })
    const depois = starts({ windows: CONTINUOUS, durationMinutes: CABELO_PIGMENTACAO })
    assert.equal(antes.at(-1), "11:30")
    assert.equal(depois.at(-1), "11:15")
    assert.ok(depois.length < antes.length)
  })
})


describe("auditoria de limites e grade", () => {
  it("deriva os últimos horários das duas janelas para cada duração real", () => {
    const cases: Array<[number, string, string, number]> = [
      [30, "11:30", "19:30", 34],
      [40, "11:15", "19:15", 32],
      [45, "11:15", "19:15", 32],
      [50, "11:00", "19:00", 30],
    ]
    for (const [durationMinutes, morningLast, afternoonLast, count] of cases) {
      const slots = starts({ windows: SPLIT, durationMinutes })
      assert.equal(slots.filter(value => at(value) < at("12:00")).at(-1), morningLast)
      assert.equal(slots.at(-1), afternoonLast)
      assert.equal(slots.length, count)
      // Cada início deve caber inteiro em exatamente uma janela, sem almoço.
      for (const value of slots) {
        assert.ok(SPLIT.some(window =>
          at(value) >= window.startMinute && at(value) + durationMinutes <= window.endMinute,
        ))
      }
    }
  })

  it("bloqueio 10:00–11:00 preserva somente os limites semiabertos", () => {
    const slots = starts({
      windows: CONTINUOUS,
      busy: [busyAt("10:00", "11:00")],
      durationMinutes: 30,
    })
    assert.ok(slots.includes("09:30"))
    for (const blocked of ["09:45", "10:00", "10:45"]) {
      assert.ok(!slots.includes(blocked), blocked)
    }
    assert.ok(slots.includes("11:00"))
  })

  it("bloqueios encostados na abertura e no fechamento não tiram horários", () => {
    const slots = starts({
      windows: CONTINUOUS,
      busy: [busyAt("08:00", "09:00"), busyAt("12:00", "13:00")],
      durationMinutes: 30,
    })
    assert.equal(slots[0], "09:00")
    assert.equal(slots.at(-1), "11:30")
  })

  it("um único segundo ocupado depois do limite impede início nesse limite", () => {
    const slots = starts({
      windows: CONTINUOUS,
      busy: [{ startMinute: at("09:00"), endMinute: at("10:00") + 1 / 60 }],
      durationMinutes: 30,
    })
    assert.ok(!slots.includes("10:00"))
    assert.equal(slots[0], "10:15")
  })

  it("antecedência mínima preserva até frações de minuto", () => {
    const slots = starts({
      windows: CONTINUOUS,
      durationMinutes: 30,
      earliestStartMinute: at("10:00") + 1 / 60_000,
    })
    assert.equal(slots[0], "10:15")
  })

  it("valida a mesma grade da consulta e reancora em cada janela", () => {
    const windows = [
      { startMinute: at("09:05"), endMinute: at("12:00") },
      { startMinute: at("14:10"), endMinute: at("20:00") },
    ]
    for (const start of computeSlotStarts({ windows, busy: [], durationMinutes: 40, slotIntervalMinutes: 15 })) {
      assert.equal(isStartOnSlotGrid(windows, start, 15), true)
    }
    for (const start of ["09:00", "09:06", "12:05", "14:05", "20:00"]) {
      assert.equal(isStartOnSlotGrid(windows, at(start), 15), false, start)
    }
    assert.equal(isStartOnSlotGrid(windows, at("09:20"), 15), true)
    assert.equal(isStartOnSlotGrid(windows, at("14:10"), 15), true)
  })
})


describe("parâmetros inválidos da grade", () => {
  it("não oferece inícios com duração ou intervalo não finitos ou não positivos", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1]) {
      assert.deepEqual(starts({ windows: CONTINUOUS, durationMinutes: value }), [])
      assert.deepEqual(starts({ windows: CONTINUOUS, durationMinutes: 30, slotIntervalMinutes: value }), [])
    }
  })
})
