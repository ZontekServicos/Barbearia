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
      AUTH_OTP_DEV_MODE: "true",
    })
    assert.equal(mod.env.NODE_ENV, "development")
    assert.equal(mod.env.AUTH_OTP_DEV_MODE, true)
    assert.equal(mod.isProduction, false)
  })

  it("recusa AUTH_OTP_DEV_MODE em produção", async () => {
    await assert.rejects(
      () =>
        loadEnvWith({
          NODE_ENV: "production",
          AUTH_OTP_DEV_MODE: "true",
          SMS_PROVIDER: "twilio",
          SMS_API_KEY: "chave",
        }),
      /AUTH_OTP_DEV_MODE não pode ser habilitado em produção/,
    )
  })

  it("recusa provider de SMS console em produção", async () => {
    await assert.rejects(
      () =>
        loadEnvWith({
          NODE_ENV: "production",
          AUTH_OTP_DEV_MODE: "false",
          SMS_PROVIDER: "console",
        }),
      /configure um provider real de SMS/,
    )
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
  SMS_PROVIDER: "twilio",
  SMS_API_KEY: "test-provider-key",
  AUTH_OTP_DEV_MODE: "false",
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
