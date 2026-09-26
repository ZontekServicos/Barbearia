import { describe, it } from "node:test"
import assert from "node:assert/strict"

const BASE_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
  JWT_ACCESS_SECRET: "access_secret_com_mais_de_32_caracteres_ok!",
  JWT_REFRESH_SECRET: "refresh_secret_com_mais_de_32_caracteres_ok",
  FRONTEND_URL: "http://localhost:8443",
}

let cacheBuster = 0

/**
 * env.ts valida na importação, então cada cenário precisa de uma instância
 * nova do módulo — daí o sufixo de query para furar o cache do ESM.
 */
async function loadEnvWith(overrides: Record<string, string | undefined>) {
  const snapshot = { ...process.env }
  try {
    for (const key of Object.keys(BASE_ENV)) delete process.env[key]
    Object.assign(process.env, BASE_ENV, overrides)
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key]
    }
    cacheBuster += 1
    return await import(`./env.js?case=${cacheBuster}`)
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, snapshot)
  }
}

describe("validação de ambiente", () => {
  it("aceita uma configuração de desenvolvimento válida", async () => {
    const mod = await loadEnvWith({
      NODE_ENV: "development",
    })
    assert.equal(mod.env.NODE_ENV, "development")
    assert.equal(mod.isProduction, false)
  })

  it("refresh opaco não exige segredo JWT de refresh", async () => {
    const mod = await loadEnvWith({
      NODE_ENV: "development",
      JWT_REFRESH_SECRET: undefined,
      BOOTSTRAP_ADMIN_NAME: "",
    })
    assert.equal(mod.env.BOOTSTRAP_ADMIN_NAME, undefined)
  })

  it("recusa segredo curto demais", async () => {
    await assert.rejects(
      () =>
        loadEnvWith({ NODE_ENV: "development", JWT_ACCESS_SECRET: "curto" }),
      /ao menos 32 caracteres/,
    )
  })

  it("recusa DATABASE_URL ausente", async () => {
    await assert.rejects(
      () => loadEnvWith({ NODE_ENV: "development", DATABASE_URL: undefined }),
      /DATABASE_URL/,
    )
  })

  it("aceita múltiplas origens no CORS", async () => {
    const mod = await loadEnvWith({
      NODE_ENV: "development",
      FRONTEND_URL: "http://localhost:8443, https://app.exemplo.com",
    })
    assert.deepEqual(mod.allowedOrigins, [
      "http://localhost:8443",
      "https://app.exemplo.com",
    ])
  })
})

const secureProduction = {
  NODE_ENV: "production",
  FRONTEND_URL: "https://app.example.com",
  JWT_ACCESS_SECRET:
    "92136ade80bc57ff427181b2d3dd6ec84524356a170823729a804bae5d2f011b",
}
it("produção aceita segredo aleatório, cookie None e caminho explícito para proxy", async () => {
  const mod = await loadEnvWith({
    ...secureProduction,
    REFRESH_COOKIE_SAME_SITE: "none",
    REFRESH_COOKIE_PATH: "/api/auth",
  })
  assert.equal(mod.env.REFRESH_COOKIE_PATH, "/api/auth")
})
it("produção rejeita placeholder e sequência repetida como segredo", async () => {
  for (const secret of ["a".repeat(48), BASE_ENV.JWT_ACCESS_SECRET])
    await assert.rejects(
      loadEnvWith({ ...secureProduction, JWT_ACCESS_SECRET: secret }),
      /segredo aleatório/,
    )
})
it("CORS rejeita wildcard, caminhos e HTTP em produção", async () => {
  for (const origin of [
    "*",
    "https://app.example.com/path",
    "http://app.example.com",
    "null",
  ])
    await assert.rejects(
      loadEnvWith({ ...secureProduction, FRONTEND_URL: origin }),
      /origens exatas/,
    )
})
it("recusa banco não PostgreSQL, cookie path amplo e trust proxy arbitrário", async () => {
  for (const values of [
    { DATABASE_URL: "https://db.example.com" },
    { REFRESH_COOKIE_PATH: "/" },
    { TRUST_PROXY_HOPS: "100" },
  ])
    await assert.rejects(loadEnvWith({ NODE_ENV: "development", ...values }))
})

describe("configuração de pagamento", () => {
  const strongSecret = "webhook_secret_com_mais_de_32_caracteres_ok"

  it("sem provedor, pagamento fica desligado e nada é exigido", async () => {
    const mod = await loadEnvWith({ NODE_ENV: "development" })
    assert.equal(mod.env.PAYMENT_PROVIDER, undefined)
    assert.equal(mod.paymentsEnabled, false)
  })

  it("provedor 'manual' é recusado em PRODUÇÃO", async () => {
    // O adaptador de teste confirma pagamento sem provedor real. Se um deploy
    // de produção o aceitasse por descuido de configuração, reservas seriam
    // confirmadas sem dinheiro nenhum ter entrado.
    await assert.rejects(
      () =>
        loadEnvWith({
          NODE_ENV: "production",
          FRONTEND_URL: "https://barbearia.exemplo",
          // Valor de teste apenas: variado o bastante para passar a checagem de
          // força que produção aplica, e nunca usado em lugar nenhum.
          JWT_ACCESS_SECRET: "fixture-q7W2xZ9pL4vB8nR3wT6yU1jH5gF0dS",
          PAYMENT_PROVIDER: "manual",
          PAYMENT_WEBHOOK_SECRET: strongSecret,
        }),
      /manual.*produção|produção.*manual/is,
    )
  })

  it("provedor sem segredo de webhook é recusado", async () => {
    // Sem segredo não há como distinguir a notificação do provedor de um POST
    // qualquer da internet — e é o webhook que confirma o pagamento.
    await assert.rejects(
      () =>
        loadEnvWith({
          NODE_ENV: "development",
          PAYMENT_PROVIDER: "manual",
          PAYMENT_WEBHOOK_SECRET: undefined,
        }),
      /PAYMENT_WEBHOOK_SECRET/,
    )
  })

  it("segredo de webhook curto é recusado", async () => {
    await assert.rejects(
      () =>
        loadEnvWith({
          NODE_ENV: "development",
          PAYMENT_PROVIDER: "manual",
          PAYMENT_WEBHOOK_SECRET: "curto",
        }),
      /PAYMENT_WEBHOOK_SECRET/,
    )
  })

  it("com provedor e segredo, pagamento fica ligado", async () => {
    const mod = await loadEnvWith({
      NODE_ENV: "development",
      PAYMENT_PROVIDER: "manual",
      PAYMENT_WEBHOOK_SECRET: strongSecret,
    })
    assert.equal(mod.paymentsEnabled, true)
  })

  it("número do WhatsApp precisa ser internacional", async () => {
    for (const invalid of ["71999999999", "(71) 99999-9999", "+0719999", "whatsapp"]) {
      await assert.rejects(
        () => loadEnvWith({ NODE_ENV: "development", BARBERSHOP_WHATSAPP_NUMBER: invalid }),
        /BARBERSHOP_WHATSAPP_NUMBER/,
        invalid,
      )
    }
    const mod = await loadEnvWith({
      NODE_ENV: "development",
      BARBERSHOP_WHATSAPP_NUMBER: "+5571999990000",
    })
    assert.equal(mod.env.BARBERSHOP_WHATSAPP_NUMBER, "+5571999990000")
  })
})
