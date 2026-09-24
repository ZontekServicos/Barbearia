import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, LayoutList, AlertCircle, RefreshCw } from 'lucide-react'
import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ApiError, isAbortError } from '@/services/api'
import { listAgenda, type AdminAppointment } from '@/services/admin-booking'
import type { AppointmentStatus } from '@/services/booking'
import { addDaysISO, weekRangeFor } from '@/lib/week'
import { cn } from '@/lib/utils'

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function formatDisplayDate(dateISO: string) {
  const [, month, day] = dateISO.split('-')
  return `${day} de ${MONTHS[Number(month) - 1]}`
}

/** Rótulo do dia sem criar `Date` no corpo do componente. */
function weekdayLabel(dateISO: string) {
  const [year, month, day] = dateISO.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()]
}

function shortDate(dateISO: string) {
  const [, month, day] = dateISO.split('-')
  return `${day}/${month}`
}

function todayISO() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
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

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; appointments: AdminAppointment[] }
  | { kind: 'error'; message: string }

export default function Agenda() {
  const [selectedDate, setSelectedDate] = useState(todayISO)
  /** Incrementado só por ação explícita: "Tentar novamente" e refresh manual. */
  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState<State>({ kind: 'loading' })

  /*
   * A semana é derivada como STRING e memoizada.
   *
   * Antes, `startOfWeek(parseISO(selectedDate))` rodava no corpo do componente
   * e devolvia um objeto `Date` novo a cada render. Esse objeto era dependência
   * do `useCallback`, que por isso mudava de identidade em todo render, o que
   * reexecutava o `useEffect`, que chamava `setState`, que re-renderizava — e
   * cada volta disparava mais uma requisição. Uma chave em string é estável por
   * valor e fecha o ciclo.
   */
  const week = useMemo(() => weekRangeFor(selectedDate), [selectedDate])
  const { from: weekFrom, to: weekTo } = week

  const load = useCallback(
    async (signal: AbortSignal) => {
      setState({ kind: 'loading' })
      try {
        // Uma consulta cobre a semana inteira: alimenta a lista do dia e os
        // contadores da faixa superior sem sete idas ao servidor.
        const appointments = await listAgenda(weekFrom, weekTo, undefined, signal)
        if (signal.aborted) return
        setState({ kind: 'ready', appointments })
      } catch (err) {
        // Cancelamento não é erro: a semana mudou e esta resposta não interessa
        // mais. Deixar o estado como está evita piscar um banner vermelho.
        if (signal.aborted || isAbortError(err)) return
        setState({
          kind: 'error',
          message: err instanceof ApiError ? err.message : 'Não foi possível carregar a agenda.',
        })
      }
    },
    [weekFrom, weekTo],
  )

  /*
   * Dispara só quando a semana muda ou quando alguém pede recarga. Trocar de
   * dia dentro da mesma semana não consulta de novo — os dados já estão em
   * memória. O AbortController cobre as duas coisas que o enunciado pede:
   * resposta antiga não sobrescreve semana nova, e componente desmontado não
   * atualiza estado.
   */
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, reloadToken])

  const refresh = useCallback(() => setReloadToken(token => token + 1), [])

  const weekAppointments = state.kind === 'ready' ? state.appointments : []

  const counts = useMemo(() => {
    const result: Record<string, number> = {}
    for (const appointment of weekAppointments) {
      result[appointment.date] = (result[appointment.date] ?? 0) + 1
    }
    return result
  }, [weekAppointments])

  /** Filtragem do dia é derivação, não motivo para nova requisição. */
  const dayAppointments = useMemo(
    () =>
      weekAppointments
        .filter(appointment => appointment.date === selectedDate)
        .slice()
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [weekAppointments, selectedDate],
  )

  // Ao mudar de semana, mantém o mesmo dia da semana em vez de pular para a
  // segunda — quem navega procurando uma sexta continua vendo sexta.
  const shiftWeek = (weeks: number) => setSelectedDate(current => addDaysISO(current, weeks * 7))

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Agenda</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-0.5">Gerencie seus atendimentos.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={state.kind === 'loading'}
        >
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', state.kind === 'loading' && 'animate-spin')} />
          Atualizar
        </Button>
      </div>

      {/* Faixa da semana */}
      <div className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <button
            aria-label="Semana anterior"
            onClick={() => shiftWeek(-1)}
            className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-[var(--primary)]/10 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium tabular-nums">
            {shortDate(weekFrom)} – {shortDate(weekTo)}
          </span>
          <button
            aria-label="Próxima semana"
            onClick={() => shiftWeek(1)}
            className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-[var(--primary)]/10 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-6 gap-1">
          {week.days.map(date => {
            const count = counts[date] ?? 0
            const isSelected = date === selectedDate
            return (
              <button
                key={date}
                aria-pressed={isSelected}
                onClick={() => setSelectedDate(date)}
                className={cn(
                  'flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all text-center min-h-11',
                  isSelected ? 'bg-[var(--primary)] text-black' : 'hover:bg-[var(--primary)]/10'
                )}
              >
                <span className={cn('text-xs font-medium', isSelected ? 'text-black' : 'text-[var(--muted-foreground)]')}>
                  {weekdayLabel(date)}
                </span>
                <span className={cn('text-lg font-bold leading-none tabular-nums', isSelected ? 'text-black' : 'text-[var(--foreground)]')}>
                  {date.split('-')[2]}
                </span>
                {count > 0 && (
                  <span className={cn('text-xs tabular-nums', isSelected ? 'text-black/70' : 'text-[var(--primary)]')}>
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
          {state.kind === 'ready' &&
            ` — ${dayAppointments.length} atendimento${dayAppointments.length !== 1 ? 's' : ''}`}
        </h3>

        {state.kind === 'loading' ? (
          <p role="status" className="text-sm text-[var(--muted-foreground)] py-6">Carregando agenda…</p>
        ) : state.kind === 'error' ? (
          <div role="alert" className="border border-red-500/40 bg-red-500/10 rounded-2xl p-5 text-center">
            <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
            <p className="text-sm text-red-200 mb-4">{state.message}</p>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Tentar novamente
            </Button>
          </div>
        ) : dayAppointments.length === 0 ? (
          <div className="border border-dashed border-[var(--primary)]/25 bg-[var(--surface-bronze)] rounded-2xl p-12 text-center">
            <LayoutList className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
            <p className="text-[var(--muted-foreground)] text-sm">Nenhum atendimento neste dia.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {dayAppointments.map(appointment => (
              <Link
                key={appointment.id}
                to={`/admin/agenda/${appointment.id}`}
                className={cn(
                  'flex flex-wrap sm:flex-nowrap items-center gap-3 p-4 border border-[var(--primary)]/20 border-l-4 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl hover:border-[var(--primary)]/45 transition-all',
                  statusColor(appointment.status)
                )}
              >
                {/* Início e fim: a duração real do serviço fica visível. */}
                <span className="font-mono text-sm font-bold text-[var(--primary)] w-[4.5rem] shrink-0 tabular-nums leading-tight">
                  {appointment.startsAtClock}
                  <span className="block text-[0.7rem] font-normal text-[var(--muted-foreground)]">
                    {appointment.endsAtClock}
                  </span>
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
