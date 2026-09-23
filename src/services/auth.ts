import {
  apiRequest,
  authenticate,
  refreshSession,
  beginLogout,
  finishLogout,
} from "./api"

export type UserRole = "CUSTOMER" | "ADMIN"
export type UserStatus = "PENDING" | "ACTIVE" | "BLOCKED"

export interface AuthUser {
  id: string
  fullName: string | null
  phone: string
  phoneFormatted: string
  role: UserRole
  status: UserStatus
  /** Contas herdadas do fluxo antigo por SMS ainda não têm senha definida. */
  hasPassword: boolean
  createdAt: string
}

interface SessionResponse {
  user: AuthUser
  isNewUser: boolean
  accessToken: string
  accessTokenExpiresAt: string
}

export interface RegisterPayload {
  fullName: string
  phone: string
  password: string
  confirmPassword: string
}

/**
 * Cria a conta. O backend revalida tudo — nome, telefone, força e confirmação
 * da senha — então a validação da tela existe só para dar retorno imediato.
 */
export async function register(
  payload: RegisterPayload,
): Promise<SessionResponse> {
  return authenticate<SessionResponse>("/auth/register", payload)
}

export async function login(
  phone: string,
  password: string,
): Promise<SessionResponse> {
  return authenticate<SessionResponse>("/auth/login", { phone, password })
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const data = await apiRequest<{ user: AuthUser }>("/auth/me")
  return data.user
}

export async function updateMyProfile(fullName: string): Promise<AuthUser> {
  const data = await apiRequest<{ user: AuthUser }>("/users/me", {
    method: "PATCH",
    body: { fullName },
  })
  return data.user
}

/**
 * Troca a senha. O backend encerra todas as sessões, inclusive esta — quem
 * chamar precisa mandar o usuário para o login depois.
 */
export async function changePassword(
  currentPassword: string,
  password: string,
  confirmPassword: string,
): Promise<void> {
  await apiRequest("/users/me/password", {
    method: "PATCH",
    body: { currentPassword, password, confirmPassword },
  })
}

export async function logout(): Promise<void> {
  await beginLogout()
  try {
    await apiRequest("/auth/logout", {
      method: "POST",
      body: {},
      skipRefresh: true,
    })
  } finally {
    finishLogout()
  }
}

export async function restoreSession(): Promise<AuthUser | null> {
  if (!(await refreshSession())) return null
  return fetchCurrentUser()
}
