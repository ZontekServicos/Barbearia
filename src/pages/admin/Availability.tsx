import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, CalendarOff, ChevronLeft, ChevronRight, Clock, Lock,
  RefreshCw, Unlock, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/Modal'
import { ApiError } from '@/services/api'
import {
  blockWholeDay,
  createBlock,
  deleteBlock,
  getAdminAvailability,
  listAdminServices,
  listBlocks,
  type AdminAvailability,
  type AdminGridSlot,
  type ScheduleBlock,
} from '@/services/admin-booking'
import type { Service } from '@/services/booking'
import { addDaysISO } from '@/lib/week'
import { cn } from '@/lib/utils'

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function todayISO() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Rótulo do dia sem criar `Date` no corpo do componente (ver `lib/week`). */
function dayLabel(dateISO: string) {
  const [year, month, day] = dateISO.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()]
  return `${weekday}, ${String(day).padStart(2, '0')} de ${MONTHS[month! - 1]}`
}

const clockToMinutes = (clock: string) => {
  const [hour, minute] = clock.split(':').map(Number)
  return hour! * 60 + minute!
}
const minutesToClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/**
 * Até onde vai o bloqueio de UM horário da grade.
 *
 * Usa o intervalo RESERVADO, não a duração: bloquear um horário tem de ocupar
 * a agenda exatamente como ocuparia um cliente marcado ali. Com reserva de 40 e
 * corte de 30, bloquear só os 30 deixaria o encaixe seguinte desalinhado do que
 * a grade mostra.
 *
 * O teto em 23:59 existe porque o fim é uma hora do MESMO dia no contrato da
 * API; expediente não encosta na meia-noite, então na prática não aparece.
 */
function blockEndFor(slot: AdminGridSlot, reservedMinutes: number) {
  return minutesToClock(Math.min(clockToMinutes(slot.startsAtClock) + reservedMinutes, 23 * 60 + 59))
}

/** Como cada estado se apresenta. O motivo é o que decide a ação possível. */
const LOOK: Record<string, { label: string; chip: string; cell: string }> = {
  FREE: {
    label: 'Livre',
    chip: 'bg-[var(--primary)]/15 border-[var(--primary)]/40 text-[var(--primary)]',
    cell: 'border-[var(--primary)]/25 bg-[var(--surface-bronze)] text-[var(--foreground)] hover:border-[var(--primary)]/60',
  },
  APPOINTMENT: {
    label: 'Agendado',
    chip: 'bg-amber-400/15 border-amber-400/50 text-amber-300',
    cell: 'border-amber-400/45 bg-amber-400/10 text-amber-200 hover:border-amber-400/70',
  },
  BLOCK: {
    label: 'Bloqueado',
    chip: 'bg-red-500/15 border-red-500/50 text-red-300',
    cell: 'border-red-500/45 bg-red-500/10 text-red-200 hover:border-red-500/70',
  },
  OUTSIDE_HOURS: {
    label: 'Fora do expediente',
    chip: 'bg-[var(--muted)]/25 border-[var(--border)] text-[var(--muted-foreground)]',
    cell: 'border-[var(--border)]/50 bg-[var(--muted)]/10 text-[var(--muted-foreground)]/60 cursor-default',
  },
  PAST: {
    label: 'Já passou',
    chip: 'bg-[var(--muted)]/25 border-[var(--border)] text-[var(--muted-foreground)]',
    cell: 'border-[var(--border)]/50 bg-[var(--muted)]/10 text-[var(--muted-foreground)]/60 cursor-default',
  },
}

const lookFor = (slot: AdminGridSlot) => LOOK[slot.available ? 'FREE' : (slot.reason ?? 'OUTSIDE_HOURS')]!
/** Horários em que clicar faz algo: bloquear o livre, liberar o bloqueado. */
const isActionable = (slot: AdminGridSlot) => slot.available || slot.reason === 'BLOCK' || slot.reason === 'APPOINTMENT'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; availability: AdminAvailability; blocks: ScheduleBlock[] }
  | { kind: 'error'; message: string }

/**
 * Gestão de disponibilidade.
 *
 * A grade pública mostra o dia e esconde de quem é o horário. Esta mostra o
 * MOTIVO, porque é ele que decide a ação: bloqueio manual se desfaz aqui,
 * agendamento não. Desmarcar cliente passa pelo cancelamento, que avisa quem
 * ia ser atendido — e por isso não existe botão de liberar sobre `Agendado`.
 */
