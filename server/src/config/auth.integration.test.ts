import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import type { Server } from "node:http"

// Explicit opt-in. This suite deletes only data in a dedicated local test database.
const database = process.env.TEST_DATABASE_URL
const enabled = Boolean(database)
if (database) {
  const url = new URL(database)
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/erickcorttes_test"
  ) {
    throw new Error(
      "TEST_DATABASE_URL must point to local erickcorttes_test; refusing cleanup.",
    )
  }
}
Object.assign(process.env, {
  DATABASE_URL: database ?? "postgresql://unused@127.0.0.1:1/erickcorttes_test",
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
  JWT_REFRESH_SECRET: randomBytes(48).toString("hex"),
  AUTH_OTP_DEV_MODE: "false",
  SMS_PROVIDER: "console",
  FRONTEND_URL: "http://localhost:8443",
  TRUST_PROXY_HOPS: "0",
})
let prisma: typeof import("../config/prisma.js").prisma
let auth: typeof import("../modules/auth/auth.service.js")
let tokens: typeof import("../modules/auth/token.service.js")
let admin: typeof import("../modules/admin/admin.service.js")
let bootstrap: typeof import("../modules/admin/bootstrap.service.js").bootstrapAdmin
let hashOtpCode: typeof import("../utils/crypto.js").hashOtpCode
let sms: typeof import("../modules/auth/sms/sms-provider.js").smsProvider
let originalSend: typeof sms.sendOtp
let limits: typeof import("../middlewares/rate-limit.js")
let server: Server
let base: string
let phoneCounter = 0
const phone = () => "+55719" + String(10000000 + phoneCounter++)
const delivered = new Map<string, string>()
async function call(
  path: string,
  opts: {
    method?: string
    body?: unknown
    access?: string
    cookie?: string
    headers?: Record<string, string>
  } = {},
) {
  const response = await fetch(base + path, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Protection": "1",
      Origin: "http://localhost:8443",
      ...(opts.access ? { Authorization: "Bearer " + opts.access } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...opts.headers,
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  })
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  }
}
async function user(
  role: "ADMIN" | "CUSTOMER" = "CUSTOMER",
  status: "ACTIVE" | "PENDING" | "BLOCKED" = "ACTIVE",
  fullName = "Pessoa QA",
) {
  return prisma.user.create({
    data: { phone: phone(), fullName, role, status },
  })
}
async function challenge(p = phone(), code = "123456", expired = false) {
  await prisma.otpChallenge.create({
    data: {
      phone: p,
      codeHash: await hashOtpCode(code),
      expiresAt: new Date(Date.now() + (expired ? -1000 : 300000)),
    },
  })
  return { phone: p, code }
}
async function login(
  role: "ADMIN" | "CUSTOMER" = "CUSTOMER",
  status: "ACTIVE" | "PENDING" = "ACTIVE",
) {
  const u = await user(role, status)
  const session = await tokens.issueSession(u.id)
  return { user: u, ...session, cookie: "ec_refresh=" + session.refreshToken }
}
async function cleanup() {
  await prisma.adminAuditLog.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.otpChallenge.deleteMany()
  await prisma.user.deleteMany()
}
describe("Express + Prisma + PostgreSQL real", { skip: !enabled }, () => {
  before(async () => {
    ;({ prisma } = await import("../config/prisma.js"))
    auth = await import("../modules/auth/auth.service.js")
    tokens = await import("../modules/auth/token.service.js")
    admin = await import("../modules/admin/admin.service.js")
    ;({
      bootstrapAdmin: bootstrap,
    } = await import("../modules/admin/bootstrap.service.js"))
    ;({ hashOtpCode } = await import("../utils/crypto.js"))
    ;({
      smsProvider: sms,
    } = await import("../modules/auth/sms/sms-provider.js"))
    originalSend = sms.sendOtp
    limits = await import("../middlewares/rate-limit.js")
    const { createApp } = await import("../app.js")
    server = createApp().listen(0, "127.0.0.1")
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    base = "http://127.0.0.1:" + address.port
    const version = await prisma.$queryRaw<Array<{
      version: string
    }>>`SELECT version()`
    assert.match(version[0]!.version, /PostgreSQL/)
  })
  beforeEach(async () => {
    await cleanup()
    delivered.clear()
    sms.sendOtp = async (p, code) => {
      delivered.set(p, code)
    }
    for (const limiter of [
      limits.globalRateLimit,
      limits.requestOtpRateLimit,
      limits.verifyOtpRateLimit,
    ])
      limiter.resetKey("127.0.0.1")
  })
  after(async () => {
    if (sms) sms.sendOtp = originalSend
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      )
    if (prisma) {
      await cleanup()
      await prisma.$disconnect()
    }
  })
  it("OTP válido cria CUSTOMER PENDING; perfil próprio é permitido e admin é negado", async () => {
    const otp = await challenge()
    const r = await call("/auth/verify-otp", {
      body: { ...otp, fullName: "Novo Cliente" },
    })
    assert.equal(r.status, 201)
    assert.equal(r.body.data.user.role, "CUSTOMER")
    assert.equal(r.body.data.user.status, "PENDING")
    assert.equal(
      (await call("/auth/me", { access: r.body.data.accessToken })).status,
      200,
    )
    assert.equal(
      (await call("/admin/users", { access: r.body.data.accessToken })).status,
      403,
    )
    assert.equal(r.body.data.refreshToken, undefined)
  })
  it("OTP errado incrementa tentativa; expirado e usado não autenticam", async () => {
    const otp = await challenge()
    assert.equal(
      (await call("/auth/verify-otp", { body: { ...otp, code: "654321" } }))
        .body.error.code,
      "OTP_INVALID",
    )
    assert.equal((await prisma.otpChallenge.findFirstOrThrow()).attempts, 1)
    assert.equal((await call("/auth/verify-otp", { body: otp })).status, 201)
    assert.equal((await call("/auth/verify-otp", { body: otp })).status, 400)
    const expired = await challenge(phone(), "123456", true)
    assert.equal(
      (await call("/auth/verify-otp", { body: expired })).body.error.code,
      "OTP_EXPIRED",
    )
  })
  it("duas verificações simultâneas do mesmo OTP geram exatamente uma sessão", async () => {
    const otp = await challenge()
    const r = await Promise.all([
      call("/auth/verify-otp", { body: otp }),
      call("/auth/verify-otp", { body: otp }),
    ])
    assert.deepEqual(r.map((x) => x.status).sort(), [201, 400])
    assert.equal(await prisma.refreshToken.count(), 1)
    assert.equal(await prisma.user.count(), 1)
  })
  it("tentativas simultâneas não ultrapassam o limite persistido do desafio", async () => {
    const otp = await challenge()
    await Promise.all(
      Array.from({ length: 8 }, () =>
        auth.verifyOtp(otp.phone, "000000").catch(() => undefined),
      ),
    )
    const stored = await prisma.otpChallenge.findFirstOrThrow()
    assert.equal(stored.attempts, 5)
    assert.ok(stored.consumedAt)
    await assert.rejects(auth.verifyOtp(otp.phone, otp.code))
  })
  it("novo pedido invalida anterior e pedidos concorrentes mantêm um desafio ativo", async () => {
    const p = phone()
    await auth.requestOtp(p)
    const first = await prisma.otpChallenge.findFirstOrThrow()
    await Promise.all([auth.requestOtp(p), auth.requestOtp(p)])
    assert.ok(
      (await prisma.otpChallenge.findUniqueOrThrow({ where: { id: first.id } }))
        .consumedAt,
    )
    assert.equal(
      await prisma.otpChallenge.count({
        where: { phone: p, consumedAt: null },
      }),
      1,
    )
  })
  it("limite persistido por telefone impede sexto envio mesmo sem depender do IP", async () => {
    const p = phone()
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => auth.requestOtp(p)),
    )
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 5)
    assert.equal(await prisma.otpChallenge.count({ where: { phone: p } }), 5)
  })
  it("pedido para conta existente ou nova tem status e resposta idênticos, sem OTP", async () => {
    const existing = await user()
    const a = await call("/auth/request-otp", {
      body: { phone: existing.phone },
    })
    const b = await call("/auth/request-otp", { body: { phone: phone() } })
    assert.equal(a.status, b.status)
    assert.deepEqual(a.body, b.body)
    assert.deepEqual(Object.keys(a.body.data), ["expiresInSeconds"])
  })
  it("provider indisponível retorna 503 e invalida o código que não foi enviado", async () => {
    sms.sendOtp = originalSend.bind(sms) // Console disabled when AUTH_OTP_DEV_MODE=false.
    const r = await call("/auth/request-otp", { body: { phone: phone() } })
    assert.equal(r.status, 503)
    assert.equal(r.body.error.code, "SMS_UNAVAILABLE")
    assert.equal(
      await prisma.otpChallenge.count({ where: { consumedAt: null } }),
      0,
    )
  })
  it("Twilio rejection and malformed success return 503 and invalidate the challenge", async () => {
    const { TwilioSmsProvider } = await import("../modules/auth/sms/sms-provider.js")
    for (const [httpStatus, payload] of [[401, { code: 20003 }], [503, {}], [201, {}], [201, { status: "failed" }]] as const) {
      const target = phone()
      let transportedCode = ""
      const provider = new TwilioSmsProvider({
        accountSid: "AC" + "1".repeat(32), authToken: "2".repeat(32),
        fromNumber: "+15005550006", timeoutMs: 1000,
      }, async (_url, init) => {
        transportedCode = new URLSearchParams(String(init.body)).get("Body")!.match(/\d{6}/)![0]
        return { ok: httpStatus === 201, status: httpStatus, text: async () => JSON.stringify(payload) }
      })
      sms.sendOtp = provider.sendOtp.bind(provider)
      const response = await call("/auth/request-otp", { body: { phone: target } })
      assert.equal(response.status, 503)
      assert.ok(!JSON.stringify(response.body).includes(transportedCode))
      assert.doesNotMatch(JSON.stringify(response.body), /twilio|20003|stack/i)
      assert.equal(await prisma.otpChallenge.count({ where: { phone: target, consumedAt: null } }), 0)
      await assert.rejects(auth.verifyOtp(target, transportedCode), { code: "OTP_INVALID" })
    }
  })
  it("Twilio acceptance transports the backend OTP without exposing it in API responses", async () => {
    const { TwilioSmsProvider } = await import("../modules/auth/sms/sms-provider.js")
    const target = phone()
    let transportedCode = ""
    const provider = new TwilioSmsProvider({
      accountSid: "AC" + "1".repeat(32), authToken: "2".repeat(32),
      messagingServiceSid: "MG" + "3".repeat(32), timeoutMs: 1000,
    }, async (_url, init) => {
      const body = new URLSearchParams(String(init.body))
      assert.equal(body.get("To"), target)
      transportedCode = body.get("Body")!.match(/\d{6}/)![0]
      return { ok: true, status: 201, text: async () => JSON.stringify({ sid: "SM" + "4".repeat(32), status: "accepted" }) }
    })
    sms.sendOtp = provider.sendOtp.bind(provider)
    const response = await call("/auth/request-otp", { body: { phone: target } })
    assert.equal(response.status, 200)
    assert.ok(!JSON.stringify(response.body).includes(transportedCode))
    const verified = await call("/auth/verify-otp", { body: { phone: target, code: transportedCode, fullName: "Twilio QA" } })
    assert.equal(verified.status, 201)
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { phone: target } })).status, "PENDING")
    await assert.rejects(auth.verifyOtp(target, transportedCode), { code: "OTP_INVALID" })
  })

  it("falha de envio consome a cota do telefone e não libera tentativas extras", async () => {
    const target = phone()
    sms.sendOtp = originalSend.bind(sms) // Envio indisponível.
    for (let i = 0; i < 5; i++) {
      const r = await call("/auth/request-otp", { body: { phone: target } })
      assert.equal(r.status, 503)
    }
    // Desafios que falharam continuam contando: ninguém queima SMS de graça.
    assert.equal(await prisma.otpChallenge.count({ where: { phone: target } }), 5)
    sms.sendOtp = async () => {}
    // Zera o limite por IP: o 429 seguinte só pode vir do limite durável
    // por telefone, que é o que precisamos provar aqui.
    limits.requestOtpRateLimit.resetKey("127.0.0.1")
    assert.equal(
      (await call("/auth/request-otp", { body: { phone: target } })).status,
      429,
    )
    // Outro telefone, mesmo IP, continua atendido: o limite é por telefone.
    assert.equal(
      (await call("/auth/request-otp", { body: { phone: phone() } })).status,
      200,
    )
    // Nenhum desafio sobrou ativo, então nenhum código pode autenticar.
    assert.equal(
      await prisma.otpChallenge.count({
        where: { phone: target, consumedAt: null },
      }),
      0,
    )
  })

  it("rate limits HTTP de pedido, verificação e rotas gerais são independentes", async () => {
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await call("/auth/request-otp", { body: { phone: phone() } })).status,
        200,
      )
    assert.equal(
      (await call("/auth/request-otp", { body: { phone: phone() } })).status,
      429,
    )
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await call("/auth/verify-otp", {
            body: { phone: phone(), code: "123456" },
          })
        ).status,
        400,
      )
    assert.equal(
      (
        await call("/auth/verify-otp", {
          body: { phone: phone(), code: "123456" },
        })
      ).status,
      429,
    )
    limits.globalRateLimit.resetKey("127.0.0.1")
    for (let i = 0; i < 120; i++)
      assert.equal((await call("/health")).status, 200)
    assert.equal((await call("/health")).status, 429)
  })
  it("refresh rotaciona, reuse revoga sessões e novo login permite nova sessão", async () => {
    const s = await login()
    const r = await call("/auth/refresh", { body: {}, cookie: s.cookie })
    assert.equal(r.status, 200)
    assert.notEqual(r.cookie, s.cookie)
    assert.equal(
      (await call("/auth/me", { access: s.accessToken })).status,
      401,
    )
    assert.equal(
      (await call("/auth/refresh", { body: {}, cookie: s.cookie })).status,
      401,
    )
    assert.equal(
      (await call("/auth/me", { access: r.body.data.accessToken })).status,
      401,
    )
    assert.equal(
      await prisma.refreshToken.count({ where: { revokedAt: null } }),
      0,
    )
    const otp = await challenge(s.user.phone)
    const fresh = await call("/auth/verify-otp", { body: otp })
    assert.equal(
      (await call("/auth/refresh", { body: {}, cookie: fresh.cookie })).status,
      200,
    )
  })
  it("duas rotações simultâneas: somente uma vence e reuse revoga a sucessora", async () => {
    const s = await login()
    const r = await Promise.all([
      call("/auth/refresh", { body: {}, cookie: s.cookie }),
      call("/auth/refresh", { body: {}, cookie: s.cookie }),
    ])
    assert.deepEqual(r.map((x) => x.status).sort(), [200, 401])
    assert.equal(await prisma.refreshToken.count(), 2)
    assert.equal(
      await prisma.refreshToken.count({ where: { revokedAt: null } }),
      0,
    )
  })
  it("logout limpa cookie e invalida access e refresh imediatamente", async () => {
    const s = await login()
    const r = await call("/auth/logout", { body: {}, cookie: s.cookie })
    assert.equal(r.status, 200)
    assert.match(r.headers.get("set-cookie")!, /Expires=Thu, 01 Jan 1970/)
    assert.equal(
      (await call("/auth/me", { access: s.accessToken })).status,
      401,
    )
    assert.equal(
      (await call("/auth/refresh", { body: {}, cookie: s.cookie })).status,
      401,
    )
  })
  it("logout concorrente com refresh não deixa sucessoras ativas", async () => {
    const s = await login()
    await Promise.allSettled([
      tokens.rotateSession(s.refreshToken),
      tokens.revokeSession(s.refreshToken),
    ])
    assert.equal(
      await prisma.refreshToken.count({ where: { revokedAt: null } }),
      0,
    )
  })
  it("cookie tem httpOnly, path, SameSite e tempo coerentes; não é entregue no JSON", async () => {
    const r = await call("/auth/verify-otp", { body: await challenge() })
    const cookie = r.headers.get("set-cookie")!
    for (const flag of [
      /HttpOnly/,
      /Path=\/auth/,
      /SameSite=Lax/,
      /Max-Age=259199\d/,
      /Expires=/,
    ])
      assert.match(cookie, flag)
    assert.doesNotMatch(cookie, /; Secure/)
    assert.equal(r.headers.get("cache-control"), "no-store")
  })
  it("CUSTOMER e ADMIN PENDING recebem 403; ADMIN ACTIVE pode listar", async () => {
    for (const [role, status, expected] of [
      ["CUSTOMER", "ACTIVE", 403],
      ["ADMIN", "PENDING", 403],
      ["ADMIN", "ACTIVE", 200],
    ] as const) {
      const s = await login(role, status)
      assert.equal(
        (await call("/admin/users", { access: s.accessToken })).status,
        expected,
      )
    }
  })
  it("role e status atuais no banco prevalecem sobre claims antigas", async () => {
    const s = await login("ADMIN")
    await prisma.user.update({
      where: { id: s.user.id },
      data: { role: "CUSTOMER" },
    })
    assert.equal(
      (await call("/admin/users", { access: s.accessToken })).status,
      403,
    )
    await prisma.user.update({
      where: { id: s.user.id },
      data: { status: "BLOCKED" },
    })
    assert.equal(
      (await call("/auth/me", { access: s.accessToken })).status,
      403,
    )
    assert.equal(
      (await call("/auth/refresh", { body: {}, cookie: s.cookie })).status,
      403,
    )
  })
  it("usuário removido e JWT adulterado não autenticam", async () => {
    const s = await login()
    await prisma.user.delete({ where: { id: s.user.id } })
    assert.equal(
      (await call("/auth/me", { access: s.accessToken })).status,
      401,
    )
    assert.equal(
      (await call("/auth/me", { access: s.accessToken + "broken" })).status,
      401,
    )
    assert.equal((await call("/auth/me")).status, 401)
  })
  it("conta BLOCKED não consegue usar OTP nem cria uma sessão", async () => {
    const u = await user("CUSTOMER", "BLOCKED")
    assert.equal(
      (await call("/auth/verify-otp", { body: await challenge(u.phone) }))
        .status,
      403,
    )
    assert.equal(await prisma.refreshToken.count(), 0)
  })
  it("mass assignment de role/status é rejeitado em pedido, login e perfil", async () => {
    const otp = await challenge()
    for (const extra of [{ role: "ADMIN" }, { status: "ACTIVE" }]) {
      assert.equal(
        (
          await call("/auth/request-otp", {
            body: { phone: otp.phone, ...extra },
          })
        ).status,
        400,
      )
      assert.equal(
        (await call("/auth/verify-otp", { body: { ...otp, ...extra } })).status,
        400,
      )
    }
    const s = await login("CUSTOMER", "PENDING")
    assert.equal(
      (
        await call("/users/me", {
          method: "PATCH",
          access: s.accessToken,
          body: { fullName: "Cliente", role: "ADMIN", status: "ACTIVE" },
        })
      ).status,
      400,
    )
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: s.user.id } }))
        .status,
      "PENDING",
    )
    assert.equal(
      (
        await call("/users/me", {
          method: "PATCH",
          access: s.accessToken,
          body: { fullName: "Nome atualizado" },
        })
      ).status,
      200,
    )
  })
  it("busca textual não inclui todos os telefones e paginação impõe limites", async () => {
    const s = await login("ADMIN")
    await user("CUSTOMER", "PENDING", "Alice Exclusiva")
    await user("CUSTOMER", "ACTIVE", "Bruno")
    const r = await call("/admin/users?search=Alice&perPage=1", {
      access: s.accessToken,
    })
    assert.equal(r.body.data.total, 1)
    assert.equal(r.body.data.users.length, 1)
    for (const query of ["perPage=101", "page=0", "page=100001", "status=FAKE"])
      assert.equal(
        (await call("/admin/users?" + query, { access: s.accessToken })).status,
        400,
      )
    assert.equal(
      (await call("/admin/users/not-a-uuid", { access: s.accessToken })).status,
      400,
    )
    assert.equal(
      (await call("/admin/users/" + s.user.id, { access: s.accessToken }))
        .status,
      200,
    )
  })
  it("self-block é negado e bloqueio cruzado concorrente preserva um admin ativo", async () => {
    const a = await login("ADMIN"),
      b = await login("ADMIN")
    assert.equal(
      (
        await call("/admin/users/" + a.user.id + "/status", {
          method: "PATCH",
          body: { status: "BLOCKED" },
          access: a.accessToken,
        })
      ).status,
      400,
    )
    const r = await Promise.allSettled([
      admin.updateUserStatus(a.user.id, b.user.id, "BLOCKED"),
      admin.updateUserStatus(b.user.id, a.user.id, "BLOCKED"),
    ])
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1)
    assert.equal(
      await prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } }),
      1,
    )
  })
  it("aprovação/bloqueio/reativação têm auditoria mínima, atômica e sem logs duplicados", async () => {
    const a = await login("ADMIN"),
      c = await login("CUSTOMER", "PENDING")
    for (const status of ["ACTIVE", "BLOCKED", "ACTIVE", "ACTIVE"] as const)
      await admin.updateUserStatus(a.user.id, c.user.id, status)
    const logs = await prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "asc" },
    })
    assert.equal(logs.length, 3)
    assert.deepEqual(logs[0]!.metadata, { from: "PENDING", to: "ACTIVE" })
    assert.equal(logs[1]!.actorId, a.user.id)
    assert.equal(logs[1]!.targetUserId, c.user.id)
    assert.equal(
      await prisma.refreshToken.count({
        where: { userId: c.user.id, revokedAt: null },
      }),
      0,
    )
    const r = await call("/admin/audit-log", { access: a.accessToken })
    assert.equal(r.status, 200)
    assert.doesNotMatch(
      JSON.stringify(r.body),
      /tokenHash|codeHash|authorization|cookie/i,
    )
  })
  it("FK preserva ator da auditoria; exclusão de alvo mantém registro histórico", async () => {
    const a = await user("ADMIN"),
      c = await user("CUSTOMER", "PENDING")
    await admin.updateUserStatus(a.id, c.id, "ACTIVE")
    await assert.rejects(prisma.user.delete({ where: { id: a.id } }), {
      code: "P2003",
    })
    await prisma.user.delete({ where: { id: c.id } })
    assert.equal(
      (await prisma.adminAuditLog.findFirstOrThrow()).targetUserId,
      null,
    )
  })
  it("bootstrap normaliza, é idempotente e requer intenção explícita para promover", async () => {
    const first = await bootstrap("(71) 99999-9999", "Admin QA")
    const again = await bootstrap("+5571999999999", "Admin QA")
    assert.equal(first.id, again.id)
    assert.equal(again.changed, false)
    assert.equal(await prisma.user.count(), 1)
    assert.equal(await prisma.adminAuditLog.count(), 1)
    const c = await user("CUSTOMER", "BLOCKED")
    await assert.rejects(bootstrap(c.phone, "Admin QA"), { statusCode: 409 })
    assert.equal((await bootstrap(c.phone, "Admin QA", true)).changed, true)
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).role,
      "ADMIN",
    )
  })
  it("bootstrap concorrente não duplica usuário nem auditoria", async () => {
    await Promise.all([
      bootstrap("71999998888", "Admin QA"),
      bootstrap("+5571999998888", "Admin QA"),
    ])
    assert.equal(await prisma.user.count(), 1)
    assert.equal(await prisma.adminAuditLog.count(), 1)
  })
  it("CORS exato, preflight com header CSRF e ausência desse header são tratados", async () => {
    const denied = await call("/auth/refresh", {
      body: {},
      headers: { Origin: "https://evil.example" },
    })
    assert.equal(denied.status, 403)
    assert.equal(denied.headers.get("access-control-allow-origin"), null)
    assert.equal(
      (
        await call("/auth/refresh", {
          body: {},
          headers: { "X-CSRF-Protection": "" },
        })
      ).status,
      403,
    )
    const preflight = await fetch(base + "/auth/refresh", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:8443",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "X-CSRF-Protection,Content-Type",
      },
    })
    assert.equal(preflight.status, 204)
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "http://localhost:8443",
    )
    assert.equal(
      preflight.headers.get("access-control-allow-credentials"),
      "true",
    )
  })
  it("JSON inválido/oversized, cookies inválidos e campos extras não viram erro 500", async () => {
    for (const [body, expected] of [
      ["{broken", 400],
      [JSON.stringify({ value: "x".repeat(110000) }), 413],
    ] as const) {
      const r = await fetch(base + "/auth/request-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Protection": "1",
        },
        body,
      })
      assert.equal(r.status, expected)
      assert.doesNotMatch(await r.text(), /stack|SQL|DATABASE_URL|node_modules/)
    }
    assert.equal(
      (
        await call("/auth/refresh", {
          body: {},
          cookie: "ec_refresh=j%3A%7B%22a%22%3A1%7D",
        })
      ).status,
      401,
    )
    assert.equal(
      (await call("/auth/refresh", { body: { refreshToken: "body-token" } }))
        .status,
      400,
    )
  })
})
