import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  generateRefreshToken,
  generateTemporaryPassword,
  hashRefreshToken,
} from "./crypto.js"

describe("generateRefreshToken", () => {
  it("produz 256 bits em base64url, sem caracteres que quebrem cookie ou URL", () => {
    for (let i = 0; i < 20; i++) {
      const token = generateRefreshToken()
      assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    }
  })

  it("não repete", () => {
    const amostra = new Set(
      Array.from({ length: 200 }, () => generateRefreshToken()),
    )
    assert.equal(amostra.size, 200)
  })
})

describe("hashRefreshToken", () => {
  it("é determinístico e devolve SHA-256 em hexadecimal", () => {
    const token = generateRefreshToken()
    assert.equal(hashRefreshToken(token), hashRefreshToken(token))
    assert.match(hashRefreshToken(token), /^[a-f0-9]{64}$/)
  })

  it("tokens diferentes geram hashes diferentes", () => {
    assert.notEqual(
      hashRefreshToken(generateRefreshToken()),
      hashRefreshToken(generateRefreshToken()),
    )
  })
})

describe("generateTemporaryPassword", () => {
  it("evita caracteres ambíguos que se perdem ao ditar a senha", () => {
    for (let i = 0; i < 50; i++) {
      const password = generateTemporaryPassword()
      assert.equal(password.length, 16)
      assert.doesNotMatch(password, /[0O1lI]/)
      assert.match(password, /^[A-Za-z2-9]+$/)
    }
  })

  it("não repete entre chamadas", () => {
    const amostra = new Set(
      Array.from({ length: 200 }, () => generateTemporaryPassword()),
    )
    assert.equal(amostra.size, 200)
  })

  it("respeita o comprimento pedido", () => {
    assert.equal(generateTemporaryPassword(24).length, 24)
  })
})
