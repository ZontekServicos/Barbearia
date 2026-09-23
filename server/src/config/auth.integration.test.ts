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
  FRONTEND_URL: "http://localhost:8443",
  TRUST_PROXY_HOPS: "0",
})
let prisma: typeof import("./prisma.js").prisma
let auth: typeof import("../modules/auth/auth.service.js")
let tokens: typeof import("../modules/auth/token.service.js")
let admin: typeof import("../modules/admin/admin.service.js")
let bootstrap: typeof import("../modules/admin/bootstrap.service.js").bootstrapAdmin
let hashPassword: typeof import("../modules/auth/password.service.js").hashPassword
let limits: typeof import("../middlewares/rate-limit.js")
let server: Server
let base: string
let phoneCounter = 0
const phone = () => "+55719" + String(10000000 + phoneCounter++)

const PASSWORD = "senha-de-teste-123"
const ADMIN_PASSWORD = "senha-admin-de-teste-456"

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

/** Cria o usuário direto no banco, com credencial válida. */
async function user(
  role: "ADMIN" | "CUSTOMER" = "CUSTOMER",
  status: "ACTIVE" | "PENDING" | "BLOCKED" = "ACTIVE",
  fullName = "Pessoa QA",
  password: string | null = PASSWORD,
) {
  return prisma.user.create({
    data: {
      phone: phone(),
      fullName,
      role,
      status,
      ...(password
        ? {
            passwordHash: await hashPassword(password),
            passwordUpdatedAt: new Date(),
          }
        : {}),
    },
  })
}

async function login(
  role: "ADMIN" | "CUSTOMER" = "CUSTOMER",
  status: "ACTIVE" | "PENDING" = "ACTIVE",
) {
  const u = await user(role, status)
  const session = await tokens.issueSession(u.id)
  return { user: u, ...session, cookie: "ec_refresh=" + session.refreshToken }
}

/** Corpo completo de cadastro, para não repetir confirmação em cada teste. */
function registration(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Cliente Novo",
    phone: phone(),
    password: PASSWORD,
    confirmPassword: PASSWORD,
    ...overrides,
  }
}

async function cleanup() {
  await prisma.adminAuditLog.deleteMany()
  await prisma.appointment.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.user.deleteMany()
}

