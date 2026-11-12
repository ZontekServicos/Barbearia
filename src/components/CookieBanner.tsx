import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cookie, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Aviso de transparência sobre o que o site guarda no navegador.
 *
 * NÃO é um pedido de consentimento, e a diferença importa: este site guarda
 * apenas o estritamente necessário para o agendamento funcionar — sessão,
 * link do pedido e rascunho. Não há rastreador, análise de audiência nem
 * terceiro. A LGPD exige consentimento para o que vai ALÉM do necessário à
 * prestação do serviço, e aqui não há esse "além".
 *
 * Por isso o botão diz "Entendi" e não "Aceitar": oferecer uma escolha que não
 * existe — um "recusar" que não desliga nada — seria teatro de consentimento,
 * que é pior que não perguntar.
 *
 * A dispensa vive em `localStorage`. Se o navegador recusar (aba anônima,
 * armazenamento bloqueado), o aviso simplesmente reaparece: é o
 * comportamento correto para quem limpou os dados, e nunca quebra a página.
 */

const STORAGE_KEY = 'cookie_consent'

/** Leitura tolerante: armazenamento pode lançar, e isso não pode derrubar a tela. */
function alreadyDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    return false
  }
}

export default function CookieBanner() {
  /**
   * Começa escondido e só aparece depois do primeiro efeito.
   *
   * Decidir no primeiro render leria `localStorage` durante a renderização e
   * faria o aviso piscar para quem já o dispensou.
   */
  const [visible, setVisible] = useState(false)
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!alreadyDismissed()) setVisible(true)
  }, [])

  /**
   * Reserva espaço no fim da página enquanto o aviso estiver na tela.
   *
   * Sendo fixo no rodapé, ele COBRE o que estiver embaixo — e embaixo costuma
   * estar justamente o botão que conclui a tarefa: "Continuar" no agendamento,
   * os links das outras políticas. Sem a reserva, o toque cai no aviso e o
   * usuário fica sem entender por que o botão não responde.
   *
   * A altura é medida em vez de chutada porque o texto quebra em mais linhas
   * em telas estreitas.
   */
  useEffect(() => {
    if (!visible) return
    const element = card.current
    if (!element) return

    const apply = () => {
      document.body.style.paddingBottom = `${element.offsetHeight + 24}px`
    }
    apply()

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
    observer?.observe(element)
    window.addEventListener('resize', apply)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', apply)
      document.body.style.paddingBottom = ''
    }
  }, [visible])

  if (!visible) return null

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString())
    } catch {
      // Sem armazenamento o aviso volta na próxima visita. Preferível a quebrar.
    }
    setVisible(false)
  }

  return (
    <div
      role="region"
      aria-label="Aviso sobre dados guardados no navegador"
      className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4 pointer-events-none"
    >
      <div
        ref={card}
        className="pointer-events-auto mx-auto max-w-2xl rounded-2xl border border-[var(--primary)]/30 bg-[var(--card)] shadow-[0_4px_24px_rgba(0,0,0,0.45)] p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <Cookie aria-hidden="true" className="h-5 w-5 text-[var(--primary)] shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--foreground)]">
              Guardamos só o necessário
            </p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
              Este site não usa rastreador, publicidade nem análise de audiência. O que fica no
              seu navegador serve para manter você conectado e para você reencontrar seu
              agendamento.{' '}
              <Link
                to="/politicas/cookies"
                className="text-[var(--primary)] underline underline-offset-2 hover:text-[var(--primary-light)]"
              >
                Ver detalhes
              </Link>
              .
            </p>
          </div>
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={dismiss}
            className="min-h-11 min-w-11 -mt-1.5 -mr-1.5 inline-flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <Button className="w-full h-11 mt-3 sm:mt-4" onClick={dismiss}>
          Entendi
        </Button>
      </div>
    </div>
  )
}
