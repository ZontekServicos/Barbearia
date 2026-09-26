import { Link } from "react-router-dom"
import { ArrowLeft } from "lucide-react"

/**
 * Casca das telas públicas: agendamento e acompanhamento do pedido.
 *
 * Extraída para os dois lugares compartilharem a mesma atmosfera — fundo,
 * cabeçalho, largura de leitura — em vez de duplicarem o layout e divergirem na
 * primeira alteração. Sem barra inferior: ela leva a áreas protegidas que quem
 * está aqui talvez não possa abrir.
 */
export default function PublicShell({
  children,
  backTo = "/",
  backLabel = "Voltar ao início",
  action,
}: {
  children: React.ReactNode
  backTo?: string
  backLabel?: string
  /** Canto direito do cabeçalho. Ausente = espaço reservado, layout estável. */
  action?: React.ReactNode
}) {
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
            to={backTo}
            aria-label={backLabel}
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
          {/* Placeholder do mesmo tamanho do link: sem ele o logo sai do centro. */}
          {action ?? <span aria-hidden="true" className="min-h-11 w-11" />}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent" />
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {children}
      </main>
    </div>
  )
}
