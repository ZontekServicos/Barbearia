import { before, beforeEach, after, afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"

// env.ts valida na importação. O provider é construído com config explícita,
// então o ambiente aqui só precisa ser válido — nunca `twilio`, para garantir
// que nenhuma credencial real seja lida durante os testes.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://unused@127.0.0.1:1/not_used",
  JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
  FRONTEND_URL: "http://localhost:8443",
  SMS_PROVIDER: "console",
  AUTH_OTP_DEV_MODE: "false",
})

const ACCOUNT_SID = "AC" + "0".repeat(32)
const AUTH_TOKEN = "test".repeat(8)
const FROM_NUMBER = "+15005550006"
const MESSAGING_SERVICE_SID = "MG" + "0".repeat(32)
const PHONE = "+5571999991111"
const CODE = "482913"

type Call = { url: string; init: RequestInit }

let TwilioSmsProvider: typeof import("./sms-provider.js").TwilioSmsProvider
let buildOtpMessage: typeof import("./sms-provider.js").buildOtpMessage

/** Resposta mínima com a forma que o provider consome. */
function reply(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  }
}

const MESSAGE_SID = "SM0123456789abcdef0123456789abcdef"
const ACCEPTED = reply(201, { sid: MESSAGE_SID, status: "queued" })

/** Captura as chamadas e devolve respostas roteirizadas. Nenhum SMS é disparado. */
function recordingFetch(responses: Array<ReturnType<typeof reply>> | (() => never)) {
  const calls: Call[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (typeof responses === "function") return responses()
    return responses.shift() ?? ACCEPTED
  }) as never
  return { calls, impl }
}

function provider(
  overrides: Partial<import("./sms-provider.js").TwilioConfig> = {},
  fetchImpl?: never,
) {
  return new TwilioSmsProvider(
    {
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      fromNumber: FROM_NUMBER,
      timeoutMs: 5000,
      ...overrides,
    },
    fetchImpl,
  )
}

/** Tudo que o logger escreveu, para provar que o OTP não vaza. */
let captured: string[] = []
const realConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
}

function bodyOf(call: Call): URLSearchParams {
  return new URLSearchParams(String(call.init.body))
}

const realFetch = globalThis.fetch
before(async () => {
  globalThis.fetch = async () => { throw new Error("Real network forbidden in provider tests") }
  ;({ TwilioSmsProvider, buildOtpMessage } = await import("./sms-provider.js"))
})

after(() => { globalThis.fetch = realFetch })

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

