import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Users, Phone, Calendar, AlertCircle, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/services/api'
import { listUsers } from '@/services/admin'
import type { AuthUser } from '@/services/auth'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

export default function Clients() {
  const [clients, setClients] = useState<AuthUser[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Clientes são os usuários reais com papel CUSTOMER.
      const result = await listUsers({
        role: 'CUSTOMER',
        ...(query.trim() ? { search: query.trim() } : {}),
        perPage: 50,
      })
      setClients(result.users)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar os clientes.')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    const timer = setTimeout(() => void load(), query ? 350 : 0)
    return () => clearTimeout(timer)
  }, [load, query])

  const blocked = clients.filter(client => client.status === 'BLOCKED')

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Clientes</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {loading
              ? 'Carregando…'
              : `${total} cliente${total !== 1 ? 's' : ''} cadastrado${total !== 1 ? 's' : ''}.`}
          </p>
        </div>
      </div>

      {blocked.length > 0 && (
        <div className="border border-orange-500/30 bg-orange-500/8 rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2 text-orange-400 text-sm font-medium mb-2">
            <AlertCircle className="h-4 w-4" />
            {blocked.length} cliente{blocked.length !== 1 ? 's' : ''} bloqueado
            {blocked.length !== 1 ? 's' : ''}
          </div>
          <div className="space-y-1">
            {blocked.map(client => (
              <Link
                key={client.id}
                to={`/admin/clients/${client.id}`}
                className="flex items-center justify-between text-sm hover:text-[var(--foreground)] transition-colors py-0.5"
              >
                <span className="text-[var(--foreground)]">{client.fullName ?? 'Sem nome'}</span>
                <span className="text-orange-400 text-xs">Bloqueado</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted-foreground)]" />
        <input
          type="search"
          aria-label="Buscar clientes"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar por nome ou telefone..."
          className="w-full pl-10 pr-4 py-3 rounded-xl border border-[var(--primary)]/20 bg-[var(--background)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
        />
      </div>

      {loading ? (
        <p role="status" className="text-sm text-[var(--muted-foreground)]">
          Carregando clientes…
        </p>
      ) : error ? (
        <div role="alert" className="border border-red-500/40 bg-red-500/10 rounded-2xl p-5 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-200 mb-4">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Tentar novamente
          </Button>
        </div>
      ) : clients.length === 0 ? (
        <div className="border border-dashed border-[var(--primary)]/25 bg-[var(--surface-bronze)] rounded-2xl p-12 text-center">
          <Users className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
          <p className="text-[var(--muted-foreground)] text-sm">
            {query
              ? `Nenhum cliente encontrado para "${query}".`
              : 'Nenhum cliente cadastrado ainda.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map(client => (
            <Link
              key={client.id}
              to={`/admin/clients/${client.id}`}
              className="flex items-center justify-between p-4 border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl hover:border-[var(--primary)]/45 transition-all"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-[var(--primary)]/10 border border-[var(--primary)]/30 flex items-center justify-center text-sm font-bold text-[var(--primary)] shrink-0">
                  {(client.fullName ?? '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm truncate">{client.fullName ?? 'Sem nome'}</p>
                    {client.status === 'BLOCKED' && <Badge variant="blocked">Bloqueado</Badge>}
                    {client.status === 'PENDING' && <Badge variant="warning">Pendente</Badge>}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] mt-0.5">
                    <Phone className="h-3 w-3 shrink-0" />
                    <span className="tabular-nums">{client.phoneFormatted}</span>
                  </div>
                </div>
              </div>

              <div className="hidden sm:block text-right shrink-0">
                <div className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                  <Calendar className="h-3 w-3" />
                  <span>{formatDate(client.createdAt)}</span>
                </div>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">cadastro</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
