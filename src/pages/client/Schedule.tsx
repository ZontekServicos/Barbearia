import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Check, Scissors, Clock,
  CalendarCheck, ChevronLeft, ChevronRight, AlertCircle, RefreshCw
} from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, isToday, isBefore, startOfDay, addMonths,
  subMonths, getDay
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/services/api'
import {
  createAppointment,
  getAvailability,
  listBusinessHours,
  listServices,
  type Appointment,
  type AvailableSlot,
  type BusinessHoursDay,
  type Service,
} from '@/services/booking'
import { cn } from '@/lib/utils'
import { useAuth, type AuthStatus } from '@/context/AuthContext'
import {
  clearBookingIntent,
  readBookingIntent,
  saveBookingIntent,
} from '@/services/booking-intent'

type Step = 'service' | 'date' | 'time' | 'confirm' | 'success'

const STEPS: { key: Step; label: string }[] = [
  { key: 'service', label: 'Serviço' },
  { key: 'date', label: 'Data' },
  { key: 'time', label: 'Horário' },
  { key: 'confirm', label: 'Confirmar' },
]

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

/** Estado de carregamento padrão das etapas. */
function LoadingState({ label }: { label: string }) {
  return (
    <p role="status" className="text-sm text-[var(--muted-foreground)] py-6 text-center">
      {label}
    </p>
  )
}

/** Erro real da API, com opção de tentar de novo. Nunca cai para dados locais. */
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="border border-red-500/40 bg-red-500/10 rounded-2xl p-5 text-center"
    >
      <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
      <p className="text-sm text-red-200 mb-4">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
        Tentar novamente
      </Button>
    </div>
  )
}

