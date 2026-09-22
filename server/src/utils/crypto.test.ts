import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  generateOtpCode,
  generateRefreshToken,
  hashOtpCode,
  hashRefreshToken,
  verifyOtpCode,
} from "./crypto.js"

describe("generateOtpCode", () => {
  it("gera sempre 6 dígitos, incluindo com zeros à esquerda", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateOtpCode()
      assert.match(code, /^\d{6}$/)
    }
  })

  it("não repete o mesmo código de forma óbvia", () => {
    const amostra = new Set(Array.from({ length: 50 }, () => generateOtpCode()))
    assert.ok(amostra.size > 40, "entropia suspeita na geração de OTP")
  })
})

describe("hashOtpCode / verifyOtpCode", () => {
  it("nunca guarda o código em texto puro", async () => {
    const hash = await hashOtpCode("123456")
    assert.ok(!hash.includes("123456"))
    assert.ok(hash.startsWith("scrypt$"))
  })

  it("usa salt distinto a cada hash", async () => {
    const a = await hashOtpCode("123456")
    const b = await hashOtpCode("123456")
    assert.notEqual(a, b)
  })

  it("valida o código correto", async () => {
    const hash = await hashOtpCode("123456")
    assert.equal(await verifyOtpCode("123456", hash), true)
  })

  it("recusa o código errado", async () => {
    const hash = await hashOtpCode("123456")
    assert.equal(await verifyOtpCode("654321", hash), false)
    assert.equal(await verifyOtpCode("000000", hash), false)
  })

  it("recusa hash malformado sem explodir", async () => {
    assert.equal(await verifyOtpCode("123456", "lixo"), false)
    assert.equal(await verifyOtpCode("123456", "scrypt$só-uma-parte"), false)
    assert.equal(await verifyOtpCode("123456", "bcrypt$aa$bb"), false)
  })
})

describe("refresh token", () => {
  it("gera tokens de alta entropia e únicos", () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => generateRefreshToken()),
    )
    assert.equal(tokens.size, 100)
    assert.ok(generateRefreshToken().length >= 40)
  })

  it("hash é determinístico e não reversível ao token", () => {
    const token = generateRefreshToken()
    const hash = hashRefreshToken(token)
    assert.equal(hash, hashRefreshToken(token))
    assert.ok(!hash.includes(token))
    assert.match(hash, /^[a-f0-9]{64}$/)
  })
})

it("hash com hex inválido ou tamanho zero não valida OTP", async () => {
  for (const value of [
    "scrypt$zz$zz",
    "scrypt$$",
    "scrypt$" + "a".repeat(32) + "$zz",
  ])
    assert.equal(await verifyOtpCode("123456", value), false)
})
