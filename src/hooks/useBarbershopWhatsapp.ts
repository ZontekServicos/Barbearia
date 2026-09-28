import { useEffect, useState } from "react"
import { getBookingPolicy } from "@/services/public-booking"

/**
 * WhatsApp da barbearia, servido pelo backend.
 *
 * Existe para que nenhum componente carregue o número. Ele vem de
 * `BARBERSHOP_WHATSAPP_NUMBER`, num lugar só: trocar a variável troca o destino
 * em toda a aplicação, sem caçar literais espalhados — que era exatamente o
 * problema quando a landing e a tela de conta bloqueada tinham o número escrito
 * dentro do JSX.
 *
 * Os links de um PEDIDO específico (avisar, falar durante o pagamento,
 * confirmar) não usam este hook: aqueles vêm prontos do backend junto do
 * pedido, com a mensagem montada a partir do banco. Este aqui serve os contatos
 * genéricos, que não têm agendamento nenhum por trás.
 */
export interface BarbershopWhatsapp {
  /** `https://wa.me/5571…` ou `null` quando não há número configurado. */
  url: string | null
  /** `(71) 99999-0000`, para exibir. `null` sem número. */
  display: string | null
}

/** `+5571999990000` → `(71) 99999-0000`. Outros formatos saem como vieram. */
function formatForDisplay(e164: string): string {
  const match = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164)
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164
}

export function useBarbershopWhatsapp(message?: string): BarbershopWhatsapp {
  const [number, setNumber] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void getBookingPolicy()
      .then(policy => {
        if (alive) setNumber(policy.barbershopWhatsapp ?? null)
      })
      // Sem política, o contato simplesmente não é oferecido. Uma falha de rede
      // aqui não pode derrubar a landing.
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  if (!number) return { url: null, display: null }

  const digits = number.replace(/[^0-9]/g, "")
  return {
    url: `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`,
    display: formatForDisplay(number),
  }
}
