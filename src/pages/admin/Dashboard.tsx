import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CalendarPlus, UserPlus, Scissors, TrendingUp,
  Calendar, XCircle, AlertCircle, RefreshCw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { ApiError } from '@/services/api'
import { listAgenda, type AdminAppointment } from '@/services/admin-booking'

/** Centavos -> "205,00". Nada de aritmética de ponto flutuante com dinheiro. */
function formatCents(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

function todayISO() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [appointments, setAppointments] = useState<AdminAppointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const today = todayISO()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAppointments(await listAgenda(today))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar o dia.')
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => { void load() }, [load])

  const upcoming = appointments.filter(a => a.status === 'CONFIRMED')
  const completed = appointments.filter(a => a.status === 'COMPLETED')
  const cancelled = appointments.filter(a => a.status === 'CANCELLED')
  const missed = appointments.filter(a => a.status === 'NO_SHOW')

  // Faturamento previsto: o que já foi atendido mais o que ainda está confirmado.
  const revenueCents = [...completed, ...upcoming].reduce(
    (sum, appointment) => sum + appointment.servicePriceCents,
    0,
  )

  const kpis = [
    { label: 'Agendamentos hoje', value: appointments.length, icon: Calendar, color: 'text-[var(--primary)]', bg: 'bg-[var(--primary)]/10' },
    { label: 'Faturamento estimado', value: `R$ ${formatCents(revenueCents)}`, icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-400/10' },
    { label: 'Cancelamentos', value: cancelled.length, icon: XCircle, color: 'text-orange-400', bg: 'bg-orange-400/10' },
    { label: 'Faltas', value: missed.length, icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-400/10' },
  ]

  const todayLabel = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Visão Geral</h2>
        <p className="text-[var(--muted-foreground)] text-sm mt-1 capitalize">{todayLabel}</p>
      </div>

      {error && (
        <div role="alert" className="border border-red-500/40 bg-red-500/10 rounded-2xl p-5 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-200 mb-4">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Tentar novamente
          </Button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-5">
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-4`}>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div className={`text-2xl font-bold ${color} mb-0.5`}>{loading ? '—' : value}</div>
            <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
          </div>
        ))}
      </div>

      {/* Ações rápidas */}
      <div>
        <h3 className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-3">Ações rápidas</h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate('/admin/agenda')}>
            <CalendarPlus className="h-4 w-4 mr-1.5" />
            Ver agenda
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/admin/clients')}>
            <UserPlus className="h-4 w-4 mr-1.5" />
            Ver clientes
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/admin/services')}>
            <Scissors className="h-4 w-4 mr-1.5" />
            Gerenciar serviços
          </Button>
        </div>
      </div>

      {/* Próximos atendimentos */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-lg font-semibold tracking-tight">Próximos atendimentos</h3>
          <Link to="/admin/agenda" className="min-h-11 inline-flex items-center text-sm text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors">
            Ver agenda completa →
          </Link>
        </div>

        {loading ? (
          <p role="status" className="text-sm text-[var(--muted-foreground)]">Carregando atendimentos…</p>
        ) : upcoming.length === 0 ? (
          <div className="border border-dashed border-[var(--primary)]/25 bg-[var(--surface-bronze)] rounded-2xl p-8 text-center">
            <Calendar className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
            <p className="text-[var(--muted-foreground)] text-sm">Nenhum atendimento restante hoje.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.map(appointment => (
              <Link
                key={appointment.id}
                to={`/admin/agenda/${appointment.id}`}
                className="flex items-center justify-between p-4 border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl hover:border-[var(--primary)]/45 transition-all"
              >
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm font-bold text-[var(--primary)] w-12 shrink-0 tabular-nums">
                    {appointment.startsAtClock}
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--foreground)] text-sm">
                      {appointment.customer.fullName ?? 'Sem nome'}
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {appointment.serviceName} · {appointment.durationMinutes} min
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-[var(--muted-foreground)]">
                    R$ {appointment.servicePriceFormatted}
                  </span>
                  <StatusBadge status={appointment.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Concluídos hoje */}
      {completed.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-3">Concluídos hoje</h3>
          <div className="space-y-2">
            {completed.map(appointment => (
              <div key={appointment.id} className="flex items-center justify-between px-4 py-3 border border-[var(--border)] bg-[var(--card)]/60 rounded-xl">
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm text-[var(--muted-foreground)] w-12 shrink-0 tabular-nums">
                    {appointment.startsAtClock}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {appointment.customer.fullName ?? 'Sem nome'}
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)]">{appointment.serviceName}</p>
                  </div>
                </div>
                <StatusBadge status={appointment.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
