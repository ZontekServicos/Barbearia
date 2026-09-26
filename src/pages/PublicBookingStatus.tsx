import BookingStatus from "@/pages/client/BookingStatus"
import PublicShell from "@/components/layouts/PublicShell"

/**
 * Casca do acompanhamento do pedido.
 *
 * Sem `ClientLayout` mesmo para quem está autenticado: esta tela é do PEDIDO,
 * identificado pelo token, e não da conta. Manter uma casca só evita que a
 * mesma informação apareça de dois jeitos dependendo de haver sessão.
 */
export default function PublicBookingStatus() {
  return (
    <PublicShell backTo="/agendar" backLabel="Voltar ao agendamento">
      <BookingStatus />
    </PublicShell>
  )
}
