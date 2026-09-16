import { Info } from 'lucide-react'

// This app currently uses fixtures and component-local state, not a booking API.
export function DemoNotice() {
  return (
    <aside
      aria-label="Modo de demonstração"
      title="Dados e contatos de exemplo. Login, reservas e alterações são simulados e não são salvos."
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)]/80 backdrop-blur px-3 py-1 text-xs text-[var(--muted-foreground)] mb-6"
    >
      <Info className="h-3 w-3 text-[var(--primary)] shrink-0" />
      <span>Modo demonstração — reservas não são salvas</span>
      <span className="sr-only">
        Dados e contatos de exemplo. Login, reservas e alterações são simulados e não são salvos.
      </span>
    </aside>
  )
}
