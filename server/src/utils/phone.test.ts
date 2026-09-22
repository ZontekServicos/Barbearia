import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  formatPhoneForDisplay,
  isValidPhone,
  maskPhone,
  normalizePhone,
} from "./phone.js"
import { AppError } from "./errors.js"

describe("normalizePhone", () => {
  it("normaliza as formas que o usuário digita para o mesmo E.164", () => {
    const esperado = "+5571999991111"
    const entradas = [
      "(71) 99999-1111",
      "71999991111",
      "71 99999 1111",
      "+55 71 99999-1111",
      "5571999991111",
      "+5571999991111",
    ]

    for (const entrada of entradas) {
      assert.equal(
        normalizePhone(entrada),
        esperado,
        `falhou para "${entrada}"`,
      )
    }
  })

  it("remove zero de tronco em chamadas nacionais", () => {
    assert.equal(normalizePhone("055 71 99999-1111"), "+5571999991111")
  })

  it("rejeita telefone fixo (sem o nono dígito)", () => {
    assert.throws(() => normalizePhone("(71) 3333-4444"), AppError)
  })

  it("rejeita DDD inválido", () => {
    assert.throws(() => normalizePhone("(01) 99999-1111"), AppError)
    assert.throws(() => normalizePhone("(70) 99999-1111"), AppError)
  })

  it("rejeita quantidade de dígitos incorreta", () => {
    assert.throws(() => normalizePhone("9999"), AppError)
    assert.throws(() => normalizePhone("719999911112222"), AppError)
  })

  it("rejeita entrada vazia", () => {
    assert.throws(() => normalizePhone(""), AppError)
    assert.throws(() => normalizePhone("abc"), AppError)
  })

  it("é idempotente", () => {
    const uma = normalizePhone("(71) 99999-1111")
    assert.equal(normalizePhone(uma), uma)
  })
})

describe("isValidPhone", () => {
  it("não lança, apenas responde", () => {
    assert.equal(isValidPhone("(71) 99999-1111"), true)
    assert.equal(isValidPhone("(71) 3333-4444"), false)
  })
})

describe("formatPhoneForDisplay", () => {
  it("converte E.164 para o formato brasileiro", () => {
    assert.equal(formatPhoneForDisplay("+5571999991111"), "(71) 99999-1111")
  })

  it("devolve a entrada quando não reconhece o padrão", () => {
    assert.equal(formatPhoneForDisplay("+12025550123"), "+12025550123")
  })
})

describe("maskPhone", () => {
  it("esconde o miolo do número para logs", () => {
    const mascarado = maskPhone("+5571999991111")
    assert.equal(mascarado, "+5571****1111")
    assert.ok(!mascarado.includes("99999"))
  })
})

it("rejeita letras misturadas, símbolos e DDD não atribuído", () => {
  for (const value of [
    "abc71999991111",
    "71/99999-1111",
    "(20) 99999-1111",
    "(76) 99999-1111",
    "++5571999991111",
  ])
    assert.throws(() => normalizePhone(value), AppError)
})
it("aceita as cinco variantes brasileiras solicitadas", () => {
  for (const value of [
    "+5571999999999",
    "5571999999999",
    "71999999999",
    "(71) 99999-9999",
    "71 99999-9999",
  ])
    assert.equal(normalizePhone(value), "+5571999999999")
})
