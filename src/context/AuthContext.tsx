import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ApiError, setSessionLostHandler } from "@/services/api"
import {
  fetchCurrentUser,
  logout as logoutRequest,
  restoreSession,
  updateMyProfile,
  login as loginRequest,
  register as registerRequest,
  type AuthUser,
  type RegisterPayload,
} from "@/services/auth"
export type AuthStatus = "loading" | "unauthenticated" | "authenticated" | "pendingApproval" | "blocked" | "error"
interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  error: string | null
  isAdmin: boolean
  signIn: (phone: string, password: string) => Promise<AuthUser>
  signUp: (payload: RegisterPayload) => Promise<AuthUser>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
  updateName: (fullName: string) => Promise<AuthUser>
}
const AuthContext = createContext<AuthContextValue | null>(null)
function statusForUser(user: AuthUser | null): AuthStatus {
  if (!user) return "unauthenticated"
  if (user.status === "PENDING") return "pendingApproval"
  if (user.status === "BLOCKED") return "blocked"
  return "authenticated"
}
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [error, setError] = useState<string | null>(null)
  const revision = useRef(0)
  useEffect(() => {
    let cancelled = false
    const startedAt = revision.current
    restoreSession()
      .then((restored) => {
        if (cancelled || startedAt !== revision.current) return
        setUser(restored)
        setStatus(statusForUser(restored))
      })
      .catch((err) => {
        if (cancelled || startedAt !== revision.current) return
        setUser(null)
        setStatus("error")
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível recuperar sua sessão.",
        )
      })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    setSessionLostHandler((reason) => {
      revision.current++
      setUser(null)
      setStatus(reason === "ACCOUNT_BLOCKED" ? "blocked" : "unauthenticated")
    })
    return () => setSessionLostHandler(null)
  }, [])
  const signIn = useCallback(async (phone: string, password: string) => {
    const startedAt = ++revision.current
    setError(null)
    const result = await loginRequest(phone, password)
    if (startedAt === revision.current) {
      setUser(result.user)
      setStatus(statusForUser(result.user))
    }
    return result.user
  }, [])
  const signUp = useCallback(async (payload: RegisterPayload) => {
    const startedAt = ++revision.current
    setError(null)
    const result = await registerRequest(payload)
    if (startedAt === revision.current) {
      setUser(result.user)
      setStatus(statusForUser(result.user))
    }
    return result.user
  }, [])
  const signOut = useCallback(async () => {
    revision.current++
    setUser(null)
    setStatus("unauthenticated")
    setError(null)
    await logoutRequest()
  }, [])
  const refreshUser = useCallback(async () => {
    const startedAt = revision.current
    setError(null)
    try {
      const current = await fetchCurrentUser()
      if (startedAt === revision.current) {
        setUser(current)
        setStatus(statusForUser(current))
      }
    } catch (err) {
      if (startedAt !== revision.current) return
      if (err instanceof ApiError && err.status === 401) {
        setUser(null)
        setStatus("unauthenticated")
      } else
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível consultar seu cadastro.",
        )
    }
  }, [])
  const updateName = useCallback(async (fullName: string) => {
    const startedAt = revision.current
    const updated = await updateMyProfile(fullName)
    if (startedAt === revision.current) {
      setUser(updated)
      setStatus(statusForUser(updated))
    }
    return updated
  }, [])
  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      error,
      isAdmin: status === "authenticated" && user?.role === "ADMIN",
      signIn,
      signUp,
      signOut,
      refreshUser,
      updateName,
    }),
    [status, user, error, signIn, signUp, signOut, refreshUser, updateName],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context)
    throw new Error("useAuth precisa estar dentro de <AuthProvider>.")
  return context
}