describe("TwilioSmsProvider", () => {
  it("envia o OTP com configuração válida", async () => {
    const { calls, impl } = recordingFetch([ACCEPTED])
    await provider({}, impl).sendOtp(PHONE, CODE)

    assert.equal(calls.length, 1)
    const call = calls[0]!
    assert.equal(
      call.url,
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    )
    assert.equal(call.init.method, "POST")
    assert.equal(call.init.redirect, "error")
    assert.ok(call.init.signal instanceof AbortSignal)

    const headers = call.init.headers as Record<string, string>
    assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded")
    // Credenciais vão em Basic auth, nunca na URL.
    const basic = headers.Authorization!.replace("Basic ", "")
    assert.equal(
      Buffer.from(basic, "base64").toString("utf8"),
      `${ACCOUNT_SID}:${AUTH_TOKEN}`,
    )
    assert.doesNotMatch(call.url, new RegExp(AUTH_TOKEN))

    const body = bodyOf(call)
    assert.equal(body.get("To"), PHONE)
    assert.equal(body.get("From"), FROM_NUMBER)
  })

  it("monta a mensagem aprovada com o código real e nada além disso", async () => {
    const message = buildOtpMessage(CODE)
    assert.equal(
      message,
      `ERICKCORTTES BARBEARIA: seu código de confirmação é ${CODE}. Não compartilhe este código.`,
    )

    const { calls, impl } = recordingFetch([ACCEPTED])
    await provider({}, impl).sendOtp(PHONE, CODE)
    assert.equal(bodyOf(calls[0]!).get("Body"), message)
  })

  it("o código transportado é o gerado pelo backend, não um novo", async () => {
    const { calls, impl } = recordingFetch([ACCEPTED, ACCEPTED])
    const sms = provider({}, impl)
    await sms.sendOtp(PHONE, "111111")
    await sms.sendOtp(PHONE, "222222")
    assert.match(bodyOf(calls[0]!).get("Body")!, /111111/)
    assert.match(bodyOf(calls[1]!).get("Body")!, /222222/)
  })

  it("prefere o Messaging Service e não envia From junto", async () => {
    const { calls, impl } = recordingFetch([ACCEPTED])
    await provider(
      { messagingServiceSid: MESSAGING_SERVICE_SID },
      impl,
    ).sendOtp(PHONE, CODE)

    const body = bodyOf(calls[0]!)
    assert.equal(body.get("MessagingServiceSid"), MESSAGING_SERVICE_SID)
    assert.equal(body.get("From"), null)
  })

  it("aceita apenas o número quando não há Messaging Service", async () => {
    const { calls, impl } = recordingFetch([ACCEPTED])
    await provider({ messagingServiceSid: undefined }, impl).sendOtp(PHONE, CODE)

    const body = bodyOf(calls[0]!)
    assert.equal(body.get("From"), FROM_NUMBER)
    assert.equal(body.get("MessagingServiceSid"), null)
  })

  it("recusa construção com credenciais ausentes", () => {
    for (const broken of [{ accountSid: "" }, { authToken: "" }])
      assert.throws(() => provider(broken), /TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN/)
  })

  it("recusa construção sem remetente configurado", () => {
    assert.throws(
      () => provider({ fromNumber: undefined, messagingServiceSid: undefined }),
      /TWILIO_MESSAGING_SERVICE_SID ou TWILIO_FROM_NUMBER/,
    )
  })

  it("credenciais inválidas viram 503 sem detalhe do provedor", async () => {
    const { impl } = recordingFetch([
      reply(401, {
        code: 20003,
        message: "Authenticate",
        more_info: "https://www.twilio.com/docs/errors/20003",
      }),
    ])

    await assert.rejects(provider({}, impl).sendOtp(PHONE, CODE), (error: unknown) => {
      const err = error as { statusCode: number; code: string; message: string }
      assert.equal(err.statusCode, 503)
      assert.equal(err.code, "SMS_UNAVAILABLE")
      assert.doesNotMatch(err.message, /twilio|20003|Authenticate|http/i)
      return true
    })
  })

  it("número inválido é classificado no log e não vaza para a resposta", async () => {
    const { impl } = recordingFetch([
      reply(400, { code: 21211, message: "Invalid 'To' Phone Number" }),
    ])

    await assert.rejects(provider({}, impl).sendOtp(PHONE, CODE), {
      code: "SMS_UNAVAILABLE",
    })
    assert.match(captured.join("\n"), /destinatario-invalido/)
  })

  it("remetente não autorizado é classificado como erro de configuração", async () => {
    const { impl } = recordingFetch([
      reply(400, { code: 21608, message: "unverified" }),
    ])

    await assert.rejects(provider({}, impl).sendOtp(PHONE, CODE), {
      code: "SMS_UNAVAILABLE",
    })
    assert.match(captured.join("\n"), /configuracao-invalida/)
  })

  it("limite de envio e indisponibilidade do provedor são distinguidos no log", async () => {
    for (const [response, expected] of [
      [reply(429, { code: 20429 }), "limite-do-provedor"],
      [reply(503, { code: 20500 }), "provedor-indisponivel"],
    ] as const) {
      captured = []
      const { impl } = recordingFetch([response])
      await assert.rejects(provider({}, impl).sendOtp(PHONE, CODE), {
        code: "SMS_UNAVAILABLE",
      })
      assert.match(captured.join("\n"), new RegExp(expected))
    }
  })

  it("timeout não propaga a exceção original", async () => {
    const { impl } = recordingFetch(() => {
      const error = new Error("The operation was aborted due to timeout")
      error.name = "TimeoutError"
      throw error
    })

    await assert.rejects(provider({}, impl).sendOtp(PHONE, CODE), (error: unknown) => {
      const err = error as { statusCode: number; code: string; name: string }
      assert.equal(err.statusCode, 503)
      assert.equal(err.name, "AppError")
      return true
    })
    assert.match(captured.join("\n"), /timeout/)
  })

  it("falha de rede vira indisponibilidade tratada", async () => {
    const { impl } = recordingFetch(() => {
      throw new TypeError("fetch failed")
    })

    await assert.rejects(provider({}, impl).sendOtp(PHONE, CODE), {
      code: "SMS_UNAVAILABLE",
    })
    assert.match(captured.join("\n"), /network/)
  })

  it("mensagem marcada como falha pela Twilio não conta como enviada", async () => {
    for (const status of ["failed", "undelivered", "canceled"]) {
      const { impl } = recordingFetch([reply(201, { sid: "SM1", status })])
      await assert.rejects(provider({}, impl).sendOtp(PHONE, CODE), {
        code: "SMS_UNAVAILABLE",
      })
    }
  })

  it("resposta sem JSON válido não derruba o fluxo de autenticação", async () => {
    const { impl } = recordingFetch([reply(502, "<html>bad gateway</html>")])
    await assert.rejects(provider({}, impl).sendOtp(PHONE, CODE), {
      code: "SMS_UNAVAILABLE",
    })

    const empty = recordingFetch([reply(201, "")])
    await assert.rejects(provider({}, empty.impl).sendOtp(PHONE, CODE), { code: "SMS_UNAVAILABLE" })
  })

  it("não registra o OTP, o telefone completo nem as credenciais", async () => {
    const { impl } = recordingFetch([
      ACCEPTED,
      reply(400, { code: 21211 }),
      reply(201, { sid: "SM2", status: "failed" }),
    ])
    const sms = provider({}, impl)

    await sms.sendOtp(PHONE, CODE)
    await assert.rejects(sms.sendOtp(PHONE, CODE), { code: "SMS_UNAVAILABLE" })
    await assert.rejects(sms.sendOtp(PHONE, CODE), { code: "SMS_UNAVAILABLE" })

    const logs = captured.join("\n")
    assert.ok(logs.length > 0, "o envio precisa deixar rastro operacional")
    for (const secret of [CODE, AUTH_TOKEN, PHONE, "Não compartilhe"])
      assert.ok(!logs.includes(secret), `log vazou: ${secret}`)
    // O telefone aparece mascarado, o suficiente para suporte.
    assert.match(logs, /\+5571\*\*\*\*1111/)
    assert.match(logs, /SM0123456789/)
  })
})

