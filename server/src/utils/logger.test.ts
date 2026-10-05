import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"

/**
 * O logger importa `config/env`, que valida o ambiente no import. Sem estes
 * valores o arquivo nem carrega — daí o import dinâmico depois do env.
 */
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://unused@127.0.0.1:1/erickcorttes_test",
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? randomBytes(48).toString("hex"),
})
const { logger } = await import("./logger.js")

/**
 * Redação de log.
 *
 * O logger aceita um objeto de contexto inteiro, e é exatamente aí que um
 * segredo entra por descuido: alguém registra `{ env }` ou `{ payload }` para
 * depurar e o valor vai para o agregador de logs, onde fica indexado e visível
 * para muito mais gente do que o banco.
 *
 * Por isso a defesa é por CHAVE, aplicada em profundidade — não depende de quem
 * escreve a chamada lembrar de filtrar.
 */

/** Captura as linhas que o logger escreve, sem sujar a saída do teste. */
function captureLines(run: () => void): string {
  const written: string[] = []
  const original = { log: console.log, warn: console.warn, error: console.error }
  const sink = (...args: unknown[]) => { written.push(args.map(String).join(" ")) }
  console.log = sink
  console.warn = sink
  console.error = sink
  try {
    run()
  } finally {
    Object.assign(console, original)
  }
  return written.join("\n")
}

const SECRET = "valor-secreto-que-nao-pode-aparecer"

describe("redação de log", () => {
  const sensitiveKeys = [
    "password", "currentPassword", "newPassword", "passwordHash", "password_hash",
    "token", "publicToken", "public_token", "contactHandle", "contact_handle",
    "previousHandle", "accessToken", "refreshToken", "tokenHash",
    "authorization", "cookie",
    "JWT_ACCESS_SECRET", "DATABASE_URL", "BOOTSTRAP_ADMIN_PASSWORD",
    // Estava faltando: quem tem este valor forja "pagamento recebido".
    "PAYMENT_WEBHOOK_SECRET",
  ]

  for (const key of sensitiveKeys) {
    it(`esconde ${key}`, () => {
      const output = captureLines(() => logger.info("teste", { [key]: SECRET }))
      assert.ok(!output.includes(SECRET), `${key} vazou: ${output}`)
      assert.match(output, /\[redacted\]/)
    })
  }

  it("esconde a chave mesmo aninhada e dentro de array", () => {
    const output = captureLines(() => logger.info("teste", {
      nivel1: { nivel2: { publicToken: SECRET } },
      lista: [{ password: SECRET }, { ok: "visivel" }],
    }))
    assert.ok(!output.includes(SECRET), "segredo aninhado vazou: " + output)
    assert.ok(output.includes("visivel"), "redação apagou dado legítimo")
  })

  it("a comparação de chave ignora caixa", () => {
    const output = captureLines(() => logger.info("teste", { PuBlIcToKeN: SECRET }))
    assert.ok(!output.includes(SECRET), "variação de caixa escapou: " + output)
  })

  it("preserva o que não é segredo", () => {
    const output = captureLines(() => logger.info("teste", {
      appointmentId: "abc", status: "PENDING", amountCents: 4000,
    }))
    for (const value of ["abc", "PENDING", "4000"]) {
      assert.ok(output.includes(value), `${value} deveria aparecer no log`)
    }
  })

  it("corta profundidade excessiva em vez de percorrer sem fim", () => {
    // Objeto com ciclo: sem o corte, a serialização estouraria.
    const cyclic: Record<string, unknown> = { nome: "raiz" }
    cyclic.self = cyclic
    const output = captureLines(() => logger.info("teste", { cyclic }))
    assert.match(output, /\[truncated\]/)
  })

  it("mensagem sem contexto não inventa campo", () => {
    const output = captureLines(() => logger.info("apenas mensagem"))
    assert.ok(output.includes("apenas mensagem"), "mensagem ausente")
    assert.ok(!output.includes("context"), "contexto vazio foi serializado")
  })
})
