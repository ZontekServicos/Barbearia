import { Link, Navigate, useNavigate } from "react-router-dom"
import { Clock, ShieldAlert, RefreshCw, LogOut } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"

function StatusShell({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <main className="relative isolate min-h-dvh flex flex-col items-center justify-center px-5 py-10">
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10 pointer-events-none"
      >
        <img
          src="/brand/interior.jpg"
          alt=""
          width="1536"
          height="1024"
          className="h-full w-full object-cover object-[68%_center] md:object-center"
        />
        <div className="absolute inset-0 bg-black/80" />
      </div>

      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-5">
          <img
            src="/brand/app-icon.png"
            alt=""
            width="256"
            height="256"
            className="h-10 w-10 object-contain shrink-0"
          />
          <span className="font-display font-bold text-lg tracking-tight">
            ErickCorttes
          </span>
        </div>

        <div className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_12px_36px_rgba(0,0,0,0.45)] rounded-2xl p-5 sm:p-6 text-center">
          <div className="w-11 h-11 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 flex items-center justify-center mx-auto mb-3">
            {icon}
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight mb-2">
            {title}
          </h1>
          {children}
        </div>
      </div>
    </main>
  )
}

/** Cadastro criado, aguardando aprovação da barbearia. */
export function PendingApproval() {
  const { user, status, error, refreshUser, signOut } = useAuth()
  const [checking, setChecking] = useState(false)

  async function handleCheck() {
    setChecking(true)
    try {
      await refreshUser()
    } finally {
      setChecking(false)
    }
  }

  if (status === "authenticated")
    return (
      <Navigate to={user?.role === "ADMIN" ? "/admin" : "/client"} replace />
    )

  return (
    <StatusShell
      icon={<Clock className="h-5 w-5 text-[var(--primary)]" />}
      title="Cadastro em análise"
    >
      <p className="text-sm text-[var(--muted-foreground)] mb-1.5">
        Recebemos seu cadastro
        {user?.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}. A barbearia
        precisa aprovar seu acesso antes do primeiro agendamento.
      </p>
      <p className="text-sm text-[var(--muted-foreground)] mb-6">
        Assim que for liberado, é só voltar aqui e agendar normalmente.
      </p>

      {error && (
        <p role="alert" className="text-sm text-red-400 mb-3">
          {error}
        </p>
      )}
      <div className="space-y-2">
        <Button
          className="w-full h-11"
          onClick={handleCheck}
          disabled={checking}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${checking ? "animate-spin" : ""}`}
          />
          {checking ? "Verificando…" : "Já fui aprovado"}
        </Button>
        <Button variant="outline" className="w-full h-11" asChild>
          <Link to="/">Voltar ao início</Link>
        </Button>
        <button
          onClick={() => void signOut().catch(() => undefined)}
          className="inline-flex items-center gap-1.5 min-h-11 px-3 text-sm text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </StatusShell>
  )
}

/** Conta bloqueada pela administração. */
export function AccountBlocked() {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <StatusShell
      icon={<ShieldAlert className="h-5 w-5 text-[var(--primary)]" />}
      title="Conta bloqueada"
    >
      <p className="text-sm text-[var(--muted-foreground)] mb-6">
        Seu acesso está suspenso no momento. Fale com a barbearia para entender
        e regularizar a situação.
      </p>

      <div className="space-y-2">
        <Button className="w-full h-11" asChild>
          <a href="https://wa.me/5571999990000">Falar com a barbearia</a>
        </Button>
        <button
          onClick={() =>
            void signOut()
              .catch(() => undefined)
              .finally(() => navigate("/login", { replace: true }))
          }
          className="inline-flex items-center gap-1.5 min-h-11 px-3 text-sm text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </StatusShell>
  )
}