for (const payload of ["", "<html>OK</html>", {}, [], null,
  { sid: MESSAGE_SID }, { status: "queued" },
  { sid: MESSAGE_SID, status: CODE }, { sid: CODE, status: "queued" },
  { sid: MESSAGE_SID, status: "received" },
  { sid: MESSAGE_SID, status: "scheduled" }]) {
  it("rejects malformed success response: " + JSON.stringify(payload), async () => {
    const { impl } = recordingFetch([reply(201, payload)])
    await assert.rejects(provider({}, impl).sendOtp(PHONE, CODE), { code: "SMS_UNAVAILABLE", statusCode: 503 })
    assert.ok(!captured.join("\n").includes(CODE))
  })
}
it("body read timeout fails closed without leaking its cause", async () => {
  const response = { ...ACCEPTED, text: async () => { throw new DOMException(CODE + AUTH_TOKEN, "TimeoutError") } }
  const { impl } = recordingFetch([response])
  await assert.rejects(provider({}, impl).sendOtp(PHONE, CODE), { code: "SMS_UNAVAILABLE" })
  for (const secret of [CODE, AUTH_TOKEN]) assert.ok(!captured.join("\n").includes(secret))
})
it("accepts only immediate outbound statuses with a valid message SID", async () => {
  for (const status of ["accepted", "queued", "sending", "sent", "delivered"]) {
    const { impl } = recordingFetch([reply(201, { sid: MESSAGE_SID, status })])
    await provider({}, impl).sendOtp(PHONE, CODE)
  }
})
it("rejects unexpected HTTP success codes", async () => {
  for (const status of [200, 202, 204]) {
    const { impl } = recordingFetch([reply(status, { sid: MESSAGE_SID, status: "queued" })])
    await assert.rejects(provider({}, impl).sendOtp(PHONE, CODE), { code: "SMS_UNAVAILABLE" })
  }
})
it("does not log unvalidated provider metadata", async () => {
  for (const response of [reply(201, { sid: CODE, status: "failed" }), reply(400, { code: Number(CODE), message: AUTH_TOKEN })]) {
    const { impl } = recordingFetch([response])
    await assert.rejects(provider({}, impl).sendOtp(PHONE, CODE), { code: "SMS_UNAVAILABLE" })
  }
  for (const secret of [CODE, AUTH_TOKEN]) assert.ok(!captured.join("\n").includes(secret))
})

it("redacts Twilio credentials and message bodies in nested logger contexts", async () => {
  const { logger } = await import("../../../utils/logger.js")
  logger.info("redaction regression", { nested: [{ TWILIO_AUTH_TOKEN: AUTH_TOKEN, accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN, authorization: AUTH_TOKEN, Body: CODE, otp: CODE }] })
  const logs = captured.join("\n")
  for (const secret of [AUTH_TOKEN, ACCOUNT_SID, CODE]) assert.ok(!logs.includes(secret))
  assert.match(logs, /redacted/)
})
