import { Link, useNavigate } from 'react-router-dom'
import {
  CalendarPlus, UserPlus, Scissors, TrendingUp,
  Calendar, XCircle, AlertCircle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { APPOINTMENTS } from '@/data/mock'

const todayStr = '2026-09-15'
const todayApts = APPOINTMENTS.filter(a => a.date === todayStr)
const upcoming = todayApts.filter(a => a.status === 'confirmed')
const completed = todayApts.filter(a => a.status === 'completed')
const cancelled = todayApts.filter(a => a.status === 'cancelled')
const missed = todayApts.filter(a => a.status === 'missed')
const revenue = completed.reduce((sum, a) => sum + a.servicePrice, 0)
  + upcoming.reduce((sum, a) => sum + a.servicePrice, 0)

const kpis = [
  { label: 'Agendamentos hoje', value: todayApts.length, icon: Calendar, color: 'text-[var(--primary)]', bg: 'bg-[var(--primary)]/10' },
  { label: 'Faturamento estimado', value: `R$ ${revenue}`, icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-400/10' },
  { label: 'Cancelamentos', value: cancelled.length, icon: XCircle, color: 'text-orange-400', bg: 'bg-orange-400/10' },
  { label: 'Faltas', value: missed.length, icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-400/10' },
]

export default function Dashboard() {
  const navigate = useNavigate()

  return (
    <div className="max-w-5xl space-y-8">
      {/* Title */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Visão Geral</h2>
        <p className="text-[var(--muted-foreground)] text-sm mt-1">Terça-feira, 15 de setembro de 2026</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="border border-[var(--border)] bg-[var(--card)] rounded-2xl p-5">
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-4`}>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div className={`text-2xl font-bold ${color} mb-0.5`}>{value}</div>
            <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
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

      {/* Upcoming appointments */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-lg font-semibold tracking-tight">Próximos atendimentos</h3>
          <Link to="/admin/agenda" className="min-h-11 inline-flex items-center text-sm text-[var(--primary)] hover:text-[var(--primary)]/80 transition-colors">
            Ver agenda completa →
          </Link>
        </div>

        {upcoming.length === 0 ? (
          <div className="border border-dashed border-[var(--border)] rounded-2xl p-8 text-center">
            <Calendar className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
            <p className="text-[var(--muted-foreground)] text-sm">Nenhum atendimento restante hoje.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.sort((a, b) => a.time.localeCompare(b.time)).map(apt => (
              <Link
                key={apt.id}
                to={`/admin/agenda/${apt.id}`}
                className="flex items-center justify-between p-4 border border-[var(--border)] bg-[var(--card)] rounded-xl hover:border-[var(--primary)]/50 transition-all group"
              >
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm font-bold text-[var(--primary)] w-12 shrink-0">{apt.time}</span>
                  <div>
                    <p className="font-semibold text-[var(--foreground)] text-sm">{apt.clientName}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{apt.serviceName} · {apt.serviceDuration} min</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-[var(--muted-foreground)]">R$ {apt.servicePrice}</span>
                  <StatusBadge status={apt.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Completed today */}
      {completed.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-3">Concluídos hoje</h3>
          <div className="space-y-2">
            {completed.map(apt => (
              <div key={apt.id} className="flex items-center justify-between px-4 py-3 border border-[var(--border)] bg-[var(--card)]/60 rounded-xl">
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm text-[var(--muted-foreground)] w-12 shrink-0">{apt.time}</span>
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">{apt.clientName}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{apt.serviceName}</p>
                  </div>
                </div>
                <StatusBadge status={apt.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