export default function Availability() {
  const [date, setDate] = useState(todayISO)
  const [services, setServices] = useState<Service[] | null>(null)
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  // Pedir a grade exige um serviço: a duração dele define a grade do dia.
  useEffect(() => {
    let active = true
    listAdminServices(false)
      .then(list => {
        if (!active) return
        setServices(list)
        setServiceId(current => current ?? list[0]?.id ?? null)
        if (list.length === 0) {
          setState({
            kind: 'error',
            message: 'Cadastre um serviço ativo para ver a grade do dia.',
          })
        }
      })
      .catch(error => {
        if (active) {
          setState({
            kind: 'error',
            message: error instanceof ApiError ? error.message : 'Não foi possível carregar os serviços.',
          })
        }
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!serviceId) return
    let active = true
    setState({ kind: 'loading' })
    Promise.all([getAdminAvailability(date, serviceId), listBlocks(date, date)])
      .then(([availability, blocks]) => {
        if (active) setState({ kind: 'ready', availability, blocks })
      })
      .catch(error => {
        if (active) {
          setState({
            kind: 'error',
            message: error instanceof ApiError ? error.message : 'Não foi possível carregar a grade.',
          })
        }
      })
    return () => { active = false }
  }, [date, serviceId, reloadToken])

  const reload = useCallback(() => setReloadToken(token => token + 1), [])

  const [chosen, setChosen] = useState<AdminGridSlot | null>(null)
  const [rangeOpen, setRangeOpen] = useState(false)
  const [dayOpen, setDayOpen] = useState(false)

  const ready = state.kind === 'ready' ? state : null
  const reservedMinutes = ready?.availability.reservedMinutes ?? 40

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight">Disponibilidade</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Bloqueie horários que não quer atender. Agendamento de cliente não se desfaz por aqui.
        </p>
      </header>

      {/* Serviço: a duração dele define a grade exibida. */}
      {services && services.length > 1 ? (
        <div className="mb-4">
          <label htmlFor="service" className="block text-xs font-semibold tracking-widest uppercase text-[var(--muted-foreground)] mb-1.5">
            Grade do serviço
          </label>
          <select
            id="service"
            value={serviceId ?? ''}
            onChange={event => setServiceId(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 text-sm text-[var(--foreground)]"
          >
            {services.map(service => (
              <option key={service.id} value={service.id}>
                {service.name} · {service.durationMinutes} min
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* Dia */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <Button variant="outline" size="icon" aria-label="Dia anterior" onClick={() => setDate(current => addDaysISO(current, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="font-semibold tabular-nums">{dayLabel(date)}</p>
          {date === todayISO() ? (
            <p className="text-xs text-[var(--muted-foreground)]">Hoje</p>
          ) : (
            <button onClick={() => setDate(todayISO())} className="text-xs text-[var(--primary)] min-h-6">
              Voltar para hoje
            </button>
          )}
        </div>
        <Button variant="outline" size="icon" aria-label="Próximo dia" onClick={() => setDate(current => addDaysISO(current, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <Button variant="outline" size="sm" onClick={() => setRangeOpen(true)}>
          <Lock className="h-3.5 w-3.5 mr-1.5" /> Bloquear intervalo
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDayOpen(true)}>
          <CalendarOff className="h-3.5 w-3.5 mr-1.5" /> Bloquear o dia
        </Button>
        <Button variant="ghost" size="sm" onClick={reload}>
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', state.kind === 'loading' && 'animate-spin')} />
          Atualizar
        </Button>
      </div>

      {state.kind === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 p-5 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-[var(--foreground)] mb-3">{state.message}</p>
          <Button variant="outline" size="sm" onClick={reload}>Tentar novamente</Button>
        </div>
      ) : state.kind === 'loading' ? (
        <p role="status" className="text-sm text-[var(--muted-foreground)] py-10 text-center">
          Carregando a grade do dia…
        </p>
      ) : !ready!.availability.open ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center">
          <CalendarOff className="h-9 w-9 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
          <p className="text-sm text-[var(--muted-foreground)]">
            Sem expediente neste dia. Ajuste a semana em Configurações.
          </p>
        </div>
      ) : (
        <>
          {/* Legenda: sem ela, cor virou adivinhação. */}
          <ul className="flex flex-wrap gap-2 mb-3">
            {['FREE', 'APPOINTMENT', 'BLOCK', 'OUTSIDE_HOURS'].map(key => (
              <li key={key} className={cn('rounded-full border px-2.5 py-1 text-[11px] font-medium', LOOK[key]!.chip)}>
                {LOOK[key]!.label}
              </li>
            ))}
          </ul>

          <p className="text-xs text-[var(--muted-foreground)] mb-4">
            Expediente {ready!.availability.windows.map(w => `${w.opensAt}–${w.closesAt}`).join(' e ')} ·
            {' '}grade de {ready!.availability.slotIntervalMinutes} min ·
            {' '}reserva de {ready!.availability.reservedMinutes} min
          </p>

          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 mb-7">
            {ready!.availability.grid.map(slot => {
              const look = lookFor(slot)
              const actionable = isActionable(slot)
              return (
                <button
                  key={slot.startsAtClock}
                  type="button"
                  disabled={!actionable}
                  /* O estado vai no nome acessível: a cor sozinha não é
                     informação para quem não a distingue. */
                  aria-label={`${slot.startsAtClock} — ${look.label}`}
                  onClick={() => setChosen(slot)}
                  className={cn(
                    'min-h-12 py-3 rounded-xl border-2 text-sm font-semibold tabular-nums transition-all',
                    look.cell,
                  )}
                >
                  {slot.startsAtClock}
                </button>
              )
            })}
          </div>

          {/* Bloqueios do dia: um intervalo pode cobrir muitos horários, e é
              aqui que ele se desfaz inteiro. */}
          <section>
            <h2 className="text-xs font-semibold tracking-widest uppercase text-[var(--muted-foreground)] mb-2.5">
              Bloqueios deste dia
            </h2>
            {ready!.blocks.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">Nenhum bloqueio.</p>
            ) : (
              <ul className="space-y-2">
                {ready!.blocks.map(block => (
                  <li key={block.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3.5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold tabular-nums">
                        {block.startsAtClock}–{block.endsAtClock}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)] truncate">{block.reason}</p>
                    </div>
                    <ReleaseButton id={block.id} onDone={reload} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {chosen ? (
        <SlotActions
          slot={chosen}
          date={date}
          reservedMinutes={reservedMinutes}
          onClose={() => setChosen(null)}
          onDone={() => { setChosen(null); reload() }}
        />
      ) : null}
      {rangeOpen ? (
        <RangeDialog date={date} onClose={() => setRangeOpen(false)} onDone={() => { setRangeOpen(false); reload() }} />
      ) : null}
      {dayOpen ? (
        <WholeDayDialog date={date} onClose={() => setDayOpen(false)} onDone={() => { setDayOpen(false); reload() }} />
      ) : null}
    </div>
  )
}

function ReleaseButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="shrink-0 text-right">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true); setError(null)
          try {
            await deleteBlock(id)
            onDone()
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Não foi possível liberar.')
            setBusy(false)
          }
        }}
      >
        <Unlock className="h-3.5 w-3.5 mr-1.5" /> Liberar
      </Button>
      {error ? <p role="alert" className="text-[11px] text-red-400 mt-1">{error}</p> : null}
    </div>
  )
}

/** O que se pode fazer com um horário — e o que não se pode, dito na cara. */
function SlotActions({
  slot, date, reservedMinutes, onClose, onDone,
}: {
  slot: AdminGridSlot
  date: string
  reservedMinutes: number
  onClose: () => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const look = lookFor(slot)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try {
      await action()
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível concluir.')
      setBusy(false)
    }
  }

  return (
    <Modal titleId="slot-actions" onClose={onClose}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 id="slot-actions" className="text-lg font-bold tabular-nums">
            {slot.startsAtClock}–{slot.endsAtClock}
          </h2>
          <p className={cn('inline-block mt-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium', look.chip)}>
            {look.label}
          </p>
        </div>
        <button aria-label="Fechar" onClick={onClose} className="min-h-11 min-w-11 inline-flex items-center justify-center text-[var(--muted-foreground)]">
          <X className="h-5 w-5" />
        </button>
      </div>

      {slot.available ? (
        <form
          onSubmit={event => {
            event.preventDefault()
            if (reason.trim().length < 2) {
              setError('Descreva o motivo.')
              return
            }
            void run(() => createBlock({
              date,
              startsAt: slot.startsAtClock,
              endsAt: blockEndFor(slot, reservedMinutes),
              reason: reason.trim(),
            }))
          }}
        >
          <p className="text-sm text-[var(--muted-foreground)] mb-3">
            Bloqueia {slot.startsAtClock}–{blockEndFor(slot, reservedMinutes)}, o mesmo intervalo que
            um cliente ocuparia aqui.
          </p>
          <label htmlFor="slot-reason" className="block text-xs font-semibold tracking-widest uppercase text-[var(--muted-foreground)] mb-1.5">
            Motivo
          </label>
          <Input id="slot-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={160} placeholder="Consulta médica" autoFocus />
          {error ? <p role="alert" className="text-xs text-red-400 mt-2">{error}</p> : null}
          <Button type="submit" className="w-full mt-4" disabled={busy}>
            <Lock className="h-4 w-4 mr-1.5" /> {busy ? 'Bloqueando…' : 'Bloquear horário'}
          </Button>
        </form>
      ) : slot.reason === 'BLOCK' && slot.blockId ? (
        <>
          {slot.blockReason ? (
            <p className="text-sm text-[var(--muted-foreground)] mb-2">Motivo: {slot.blockReason}</p>
          ) : null}
          <p className="text-sm text-[var(--muted-foreground)] mb-4">
            Liberar desfaz o bloqueio inteiro, que pode cobrir mais horários que este.
          </p>
          {error ? <p role="alert" className="text-xs text-red-400 mb-2">{error}</p> : null}
          <Button className="w-full" disabled={busy} onClick={() => void run(() => deleteBlock(slot.blockId!))}>
            <Unlock className="h-4 w-4 mr-1.5" /> {busy ? 'Liberando…' : 'Liberar horário'}
          </Button>
        </>
      ) : slot.reason === 'APPOINTMENT' ? (
        <>
          <p className="text-sm text-[var(--muted-foreground)] mb-4">
            Há cliente marcado neste horário. Desmarcar passa pelo cancelamento no
            agendamento, que avisa quem ia ser atendido — não por um bloqueio.
          </p>
          {slot.appointmentId ? (
            <Button asChild className="w-full">
              <Link to={`/admin/agenda/${slot.appointmentId}`}>Ver agendamento</Link>
            </Button>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">
          {slot.reason === 'PAST'
            ? 'Esse horário já passou.'
            : 'Esse horário não cabe no expediente deste dia.'}
        </p>
      )}
    </Modal>
  )
}

function RangeDialog({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal titleId="range-dialog" onClose={onClose}>
      <h2 id="range-dialog" className="text-lg font-bold mb-1">Bloquear intervalo</h2>
      <p className="text-sm text-[var(--muted-foreground)] mb-4">
        {dayLabel(date)}. Todo horário que o intervalo encostar fica indisponível.
      </p>
      <form
        onSubmit={event => {
          event.preventDefault()
          if (!/^\d{2}:\d{2}$/.test(startsAt) || !/^\d{2}:\d{2}$/.test(endsAt)) {
            setError('Use o formato HH:MM.')
            return
          }
          if (startsAt >= endsAt) {
            setError('O fim deve ser depois do início.')
            return
          }
          if (reason.trim().length < 2) {
            setError('Descreva o motivo.')
            return
          }
          setBusy(true); setError(null)
          createBlock({ date, startsAt, endsAt, reason: reason.trim() })
            .then(onDone)
            .catch(err => {
              setError(err instanceof ApiError ? err.message : 'Não foi possível bloquear.')
              setBusy(false)
            })
        }}
      >
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label htmlFor="range-start" className="block text-xs font-semibold tracking-widest uppercase text-[var(--muted-foreground)] mb-1.5">Início</label>
            <Input id="range-start" type="time" value={startsAt} onChange={event => setStartsAt(event.target.value)} autoFocus />
          </div>
          <div>
            <label htmlFor="range-end" className="block text-xs font-semibold tracking-widest uppercase text-[var(--muted-foreground)] mb-1.5">Fim</label>
            <Input id="range-end" type="time" value={endsAt} onChange={event => setEndsAt(event.target.value)} />
          </div>
        </div>
        <label htmlFor="range-reason" className="block text-xs font-semibold tracking-widest uppercase text-[var(--muted-foreground)] mb-1.5">Motivo</label>
        <Input id="range-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={160} placeholder="Entrega de material" />
        {error ? <p role="alert" className="text-xs text-red-400 mt-2">{error}</p> : null}
        <div className="flex gap-2 mt-4">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={busy}>{busy ? 'Bloqueando…' : 'Bloquear'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function WholeDayDialog({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal titleId="day-dialog" onClose={onClose}>
      <h2 id="day-dialog" className="text-lg font-bold mb-1">Bloquear o dia</h2>
      <p className="text-sm text-[var(--muted-foreground)] mb-4">
        {dayLabel(date)} fica sem horário para agendar.
      </p>
      <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-3 mb-4 flex gap-2.5">
        <Clock className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-200">
          Agendamento já marcado continua valendo. Bloquear o dia não avisa ninguém —
          para desmarcar, cancele cada agendamento.
        </p>
      </div>
      <form
        onSubmit={event => {
          event.preventDefault()
          if (reason.trim().length < 2) {
            setError('Descreva o motivo.')
            return
          }
          setBusy(true); setError(null)
          blockWholeDay({ date, reason: reason.trim() })
            .then(onDone)
            .catch(err => {
              setError(err instanceof ApiError ? err.message : 'Não foi possível bloquear o dia.')
              setBusy(false)
            })
        }}
      >
        <label htmlFor="day-reason" className="block text-xs font-semibold tracking-widest uppercase text-[var(--muted-foreground)] mb-1.5">Motivo</label>
        <Input id="day-reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={160} placeholder="Feriado" autoFocus />
        {error ? <p role="alert" className="text-xs text-red-400 mt-2">{error}</p> : null}
        <div className="flex gap-2 mt-4">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="flex-1" disabled={busy}>{busy ? 'Bloqueando…' : 'Bloquear o dia'}</Button>
        </div>
      </form>
    </Modal>
  )
}
