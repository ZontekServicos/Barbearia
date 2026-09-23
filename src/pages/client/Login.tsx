import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Phone, Lock, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/layouts/AuthShell"
import { useAuth } from "@/context/AuthContext"
import type { AuthUser } from "@/services/auth"
import { ApiError } from "@/services/api"
import { looksLikeCompletePhone, maskPhone } from "@/lib/phone"
import { readBookingIntent } from "@/services/booking-intent"

export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { signIn } = useAuth()
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Só aceitamos caminhos internos: `next` vindo da URL não pode virar
  // redirecionamento para outro site.
  const rawNext = params.get("next")
  const next = rawNext && /^\/[^/\\]/.test(rawNext) ? rawNext : null

  /** Para onde mandar o usuário depois de autenticar, conforme papel e status. */
  function redirectForUser(user: AuthUser) {
    if (user.status === "BLOCKED")
      return navigate("/conta/bloqueada", { replace: true })
    if (user.status === "PENDING")
      return navigate("/conta/pendente", { replace: true })
    if (user.role === "ADMIN") return navigate("/admin", { replace: true })
    // Voltar exatamente para onde o agendamento parou, quando havia um.
    if (next) return navigate(next, { replace: true })
    if (readBookingIntent()) return navigate("/agendar", { replace: true })
    return navigate("/client", { replace: true })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      redirectForUser(await signIn(phone, password))
    } catch (err) {
      if (err instanceof ApiError && err.code === "ACCOUNT_BLOCKED") {
        navigate("/conta/bloqueada", { replace: true })
        return
      }
      setError(
        err instanceof ApiError
          ? err.message
          : "Algo deu errado. Tente novamente.",
      )
      setPassword("")
    } finally {
      setLoading(false)
    }
  }

  const registerHref = next
    ? `/cadastro?next=${encodeURIComponent(next)}`
    : "/cadastro"

  return (
    <AuthShell
      icon={<Lock className="h-5 w-5 text-[var(--primary)]" />}
      title="Bem-vindo de volta"
      subtitle="Entre com seu WhatsApp e senha."
      footer={
        <>
          Ainda não possui conta?{" "}
          <Link
            to={registerHref}
            className="inline-flex items-center min-h-11 px-1 text-[var(--primary)] font-medium hover:text-[var(--primary-light)] transition-colors"
          >
            Criar conta
          </Link>
        </>
      }
    >
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="WhatsApp"
          type="tel"
          icon={<Phone className="h-4 w-4" />}
          placeholder="(71) 99999-9999"
          value={phone}
          onChange={(e) => setPhone(maskPhone(e.target.value))}
          autoComplete="username"
          inputMode="tel"
          maxLength={24}
          required
        />

        <div className="relative">
          <Input
            label="Senha"
            type={showPassword ? "text" : "password"}
            icon={<Lock className="h-4 w-4" />}
            placeholder="Sua senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            maxLength={512}
            className="pr-12"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            className="absolute right-1 bottom-0 h-12 w-11 inline-flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>

        <Button
          type="submit"
          className="w-full h-12 text-base"
          disabled={loading || !looksLikeCompletePhone(phone) || !password}
        >
          {loading ? "Entrando..." : "Entrar"}
        </Button>

        <p className="text-xs text-center text-[var(--muted-foreground)]">
          Esqueceu a senha? Fale com a barbearia para redefinir presencialmente.
        </p>
      </form>
    </AuthShell>
  )
}
