import {
  apiRequest,
  setAccessToken,
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
  phoneVerified: boolean
  createdAt: string
}

interface SessionResponse {
  user: AuthUser
  isNewUser: boolean
  accessToken: string
  accessTokenExpiresAt: string
}

export async function requestOtp(
  phone: string,
): Promise<{ expiresInSeconds: number }> {
  return apiRequest("/auth/request-otp", {
    method: "POST",
    body: { phone },
    skipRefresh: true,
  })
}

export async function verifyOtp(
  phone: string,
  code: string,
  fullName?: string,
): Promise<SessionResponse> {
  const data = await apiRequest<SessionResponse>("/auth/verify-otp", {
    method: "POST",
    skipRefresh: true,
    body: { phone, code, ...(fullName ? { fullName } : {}) },
  })
  setAccessToken(data.accessToken)
  return data
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
