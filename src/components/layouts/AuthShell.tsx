import { Link } from "react-router-dom"
import { ArrowLeft } from "lucide-react"

/**
 * Moldura das telas de autenticação.
 *
 * Mesma atmosfera do resto do app — foto do interior, véu preto, cartão em
 * bronze e o dourado fosco da marca. Extraída de Login para que cadastro e
 * login não divirjam visualmente com o tempo.
 */
export function AuthShell({
  icon,
  title,
  subtitle,
  children,
  footer,
  backTo = "/",
  backLabel = "Voltar",
}: {
  icon: React.ReactNode
  title: string
  subtitle?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  backTo?: string
  backLabel?: string
}) {
  return (
    <main className="relative isolate min-h-dvh flex flex-col items-center justify-center px-5 py-10">
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

        <div className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_12px_36px_rgba(0,0,0,0.45)] rounded-2xl p-5 sm:p-6">
          <div className="text-center mb-6">
            <div className="w-11 h-11 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 flex items-center justify-center mx-auto mb-3">
              {icon}
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
                {subtitle}
              </p>
            )}
          </div>

          {children}
        </div>

        {footer && (
          <div className="flex flex-wrap items-center justify-center gap-1 text-center text-sm text-[var(--muted-foreground)] mt-3">
            {footer}
          </div>
        )}

        <div className="flex justify-center mt-2">
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 min-h-11 px-3 text-sm text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </div>
      </div>
    </main>
  )
}
