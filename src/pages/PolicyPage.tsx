import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, ShieldCheck, Cookie, Scale, AlertTriangle } from 'lucide-react'
import PublicShell from '@/components/layouts/PublicShell'
import {
  POLICIES,
  POLICIES_UPDATED_AT,
  POLICY_ORDER,
  POLICY_PLACEHOLDER,
  type PolicySlug,
} from '@/constants/policies'
import { cn } from '@/lib/utils'

/**
 * Página única para as quatro políticas, escolhida pelo slug da URL.
 *
 * Uma página por slug duplicaria layout e navegação para variar só o texto —
 * e texto é exatamente o que precisa ser revisado sem mexer em componente.
 */

const ICONS: Record<PolicySlug, typeof FileText> = {
  privacidade: ShieldCheck,
  uso: Scale,
  cookies: Cookie,
  seguranca: FileText,
}

const isPolicySlug = (value: string | undefined): value is PolicySlug =>
  value !== undefined && value in POLICIES

function formatDate(iso: string) {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

export default function PolicyPage() {
  const { slug } = useParams<{ slug: string }>()

  // Slug desconhecido volta para a primeira política em vez de 404: quem chegou
  // aqui queria ler as regras, e a lista está logo abaixo de qualquer uma.
  if (!isPolicySlug(slug)) return <Navigate to={`/politicas/${POLICY_ORDER[0]}`} replace />

  const policy = POLICIES[slug]
  const Icon = ICONS[slug]
  /**
   * Um texto com `[preencher]` não está pronto para valer como política.
   * O aviso é para o DONO, e some sozinho quando os campos forem preenchidos.
   */
  const pending = JSON.stringify(policy).split(POLICY_PLACEHOLDER).length - 1

  return (
    <PublicShell
      action={
        <Link
          to="/agendar"
          className="min-h-11 inline-flex items-center px-2 text-sm font-medium text-[var(--primary)] hover:text-[var(--primary-light)] transition-colors"
        >
          Agendar
        </Link>
      }
    >
      <article className="max-w-2xl mx-auto">
        <Link
          to="/"
          className="min-h-11 inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao início
        </Link>

        <header className="mb-6">
          <div className="flex items-center gap-2.5 mb-2">
            <Icon aria-hidden="true" className="h-5 w-5 text-[var(--primary)] shrink-0" />
            <h1 className="font-display text-2xl font-bold tracking-tight">{policy.title}</h1>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">{policy.summary}</p>
          <p className="text-xs text-[var(--muted-foreground)]/70 mt-2">
            Última atualização: {formatDate(POLICIES_UPDATED_AT)}
          </p>
        </header>

        {pending > 0 && (
          <div
            role="status"
            className="mb-6 rounded-xl border border-amber-400/50 bg-amber-400/10 px-4 py-3 flex gap-2.5"
          >
            <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-amber-200">
                Texto ainda não finalizado ({pending}{' '}
                {pending === 1 ? 'campo' : 'campos'} por preencher)
              </p>
              <p className="text-xs text-amber-200/80 mt-1">
                Os trechos marcados dependem de dados que só a barbearia tem — identificação,
                canal de contato e prazos. Edite <code>src/constants/policies.ts</code> antes de
                divulgar esta página.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-7">
          {policy.sections.map(section => (
            <section key={section.heading}>
              <h2 className="text-base font-semibold mb-2">{section.heading}</h2>
              {section.body.map(paragraph => (
                <p
                  key={paragraph.slice(0, 48)}
                  className="text-sm text-[var(--muted-foreground)] leading-relaxed mb-2 last:mb-0"
                >
                  {paragraph}
                </p>
              ))}
              {section.items && (
                <ul className="mt-2.5 space-y-1.5">
                  {section.items.map(item => (
                    <li
                      key={item.slice(0, 48)}
                      className="text-sm text-[var(--muted-foreground)] leading-relaxed pl-4 relative"
                    >
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-2 h-1 w-1 rounded-full bg-[var(--primary)]"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <nav aria-label="Outras políticas" className="mt-10 pt-6 border-t border-[var(--border)]">
          <h2 className="text-xs font-semibold tracking-widest uppercase text-[var(--muted-foreground)] mb-3">
            Outras políticas
          </h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {POLICY_ORDER.map(entry => {
              const EntryIcon = ICONS[entry]
              const current = entry === slug
              return (
                <li key={entry}>
                  <Link
                    to={`/politicas/${entry}`}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'min-h-11 flex items-center gap-2 rounded-xl border px-3 text-sm transition-colors',
                      current
                        ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)]'
                        : 'border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                    )}
                  >
                    <EntryIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
                    {POLICIES[entry].title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </article>
    </PublicShell>
  )
}