function StepProgress({ current }: { current: Step }) {
  const steps = STEPS
  const currentIndex = steps.findIndex(s => s.key === current)
  return (
    <div className="flex items-center gap-1 mb-8">
      {steps.map((step, i) => {
        const done = i < currentIndex
        const active = i === currentIndex
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all',
                done && 'bg-[var(--primary)] text-black',
                active && 'bg-[var(--primary)]/20 border-2 border-[var(--primary)] text-[var(--primary)]',
                !done && !active && 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
              )}>
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span className={cn(
                'text-xs mt-1 font-medium hidden sm:block',
                active ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'
              )}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn(
                'flex-1 h-px mx-2 sm:mt-[-14px]',
                i < currentIndex ? 'bg-[var(--primary)]/60' : 'bg-[var(--border)]'
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function ServiceStep({ onSelect }: { onSelect: (s: Service) => void }) {
  const [services, setServices] = useState<Service[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setServices(await listServices())
    } catch (err) {
      setError(describeError(err, 'Não foi possível carregar os serviços.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">Escolha o serviço</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">Selecione o que você precisa hoje.</p>
      </div>

      {loading ? (
        <LoadingState label="Carregando serviços…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : services.length === 0 ? (
        <div className="border border-dashed border-[var(--primary)]/25 bg-[var(--surface-bronze)] rounded-2xl p-8 text-center">
          <Scissors className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
          <p className="text-sm text-[var(--muted-foreground)]">
            Nenhum serviço disponível no momento.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3 mb-6">
            {services.map(service => (
              <button
                key={service.id}
                aria-pressed={selected === service.id}
                onClick={() => setSelected(service.id)}
                className={cn(
                  'w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left',
                  selected === service.id
                    ? 'border-[var(--primary)] bg-[var(--primary)]/12'
                    : 'border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] hover:border-[var(--primary)]/45'
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-10 h-10 rounded-full border flex items-center justify-center transition-colors',
                    selected === service.id
                      ? 'border-[var(--primary)]/50 bg-[var(--primary)]/25'
                      : 'border-[var(--primary)]/30 bg-[var(--primary)]/10'
                  )}>
                    <Scissors className={cn('h-5 w-5', selected === service.id ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]')} />
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">{service.name}</p>
                    <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] mt-0.5">
                      <Clock className="h-3 w-3" />
                      <span>{service.durationMinutes} min</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[var(--primary)]">R$ {service.priceFormatted}</span>
                  {selected === service.id && (
                    <div className="w-5 h-5 rounded-full bg-[var(--primary)] flex items-center justify-center">
                      <Check className="h-3 w-3 text-black" />
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>

          <Button
            className="w-full h-12"
            disabled={!selected}
            onClick={() => {
              const service = services.find(s => s.id === selected)
              if (service) onSelect(service)
            }}
          >
            Continuar
          </Button>
        </>
      )}
    </div>
  )
}

function DateStep({ onSelect, onBack }: { onSelect: (d: Date) => void; onBack: () => void }) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selected, setSelected] = useState<Date | null>(null)
  const [week, setWeek] = useState<BusinessHoursDay[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = startOfDay(new Date())

  const load = useCallback(async () => {
    setError(null)
    try {
      setWeek(await listBusinessHours())
    } catch (err) {
      setError(describeError(err, 'Não foi possível carregar o funcionamento da barbearia.'))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  })

  const firstDayOfWeek = getDay(startOfMonth(currentMonth))
  const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

  // Dias fechados vêm do expediente real, não de uma constante local.
  const isDisabled = (day: Date) => {
    if (isBefore(day, today)) return true
    const config = week?.find(entry => entry.weekday === getDay(day))
    return config?.closed ?? false
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button aria-label="Voltar à etapa anterior" onClick={onBack} className="min-h-11 min-w-11 inline-flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Escolha a data</h2>
          <p className="text-sm text-[var(--muted-foreground)]">Selecione um dia disponível.</p>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !week ? (
        <LoadingState label="Carregando calendário…" />
      ) : (
        <>
          <div className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-4 mb-6">
            <div className="flex items-center justify-between mb-4">
              <button
                aria-label="Mês anterior"
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-[var(--primary)]/10 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-semibold text-sm capitalize">
                {format(currentMonth, "MMMM 'de' yyyy", { locale: ptBR })}
              </span>
              <button
                aria-label="Próximo mês"
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="min-h-11 min-w-11 inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-[var(--primary)]/10 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-px sm:gap-0.5 -mx-3 sm:mx-0 mb-2">
              {weekDays.map(d => (
                <div key={d} className="text-center text-xs text-[var(--muted-foreground)] font-medium py-1">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-px sm:gap-0.5 -mx-3 sm:mx-0">
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {days.map(day => {
                const disabled = isDisabled(day)
                const sel = selected && isSameDay(day, selected)
                const todayDay = isToday(day)
                return (
                  <button
                    key={day.toISOString()}
                    aria-label={format(day, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                    aria-pressed={!!sel}
                    disabled={disabled}
                    onClick={() => setSelected(day)}
                    className={cn(
                      'aspect-square min-h-11 flex items-center justify-center text-sm rounded-lg transition-all',
                      sel && 'bg-[var(--primary)] text-black font-bold',
                      !sel && todayDay && 'border border-[var(--primary)]/50 text-[var(--primary)]',
                      !sel && !disabled && !todayDay && 'hover:bg-[var(--primary)]/10 text-[var(--foreground)]',
                      disabled && 'text-[var(--muted-foreground)]/40 cursor-not-allowed'
                    )}
                  >
                    {format(day, 'd')}
                  </button>
                )
              })}
            </div>
          </div>

          <Button
            className="w-full h-12"
            disabled={!selected}
            onClick={() => selected && onSelect(selected)}
          >
            Continuar
          </Button>
        </>
      )}
    </div>
  )
}

/**
 * Agrupa os horários em manhã, tarde e noite.
 *
 * Com grade de 15 minutos um dia cheio passa de 30 opções; em tela de celular
 * isso vira uma parede de números. Os cortes seguem o uso comum no Brasil e
 * períodos vazios simplesmente não aparecem.
 */
function groupByPeriod(slots: AvailableSlot[]) {
  const periods: Array<{ label: string; until: number; entries: AvailableSlot[] }> = [
    { label: 'Manhã', until: 12 * 60, entries: [] },
    { label: 'Tarde', until: 18 * 60, entries: [] },
    { label: 'Noite', until: 24 * 60, entries: [] },
  ]

  for (const slot of slots) {
    const [hour, minute] = slot.startsAtClock.split(':').map(Number)
    const total = hour! * 60 + minute!
    const period = periods.find(entry => total < entry.until) ?? periods[periods.length - 1]!
    period.entries.push(slot)
  }

  return periods.filter(period => period.entries.length > 0)
}

/** Motivos que o backend devolve quando não há horários. */
const EMPTY_REASON: Record<string, string> = {
  CLOSED: 'A barbearia está fechada nesta data.',
  PAST_DATE: 'Essa data já passou.',
  TOO_FAR: 'Ainda não é possível agendar tão longe.',
  FULLY_BOOKED: 'Todos os horários deste dia já foram reservados.',
}

function TimeStep({
  date,
  service,
  onSelect,
  onBack,
}: {
  date: Date
  service: Service
  onSelect: (slot: AvailableSlot) => void
  onBack: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [slots, setSlots] = useState<AvailableSlot[] | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dateISO = format(date, 'yyyy-MM-dd')

  const load = useCallback(async () => {
    setError(null)
    setSlots(null)
    try {
      const availability = await getAvailability(dateISO, service.id)
      setSlots(availability.slots)
      setReason(availability.reason)
    } catch (err) {
      setError(describeError(err, 'Não foi possível carregar os horários.'))
    }
  }, [dateISO, service.id])

  useEffect(() => { void load() }, [load])

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button aria-label="Voltar à etapa anterior" onClick={onBack} className="min-h-11 min-w-11 inline-flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Escolha o horário</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {format(date, "EEEE, dd 'de' MMMM", { locale: ptBR })} · {service.durationMinutes} min
          </p>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : slots === null ? (
        <LoadingState label="Buscando horários livres…" />
      ) : slots.length === 0 ? (
        <div className="border border-dashed border-[var(--primary)]/25 bg-[var(--surface-bronze)] rounded-2xl p-8 text-center">
          <Clock className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
          <p className="text-sm text-[var(--muted-foreground)] mb-4">
            {(reason && EMPTY_REASON[reason]) ?? 'Nenhum horário disponível nesta data.'}
          </p>
          <Button variant="outline" size="sm" onClick={onBack}>
            Escolher outra data
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-5 mb-6">
            {groupByPeriod(slots).map(({ label, entries }) => (
              <div key={label}>
                <h3 className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-2.5">
                  {label}
                </h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                  {entries.map(slot => {
                    const isSelected = selected === slot.startsAtClock
                    return (
                      <button
                        key={slot.startsAtClock}
                        aria-pressed={isSelected}
                        onClick={() => setSelected(slot.startsAtClock)}
                        className={cn(
                          'min-h-12 py-3.5 rounded-xl text-sm font-semibold tabular-nums border-2 transition-all',
                          isSelected
                            ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]'
                            : 'border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/10 text-[var(--foreground)]'
                        )}
                      >
                        {slot.startsAtClock}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <Button
            className="w-full h-12"
            disabled={!selected}
            onClick={() => {
              const slot = slots.find(entry => entry.startsAtClock === selected)
              if (slot) onSelect(slot)
            }}
          >
            Continuar
          </Button>
        </>
      )}
    </div>
  )
}

function ConfirmStep({
  service,
  date,
  slot,
  onConfirm,
  onBack,
  loading,
  error,
  authStatus,
}: {
  service: Service
  date: Date
  slot: AvailableSlot
  onConfirm: () => void
  onBack: () => void
  loading: boolean
  error: string | null
  authStatus: AuthStatus
}) {
  const needsAccount = authStatus === 'unauthenticated' || authStatus === 'error'
  const awaitingApproval = authStatus === 'pendingApproval'
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button disabled={loading} aria-label="Voltar à etapa anterior" onClick={onBack} className="min-h-11 min-w-11 inline-flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Confirmar agendamento</h2>
          <p className="text-sm text-[var(--muted-foreground)]">Revise os detalhes abaixo.</p>
        </div>
      </div>

      <div className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl overflow-hidden mb-6">
        <div className="p-4 border-b border-[var(--primary)]/20 bg-[var(--primary)]/8">
          <div className="flex items-center gap-2 text-[var(--primary)] text-sm font-medium">
            <CalendarCheck className="h-4 w-4" />
            Resumo do agendamento
          </div>
        </div>
        <div className="p-4 space-y-3">
          {[
            { label: 'Serviço', value: service.name },
            { label: 'Data', value: format(date, "dd 'de' MMMM", { locale: ptBR }) },
            { label: 'Horário', value: `${slot.startsAtClock} – ${slot.endsAtClock}` },
            { label: 'Duração', value: `${service.durationMinutes} minutos` },
            { label: 'Valor', value: `R$ ${service.priceFormatted}`, highlight: true },
          ].map(({ label, value, highlight }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-sm text-[var(--muted-foreground)]">{label}</span>
              <span className={cn('text-sm font-semibold', highlight && 'text-[var(--primary)] text-base')}>
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      {needsAccount && (
        <p className="mb-4 rounded-lg border border-[var(--primary)]/35 bg-[var(--primary)]/8 px-3 py-2.5 text-sm text-[var(--foreground)]">
          Falta só identificar você. Sua escolha fica guardada — confirmamos a
          disponibilidade logo depois.
        </p>
      )}

      {awaitingApproval && (
        <p className="mb-4 rounded-lg border border-[var(--primary)]/35 bg-[var(--primary)]/8 px-3 py-2.5 text-sm text-[var(--foreground)]">
          Seu cadastro está em análise. A barbearia precisa aprovar seu acesso
          antes do primeiro agendamento — guardamos sua escolha até lá.
        </p>
      )}

      <Button className="w-full h-12 text-base" onClick={onConfirm} disabled={loading}>
        {loading
          ? 'Confirmando...'
          : needsAccount
            ? 'Entrar e confirmar'
            : awaitingApproval
              ? 'Ver situação do cadastro'
              : 'Confirmar agendamento'}
      </Button>
    </div>
  )
}

function SuccessStep({ appointment, onRestart }: { appointment: Appointment; onRestart: () => void }) {
  const navigate = useNavigate()
  const [year, month, day] = appointment.date.split('-')

  return (
    <div className="text-center py-6">
      <div className="w-20 h-20 rounded-full bg-[var(--primary)]/15 border-2 border-[var(--primary)]/40 flex items-center justify-center mx-auto mb-6">
        <Check className="h-10 w-10 text-[var(--primary)]" />
      </div>
      <h2 className="font-display text-2xl font-bold tracking-tight mb-2">Agendamento confirmado!</h2>
      <p className="text-[var(--muted-foreground)] text-sm mb-8">
        <span className="text-[var(--foreground)] font-medium">{appointment.serviceName}</span>{' '}
        no dia{' '}
        <span className="text-[var(--foreground)] font-medium">{day}/{month}/{year}</span>{' '}
        às <span className="text-[var(--foreground)] font-medium">{appointment.startsAtClock}</span>.
      </p>

      <div className="border border-[var(--primary)]/30 bg-[var(--primary)]/5 rounded-xl p-4 mb-8 text-left">
        <p className="text-xs text-[var(--muted-foreground)] mb-1">Lembrete</p>
        <p className="text-sm text-[var(--foreground)]">Chegue com 5 minutos de antecedência. Em caso de imprevisto, cancele com pelo menos 2 horas de antecedência.</p>
      </div>

      <div className="space-y-3">
        <Button className="w-full h-11" onClick={() => navigate('/client/appointments')}>
          Ver meus agendamentos
        </Button>
        <Button variant="outline" className="w-full h-11" onClick={onRestart}>
          Fazer outro agendamento
        </Button>
        <Button variant="ghost" className="w-full h-11 text-[var(--muted-foreground)]" onClick={() => navigate('/')}>
          Voltar ao início
        </Button>
      </div>
    </div>
  )
}

export default function Schedule() {
  const navigate = useNavigate()
  const { status } = useAuth()
  const [step, setStep] = useState<Step>('service')
  const [service, setService] = useState<Service | null>(null)
  const [date, setDate] = useState<Date | null>(null)
  const [slot, setSlot] = useState<AvailableSlot | null>(null)
  const [created, setCreated] = useState<Appointment | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const restored = useRef(false)

  /**
   * Retorno do login/cadastro: reconstrói a seleção que a pessoa já tinha
   * feito, em vez de mandá-la começar do zero.
   *
   * Reconstruir é só a parte visual. A confirmação continua passando pelo
   * backend, que revalida serviço, expediente, antecedência e — sobretudo —
   * se o horário ainda está livre. A EXCLUDE constraint no banco garante que
   * duas pessoas não fiquem com o mesmo horário, então uma intenção guardada
   * nunca vira reserva indevida.
   */
  useEffect(() => {
    if (restored.current || status === 'loading') return
    const intent = readBookingIntent()
    if (!intent) return

    let cancelled = false
    void (async () => {
      try {
        const services = await listServices()
        const chosen = services.find(entry => entry.id === intent.serviceId)
        if (cancelled) return
        if (!chosen) { restored.current = true; return clearBookingIntent() }

        const [year, month, day] = intent.date.split('-').map(Number)
        const chosenDate = new Date(year!, month! - 1, day!)

        // Revalidação real: o horário guardado só volta se ainda existir.
        const availability = await getAvailability(intent.date, chosen.id)
        const stillFree = availability.slots.find(
          entry => entry.startsAtClock === intent.startsAt,
        )
        if (cancelled) return

        restored.current = true
        setService(chosen)
        setDate(chosenDate)
        if (stillFree) {
          setSlot(stillFree)
          setStep('confirm')
        } else {
          setSlot(null)
          setStep('time')
          setNotice(
            'O horário que você tinha escolhido não está mais livre. Escolha outro.',
          )
        }
      } catch {
        if (!cancelled) setNotice('Não foi possível recuperar sua seleção. Recarregue para tentar novamente.')
      }
    })()

    return () => { cancelled = true }
  }, [status])

  /**
   * Sem atualização otimista: o agendamento só aparece como confirmado depois
   * que o backend cria. Entre listar e reservar, o horário pode ter sido
   * tomado por outra pessoa — e nesse caso voltamos para a escolha de horário.
   */
  async function handleConfirm() {
    if (!service || !date || !slot) return

    const dateISO = format(date, 'yyyy-MM-dd')
    const intent = {
      serviceId: service.id,
      date: dateISO,
      startsAt: slot.startsAtClock,
    }

    // Ainda sem sessão: guarda a seleção e manda autenticar.
    if (status === 'unauthenticated' || status === 'error') {
      saveBookingIntent(intent)
      return navigate('/login?next=%2Fagendar')
    }

    // Cadastro em análise: a política da barbearia exige aprovação antes do
    // primeiro agendamento, e ela vale no backend. Dizemos isso aqui em vez
    // de deixar o usuário bater num 403.
    if (status === 'pendingApproval') {
      saveBookingIntent(intent)
      return navigate('/conta/pendente')
    }

    if (status === 'blocked') return navigate('/conta/bloqueada')

    setLoading(true)
    setError(null)
    try {
      const appointment = await createAppointment(intent)
      clearBookingIntent()
      setCreated(appointment)
      setStep('success')
    } catch (err) {
      setError(describeError(err, 'Não foi possível confirmar o agendamento.'))
      // Conflito: alguém reservou antes. Volta para a lista já atualizada.
      if (err instanceof ApiError && err.status === 409) {
        setSlot(null)
        setStep('time')
      }
      // A conta deixou de estar apta entre abrir a tela e confirmar.
      if (err instanceof ApiError && err.code === 'ACCOUNT_PENDING') {
        saveBookingIntent(intent)
        navigate('/conta/pendente')
      }
    } finally {
      setLoading(false)
    }
  }

  function restart() {
    clearBookingIntent()
    setService(null)
    setDate(null)
    setSlot(null)
    setCreated(null)
    setError(null)
    setNotice(null)
    setStep('service')
  }

  if (step === 'success' && created) {
    return <SuccessStep appointment={created} onRestart={restart} />
  }

  return (
    <div>
      {step !== 'success' && <StepProgress current={step} />}

      {notice && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/10 px-3 py-2 text-sm text-[var(--primary-light)]"
        >
          {notice}
        </p>
      )}

      {step === 'time' && error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      {step === 'service' && (
        <ServiceStep
          onSelect={s => {
            // Trocar o serviço invalida o horário escolhido: um intervalo que
            // comportava 30 min pode não comportar 50. Guardá-lo em silêncio
            // levaria o cliente a confirmar algo que o backend vai recusar.
            if (service && service.id !== s.id && slot) {
              setSlot(null)
              setNotice('O horário foi limpo porque a duração do serviço mudou.')
            } else {
              setNotice(null)
            }
            setService(s)
            setStep('date')
          }}
        />
      )}
      {step === 'date' && (
        <DateStep onSelect={d => { setDate(d); setStep('time') }} onBack={() => setStep('service')} />
      )}
      {step === 'time' && date && service && (
        <TimeStep
          date={date}
          service={service}
          onSelect={s => { setSlot(s); setError(null); setNotice(null); setStep('confirm') }}
          onBack={() => setStep('date')}
        />
      )}
      {step === 'confirm' && service && date && slot && (
        <ConfirmStep
          service={service}
          date={date}
          slot={slot}
          onConfirm={handleConfirm}
          onBack={() => setStep('time')}
          loading={loading}
          error={error}
          authStatus={status}
        />
      )}
    </div>
  )
}
