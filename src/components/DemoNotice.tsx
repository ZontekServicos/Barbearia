// This app currently uses fixtures and component-local state, not a booking API.
export function DemoNotice() {
  return (
    <aside aria-label="Modo de demonstração" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-sm text-[var(--muted-foreground)] mb-6">
      <strong className="text-[var(--foreground)]">Demonstração.</strong>{' '}
      Dados e contatos de exemplo. Login, reservas e alterações são simulados e não são salvos.
    </aside>
  )
}
