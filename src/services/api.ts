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
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  body?: unknown
  skipRefresh?: boolean
}
async function send(
  path: string,
  options: RequestOptions,
  token: string | null,
): Promise<Response> {
  try {
    return await fetch(API_URL + path, {
      method: options.method ?? "GET",
      credentials: "include",
      signal: AbortSignal.timeout(15000),
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
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "Não foi possível falar com o servidor. Verifique sua conexão.",
    })
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
export async function beginLogout(): Promise<void> {
  loggingOut = true
  setAccessToken(null)
  // Aguarda o Set-Cookie da rotação já iniciada antes de revogar e apagar o cookie.
  await refreshFlight?.catch(() => false)
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
