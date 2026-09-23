import { after, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  apiRequest,
  ApiError,
  beginLogout,
  finishLogout,
  getAccessToken,
  refreshSession,
  setAccessToken,
  setSessionLostHandler,
} from "./api"
const realFetch = globalThis.fetch
const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), { status: 200 })
const denied = () =>
  new Response(
    JSON.stringify({
      success: false,
      error: { code: "INVALID_TOKEN", message: "Expired" },
    }),
    { status: 401 },
  )
const tick = () => new Promise((resolve) => setTimeout(resolve, 10))
describe("cliente HTTP e concorrência de sessão", () => {
  beforeEach(() => {
    finishLogout()
    setAccessToken("old")
    setSessionLostHandler(null)
  })
  after(() => {
    globalThis.fetch = realFetch
    setAccessToken(null)
    setSessionLostHandler(null)
  })
  it("dez 401 simultâneos fazem uma rotação e repetem cada pedido uma vez", async () => {
    let refreshes = 0,
      requests = 0
    globalThis.fetch = async (url, init) => {
      assert.equal(init?.credentials, "include")
      assert.equal(
        (init?.headers as Record<string, string>)["X-CSRF-Protection"],
        "1",
      )
      if (String(url).endsWith("/auth/refresh")) {
        refreshes++
        await tick()
        return ok({ accessToken: "new" })
      }
      requests++
      return (init?.headers as Record<string, string>).Authorization ===
        "Bearer new"
        ? ok({ id: 1 })
        : denied()
    }
    const results = await Promise.all(
      Array.from({ length: 10 }, () => apiRequest("/users/me")),
    )
    assert.equal(results.length, 10)
    assert.equal(refreshes, 1)
    assert.equal(requests, 20)
  })
  it("restaurações simultâneas de StrictMode compartilham o refresh", async () => {
    let count = 0
    globalThis.fetch = async () => {
      count++
      await tick()
      return ok({ accessToken: "new" })
    }
    assert.deepEqual(await Promise.all([refreshSession(), refreshSession()]), [
      true,
      true,
    ])
    assert.equal(count, 1)
  })
  it("401 tardio de token anterior usa o token recém-renovado sem outra rotação", async () => {
    let refreshes = 0
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/auth/refresh")) {
        refreshes++
        return ok({ accessToken: "new" })
      }
      if (
        (init?.headers as Record<string, string>).Authorization === "Bearer new"
      )
        return ok({})
      if (String(url).endsWith("/slow")) await tick()
      return denied()
    }
    await Promise.all([apiRequest("/fast"), apiRequest("/slow")])
    assert.equal(refreshes, 1)
  })
  it("segundo 401 encerra sessão sem loop de refresh", async () => {
    let count = 0,
      lost = 0
    setSessionLostHandler(() => lost++)
    globalThis.fetch = async (url) => {
      count++
      return String(url).endsWith("/auth/refresh")
        ? ok({ accessToken: "new" })
        : denied()
    }
    await assert.rejects(apiRequest("/users/me"), { status: 401 })
    assert.equal(count, 3)
    assert.equal(lost, 1)
    assert.equal(getAccessToken(), null)
  })
  it("refresh recusado limpa estado; erro de rede preserva token e informa indisponibilidade", async () => {
    globalThis.fetch = async () => denied()
    assert.equal(await refreshSession(), false)
    assert.equal(getAccessToken(), null)
    setAccessToken("valid")
    globalThis.fetch = async () => {
      throw new TypeError("offline")
    }
    await assert.rejects(
      refreshSession(),
      (e: unknown) => e instanceof ApiError && e.code === "NETWORK_ERROR",
    )
    assert.equal(getAccessToken(), "valid")
  })
  it("logout aguarda refresh pendente e ignora seu access token", async () => {
    let complete: (response: Response) => void = () => {
      throw new Error("Fetch was not started")
    }
    globalThis.fetch = async () =>
      new Promise<Response>((resolve) => {
        complete = resolve
      })
    const refresh = refreshSession()
    const logout = beginLogout()
    assert.equal(getAccessToken(), null)
    complete(ok({ accessToken: "must-not-restore" }))
    await logout
    assert.equal(await refresh, false)
    assert.equal(getAccessToken(), null)
    assert.equal(await refreshSession(), false)
    finishLogout()
  })
  it("login público não dispara refresh e bloqueio sinaliza estado correto", async () => {
    let count = 0
    let reason: string | undefined
    globalThis.fetch = async () => {
      count++
      return denied()
    }
    await assert.rejects(
      apiRequest("/auth/login", {
        skipRefresh: true,
        body: {},
        method: "POST",
      }),
    )
    assert.equal(count, 1)
    setSessionLostHandler((value) => {
      reason = value
    })
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { code: "ACCOUNT_BLOCKED", message: "Blocked" },
        }),
        { status: 403 },
      )
    await assert.rejects(apiRequest("/auth/me"))
    assert.equal(reason, "ACCOUNT_BLOCKED")
    assert.equal(getAccessToken(), null)
  })
  it("resposta de erro malformada é tratada sem expor HTML ou criar sucesso falso", async () => {
    globalThis.fetch = async () =>
      new Response("<html>Proxy error</html>", { status: 502 })
    await assert.rejects(apiRequest("/users/me"), {
      code: "NETWORK_ERROR",
      status: 502,
    })
  })
  for (const action of ["login", "register"] as const) {
    it("logout waits for in-flight " + action + " and never restores its session", async () => {
      const auth = await import("./auth")
      let release: (response: Response) => void = () => { throw new Error("request did not start") }
      const order: string[] = []
      globalThis.fetch = async (url) => {
        if (String(url).endsWith("/auth/" + action)) {
          const response = await new Promise<Response>(resolve => { release = resolve })
          order.push("authentication-response")
          return response
        }
        if (String(url).endsWith("/auth/logout")) order.push("logout-request")
        return ok({})
      }
      const pending = (action === "login" ? auth.login("71999991111", "synthetic-password") : auth.register({fullName:"Test",phone:"71999991111",password:"synthetic-password",confirmPassword:"synthetic-password"})).catch(() => null)
      await tick()
      const logout = auth.logout()
      await tick()
      release(ok({accessToken:"must-not-return-after-logout",user:{id:"synthetic"}}))
      await Promise.all([pending,logout])
      assert.deepEqual(order,["authentication-response","logout-request"])
      assert.equal(getAccessToken(),null)
    })
  }

})
