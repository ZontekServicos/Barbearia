import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, passwordLength, passwordsMatch } from "@/lib/password"
import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Phone, Lock, User, Eye, EyeOff, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/layouts/AuthShell"
import { useAuth } from "@/context/AuthContext"
import { ApiError } from "@/services/api"
import { looksLikeCompletePhone, maskPhone } from "@/lib/phone"

/** Espelha o mínimo do backend; ele revalida tudo de qualquer forma. */


export default function Register() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { signUp } = useAuth()

  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const rawNext = params.get("next")
  const next = rawNext && /^\/[^/\\]/.test(rawNext) ? rawNext : null

  const mismatch = confirmPassword.length > 0 && !passwordsMatch(password, confirmPassword)
  const canSubmit =
    fullName.trim().length >= 2 &&
    looksLikeCompletePhone(phone) &&
    passwordLength(password) >= PASSWORD_MIN_LENGTH && passwordLength(password) <= PASSWORD_MAX_LENGTH &&
    passwordsMatch(password, confirmPassword)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setLoading(true)
    setError(null)
    setFieldErrors({})
    try {
      const user = await signUp({
        fullName,
        phone,
        password,
        confirmPassword,
      })
      // Toda conta nova nasce aguardando aprovação da barbearia.
      if (user.status === "PENDING")
        return navigate("/conta/pendente", { replace: true })
      if (next) return navigate(next, { replace: true })
      return navigate("/client", { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        // O backend aponta o campo quando a validação falha lá.
        if (err.details?.length) {
          setFieldErrors(
            Object.fromEntries(
              err.details.map((d) => [d.field.split(".").pop() ?? d.field, d.message]),
            ),
          )
        }
      } else {
        setError("Algo deu errado. Tente novamente.")
      }
    } finally {
      setLoading(false)
    }
  }

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login"

  return (
    <AuthShell
      icon={<UserPlus className="h-5 w-5 text-[var(--primary)]" />}
      title="Crie sua conta"
      subtitle="Leva menos de um minuto."
      footer={
        <>
          Já possui uma conta?{" "}
          <Link
            to={loginHref}
            className="inline-flex items-center min-h-11 px-1 text-[var(--primary)] font-medium hover:text-[var(--primary-light)] transition-colors"
          >
            Entrar
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

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Input
          label="Nome completo"
          type="text"
          icon={<User className="h-4 w-4" />}
          placeholder="João Silva"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={fieldErrors.fullName}
          autoComplete="name"
          maxLength={120}
          required
        />

        <Input
          label="WhatsApp"
          type="tel"
          icon={<Phone className="h-4 w-4" />}
          placeholder="(71) 99999-9999"
          value={phone}
          onChange={(e) => setPhone(maskPhone(e.target.value))}
          error={fieldErrors.phone}
          autoComplete="tel"
          inputMode="tel"
          maxLength={24}
          required
        />

        <div className="relative">
          <Input
            label="Senha"
            type={showPassword ? "text" : "password"}
            icon={<Lock className="h-4 w-4" />}
            placeholder={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            autoComplete="new-password"
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

        <Input
          label="Confirmar senha"
          type={showPassword ? "text" : "password"}
          icon={<Lock className="h-4 w-4" />}
          placeholder="Repita a senha"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={
            mismatch ? "As senhas não conferem." : fieldErrors.confirmPassword
          }
          autoComplete="new-password"
          maxLength={512}
          required
        />

        <Button
          type="submit"
          className="w-full h-12 text-base"
          disabled={loading || !canSubmit}
        >
          {loading ? "Criando..." : "Criar minha conta"}
        </Button>

        <p className="text-xs text-center text-[var(--muted-foreground)]">
          A barbearia aprova novos cadastros antes do primeiro agendamento.
        </p>
      </form>
    </AuthShell>
  )
}
