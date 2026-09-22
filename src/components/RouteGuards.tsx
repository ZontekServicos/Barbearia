import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/context/AuthContext"

function SessionLoading() {
  return (
    <div
      className="min-h-dvh flex items-center justify-center px-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <img
          src="/brand/app-icon.png"
          alt=""
          width="256"
          height="256"
          className="h-12 w-12 object-contain animate-pulse"
        />
        <p className="text-sm text-[var(--muted-foreground)]">
          Carregando sua sessão…
        </p>
      </div>
    </div>
  )
}

/**
 * Exige sessão válida. Guard de UX — a autorização de verdade é feita no
 * backend a cada requisição; aqui só evitamos mostrar telas inúteis.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === "loading") return <SessionLoading />

  if (status === "unauthenticated" || status === "error") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (status === "blocked") return <Navigate to="/conta/bloqueada" replace />

  return <>{children}</>
}

/** Exige conta aprovada (ACTIVE). PENDING é desviado para a tela de espera. */
export function RequireActiveAccount({
  children,
}: {
  children: React.ReactNode
}) {
  const { status } = useAuth()

  if (status === "loading") return <SessionLoading />
  if (status === "unauthenticated" || status === "error")
    return <Navigate to="/login" replace />
  if (status === "pendingApproval")
    return <Navigate to="/conta/pendente" replace />
  if (status === "blocked") return <Navigate to="/conta/bloqueada" replace />

  return <>{children}</>
}

/** Exige papel ADMIN. O backend repete a checagem em toda rota /admin. */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { status, isAdmin } = useAuth()

  if (status === "loading") return <SessionLoading />
  if (status === "unauthenticated" || status === "error")
    return <Navigate to="/login" replace />
  if (status === "blocked") return <Navigate to="/conta/bloqueada" replace />
  if (status === "pendingApproval")
    return <Navigate to="/conta/pendente" replace />
  if (!isAdmin) return <Navigate to="/client" replace />

  return <>{children}</>
}
