import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Users, AlertTriangle, Phone, Calendar } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { CLIENTS } from '@/data/mock'

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

export default function Clients() {
  const [query, setQuery] = useState('')

  const filtered = CLIENTS.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    c.phone.includes(query)
  )

  const flagged = CLIENTS.filter(c => c.blocked || c.missedAppointments >= 2 || c.cancelledAppointments >= 2)

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Clientes</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">{CLIENTS.length} clientes cadastrados.</p>
        </div>
      </div>

      {/* Alerts */}
      {flagged.length > 0 && (
        <div className="border border-orange-500/30 bg-orange-500/8 rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2 text-orange-400 text-sm font-medium mb-2">
            <AlertTriangle className="h-4 w-4" />
            {flagged.length} cliente{flagged.length !== 1 ? 's' : ''} com alerta
          </div>
          <div className="space-y-1">
            {flagged.map(c => (
              <Link
                key={c.id}
                to={`/admin/clients/${c.id}`}
                className="flex items-center justify-between text-sm hover:text-[var(--foreground)] transition-colors py-0.5"
              >
                <span className="text-[var(--foreground)]">{c.name}</span>
                <span className="text-orange-400 text-xs">
                  {c.blocked ? 'Bloqueado' : c.missedAppointments >= 2 ? `${c.missedAppointments} faltas` : `${c.cancelledAppointments} cancelamentos`}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar por nome ou telefone..."
          className="w-full pl-10 pr-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
        />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="border border-dashed border-[var(--border)] rounded-2xl p-12 text-center">
          <Users className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
          <p className="text-[var(--muted-foreground)] text-sm">Nenhum cliente encontrado para "{query}".</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(client => (
            <Link
              key={client.id}
              to={`/admin/clients/${client.id}`}
              className="flex items-center justify-between p-4 border border-[var(--border)] bg-[var(--card)] rounded-xl hover:border-[var(--primary)]/40 transition-all group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-[var(--secondary)] flex items-center justify-center text-sm font-bold text-[var(--primary)] shrink-0">
                  {client.name[0]}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm truncate">{client.name}</p>
                    {client.blocked && <Badge variant="blocked">Bloqueado</Badge>}
                    {!client.blocked && client.missedAppointments >= 2 && <Badge variant="warning">Faltoso</Badge>}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] mt-0.5">
                    <Phone className="h-3 w-3" />
                    <span>{client.phone}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6 shrink-0 text-right">
                <div className="hidden sm:block">
                  <p className="text-sm font-semibold text-[var(--foreground)]">{client.totalAppointments}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">agendamentos</p>
                </div>
                <div className="hidden sm:block">
                  <div className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                    <Calendar className="h-3 w-3" />
                    <span>{formatDate(client.lastVisit)}</span>
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5 text-right">última visita</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
