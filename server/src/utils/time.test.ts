import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  addDaysToShopDate,
  clockToMinutes,
  instantToShopDate,
  instantToShopMinutes,
  intervalsOverlap,
  minutesToClock,
  parseShopDate,
  shopWallClockToInstant,
  shopWeekday,
} from "./time.js"
import { AppError } from "./errors.js"

describe("shopWallClockToInstant", () => {
  it("converte hora de parede da barbearia para UTC", () => {
    // 22/09/2026 09:00 em America/Sao_Paulo (UTC-3) = 12:00 UTC
    const instant = shopWallClockToInstant("2026-09-22", 9 * 60)
    assert.equal(instant.toISOString(), "2026-09-22T12:00:00.000Z")
  })

  it("trata meia-noite local", () => {
    const instant = shopWallClockToInstant("2026-09-22", 0)
    assert.equal(instant.toISOString(), "2026-09-22T03:00:00.000Z")
  })

  it("é a inversa de instantToShopMinutes", () => {
    for (const minutes of [0, 9 * 60, 13 * 60 + 30, 19 * 60, 23 * 60 + 59]) {
      const instant = shopWallClockToInstant("2026-09-22", minutes)
      assert.equal(instantToShopMinutes(instant), minutes, `falhou em ${minutes}`)
      assert.equal(instantToShopDate(instant), "2026-09-22")
    }
  })

  it("não deixa a data escorregar perto da meia-noite", () => {
    // 23:30 local continua sendo o mesmo dia local, mesmo já sendo outro dia em UTC.
    const instant = shopWallClockToInstant("2026-09-22", 23 * 60 + 30)
    assert.equal(instant.toISOString(), "2026-09-23T02:30:00.000Z")
    assert.equal(instantToShopDate(instant), "2026-09-22")
  })

  it("rejeita data malformada ou inexistente", () => {
    assert.throws(() => shopWallClockToInstant("22/09/2026", 540), AppError)
    assert.throws(() => shopWallClockToInstant("2026-02-30", 540), AppError)
    assert.throws(() => shopWallClockToInstant("2026-13-01", 540), AppError)
  })
})

describe("parseShopDate", () => {
  it("aceita data válida", () => {
    assert.deepEqual(parseShopDate("2026-09-22"), { year: 2026, month: 9, day: 22 })
  })

  it("aceita ano bissexto correto e rejeita o inválido", () => {
    assert.doesNotThrow(() => parseShopDate("2028-02-29"))
    assert.throws(() => parseShopDate("2026-02-29"), AppError)
  })
})

describe("shopWeekday", () => {
  it("mapeia domingo em 0 e sábado em 6", () => {
    assert.equal(shopWeekday("2026-09-20"), 0)
    assert.equal(shopWeekday("2026-09-22"), 2)
    assert.equal(shopWeekday("2026-09-26"), 6)
  })
})

describe("minutesToClock / clockToMinutes", () => {
  it("converte nos dois sentidos", () => {
    assert.equal(minutesToClock(0), "00:00")
    assert.equal(minutesToClock(9 * 60), "09:00")
    assert.equal(minutesToClock(19 * 60 + 30), "19:30")
    assert.equal(clockToMinutes("09:00"), 540)
    assert.equal(clockToMinutes("19:30"), 1170)
  })

  it("rejeita horário inválido", () => {
    assert.throws(() => clockToMinutes("24:00"), AppError)
    assert.throws(() => clockToMinutes("9:00"), AppError)
    assert.throws(() => clockToMinutes("09:60"), AppError)
    assert.throws(() => clockToMinutes("abc"), AppError)
  })
})

describe("addDaysToShopDate", () => {
  it("atravessa meses e anos", () => {
    assert.equal(addDaysToShopDate("2026-09-22", 1), "2026-09-23")
    assert.equal(addDaysToShopDate("2026-09-30", 1), "2026-10-01")
    assert.equal(addDaysToShopDate("2026-12-31", 1), "2027-01-01")
    assert.equal(addDaysToShopDate("2026-09-01", -1), "2026-08-31")
  })
})

describe("intervalsOverlap", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 22, h, m))

  it("detecta sobreposição parcial", () => {
    assert.equal(intervalsOverlap(at(9), at(10), at(9, 30), at(10, 30)), true)
  })

  it("trata o intervalo como [início, fim): encostar não é conflito", () => {
    assert.equal(intervalsOverlap(at(9), at(10), at(10), at(11)), false)
    assert.equal(intervalsOverlap(at(10), at(11), at(9), at(10)), false)
  })

  it("detecta contenção total", () => {
    assert.equal(intervalsOverlap(at(9), at(12), at(10), at(11)), true)
    assert.equal(intervalsOverlap(at(10), at(11), at(9), at(12)), true)
  })

  it("nega intervalos distantes", () => {
    assert.equal(intervalsOverlap(at(9), at(10), at(14), at(15)), false)
  })
})
