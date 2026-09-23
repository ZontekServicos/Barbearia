import { useCallback, useEffect, useState } from 'react'
import { addDays, addWeeks, format, parseISO, startOfWeek } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, LayoutList, AlertCircle, RefreshCw } from 'lucide-react'
import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/services/api'
import { listAgenda, type AdminAppointment } from '@/services/admin-booking'
import type { AppointmentStatus } from '@/services/booking'
import { cn } from '@/lib/utils'

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function formatDisplayDate(dateISO: string) {
  const [, month, day] = dateISO.split('-')
  return `${day} de ${MONTHS[Number(month) - 1]}`
}

function statusColor(status: AppointmentStatus) {
  switch (status) {
    case 'CONFIRMED': return 'border-l-[var(--primary)]'
    case 'COMPLETED': return 'border-l-green-500'
    case 'CANCELLED': return 'border-l-red-500'
    case 'NO_SHOW': return 'border-l-orange-500'
    default: return 'border-l-[var(--border)]'
  }
}

export default function Agenda() {
  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [appointments, setAppointments] = useState<AdminAppointment[]>([])
  const [weekCounts, setWeekCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const weekStart = startOfWeek(parseISO(selectedDate), { weekStartsOn: 1 })
  const days = Array.from({ length: 6 }, (_, index) => {
    const day = addDays(weekStart, index)
    return { label: format(day, 'EEE', { locale: ptBR }), date: format(day, 'yyyy-MM-dd') }
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const weekFrom = format(weekStart, 'yyyy-MM-dd')
      const weekTo = format(addDays(weekStart, 5), 'yyyy-MM-dd')

      // Uma consulta cobre a semana inteira: alimenta a lista do dia e os
      // contadores da faixa superior sem sete idas ao servidor.
      const week = await listAgenda(weekFrom, weekTo)

      const counts: Record<string, number> = {}
      for (const appointment of week) {
        counts[appointment.date] = (counts[appointment.date] ?? 0) + 1
      }

      setWeekCounts(counts)
      setAppointments(week.filter(appointment => appointment.date === selectedDate))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar a agenda.')
    } finally {
      setLoading(false)
    }
  }, [selectedDate, weekStart])

  useEffect(() => { void load() }, [load])

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Agenda</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-0.5">Gerencie seus atendimentos.</p>
        </div>
      </div>

      {/* Faixa da semana */}
      <div className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <button
            aria-label="Semana anterior"
            onClick={() => setSelectedDate(format(addWeeks(parseISO(selectedDate), -1), 'yyyy-MM-dd'))}
            className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-[var(--primary)]/10 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium">
            {format(weekStart, 'dd/MM')} – {format(addDays(weekStart, 5), 'dd/MM/yyyy')}
          </span>
          <button
            aria-label="Próxima semana"
            onClick={() => setSelectedDate(format(addWeeks(parseISO(selectedDate), 1), 'yyyy-MM-dd'))}
            className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-[var(--primary)]/10 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-6 gap-1">
          {days.map(({ label, date }) => {
            const count = weekCounts[date] ?? 0
            const isSelected = date === selectedDate
            return (
              <button
                key={date}
                aria-pressed={isSelected}
                onClick={() => setSelectedDate(date)}
                className={cn(
                  'flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all text-center',
                  isSelected ? 'bg-[var(--primary)] text-black' : 'hover:bg-[var(--primary)]/10'
                )}
              >
                <span className={cn('text-xs font-medium', isSelected ? 'text-black' : 'text-[var(--muted-foreground)]')}>{label}</span>
                <span className={cn('text-lg font-bold leading-none', isSelected ? 'text-black' : 'text-[var(--foreground)]')}>
                  {date.split('-')[2]}
                </span>
                {count > 0 && (
                  <span className={cn('text-xs', isSelected ? 'text-black/70' : 'text-[var(--primary)]')}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Atendimentos do dia */}
      <div>
        <h3 className="text-sm font-medium text-[var(--muted-foreground)] mb-3">
          {formatDisplayDate(selectedDate)}
          {!loading && !error && ` — ${appointments.length} atendimento${appointments.length !== 1 ? 's' : ''}`}
        </h3>

        {loading ? (
          <p role="status" className="text-sm text-[var(--muted-foreground)] py-6">Carregando agenda…</p>
        ) : error ? (
          <div role="alert" className="border border-red-500/40 bg-red-500/10 rounded-2xl p-5 text-center">
            <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
            <p className="text-sm text-red-200 mb-4">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Tentar novamente
            </Button>
          </div>
        ) : appointments.length === 0 ? (
          <div className="border border-dashed border-[var(--primary)]/25 bg-[var(--surface-bronze)] rounded-2xl p-12 text-center">
            <LayoutList className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
            <p className="text-[var(--muted-foreground)] text-sm">Nenhum atendimento neste dia.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {appointments.map(appointment => (
              <Link
                key={appointment.id}
                to={`/admin/agenda/${appointment.id}`}
                className={cn(
                  'flex flex-wrap sm:flex-nowrap items-center gap-3 p-4 border border-[var(--primary)]/20 border-l-4 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl hover:border-[var(--primary)]/45 transition-all',
                  statusColor(appointment.status)
                )}
              >
                <span className="font-mono text-sm font-bold text-[var(--primary)] w-12 shrink-0 tabular-nums">
                  {appointment.startsAtClock}
                </span>
                <div className="flex-1 min-w-[8rem]">
                  <p className="font-semibold text-sm break-words">
                    {appointment.customer.fullName ?? 'Sem nome'}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {appointment.serviceName} · {appointment.durationMinutes} min · {appointment.customer.phoneFormatted}
                  </p>
                </div>
                <div className="flex items-center justify-end gap-3 w-full sm:w-auto shrink-0">
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
    </div>
  )
}
