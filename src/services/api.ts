/** Tokens de acesso ficam somente em memória; refresh usa cookie httpOnly. */
const API_URL = (
  import.meta.env?.VITE_API_URL ??
  (import.meta.env?.DEV ? "http://localhost:3333" : "/api")
).replace(/\/$/, "")
export interface ApiErrorBody {
  code: string
  message: string
  details?: Array<{
    field: string
    message: string
  }>
}
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: ApiErrorBody["details"]
  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = "ApiError"
    this.status = status
    this.code = body.code
    this.details = body.details
  }
}
let accessToken: string | null = null
let generation = 0
let loggingOut = false
let refreshFlight: Promise<boolean> | null = null
let authenticationFlight: Promise<{ accessToken: string }> | null = null
let onSessionLost: ((reason?: string) => void) | null = null
export function setAccessToken(token: string | null): void {
  generation++
  accessToken = token
}
export function getAccessToken(): string | null {
  return accessToken
}
export function setSessionLostHandler(handler: typeof onSessionLost): void {
  onSessionLost = handler
}
function loseSession(reason?: string) {
  setAccessToken(null)
  onSessionLost?.(reason)
}
interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  body?: unknown
  skipRefresh?: boolean
  /** Cancela a requisição. Usado para descartar respostas que ficaram velhas. */
  signal?: AbortSignal
}

/**
 * Cancelamento pedido por quem chamou — não é falha.
 *
 * A tela que aborta uma consulta antiga não deve mostrar erro nenhum: ela só
 * perdeu o interesse na resposta. Distinguir isso de uma queda de rede evita
 * o banner vermelho que pisca ao trocar de semana rápido.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "ABORTED"
}
async function send(
  path: string,
  options: RequestOptions,
  token: string | null,
): Promise<Response> {
  // Combina o timeout com o cancelamento de quem chamou. Feito na mão em vez
  // de AbortSignal.any() para não exigir um Safari muito recente.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  const abortFromCaller = () => controller.abort()
  options.signal?.addEventListener("abort", abortFromCaller, { once: true })
  if (options.signal?.aborted) controller.abort()

  try {
    return await fetch(API_URL + path, {
      method: options.method ?? "GET",
      credentials: "include",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Protection": "1",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    })
  } catch {
    if (options.signal?.aborted) {
      throw new ApiError(0, {
        code: "ABORTED",
        message: "Requisição cancelada.",
      })
    }
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "Não foi possível falar com o servidor. Verifique sua conexão.",
    })
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", abortFromCaller)
  }
}
async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (response.ok && payload?.success === true) return payload.data as T
  throw new ApiError(
    response.status,
    payload?.success === false &&
      typeof payload.error?.code === "string" &&
      typeof payload.error?.message === "string"
      ? payload.error
      : { code: "NETWORK_ERROR", message: "Resposta inválida do servidor." },
  )
}
/** Uma única rotação atende chamadas simultâneas, incluindo a restauração no StrictMode. */
export async function refreshSession(): Promise<boolean> {
  if (loggingOut) return false
  if (refreshFlight) return refreshFlight
  const startedAt = generation
  refreshFlight = (async () => {
    const response = await send(
      "/auth/refresh",
      { method: "POST", body: {} },
      null,
    )
    if (response.status === 401 || response.status === 403) {
      const payload = await response.json().catch(() => null)
      if (generation === startedAt) loseSession(payload?.error?.code)
      return false
    }
    const data = await parseResponse<{ accessToken: string }>(response)
    if (typeof data.accessToken !== "string")
      throw new ApiError(502, {
        code: "NETWORK_ERROR",
        message: "Resposta inválida do servidor.",
      })
    if (loggingOut || generation !== startedAt) return false
    accessToken = data.accessToken
    return true
  })()
  try {
    return await refreshFlight
  } finally {
    refreshFlight = null
  }
}
/** Orders credential responses before logout so a late Set-Cookie cannot restore a session. */
export async function authenticate<T extends { accessToken: string }>(path: string, body: unknown): Promise<T> {
  if (loggingOut || authenticationFlight) throw new ApiError(409, { code: "AUTH_IN_PROGRESS", message: "Aguarde a autenticação em andamento." })
  setAccessToken(null)
  const startedAt = generation
  const cancelled = () => new ApiError(401, { code: "SESSION_CANCELLED", message: "Autenticação cancelada. Entre novamente." })
  const pending = (async () => {
    // An older refresh cookie must arrive before the new login cookie.
    await refreshFlight?.catch(() => false)
    if (loggingOut || generation !== startedAt) throw cancelled()
    const data = await apiRequest<T>(path, { method: "POST", skipRefresh: true, body })
    if (loggingOut || generation !== startedAt) throw cancelled()
    if (typeof data.accessToken !== "string") throw new ApiError(502, { code: "NETWORK_ERROR", message: "Resposta inválida do servidor." })
    setAccessToken(data.accessToken)
    return data
  })()
  authenticationFlight = pending
  try { return await pending } finally { if (authenticationFlight === pending) authenticationFlight = null }
}

export async function beginLogout(): Promise<void> {
  loggingOut = true
  setAccessToken(null)
  // Aguarda o Set-Cookie da rotação já iniciada antes de revogar e apagar o cookie.
  await Promise.allSettled([refreshFlight, authenticationFlight])
}
export function finishLogout(): void {
  accessToken = null
  loggingOut = false
}
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const startedAt = generation
  const sentToken = accessToken
  let response = await send(path, options, sentToken)
  if (
    response.status === 401 &&
    !options.skipRefresh &&
    !loggingOut &&
    startedAt === generation
  ) {
    const renewed =
      accessToken && accessToken !== sentToken ? true : await refreshSession()
    if (renewed) response = await send(path, options, accessToken)
  }
  try {
    return await parseResponse<T>(response)
  } catch (error) {
    if (
      error instanceof ApiError &&
      !options.skipRefresh &&
      startedAt === generation &&
      (error.status === 401 ||
        error.code === "ACCOUNT_BLOCKED" ||
        error.code === "ACCOUNT_PENDING")
    ) {
      loseSession(error.code)
    }
    throw error
  }
}
export const apiBaseUrl = API_URL
