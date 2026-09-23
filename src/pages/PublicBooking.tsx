import { Link } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import ClientLayout from "@/components/layouts/ClientLayout"
import Schedule from "@/pages/client/Schedule"
import { useAuth } from "@/context/AuthContext"

/**
 * Casca pública do agendamento.
 *
 * Quem já está com a conta aprovada vê o app normal, com a navegação de
 * cliente. Quem ainda não entrou vê a mesma atmosfera da marca sem a barra
 * inferior — ela leva a áreas protegidas que essa pessoa ainda não pode abrir.
 *
 * Nenhuma das duas cascas decide autorização: o backend recusa criar reserva
 * sem sessão e sem conta ACTIVE, independentemente do que esta tela mostre.
 */
export default function PublicBooking() {
  const { status } = useAuth()

  if (status === "authenticated") {
    return (
      <ClientLayout>
        <Schedule />
      </ClientLayout>
    )
  }

  return (
    <div className="relative isolate min-h-dvh flex flex-col">
      <div aria-hidden="true" className="fixed inset-0 -z-10 pointer-events-none">
        <img
          src="/brand/interior.jpg"
          alt=""
          width="1536"
          height="1024"
          className="h-full w-full object-cover object-[68%_center] md:object-center"
        />
        <div className="absolute inset-0 bg-black/80" />
      </div>

      <header className="sticky top-0 z-20 bg-[var(--background)]/90 backdrop-blur px-4 py-3">
        <div className="max-w-md mx-auto flex items-center justify-between gap-3">
          <Link
            to="/"
            aria-label="Voltar ao início"
            className="min-h-11 min-w-11 -ml-2 inline-flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2">
            <img
              src="/brand/app-icon.png"
              alt=""
              width="256"
              height="256"
              className="h-9 w-9 object-contain shrink-0"
            />
            <span className="font-display font-bold tracking-tight text-[var(--foreground)]">
              ErickCorttes
            </span>
          </div>
          <Link
            to="/login?next=%2Fagendar"
            className="min-h-11 inline-flex items-center px-2 text-sm font-medium text-[var(--primary)] hover:text-[var(--primary-light)] transition-colors"
          >
            Entrar
          </Link>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent" />
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        <Schedule />
      </main>
    </div>
  )
}