describe("Autenticação telefone + senha (Express + Prisma + PostgreSQL real)", { skip: !enabled }, () => {
  before(async () => {
    ;({ prisma } = await import("./prisma.js"))
    auth = await import("../modules/auth/auth.service.js")
    tokens = await import("../modules/auth/token.service.js")
    admin = await import("../modules/admin/admin.service.js")
    ;({
      bootstrapAdmin: bootstrap,
    } = await import("../modules/admin/bootstrap.service.js"))
    ;({
      hashPassword,
    } = await import("../modules/auth/password.service.js"))
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
    for (const limiter of [
      limits.globalRateLimit,
      limits.registerRateLimit,
      limits.loginRateLimit,
      limits.passwordChangeRateLimit,
    ])
      limiter.resetKey("127.0.0.1")
  })
  after(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      )
    if (prisma) {
      await cleanup()
      await prisma.$disconnect()
    }
  })

  for (const mutation of ["password", "blocked", "lockout"] as const) {
    it("security regression: login rechecks " + mutation + " after acquiring the user lock", async () => {
      const u = await user()
      const original = prisma.user.findUnique.bind(prisma.user)
      const replacement = await hashPassword("new-independent-password-123")
      prisma.user.findUnique = (async (args: any) => {
        const snapshot = await original(args)
        if (args.where.phone === u.phone) {
          prisma.user.findUnique = original
          await prisma.user.update({ where: { id: u.id }, data:
            mutation === "password" ? { passwordHash: replacement, passwordUpdatedAt: new Date() } :
            mutation === "blocked" ? { status: "BLOCKED" } : { lockedUntil: new Date(Date.now() + 60000) }
          })
        }
        return snapshot
      }) as typeof prisma.user.findUnique
      try {
        await assert.rejects(auth.loginWithPassword(u.phone, PASSWORD), { statusCode: mutation === "blocked" ? 403 : 401 })
        assert.equal(await prisma.refreshToken.count({ where: { userId: u.id, revokedAt: null } }), 0)
      } finally { prisma.user.findUnique = original }
    })
  }
  it("security regression: stale current password cannot overwrite an intervening reset", async () => {
    const session = await login()
    const replacement = await hashPassword("reset-by-operator-password-123")
    const original = prisma.user.findUnique.bind(prisma.user)
    prisma.user.findUnique = (async (args: any) => {
      const snapshot = await original(args)
      if (args.where.id === session.user.id) {
        prisma.user.findUnique = original
        await prisma.user.update({ where: { id: session.user.id }, data: { passwordHash: replacement } })
      }
      return snapshot
    }) as typeof prisma.user.findUnique
    try {
      const response = await call("/users/me/password", { method: "PATCH", access: session.accessToken,
        body: { currentPassword: PASSWORD, password: "attacker-replacement-password", confirmPassword: "attacker-replacement-password" } })
      assert.equal(response.status, 401)
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } })).passwordHash, replacement)
    } finally { prisma.user.findUnique = original }
  })
  it("security regression: Unicode normalization errors return 400 instead of 500", async () => {
    for (const password of ["e\u0301".repeat(4), "\uFB03".repeat(64)]) {
      const r = await call("/auth/register", { body: registration({ password, confirmPassword: password }) })
      assert.equal(r.status, 400)
      assert.equal(r.body.error.code, "VALIDATION_ERROR")
    }
  })

  it("password changes have an independent rate limit", async () => {
    const session = await login()
    for (let i = 0; i < 10; i++) {
      const r = await call("/users/me/password", { method: "PATCH", access: session.accessToken,
        body: { currentPassword: "wrong-password", password: "new-password-example-123", confirmPassword: "new-password-example-123" } })
      assert.equal(r.status, 401)
    }
    assert.equal((await call("/users/me/password", { method: "PATCH", access: session.accessToken,
      body: { currentPassword: PASSWORD, password: "new-password-example-123", confirmPassword: "new-password-example-123" } })).status, 429)
  })
  it("new password validation counts normalized code points and enforces 15 characters", async () => {
    for (const password of ["a".repeat(14), "e\u0301".repeat(14)]) {
      assert.equal((await call("/auth/register", { body: registration({ password, confirmPassword: password }) })).status, 400)
    }
    const password = "😀".repeat(15)
    const body = registration({ password, confirmPassword: password })
    assert.equal((await call("/auth/register", { body })).status, 201)
    assert.equal((await call("/auth/login", { body: { phone: body.phone, password } })).status, 200)
  })

  // ------------------------------------------------------------------ cadastro

  it("cadastro válido cria CUSTOMER PENDING com sessão e sem expor credencial", async () => {
    const r = await call("/auth/register", { body: registration() })
    assert.equal(r.status, 201)
    assert.equal(r.body.data.user.role, "CUSTOMER")
    assert.equal(r.body.data.user.status, "PENDING")
    assert.equal(r.body.data.user.hasPassword, true)
    // Nem hash, nem senha, nem refresh token no corpo.
    assert.doesNotMatch(
      JSON.stringify(r.body),
      /argon2|passwordHash|senha-de-teste|refreshToken/i,
    )
    assert.equal(
      (await call("/auth/me", { access: r.body.data.accessToken })).status,
      200,
    )
    // PENDING autentica mas não acessa área administrativa.
    assert.equal(
      (await call("/admin/users", { access: r.body.data.accessToken })).status,
      403,
    )
  })

  it("o hash guardado é Argon2id e nunca a senha em texto puro", async () => {
    const body = registration()
    await call("/auth/register", { body })
    const stored = await prisma.user.findUniqueOrThrow({
      where: { phone: body.phone },
    })
    assert.match(stored.passwordHash!, /^\$argon2id\$/)
    assert.ok(!stored.passwordHash!.includes(PASSWORD))
    assert.notEqual(stored.passwordUpdatedAt, null)
  })

  it("a mesma senha em dois cadastros produz hashes diferentes", async () => {
    const a = registration()
    const b = registration()
    await call("/auth/register", { body: a })
    await call("/auth/register", { body: b })
    const [ua, ub] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { phone: a.phone } }),
      prisma.user.findUniqueOrThrow({ where: { phone: b.phone } }),
    ])
    assert.notEqual(ua.passwordHash, ub.passwordHash)
  })

  it("recusa nome vazio, só espaços, telefone inválido e senha curta", async () => {
    for (const invalid of [
      { fullName: "" },
      { fullName: "   " },
      { fullName: "A" },
      { phone: "123" },
      { phone: "(71) 3333-3333" }, // fixo, não recebe cliente de celular
      { phone: "(00) 99999-9999" }, // DDD inexistente
      { password: "curta", confirmPassword: "curta" },
      { password: "", confirmPassword: "" },
    ]) {
      // Isolate schema validation from the independently tested IP quota.
      limits.registerRateLimit.resetKey("127.0.0.1")
      const r = await call("/auth/register", { body: registration(invalid) })
      assert.equal(r.status, 400, JSON.stringify(invalid))
      assert.equal(r.body.error.code, "VALIDATION_ERROR")
    }
    assert.equal(await prisma.user.count(), 0)
  })

  it("recusa confirmação divergente e aponta o campo", async () => {
    const r = await call("/auth/register", {
      body: registration({ confirmPassword: "outra-senha-qualquer" }),
    })
    assert.equal(r.status, 400)
    assert.ok(
      r.body.error.details?.some((d: { field: string }) =>
        d.field.includes("confirmPassword"),
      ),
      "a validação deve apontar confirmPassword",
    )
    assert.equal(await prisma.user.count(), 0)
  })

  it("normaliza o telefone para E.164 e o nome antes de gravar", async () => {
    const r = await call("/auth/register", {
      body: {
        fullName: "  Maria   das   Dores  ",
        phone: "(71) 98888-7777",
        password: PASSWORD,
        confirmPassword: PASSWORD,
      },
    })
    assert.equal(r.status, 201)
    const stored = await prisma.user.findUniqueOrThrow({
      where: { phone: "+5571988887777" },
    })
    assert.equal(stored.fullName, "Maria das Dores")
  })

  it("telefone duplicado é recusado mesmo escrito em formato diferente", async () => {
    await call("/auth/register", {
      body: registration({ phone: "(71) 98888-1234" }),
    })
    for (const variant of [
      "71988881234",
      "+55 71 98888-1234",
      "5571988881234",
    ]) {
      const r = await call("/auth/register", {
        body: registration({ phone: variant }),
      })
      assert.equal(r.status, 409)
      assert.equal(r.body.error.code, "PHONE_ALREADY_REGISTERED")
    }
    assert.equal(await prisma.user.count(), 1)
  })

  it("dois cadastros simultâneos do mesmo telefone criam apenas uma conta", async () => {
    const body = registration()
    const results = await Promise.all([
      call("/auth/register", { body }),
      call("/auth/register", { body }),
    ])
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409])
    assert.equal(await prisma.user.count(), 1)
    assert.equal(await prisma.refreshToken.count(), 1)
  })

  it("cadastro não pode reivindicar conta herdada sem senha", async () => {
    const legacy = await user("CUSTOMER", "ACTIVE", "Conta Antiga", null)
    const r = await call("/auth/register", {
      body: registration({ phone: legacy.phone }),
    })
    assert.equal(r.status, 409)
    // A conta antiga continua sem credencial: ninguém a assumiu.
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: legacy.id },
    })
    assert.equal(after.passwordHash, null)
    assert.equal(after.role, "CUSTOMER")
  })

  // --------------------------------------------------------------------- login

  it("login com senha correta abre sessão; senha errada e telefone inexistente respondem igual", async () => {
    const u = await user("CUSTOMER", "ACTIVE")
    const ok = await call("/auth/login", {
      body: { phone: u.phone, password: PASSWORD },
    })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.data.user.id, u.id)
    assert.equal(
      (await call("/auth/me", { access: ok.body.data.accessToken })).status,
      200,
    )

    const wrongPassword = await call("/auth/login", {
      body: { phone: u.phone, password: "senha-errada-aqui" },
    })
    const unknownPhone = await call("/auth/login", {
      body: { phone: phone(), password: PASSWORD },
    })
    // Resposta idêntica: nada revela se o telefone existe.
    assert.equal(wrongPassword.status, 401)
    assert.deepEqual(wrongPassword.body, unknownPhone.body)
    assert.equal(wrongPassword.body.error.code, "INVALID_CREDENTIALS")
    assert.match(wrongPassword.body.error.message, /Telefone ou senha/)
  })

  it("conta sem senha não autentica e não se distingue de senha errada", async () => {
    const legacy = await user("CUSTOMER", "ACTIVE", "Conta Antiga", null)
    const r = await call("/auth/login", {
      body: { phone: legacy.phone, password: PASSWORD },
    })
    const unknown = await call("/auth/login", {
      body: { phone: phone(), password: PASSWORD },
    })
    assert.equal(r.status, 401)
    assert.deepEqual(r.body, unknown.body)
    assert.equal(await prisma.refreshToken.count(), 0)
  })

  it("usuário PENDING entra e vê o próprio perfil, mas não agenda", async () => {
    const u = await user("CUSTOMER", "PENDING")
    const r = await call("/auth/login", {
      body: { phone: u.phone, password: PASSWORD },
    })
    assert.equal(r.status, 200)
    assert.equal(r.body.data.user.status, "PENDING")
    const access = r.body.data.accessToken
    assert.equal((await call("/auth/me", { access })).status, 200)
    const blocked = await call("/booking/appointments", {
      access,
      body: { serviceId: crypto.randomUUID(), date: "2030-01-01", startsAt: "10:00" },
    })
    assert.equal(blocked.status, 403)
    assert.equal(blocked.body.error.code, "ACCOUNT_PENDING")
  })

  it("conta BLOCKED não entra mesmo com a senha certa e não cria sessão", async () => {
    const u = await user("CUSTOMER", "BLOCKED")
    const r = await call("/auth/login", {
      body: { phone: u.phone, password: PASSWORD },
    })
    assert.equal(r.status, 403)
    assert.equal(r.body.error.code, "ACCOUNT_BLOCKED")
    assert.equal(await prisma.refreshToken.count(), 0)

    // E com senha errada continua sendo a resposta genérica: o bloqueio só é
    // revelado a quem provou conhecer a credencial.
    const wrong = await call("/auth/login", {
      body: { phone: u.phone, password: "errada-de-proposito" },
    })
    assert.equal(wrong.status, 401)
    assert.equal(wrong.body.error.code, "INVALID_CREDENTIALS")
  })

  it("tentativas repetidas bloqueiam a conta em silêncio, sem revelar que existe", async () => {
    const u = await user("CUSTOMER", "ACTIVE")
    for (let i = 0; i < 10; i++) {
      limits.loginRateLimit.resetKey("127.0.0.1")
      const r = await call("/auth/login", {
        body: { phone: u.phone, password: "errada" },
      })
      assert.equal(r.status, 401)
    }
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    assert.notEqual(locked.lockedUntil, null)
    assert.ok(locked.lockedUntil!.getTime() > Date.now())

    // Mesmo com a senha correta, a resposta durante o bloqueio é a genérica.
    limits.loginRateLimit.resetKey("127.0.0.1")
    const correct = await call("/auth/login", {
      body: { phone: u.phone, password: PASSWORD },
    })
    assert.equal(correct.status, 401)
    assert.equal(correct.body.error.code, "INVALID_CREDENTIALS")
    assert.equal(await prisma.refreshToken.count(), 0)
  })

  it("login bem-sucedido zera o contador de falhas", async () => {
    const u = await user("CUSTOMER", "ACTIVE")
    for (let i = 0; i < 3; i++) {
      limits.loginRateLimit.resetKey("127.0.0.1")
      await call("/auth/login", { body: { phone: u.phone, password: "x" } })
    }
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: u.id } }))
        .failedLoginAttempts,
      3,
    )
    limits.loginRateLimit.resetKey("127.0.0.1")
    assert.equal(
      (await call("/auth/login", { body: { phone: u.phone, password: PASSWORD } }))
        .status,
      200,
    )
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    assert.equal(after.failedLoginAttempts, 0)
    assert.equal(after.lockedUntil, null)
  })

  it("limites por IP de cadastro e login são independentes", async () => {
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await call("/auth/register", { body: registration() })).status,
        201,
      )
    assert.equal(
      (await call("/auth/register", { body: registration() })).status,
      429,
    )
    // O login continua liberado: os limitadores não compartilham contador.
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await call("/auth/login", { body: { phone: phone(), password: PASSWORD } }))
          .status,
        401,
      )
    assert.equal(
      (await call("/auth/login", { body: { phone: phone(), password: PASSWORD } }))
        .status,
      429,
    )
    limits.globalRateLimit.resetKey("127.0.0.1")
    for (let i = 0; i < 120; i++)
      assert.equal((await call("/health")).status, 200)
    assert.equal((await call("/health")).status, 429)
  })

  it("rotas de OTP não existem mais", async () => {
    for (const path of ["/auth/request-otp", "/auth/verify-otp"]) {
      const r = await call(path, { body: { phone: phone(), code: "123456" } })
      assert.equal(r.status, 404, path)
    }
  })

  // ---------------------------------------------------------- troca de senha

  it("troca de senha exige a atual, encerra sessões e passa a valer no login", async () => {
    const u = await user("CUSTOMER", "ACTIVE")
    const session = await tokens.issueSession(u.id)

    const wrong = await call("/users/me/password", {
      method: "PATCH",
      access: session.accessToken,
      body: {
        currentPassword: "nao-e-a-atual",
        password: "nova-senha-longa-1",
        confirmPassword: "nova-senha-longa-1",
      },
    })
    assert.equal(wrong.status, 401)

    const ok = await call("/users/me/password", {
      method: "PATCH",
      access: session.accessToken,
      body: {
        currentPassword: PASSWORD,
        password: "nova-senha-longa-1",
        confirmPassword: "nova-senha-longa-1",
      },
    })
    assert.equal(ok.status, 200)

    // A sessão anterior morre junto com a senha antiga.
    assert.equal(
      (await call("/auth/me", { access: session.accessToken })).status,
      401,
    )
    limits.loginRateLimit.resetKey("127.0.0.1")
    assert.equal(
      (await call("/auth/login", { body: { phone: u.phone, password: PASSWORD } }))
        .status,
      401,
    )
    limits.loginRateLimit.resetKey("127.0.0.1")
    assert.equal(
      (
        await call("/auth/login", {
          body: { phone: u.phone, password: "nova-senha-longa-1" },
        })
      ).status,
      200,
    )
  })

  it("confirmação divergente não troca a senha", async () => {
    const u = await user("CUSTOMER", "ACTIVE")
    const session = await tokens.issueSession(u.id)
    const r = await call("/users/me/password", {
      method: "PATCH",
      access: session.accessToken,
      body: {
        currentPassword: PASSWORD,
        password: "nova-senha-longa-1",
        confirmPassword: "nova-senha-diferente",
      },
    })
    assert.equal(r.status, 400)
    assert.equal(
      (await call("/auth/me", { access: session.accessToken })).status,
      200,
    )
  })

  // ------------------------------------------- recuperação assistida (admin)

  it("admin redefine senha: nunca devolve a senha, audita e derruba sessões", async () => {
    const a = await login("ADMIN")
    const target = await user("CUSTOMER", "ACTIVE", "Cliente Esquecido")
    const targetSession = await tokens.issueSession(target.id)

    const r = await call("/admin/users/" + target.id + "/reset-password", {
      method: "POST",
      access: a.accessToken,
      body: { password: "temporary-password-test-123", confirmPassword: "temporary-password-test-123" },
    })
    assert.equal(r.status, 200)
    const temporary = "temporary-password-test-123"
    assert.ok(!JSON.stringify(r.body).includes(temporary))
    assert.equal(r.body.data.temporaryPassword, undefined)

    // Sessão do alvo encerrada; a senha antiga não vale mais.
    assert.equal(
      (await call("/auth/me", { access: targetSession.accessToken })).status,
      401,
    )
    limits.loginRateLimit.resetKey("127.0.0.1")
    assert.equal(
      (
        await call("/auth/login", {
          body: { phone: target.phone, password: PASSWORD },
        })
      ).status,
      401,
    )
    limits.loginRateLimit.resetKey("127.0.0.1")
    assert.equal(
      (
        await call("/auth/login", {
          body: { phone: target.phone, password: temporary },
        })
      ).status,
      200,
    )

    // Auditoria registra o fato, nunca a senha.
    const log = await prisma.adminAuditLog.findFirstOrThrow({
      where: { action: "USER_PASSWORD_RESET" },
    })
    assert.equal(log.actorId, a.user.id)
    assert.equal(log.targetUserId, target.id)
    assert.ok(!JSON.stringify(log.metadata).includes(temporary))
  })

  it("redefinição assistida destrava conta herdada sem senha", async () => {
    const a = await login("ADMIN")
    const legacy = await user("CUSTOMER", "ACTIVE", "Conta Antiga", null)
    const r = await call("/admin/users/" + legacy.id + "/reset-password", {
      method: "POST",
      access: a.accessToken,
      body: { password: "temporary-password-test-123", confirmPassword: "temporary-password-test-123" },
    })
    assert.equal(r.status, 200)
    limits.loginRateLimit.resetKey("127.0.0.1")
    assert.equal(
      (
        await call("/auth/login", {
          body: { phone: legacy.phone, password: "temporary-password-test-123" },
        })
      ).status,
      200,
    )
  })

  it("redefinição é exclusiva de ADMIN e não serve para a própria conta", async () => {
    const a = await login("ADMIN")
    const customer = await login("CUSTOMER", "ACTIVE")
    assert.equal(
      (
        await call("/admin/users/" + a.user.id + "/reset-password", {
          method: "POST",
          access: customer.accessToken,
          body: { password: "temporary-password-test-123", confirmPassword: "temporary-password-test-123" },
        })
      ).status,
      403,
    )
    assert.equal(
      (
        await call("/admin/users/" + a.user.id + "/reset-password", {
          method: "POST",
          access: a.accessToken,
          body: { password: "temporary-password-test-123", confirmPassword: "temporary-password-test-123" },
        })
      ).status,
      400,
    )
  })

  // --------------------------------------------------------- sessão e tokens

  it("refresh rotaciona, reuse revoga sessões e novo login permite nova sessão", async () => {
    const u = await user("CUSTOMER", "ACTIVE")
    const s = await tokens.issueSession(u.id)
    const cookie = "ec_refresh=" + s.refreshToken
    const r = await call("/auth/refresh", { body: {}, cookie })
    assert.equal(r.status, 200)
    assert.notEqual(r.cookie, cookie)
    assert.equal((await call("/auth/me", { access: s.accessToken })).status, 401)
    assert.equal(
      (await call("/auth/refresh", { body: {}, cookie })).status,
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
    limits.loginRateLimit.resetKey("127.0.0.1")
    const fresh = await call("/auth/login", {
      body: { phone: u.phone, password: PASSWORD },
    })
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
    assert.equal((await call("/auth/me", { access: s.accessToken })).status, 401)
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

  it("cookie tem httpOnly, path e SameSite coerentes; não é entregue no JSON", async () => {
    const body = registration()
    const r = await call("/auth/register", { body })
    const cookie = r.headers.get("set-cookie")!
    for (const expected of [/HttpOnly/, /Path=\/auth/, /SameSite=Lax/])
      assert.match(cookie, expected)
    assert.equal(r.body.data.refreshToken, undefined)
  })

  // ------------------------------------------------------------- autorização

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
    assert.equal((await call("/auth/me", { access: s.accessToken })).status, 403)
    assert.equal(
      (await call("/auth/refresh", { body: {}, cookie: s.cookie })).status,
      403,
    )
  })

  it("usuário removido e JWT adulterado não autenticam", async () => {
    const s = await login()
    await prisma.user.delete({ where: { id: s.user.id } })
    assert.equal((await call("/auth/me", { access: s.accessToken })).status, 401)
    assert.equal(
      (await call("/auth/me", { access: s.accessToken + "broken" })).status,
      401,
    )
    assert.equal((await call("/auth/me")).status, 401)
  })

  it("mass assignment de role, status e phone é rejeitado no cadastro e no perfil", async () => {
    for (const extra of [
      { role: "ADMIN" },
      { status: "ACTIVE" },
      { passwordHash: "$argon2id$forjado" },
    ]) {
      const r = await call("/auth/register", { body: registration(extra) })
      assert.equal(r.status, 400, JSON.stringify(extra))
    }
    assert.equal(await prisma.user.count(), 0)

    const s = await login("CUSTOMER", "PENDING")
    for (const extra of [
      { role: "ADMIN" },
      { status: "ACTIVE" },
      { phone: "+5571988889999" },
    ]) {
      assert.equal(
        (
          await call("/users/me", {
            method: "PATCH",
            access: s.accessToken,
            body: { fullName: "Cliente", ...extra },
          })
        ).status,
        400,
        JSON.stringify(extra),
      )
    }
    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: s.user.id },
    })
    assert.equal(unchanged.status, "PENDING")
    assert.equal(unchanged.phone, s.user.phone)
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

  it("nenhuma resposta da API carrega hash, senha ou token interno", async () => {
    const a = await login("ADMIN")
    await user("CUSTOMER", "PENDING", "Alvo QA")
    for (const path of ["/admin/users", "/admin/audit-log", "/auth/me"]) {
      const r = await call(path, { access: a.accessToken })
      assert.equal(r.status, 200, path)
      assert.doesNotMatch(
        JSON.stringify(r.body),
        /argon2|passwordHash|password_hash|tokenHash|authorization|cookie/i,
        path,
      )
    }
  })

  // ------------------------------------------------------------------- admin

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
    assert.equal(
      await prisma.refreshToken.count({
        where: { userId: c.user.id, revokedAt: null },
      }),
      0,
    )
  })

  it("aprovação administrativa libera o agendamento que estava bloqueado", async () => {
    const a = await login("ADMIN")
    const r = await call("/auth/register", { body: registration() })
    const access = r.body.data.accessToken
    const created = await prisma.user.findUniqueOrThrow({
      where: { id: r.body.data.user.id },
    })

    assert.equal(
      (await call("/booking/appointments", { access, body: {} }))
        .status,
      403,
    )
    await admin.updateUserStatus(a.user.id, created.id, "ACTIVE")

    // Uma nova autenticação também observa imediatamente o status aprovado.
    limits.loginRateLimit.resetKey("127.0.0.1")
    const again = await call("/auth/login", {
      body: { phone: created.phone, password: PASSWORD },
    })
    assert.equal(again.status, 200)
    assert.equal(again.body.data.user.status, "ACTIVE")
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

  // --------------------------------------------------------------- bootstrap

  it("bootstrap cria admin com senha, normaliza telefone e é idempotente", async () => {
    const first = await bootstrap("(71) 99999-9999", "Admin QA", ADMIN_PASSWORD)
    const again = await bootstrap("+5571999999999", "Admin QA", ADMIN_PASSWORD)
    assert.equal(first.id, again.id)
    assert.equal(again.changed, false)
    assert.equal(await prisma.user.count(), 1)
    assert.equal(await prisma.adminAuditLog.count(), 1)

    const created = await prisma.user.findUniqueOrThrow({
      where: { id: first.id },
    })
    assert.match(created.passwordHash!, /^\$argon2id\$/)

    // O admin entra pelo mesmo fluxo de senha que os clientes.
    limits.loginRateLimit.resetKey("127.0.0.1")
    const session = await call("/auth/login", {
      body: { phone: "+5571999999999", password: ADMIN_PASSWORD },
    })
    assert.equal(session.status, 200)
    assert.equal(session.body.data.user.role, "ADMIN")
    assert.equal(
      (await call("/admin/users", { access: session.body.data.accessToken }))
        .status,
      200,
    )
  })

  it("bootstrap exige senha e não cria admin sem credencial", async () => {
    await assert.rejects(bootstrap("(71) 99999-7777", "Admin QA", null), {
      statusCode: 400,
    })
    assert.equal(await prisma.user.count(), 0)
  })

  it("bootstrap exige intenção explícita para promover e para trocar senha", async () => {
    const c = await user("CUSTOMER", "BLOCKED")
    await assert.rejects(bootstrap(c.phone, "Admin QA", ADMIN_PASSWORD), {
      statusCode: 409,
    })

    // Promoção autorizada preserva a senha que a conta já tinha.
    const before = await prisma.user.findUniqueOrThrow({ where: { id: c.id } })
    const promoted = await bootstrap(c.phone, "Admin QA", ADMIN_PASSWORD, true)
    assert.equal(promoted.changed, true)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: c.id } })
    assert.equal(after.role, "ADMIN")
    assert.equal(after.status, "ACTIVE")
    assert.equal(
      after.passwordHash,
      before.passwordHash,
      "bootstrap não pode substituir credencial existente sem intenção declarada",
    )

    // Com a intenção declarada, a senha é substituída.
    const reset = await bootstrap(c.phone, "Admin QA", ADMIN_PASSWORD, true, true)
    assert.equal(reset.changed, true)
    const final = await prisma.user.findUniqueOrThrow({ where: { id: c.id } })
    assert.notEqual(final.passwordHash, before.passwordHash)
  })

  it("bootstrap concorrente não duplica usuário nem auditoria", async () => {
    await Promise.all([
      bootstrap("71999998888", "Admin QA", ADMIN_PASSWORD),
      bootstrap("+5571999998888", "Admin QA", ADMIN_PASSWORD),
    ])
    assert.equal(await prisma.user.count(), 1)
    assert.equal(await prisma.adminAuditLog.count(), 1)
  })

  it("nenhuma senha de bootstrap aparece na auditoria", async () => {
    await bootstrap("71999996666", "Admin QA", ADMIN_PASSWORD)
    const logs = await prisma.adminAuditLog.findMany()
    assert.ok(!JSON.stringify(logs).includes(ADMIN_PASSWORD))
  })

  // ---------------------------------------------------------------- borda HTTP

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
  })

  it("login também exige o header anti-CSRF", async () => {
    const r = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone(), password: PASSWORD }),
    })
    assert.equal(r.status, 403)
  })

  it("JSON inválido/oversized, cookies inválidos e campos extras não viram erro 500", async () => {
    for (const [body, expected] of [
      ["{broken", 400],
      [JSON.stringify({ value: "x".repeat(110000) }), 413],
    ] as const) {
      const r = await fetch(base + "/auth/login", {
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

  it("senha de 128 caracteres é aceita e acima disso recusada", async () => {
    const longa = "a".repeat(128)
    const body = registration({ password: longa, confirmPassword: longa })
    assert.equal((await call("/auth/register", { body })).status, 201)

    const excessiva = "a".repeat(129)
    assert.equal(
      (
        await call("/auth/register", {
          body: registration({
            password: excessiva,
            confirmPassword: excessiva,
          }),
        })
      ).status,
      400,
    )
  })

  it("auth.service recusa senha fora do padrão sem tocar no banco", async () => {
    await assert.rejects(
      auth.registerCustomer(phone(), "curta", "Nome QA"),
      /tamanho/,
    )
    assert.equal(await prisma.user.count(), 0)
  })
})
