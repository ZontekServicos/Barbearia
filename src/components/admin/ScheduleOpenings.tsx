import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle, CalendarPlus, Check, ChevronDown, Copy, Plus, RefreshCw, Trash2, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/Modal'
import { ApiError } from '@/services/api'
import {
  copyOpenings,
  listDateOverrides,
  listOpenings,
  removeDateOverride,
  saveDateOverride,
  saveWeekdayOpenings,
  type DateOverride,
} from '@/services/admin-booking'
import type { BusinessHoursDay, OpeningRange } from '@/services/booking'
import { addDaysISO } from '@/lib/week'
import { cn } from '@/lib/utils'

/**
 * ABERTURA DA AGENDA.
 *
 * A agenda é FECHADA por padrão: nada aqui "libera" horário ocupado, e nada
 * aqui cancela agendamento. Esta tela só declara QUANDO a barbearia aceita
 * agendamento novo.
 *
 * Um dia é um card (accordion), não uma linha de tabela: sete dias × várias
 * faixas numa tabela de 360px vira rolagem horizontal, que é a pior forma de
 * editar horário no celular.
 */

const WEEKDAYS = [
  { weekday: 1, label: 'Segunda', short: 'Seg' },
  { weekday: 2, label: 'Terça', short: 'Ter' },
  { weekday: 3, label: 'Quarta', short: 'Qua' },
  { weekday: 4, label: 'Quinta', short: 'Qui' },
  { weekday: 5, label: 'Sexta', short: 'Sex' },
  { weekday: 6, label: 'Sábado', short: 'Sáb' },
  { weekday: 0, label: 'Domingo', short: 'Dom' },
]

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const todayISO = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
/** Rótulo de data sem criar `Date` no corpo do componente (ver `lib/week`). */
function dateLabel(dateISO: string) {
  const [, month, day] = dateISO.split('-')
  return `${day} de ${MONTHS[Number(month) - 1]}`
}

const describe = (ranges: OpeningRange[]) =>
  ranges.length === 0
    ? 'Fechado'
    : ranges.map(range => `${range.opensAt}–${range.closesAt}`).join(' · ')

/**
 * Validação local, espelhando a do servidor.
 *
 * O servidor valida de novo e o banco tem constraint — esta existe só para o
 * erro aparecer antes de uma ida à rede. Nunca é a autoridade.
 */
function rangeProblem(ranges: OpeningRange[]): string | null {
  for (const range of ranges) {
    if (!/^\d{2}:\d{2}$/.test(range.opensAt) || !/^\d{2}:\d{2}$/.test(range.closesAt)) {
      return 'Preencha as duas horas de cada faixa.'
    }
    if (range.closesAt <= range.opensAt) {
      return `O fim (${range.closesAt}) deve ser depois do início (${range.opensAt}).`
    }
  }
  const ordered = [...ranges].sort((a, b) => a.opensAt.localeCompare(b.opensAt))
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1]!
    const current = ordered[index]!
    if (current.opensAt < previous.closesAt) {
      return current.opensAt === previous.opensAt && current.closesAt === previous.closesAt
        ? 'Há faixas repetidas.'
        : `As faixas ${previous.opensAt}–${previous.closesAt} e ${current.opensAt}–${current.closesAt} se sobrepõem.`
    }
  }
  return null
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; days: BusinessHoursDay[]; overrides: DateOverride[] }
  | { kind: 'error'; message: string }

