import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, List, LayoutList, CalendarDays } from 'lucide-react'
import { StatusBadge } from '@/components/ui/badge'
import { APPOINTMENTS } from '@/data/mock'
import { cn } from '@/lib/utils'

type View = 'day' | 'list'

const DAYS = [
  { label: 'Seg', date: '2026-09-14' },
  { label: 'Ter', date: '2026-09-15' },
  { label: 'Qua', date: '2026-09-16' },
  { label: 'Qui', date: '2026-09-17' },
  { label: 'Sex', date: '2026-09-18' },
  { label: 'Sáb', date: '2026-09-19' },
]

function formatDisplayDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-')
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${d} de ${months[parseInt(m) - 1]}`
}

function statusColor(status: string) {
  switch (status) {
    case 'confirmed': return 'border-l-[var(--primary)]'
    case 'completed': return 'border-l-green-500'
    case 'cancelled': return 'border-l-red-500'
    case 'missed': return 'border-l-orange-500'
    default: return 'border-l-[var(--border)]'
  }
}

export default function Agenda() {
  const [view, setView] = useState<View>('day')
  const [selectedDate, setSelectedDate] = useState('2026-09-15')

  const dayApts = APPOINTMENTS
    .filter(a => a.date === selectedDate)
    .sort((a, b) => a.time.localeCompare(b.time))

  const allApts = APPOINTMENTS
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Agenda</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-0.5">Gerencie seus atendimentos.</p>
        </div>
        <div className="flex items-center gap-1 border border-[var(--border)] bg-[var(--card)] rounded-lg p-1">
          <button
            onClick={() => setView('day')}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors', view === 'day' ? 'bg-[var(--primary)] text-black' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]')}
          >
            <CalendarDays className="h-4 w-4" />
            <span className="hidden sm:inline">Dia</span>
          </button>
          <button
            onClick={() => setView('list')}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors', view === 'list' ? 'bg-[var(--primary)] text-black' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]')}
          >
            <List className="h-4 w-4" />
            <span className="hidden sm:inline">Lista</span>
          </button>
        </div>
      </div>

      {/* Day view */}
      {view === 'day' && (
        <>
          {/* Week strip */}
          <div className="border border-[var(--border)] bg-[var(--card)] rounded-2xl p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <button className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium">Semana de 14–19 set 2026</span>
              <button className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {DAYS.map(({ label, date }) => {
                const count = APPOINTMENTS.filter(a => a.date === date).length
                const isSelected = date === selectedDate
                return (
                  <button
                    key={date}
                    onClick={() => setSelectedDate(date)}
                    className={cn(
                      'flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all text-center',
                      isSelected ? 'bg-[var(--primary)] text-black' : 'hover:bg-[var(--secondary)]'
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

          {/* Day appointments */}
          <div>
            <h3 className="text-sm font-medium text-[var(--muted-foreground)] mb-3">
              {formatDisplayDate(selectedDate)} — {dayApts.length} atendimento{dayApts.length !== 1 ? 's' : ''}
            </h3>

            {dayApts.length === 0 ? (
              <div className="border border-dashed border-[var(--border)] rounded-2xl p-12 text-center">
                <LayoutList className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
                <p className="text-[var(--muted-foreground)] text-sm">Nenhum atendimento neste dia.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {dayApts.map(apt => (
                  <Link
                    key={apt.id}
                    to={`/admin/agenda/${apt.id}`}
                    className={cn(
                      'flex items-center gap-4 p-4 border border-[var(--border)] border-l-4 bg-[var(--card)] rounded-xl hover:bg-[var(--secondary)]/30 transition-all',
                      statusColor(apt.status)
                    )}
                  >
                    <span className="font-mono text-sm font-bold text-[var(--primary)] w-12 shrink-0">{apt.time}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{apt.clientName}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {apt.serviceName} · {apt.serviceDuration} min · {apt.clientPhone}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-medium text-[var(--muted-foreground)]">R$ {apt.servicePrice}</span>
                      <StatusBadge status={apt.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* List view */}
      {view === 'list' && (
        <div className="space-y-6">
          {['2026-09-15', '2026-09-18', '2026-09-25'].map(date => {
            const apts = APPOINTMENTS.filter(a => a.date === date).sort((a, b) => a.time.localeCompare(b.time))
            if (apts.length === 0) return null
            return (
              <div key={date}>
                <h3 className="text-xs font-semibold tracking-widest text-[var(--primary)] uppercase mb-3">
                  {formatDisplayDate(date)}
                </h3>
                <div className="space-y-2">
                  {apts.map(apt => (
                    <Link
                      key={apt.id}
                      to={`/admin/agenda/${apt.id}`}
                      className={cn(
                        'flex items-center gap-4 p-4 border border-[var(--border)] border-l-4 bg-[var(--card)] rounded-xl hover:bg-[var(--secondary)]/30 transition-all',
                        statusColor(apt.status)
                      )}
                    >
                      <span className="font-mono text-sm font-bold text-[var(--primary)] w-12 shrink-0">{apt.time}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{apt.clientName}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{apt.serviceName} · {apt.serviceDuration} min</p>
                      </div>
                      <StatusBadge status={apt.status} />
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
