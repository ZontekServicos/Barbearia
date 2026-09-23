import { before, beforeEach, afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://unused@127.0.0.1:1/not_used",
  JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
  FRONTEND_URL: "http://localhost:8443",
})

let passwords: typeof import("./password.service.js")

/** Captura o que o logger escreveu, para provar que a senha não vaza. */
let captured: string[] = []
const realConsole = { log: console.log, warn: console.warn, error: console.error }

before(async () => {
  passwords = await import("./password.service.js")
})

beforeEach(() => {
  captured = []
  for (const level of ["log", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(" "))
    }
  }
})

afterEach(() => {
  Object.assign(console, realConsole)
})

describe("hashPassword / verifyPassword", () => {
  it("gera um hash Argon2id com os parâmetros do OWASP", async () => {
    const hash = await passwords.hashPassword("senha-de-teste-123")
    assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
  })

  it("nunca guarda a senha em texto puro dentro do hash", async () => {
    const hash = await passwords.hashPassword("minha-senha-secreta")
    assert.ok(!hash.includes("minha-senha-secreta"))
  })

  it("a mesma senha gera hashes diferentes (salt por registro)", async () => {
    const [a, b] = await Promise.all([
      passwords.hashPassword("senha-identica-aqui"),
      passwords.hashPassword("senha-identica-aqui"),
    ])
    assert.notEqual(a, b)
    // Mesmo com hashes distintos, as duas continuam validando.
    assert.equal(await passwords.verifyPassword(a, "senha-identica-aqui"), true)
    assert.equal(await passwords.verifyPassword(b, "senha-identica-aqui"), true)
  })

  it("aceita a senha correta e recusa a errada", async () => {
    const hash = await passwords.hashPassword("correta-horse-battery")
    assert.equal(await passwords.verifyPassword(hash, "correta-horse-battery"), true)
    assert.equal(await passwords.verifyPassword(hash, "correta-horse-batter"), false)
    assert.equal(await passwords.verifyPassword(hash, ""), false)
  })

  it("aceita frases-senha longas e caracteres não-ASCII", async () => {
    const frase = "Meu cachorro é o José e ele adora pão de queijo às terças!"
    const hash = await passwords.hashPassword(frase)
    assert.equal(await passwords.verifyPassword(hash, frase), true)
  })

  it("normaliza Unicode: a mesma senha digitada com composições diferentes confere", async () => {
    // "á" pré-composto (NFC) vs. "a" + acento combinante (NFD).
    const precomposto = "senha-cáfe-forte"
    const decomposto = "senha-cáfe-forte"
    assert.notEqual(precomposto, decomposto)
    const hash = await passwords.hashPassword(precomposto)
    assert.equal(await passwords.verifyPassword(hash, decomposto), true)
  })

  it("preserva espaços nas bordas: eles fazem parte da senha", async () => {
    const hash = await passwords.hashPassword("  senha com bordas  ")
    assert.equal(await passwords.verifyPassword(hash, "  senha com bordas  "), true)
    assert.equal(await passwords.verifyPassword(hash, "senha com bordas"), false)
  })

  it("recusa hashear senha fora do tamanho permitido", async () => {
    await assert.rejects(() => passwords.hashPassword("curta"), /tamanho/)
    await assert.rejects(
      () => passwords.hashPassword("a".repeat(passwords.PASSWORD_MAX_LENGTH + 1)),
      /tamanho/,
    )
  })

  it("conta sem credencial estabelecida nunca autentica", async () => {
    for (const vazio of [null, undefined, ""]) {
      assert.equal(await passwords.verifyPassword(vazio, "qualquer-senha"), false)
      // Mesmo tentando passar string vazia como senha.
      assert.equal(await passwords.verifyPassword(vazio, ""), false)
    }
  })

  it("hash corrompido é apenas 'não confere', não derruba o login", async () => {
    for (const lixo of [
      "lixo",
      "$argon2id$incompleto",
      "$2b$10$bcryptNaoSuportado",
      "scrypt$aa$bb",
    ])
      assert.equal(await passwords.verifyPassword(lixo, "senha-qualquer"), false)
  })

  it("não registra a senha nem o hash em log", async () => {
    const segredo = "senha-ultra-secreta-987"
    const hash = await passwords.hashPassword(segredo)
    await passwords.verifyPassword(hash, segredo)
    await passwords.verifyPassword(hash, "errada")
    await passwords.verifyPassword("hash-corrompido", segredo)

    const logs = captured.join("\n")
    assert.ok(!logs.includes(segredo), "a senha apareceu no log")
    assert.ok(!logs.includes(hash), "o hash apareceu no log")
  })

  it("burnTime gasta tempo comparável a uma verificação real", async () => {
    const hash = await passwords.hashPassword("senha-para-medir-tempo")

    const startReal = performance.now()
    await passwords.verifyPassword(hash, "senha-errada-aqui")
    const real = performance.now() - startReal

    const startDecoy = performance.now()
    await passwords.burnTime()
    const decoy = performance.now() - startDecoy

    // Não exigimos igualdade — a máquina oscila. Exigimos a mesma ordem de
    // grandeza, que é o que apaga o sinal de "telefone não cadastrado".
    assert.ok(
      decoy > real / 4 && decoy < real * 4,
      `tempos muito distantes: real=${real.toFixed(1)}ms decoy=${decoy.toFixed(1)}ms`,
    )
  })
})

it("redacts password fields and bootstrap credentials in nested logs", async () => {
  const { logger } = await import("../../utils/logger.js")
  logger.info("redaction regression", { data: [{ password:"private-value", currentPassword:"private-value", newPassword:"private-value", confirmPassword:"private-value", temporaryPassword:"private-value", password_hash:"private-value", BOOTSTRAP_ADMIN_PASSWORD:"private-value" }] })
  assert.ok(!captured.join("\n").includes("private-value"))
  assert.match(captured.join("\n"), /redacted/)
})