export default function ScheduleOpenings() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)
  const [open, setOpen] = useState<number | null>(null)
  const [copying, setCopying] = useState<{ weekday: number; ranges: OpeningRange[] } | null>(null)
  const [addingDate, setAddingDate] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    const horizon = addDaysISO(todayISO(), 180)
    Promise.all([listOpenings(), listDateOverrides(todayISO(), horizon)])
      .then(([days, overrides]) => {
        if (alive) setState({ kind: 'ready', days, overrides })
      })
      .catch(error => {
        if (alive) {
          setState({
            kind: 'error',
            message: error instanceof ApiError ? error.message : 'Não foi possível carregar a agenda.',
          })
        }
      })
    return () => { alive = false }
  }, [reloadToken])

  const reload = useCallback(() => setReloadToken(token => token + 1), [])
  const announce = useCallback((message: string) => {
    setToast(message)
    setTimeout(() => setToast(null), 4000)
  }, [])

  const ready = state.kind === 'ready' ? state : null

  return (
    <section aria-labelledby="openings-heading">
      {toast && (
        <div role="status" className="mb-4 rounded-xl border border-green-500/40 bg-green-500/10 px-3.5 py-2.5 text-sm text-green-300">
          {toast}
        </div>
      )}

      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 id="openings-heading" className="text-base font-semibold">Abertura da agenda</h2>
        <Button variant="ghost" size="sm" onClick={reload}>
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', state.kind === 'loading' && 'animate-spin')} />
          Atualizar
        </Button>
      </div>
      <p className="text-sm text-[var(--muted-foreground)] mb-4">
        A agenda começa fechada. Só os horários abertos aqui aceitam agendamento novo —
        agendamento que já existe continua valendo.
      </p>

      {state.kind === 'error' ? (
        <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 p-5 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm mb-3">{state.message}</p>
          <Button variant="outline" size="sm" onClick={reload}>Tentar novamente</Button>
        </div>
      ) : state.kind === 'loading' ? (
        <p role="status" className="py-8 text-center text-sm text-[var(--muted-foreground)]">
          Carregando a agenda…
        </p>
      ) : (
        <>
          <ul className="space-y-2.5 mb-8">
            {WEEKDAYS.map(({ weekday, label }) => {
              const day = ready!.days.find(entry => entry.weekday === weekday)
              const ranges = day?.ranges ?? []
              const expanded = open === weekday
              return (
                <li key={weekday} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`day-${weekday}`}
                    onClick={() => setOpen(expanded ? null : weekday)}
                    className="w-full min-h-14 flex items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{label}</span>
                      <span
                        className={cn(
                          'block text-xs tabular-nums mt-0.5',
                          ranges.length === 0
                            ? 'text-[var(--muted-foreground)]'
                            : 'text-[var(--primary)]',
                        )}
                      >
                        {describe(ranges)}
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        'h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform',
                        expanded && 'rotate-180',
                      )}
                    />
                  </button>
                  {expanded && (
                    <div id={`day-${weekday}`} className="border-t border-[var(--border)] px-4 py-4">
                      <DayEditor
                        label={label}
                        initial={ranges}
                        onCopy={current => setCopying({ weekday, ranges: current })}
                        onSaved={(days, outside) => {
                          setState(current =>
                            current.kind === 'ready' ? { ...current, days } : current,
                          )
                          announce(
                            outside > 0
                              ? `${label} salvo. Existem ${outside} agendamento(s) dentro do período fechado. Eles não serão cancelados.`
                              : `${label} salvo.`,
                          )
                        }}
                        onSave={ranges => saveWeekdayOpenings(weekday, ranges)}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="flex items-start justify-between gap-3 mb-1">
            <h3 className="text-base font-semibold">Exceções por data</h3>
            <Button variant="outline" size="sm" onClick={() => setAddingDate(true)}>
              <CalendarPlus className="h-3.5 w-3.5 mr-1.5" /> Nova data
            </Button>
          </div>
          <p className="text-sm text-[var(--muted-foreground)] mb-3">
            Uma data com exceção ignora a regra da semana — para fechar um feriado ou abrir
            um horário diferente.
          </p>

          {ready!.overrides.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">Nenhuma exceção programada.</p>
          ) : (
            <ul className="space-y-2">
              {ready!.overrides.map(override => (
                <li
                  key={override.date}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3.5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums">{dateLabel(override.date)}</p>
                    <p
                      className={cn(
                        'text-xs tabular-nums',
                        override.ranges.length === 0
                          ? 'text-red-300'
                          : 'text-[var(--primary)]',
                      )}
                    >
                      {describe(override.ranges)}
                    </p>
                    {override.note && (
                      <p className="text-xs text-[var(--muted-foreground)] truncate">{override.note}</p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    aria-label={`Remover exceção de ${dateLabel(override.date)}`}
                    onClick={async () => {
                      await removeDateOverride(override.date)
                      announce(`Exceção de ${dateLabel(override.date)} removida. A data volta à regra da semana.`)
                      reload()
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remover
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {copying && (
        <CopyDialog
          from={copying.weekday}
          ranges={copying.ranges}
          onClose={() => setCopying(null)}
          onDone={(days, count) => {
            setCopying(null)
            setState(current => (current.kind === 'ready' ? { ...current, days } : current))
            announce(`Horários copiados para ${count} dia(s).`)
          }}
        />
      )}
      {addingDate && (
        <DateOverrideDialog
          onClose={() => setAddingDate(false)}
          onDone={(message) => {
            setAddingDate(false)
            announce(message)
            reload()
          }}
        />
      )}
    </section>
  )
}

/** Editor das faixas de UM dia. Salvar substitui o dia inteiro. */
function DayEditor({
  label, initial, onSave, onSaved, onCopy,
}: {
  label: string
  initial: OpeningRange[]
  onSave: (ranges: OpeningRange[]) => Promise<{ days: BusinessHoursDay[]; appointmentsOutside: number }>
  onSaved: (days: BusinessHoursDay[], appointmentsOutside: number) => void
  onCopy: (ranges: OpeningRange[]) => void
}) {
  const [ranges, setRanges] = useState<OpeningRange[]>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (index: number, patch: Partial<OpeningRange>) =>
    setRanges(current => current.map((range, at) => (at === index ? { ...range, ...patch } : range)))

  const openDay = ranges.length > 0

  return (
    <div>
      {/*
        O toggle é o próprio conteúdo: dia sem faixa É dia fechado. Um booleano
        separado poderia discordar das faixas — "ativo" com zero faixas não
        significaria nada.
      */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-sm font-medium">{openDay ? 'Atendendo' : 'Fechado'}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={openDay}
          onClick={() =>
            setRanges(openDay ? [] : [{ opensAt: '09:00', closesAt: '18:00' }])
          }
        >
          {openDay ? 'Fechar o dia' : 'Abrir o dia'}
        </Button>
      </div>

      {ranges.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)] mb-3">
          Sem faixa aberta, {label} não aceita agendamento.
        </p>
      ) : (
        <ul className="space-y-2.5 mb-3">
          {ranges.map((range, index) => (
            <li key={index} className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <label htmlFor={`start-${label}-${index}`} className="block text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">
                  Início
                </label>
                <Input
                  id={`start-${label}-${index}`}
                  type="time"
                  value={range.opensAt}
                  onChange={event => update(index, { opensAt: event.target.value })}
                />
              </div>
              <div className="flex-1 min-w-0">
                <label htmlFor={`end-${label}-${index}`} className="block text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">
                  Fim
                </label>
                <Input
                  id={`end-${label}-${index}`}
                  type="time"
                  value={range.closesAt}
                  onChange={event => update(index, { closesAt: event.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover intervalo ${range.opensAt}–${range.closesAt}`}
                onClick={() => setRanges(current => current.filter((_unused, at) => at !== index))}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setRanges(current => [...current, { opensAt: '', closesAt: '' }])
          }
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Adicionar intervalo
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onCopy(ranges)}>
          <Copy className="h-3.5 w-3.5 mr-1.5" /> Copiar horários para…
        </Button>
      </div>

      {error && <p role="alert" className="text-xs text-red-400 mt-2">{error}</p>}

      <Button
        type="button"
        className="w-full h-11 mt-4"
        disabled={saving}
        onClick={async () => {
          const problem = rangeProblem(ranges)
          if (problem) {
            setError(problem)
            return
          }
          setSaving(true)
          setError(null)
          try {
            const result = await onSave(ranges)
            onSaved(result.days, result.appointmentsOutside)
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.')
          } finally {
            setSaving(false)
          }
        }}
      >
        <Check className="h-4 w-4 mr-1.5" /> {saving ? 'Salvando…' : 'Salvar'}
      </Button>
    </div>
  )
}

function CopyDialog({
  from, ranges, onClose, onDone,
}: {
  from: number
  ranges: OpeningRange[]
  onClose: () => void
  onDone: (days: BusinessHoursDay[], count: number) => void
}) {
  const [targets, setTargets] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const source = WEEKDAYS.find(day => day.weekday === from)!

  return (
    <Modal titleId="copy-openings" onClose={onClose}>
      <h2 id="copy-openings" className="text-lg font-bold mb-1">Copiar horários</h2>
      <p className="text-sm text-[var(--muted-foreground)] mb-1">
        De <strong className="text-[var(--foreground)]">{source.label}</strong>: {describe(ranges)}
      </p>
      {/* Substituição, não soma: é o que "copiar para" significa, e tem de
          estar dito antes do clique. */}
      <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-3 my-3 flex gap-2.5">
        <AlertCircle className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-200">
          Os horários dos dias escolhidos serão <strong>substituídos</strong>. Agendamento
          que já existe não é cancelado.
        </p>
      </div>

      <fieldset className="mb-4">
        <legend className="text-xs font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-2">
          Copiar para
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {WEEKDAYS.filter(day => day.weekday !== from).map(day => {
            const checked = targets.includes(day.weekday)
            return (
              <label
                key={day.weekday}
                className={cn(
                  'min-h-11 flex items-center gap-2 rounded-xl border px-3 cursor-pointer',
                  checked
                    ? 'border-[var(--primary)] bg-[var(--primary)]/10'
                    : 'border-[var(--border)]',
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--primary)]"
                  checked={checked}
                  onChange={event =>
                    setTargets(current =>
                      event.target.checked
                        ? [...current, day.weekday]
                        : current.filter(weekday => weekday !== day.weekday),
                    )
                  }
                />
                <span className="text-sm">{day.label}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {error && <p role="alert" className="text-xs text-red-400 mb-2">{error}</p>}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button
          className="flex-1"
          disabled={busy || targets.length === 0}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              const days = await copyOpenings(from, targets)
              onDone(days, targets.length)
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Não foi possível copiar.')
              setBusy(false)
            }
          }}
        >
          {busy ? 'Copiando…' : 'Substituir e copiar'}
        </Button>
      </div>
    </Modal>
  )
}

function DateOverrideDialog({
  onClose, onDone,
}: {
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [date, setDate] = useState('')
  const [mode, setMode] = useState<'CLOSED' | 'OPEN'>('CLOSED')
  const [ranges, setRanges] = useState<OpeningRange[]>([{ opensAt: '09:00', closesAt: '13:00' }])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal titleId="date-override" onClose={onClose}>
      <h2 id="date-override" className="text-lg font-bold mb-1">Exceção por data</h2>
      <p className="text-sm text-[var(--muted-foreground)] mb-4">
        Vale só nesta data e ignora a regra da semana.
      </p>

      <label htmlFor="override-date" className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-1.5">
        Data
      </label>
      <Input id="override-date" type="date" value={date} min={todayISO()} onChange={event => setDate(event.target.value)} />

      <fieldset className="mt-4">
        <legend className="text-xs font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-2">
          Nesta data
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {([['CLOSED', 'Fechado'], ['OPEN', 'Horário especial']] as const).map(([value, label]) => (
            <label
              key={value}
              className={cn(
                'min-h-11 flex items-center gap-2 rounded-xl border px-3 cursor-pointer',
                mode === value ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--border)]',
              )}
            >
              <input
                type="radio"
                name="override-mode"
                className="h-4 w-4 accent-[var(--primary)]"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'OPEN' && (
        <ul className="space-y-2.5 mt-3">
          {ranges.map((range, index) => (
            <li key={index} className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <label htmlFor={`override-start-${index}`} className="block text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">
                  Início
                </label>
                <Input
                  id={`override-start-${index}`}
                  type="time"
                  value={range.opensAt}
                  onChange={event =>
                    setRanges(current =>
                      current.map((entry, at) => (at === index ? { ...entry, opensAt: event.target.value } : entry)),
                    )
                  }
                />
              </div>
              <div className="flex-1 min-w-0">
                <label htmlFor={`override-end-${index}`} className="block text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">
                  Fim
                </label>
                <Input
                  id={`override-end-${index}`}
                  type="time"
                  value={range.closesAt}
                  onChange={event =>
                    setRanges(current =>
                      current.map((entry, at) => (at === index ? { ...entry, closesAt: event.target.value } : entry)),
                    )
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover intervalo ${range.opensAt}–${range.closesAt}`}
                onClick={() => setRanges(current => current.filter((_unused, at) => at !== index))}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
          <li>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRanges(current => [...current, { opensAt: '', closesAt: '' }])}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Adicionar intervalo
            </Button>
          </li>
        </ul>
      )}

      <label htmlFor="override-note" className="block text-xs font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-1.5 mt-4">
        Motivo (opcional)
      </label>
      <Input id="override-note" value={note} maxLength={160} placeholder="Feriado" onChange={event => setNote(event.target.value)} />

      {error && <p role="alert" className="text-xs text-red-400 mt-2">{error}</p>}

      <div className="flex gap-2 mt-4">
        <Button variant="outline" className="flex-1" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button
          className="flex-1"
          disabled={busy}
          onClick={async () => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
              setError('Escolha uma data.')
              return
            }
            const payload = mode === 'CLOSED' ? [] : ranges
            const problem = mode === 'CLOSED' ? null : rangeProblem(payload)
            if (problem) {
              setError(problem)
              return
            }
            setBusy(true)
            setError(null)
            try {
              const result = await saveDateOverride({
                date,
                ranges: payload,
                ...(note.trim() ? { note: note.trim() } : {}),
              })
              onDone(
                result.appointmentsOutside > 0
                  ? `Exceção salva. Existem ${result.appointmentsOutside} agendamento(s) dentro deste período. Eles não serão cancelados.`
                  : 'Exceção salva.',
              )
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a exceção.')
              setBusy(false)
            }
          }}
        >
          {busy ? 'Salvando…' : 'Salvar exceção'}
        </Button>
      </div>
    </Modal>
  )
}
