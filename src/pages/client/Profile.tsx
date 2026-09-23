import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, passwordLength, passwordsMatch } from "@/lib/password"
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Phone, Scissors, Star, AlertTriangle, LogOut, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/context/AuthContext"
import { listMyAppointments } from "@/services/booking"
import { changePassword } from "@/services/auth"
import { ApiError } from "@/services/api"

interface ProfileStats {
  total: number
  completed: number
  cancelled: number
  missed: number
}

const EMPTY_STATS: ProfileStats = { total: 0, completed: 0, cancelled: 0, missed: 0 }

export default function Profile() {
  const { user, signOut, status, updateName } = useAuth()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editedName, setEditedName] = useState("")
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  async function saveName(event: React.FormEvent) {
    event.preventDefault()
    setSavingName(true)
    setNameError(null)
    try { await updateName(editedName); setEditingName(false) }
    catch (error) { setNameError(error instanceof ApiError ? error.message : "Não foi possível salvar o nome.") }
    finally { setSavingName(false) }
  }
  const [stats, setStats] = useState<ProfileStats | null>(null)

  // Contadores derivados dos agendamentos reais do próprio usuário.
  useEffect(() => {
    // Conta PENDING ainda não tem acesso à agenda; evita 403 desnecessário.
    if (status !== "authenticated") {
      setStats(EMPTY_STATS)
      return
    }

    let cancelled = false

    void listMyAppointments("all")
      .then(appointments => {
        if (cancelled) return
        setStats({
          total: appointments.length,
          completed: appointments.filter(a => a.status === "COMPLETED").length,
          cancelled: appointments.filter(a => a.status === "CANCELLED").length,
          missed: appointments.filter(a => a.status === "NO_SHOW").length,
        })
      })
      .catch(() => {
        if (!cancelled) setStats(EMPTY_STATS)
      })

    return () => { cancelled = true }
  }, [status])

  const displayName = user?.fullName ?? "Cliente"
  const initial = displayName.trim().charAt(0).toUpperCase() || "C"

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } catch {
      // O estado local já foi encerrado; a indisponibilidade remota não prende esta tela.
    } finally {
      navigate("/", { replace: true })
      setSigningOut(false)
    }
  }

  return (
    <div>
      {/* Header — personal data grouped into a single bronze block */}
      <div className="flex items-center gap-4 border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-4 mb-8">
        <div className="w-16 h-16 rounded-2xl bg-[var(--primary)]/20 border border-[var(--primary)]/30 flex items-center justify-center shrink-0">
          <span className="text-2xl font-bold text-[var(--primary)]">
            {initial}
          </span>
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight truncate">
            {displayName}
          </h2>
          <div className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] mt-0.5">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span className="tabular-nums">{user?.phoneFormatted ?? "—"}</span>
          </div>
        </div>
      </div>

      <div className="mb-6">
        {editingName ? (
          <form onSubmit={saveName} className="space-y-3">
            <Input label="Nome completo" value={editedName} onChange={event => setEditedName(event.target.value)} maxLength={120} required autoComplete="name" />
            {nameError && <p role="alert" className="text-sm text-red-300">{nameError}</p>}
            <div className="flex gap-2">
              <Button type="submit" className="h-11" disabled={savingName || editedName.trim().length < 2}>{savingName ? "Salvando..." : "Salvar nome"}</Button>
              <Button type="button" variant="outline" className="h-11" disabled={savingName} onClick={() => setEditingName(false)}>Cancelar</Button>
            </div>
          </form>
        ) : <Button variant="outline" className="h-11" onClick={() => { setEditedName(user?.fullName ?? ""); setNameError(null); setEditingName(true) }}>Editar nome</Button>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        {[
          {
            label: "Agendamentos",
            value: stats?.total ?? "—",
            icon: Scissors,
            color: "text-[var(--primary)]",
          },
          {
            label: "Concluídos",
            value: stats?.completed ?? "—",
            icon: Star,
            color: "text-green-400",
          },
          {
            label: "Cancelamentos",
            value: stats?.cancelled ?? "—",
            icon: AlertTriangle,
            color: "text-orange-400",
          },
          {
            label: "Faltas",
            value: stats?.missed ?? "—",
            icon: AlertTriangle,
            color: "text-red-400",
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl p-4"
          >
            <div className={`text-2xl font-bold ${color} mb-1`}>{value}</div>
            <div className="flex items-center gap-1.5">
              <Icon className={`h-3.5 w-3.5 ${color}`} />
              <span className="text-xs text-[var(--muted-foreground)]">
                {label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="space-y-2 mb-8">
        <h3 className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-3">
          Conta
        </h3>
        {[
          { label: "Meus agendamentos", to: "/client/appointments" },
          { label: "Fazer agendamento", to: "/client/schedule" },
        ].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center justify-between p-4 border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl hover:border-[var(--primary)]/45 transition-all"
          >
            <span className="text-sm font-medium">{item.label}</span>
            <span className="text-[var(--muted-foreground)]">→</span>
          </Link>
        ))}
      </div>

      {/* Troca de senha */}
      <ChangePasswordSection />

      {/* Logout */}
      <Button
        variant="outline"
        className="w-full h-11 text-[var(--muted-foreground)]"
        onClick={handleSignOut}
        disabled={signingOut}
      >
        <LogOut className="h-4 w-4 mr-2" />
        {signingOut ? "Saindo..." : "Sair da conta"}
      </Button>
    </div>
  )
}

/**
 * Troca de senha do próprio cliente.
 *
 * Exige a senha atual: uma sessão sequestrada não deve conseguir trocar a
 * credencial e expulsar o dono. O backend encerra todas as sessões depois da
 * troca — inclusive esta — então o usuário volta para o login.
 */
function ChangePasswordSection() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mismatch = confirmPassword.length > 0 && !passwordsMatch(password, confirmPassword)
  const canSubmit =
    currentPassword.length > 0 && passwordLength(password) >= PASSWORD_MIN_LENGTH && passwordLength(password) <= PASSWORD_MAX_LENGTH && passwordsMatch(password, confirmPassword)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      await changePassword(currentPassword, password, confirmPassword)
      // A sessão atual morreu junto com a senha antiga.
      navigate('/login', { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Não foi possível trocar a senha.',
      )
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="mb-8">
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-between p-4 border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl hover:border-[var(--primary)]/45 transition-all"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Lock className="h-4 w-4 text-[var(--primary)]" />
            Alterar senha
          </span>
          <span className="text-[var(--muted-foreground)]">→</span>
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-8 border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl p-4 space-y-4"
    >
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-[var(--primary)]" />
        <h3 className="text-sm font-semibold">Alterar senha</h3>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <Input
        label="Senha atual"
        type="password"
        value={currentPassword}
        onChange={e => setCurrentPassword(e.target.value)}
        autoComplete="current-password"
        maxLength={512}
        required
      />
      <Input
        label="Nova senha"
        type="password"
        placeholder={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres`}
        value={password}
        onChange={e => setPassword(e.target.value)}
        autoComplete="new-password"
        maxLength={512}
        required
      />
      <Input
        label="Confirmar nova senha"
        type="password"
        value={confirmPassword}
        onChange={e => setConfirmPassword(e.target.value)}
        error={mismatch ? 'As senhas não conferem.' : undefined}
        autoComplete="new-password"
        maxLength={512}
        required
      />

      <p className="text-xs text-[var(--muted-foreground)]">
        Ao trocar a senha, todas as sessões são encerradas e você entra de novo.
      </p>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1 h-11" disabled={saving || !canSubmit}>
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={() => setOpen(false)}
          disabled={saving}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}
