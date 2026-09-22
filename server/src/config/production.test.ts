import { after, before, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import express from "express"
import jwt from "jsonwebtoken"
import type { Server } from "node:http"
const secret = randomBytes(48).toString("hex")
Object.assign(process.env, {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://unused@127.0.0.1:1/not_used",
  JWT_ACCESS_SECRET: secret,
  FRONTEND_URL: "https://app.example.com",
  SMS_PROVIDER: "twilio",
  SMS_API_KEY: "test-only",
  AUTH_OTP_DEV_MODE: "false",
  REFRESH_COOKIE_SAME_SITE: "none",
  REFRESH_COOKIE_PATH: "/api/auth",
})
let server: Server, base: string
let verify: typeof import("../modules/auth/token.service.js").verifyAccessToken
before(async () => {
  const { setRefreshCookie, clearRefreshCookie } = await import(
    "../modules/auth/auth.controller.js"
  )
  const { errorHandler } = await import("../middlewares/error-handler.js")
  ;({
    verifyAccessToken: verify,
  } = await import("../modules/auth/token.service.js"))
  const app = express()
  app.post("/cookie", (_req, res) => {
    setRefreshCookie(res, {
      accessToken: "test-only",
      refreshToken: randomBytes(32).toString("base64url"),
      accessTokenExpiresAt: new Date(Date.now() + 60000),
      refreshTokenExpiresAt: new Date(Date.now() + 86400000),
    })
    res.json({ ok: true })
  })
  app.post("/clear", (_req, res) => {
    clearRefreshCookie(res)
    res.json({ ok: true })
  })
  app.get("/error/:code", (req, _res, next) =>
    next(
      Object.assign(new Error("SQL DATABASE_URL secret C:/private/path"), {
        code: req.params.code,
      }),
    ),
  )
  app.use(errorHandler)
  server = app.listen(0, "127.0.0.1")
  await new Promise<void>((resolve) => server.once("listening", resolve))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  base = "http://127.0.0.1:" + address.port
})
after(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()))
})
it("cookies de produção usam Secure, HttpOnly, None, path externo e remoção equivalente", async () => {
  const response = await fetch(base + "/cookie", { method: "POST" })
  const cookie = response.headers.get("set-cookie")!
  for (const expected of [
    /; Secure/,
    /; HttpOnly/,
    /SameSite=None/,
    /Path=\/api\/auth/,
    /Max-Age=8639\d|Max-Age=86400/,
  ])
    assert.match(cookie, expected)
  const clear = (await fetch(base + "/clear", { method: "POST" })).headers.get(
    "set-cookie",
  )!
  for (const expected of [
    /; Secure/,
    /; HttpOnly/,
    /SameSite=None/,
    /Path=\/api\/auth/,
    /Expires=Thu, 01 Jan 1970/,
  ])
    assert.match(clear, expected)
})
it("erros Prisma e internos recebem resposta útil sem stack, SQL, segredo ou path", async () => {
  for (const [code, status] of [
    ["P2002", 409],
    ["P2025", 404],
    ["P2003", 409],
    ["OTHER", 500],
  ] as const) {
    const r = await fetch(base + "/error/" + code)
    assert.equal(r.status, status)
    assert.doesNotMatch(
      await r.text(),
      /SQL|DATABASE_URL|private|stack|secret|Prisma/i,
    )
  }
})
it("JWT exige algoritmo, issuer, audience, subject, sessão e expiração válidos", () => {
  const payload = { sub: randomUUID(), sid: randomUUID(), role: "ADMIN" }
  const options = {
    issuer: "erickcorttes-api",
    audience: "erickcorttes-web",
    expiresIn: 60,
  }
  assert.equal(verify(jwt.sign(payload, secret, options)).sub, payload.sub)
  for (const token of [
    jwt.sign(payload, secret, { ...options, algorithm: "HS384" }),
    jwt.sign(payload, secret, { ...options, audience: "other" }),
    jwt.sign(payload, secret, { ...options, issuer: "other" }),
    jwt.sign(payload, secret, { ...options, expiresIn: -1 }),
    jwt.sign({ ...payload, sid: "invalid" }, secret, options),
    jwt.sign(payload, secret, {
      issuer: options.issuer,
      audience: options.audience,
    }),
  ])
    assert.throws(() => verify(token), { statusCode: 401 })
})
