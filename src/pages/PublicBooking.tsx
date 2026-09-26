import { Link } from "react-router-dom"
import ClientLayout from "@/components/layouts/ClientLayout"
import PublicShell from "@/components/layouts/PublicShell"
import Schedule from "@/pages/client/Schedule"
import { useAuth } from "@/context/AuthContext"

/**
 * Casca pública do agendamento.
 *
 * Quem já está com a conta aprovada vê o app normal, com a navegação de
 * cliente. Quem ainda não entrou vê a mesma atmosfera da marca sem a barra
 * inferior — ela leva a áreas protegidas que essa pessoa ainda não pode abrir.
 *
 * As duas cascas usam a solicitação pública sem sessão. O backend mantém
 * os recursos privados protegidos e exige decisão administrativa do pedido.
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
    <PublicShell
      action={
        <Link
          to="/login?next=%2Fagendar"
          className="min-h-11 inline-flex items-center px-2 text-sm font-medium text-[var(--primary)] hover:text-[var(--primary-light)] transition-colors"
        >
          Entrar
        </Link>
      }
    >
      <Schedule />
    </PublicShell>
  )
}
