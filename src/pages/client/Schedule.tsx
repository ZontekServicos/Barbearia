import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Check, Scissors, Clock, Phone, User, Hourglass,
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
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { looksLikeCompletePhone, maskPhone } from '@/lib/phone'
import {
  requestBooking,
  rememberRequestToken,
  registerContact,
  type ContactRegistration,
  getBookingPolicy,
  type BookingPolicy,
  type BookingRequestResult,
} from '@/services/public-booking'
import {
  clearBookingIntent,
  readBookingIntent,
  saveBookingIntent,
} from '@/services/booking-intent'

type Step = 'phone' | 'service' | 'date' | 'time' | 'confirm' | 'success'

const STEPS: { key: Step; label: string }[] = [
  { key: 'phone', label: 'Cadastro' },
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

function ServiceStep({ onSelect, onBack }: { onSelect: (s: Service) => void; onBack: () => void }) {
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
      <div className="flex items-center gap-3 mb-6">
        <button aria-label="Voltar à etapa anterior" onClick={onBack} className="min-h-11 min-w-11 inline-flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Escolha o serviço</h2>
          <p className="text-sm text-[var(--muted-foreground)]">Selecione o que você precisa hoje.</p>
        </div>
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
  fullName,
  phoneMasked,
  onConfirm,
  onBack,
  onEditContact,
  loading,
  error,
  requiresApproval,
}: {
  service: Service
  date: Date
  slot: AvailableSlot
  fullName: string
  /** Já mascarado pelo servidor: "(71) *****-6090". */
  phoneMasked: string
  onConfirm: () => void
  onBack: () => void
  onEditContact: () => void
  loading: boolean
  error: string | null
  requiresApproval: boolean
}) {
  // Reserva operacional: quanto a agenda bloqueia. Só é mencionada quando
  // difere da duração — e nunca no lugar dela. Um corte de 30 min é
  // apresentado como 30 min, sempre.
  const reserved = slot.reservedMinutes ?? service.durationMinutes
  const holdsLonger = reserved > service.durationMinutes

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button disabled={loading} aria-label="Voltar à etapa anterior" onClick={onBack} className="min-h-11 min-w-11 inline-flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {requiresApproval ? 'Revisar solicitação' : 'Confirmar agendamento'}
          </h2>
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
            <div key={label} className="flex items-center justify-between gap-3">
              <span className="text-sm text-[var(--muted-foreground)]">{label}</span>
              <span className={cn('text-sm font-semibold text-right', highlight && 'text-[var(--primary)] text-base')}>
                {value}
              </span>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-[var(--primary)]/20 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{fullName}</p>
            <p className="text-xs text-[var(--muted-foreground)] tabular-nums">{phoneMasked}</p>
          </div>
          <button
            type="button"
            onClick={onEditContact}
            disabled={loading}
            className="min-h-11 px-2 text-sm text-[var(--primary)] hover:text-[var(--primary-light)] transition-colors shrink-0"
          >
            Editar
          </button>
        </div>
      </div>

      {holdsLonger && (
        <p className="mb-4 text-xs text-[var(--muted-foreground)]">
          A barbearia reserva {reserved} minutos na agenda para este horário; seu
          atendimento dura {service.durationMinutes} minutos.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      {requiresApproval && (
        <p className="mb-4 rounded-lg border border-[var(--primary)]/35 bg-[var(--primary)]/8 px-3 py-2.5 text-sm text-[var(--foreground)]">
          A barbearia confirma cada pedido. Seu horário fica segurado enquanto
          isso; o atendimento ainda depende da aprovação.
        </p>
      )}

      <Button className="w-full h-12 text-base" onClick={onConfirm} disabled={loading}>
        {loading
          ? 'Enviando...'
          : requiresApproval
            ? 'Solicitar agendamento'
            : 'Confirmar agendamento'}
      </Button>
    </div>
  )
}

/**
 * Primeira etapa do agendamento: cadastro.
 *
 * Nome e WhatsApp bastam. Sem senha, sem código, sem e-mail. O contato é
 * gravado no backend ao continuar, então um telefone inválido é recusado aqui
 * — não cinco etapas adiante, quando a pessoa já escolheu tudo.
 */
function ContactStep({
  phone,
  fullName,
  onChangePhone,
  onChangeName,
  onContinue,
  loading,
  error,
}: {
  phone: string
  fullName: string
  onChangePhone: (value: string) => void
  onChangeName: (value: string) => void
  onContinue: () => void
  loading: boolean
  error: string | null
}) {
  const ready = looksLikeCompletePhone(phone) && fullName.trim().length >= 2

  return (
    <form
      onSubmit={event => { event.preventDefault(); if (ready && !loading) onContinue() }}
      className="space-y-4"
    >
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">Vamos começar?</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Informe seus dados para realizar o agendamento.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      <Input
        label="Nome completo"
        type="text"
        icon={<User className="h-4 w-4" />}
        placeholder="João Silva"
        value={fullName}
        onChange={event => onChangeName(event.target.value)}
        autoComplete="name"
        maxLength={120}
        required
      />

      <Input
        label="WhatsApp"
        type="tel"
        icon={<Phone className="h-4 w-4" />}
        placeholder="(71) 99999-9999"
        value={phone}
        onChange={event => onChangePhone(maskPhone(event.target.value))}
        autoComplete="tel"
        inputMode="tel"
        maxLength={24}
        required
      />

      <Button type="submit" className="w-full h-12 text-base" disabled={!ready || loading}>
        {loading ? 'Salvando...' : 'Continuar'}
      </Button>

      <p className="text-xs text-center text-[var(--muted-foreground)]">
        Sem senha e sem código. Usamos o número só para identificar seu
        atendimento.
      </p>
    </form>
  )
}

/**
 * Resultado da solicitação.
 *
 * Nunca diz "confirmado" quando o pedido ainda depende do barbeiro — a
 * diferença é o ponto inteiro da política de aprovação.
 */
function SuccessStep({
  result,
  policy,
  onRestart,
}: {
  result: BookingRequestResult
  policy: BookingPolicy | null
  onRestart: () => void
}) {
  const { appointment, awaitingApproval, pendingTtlMinutes } = result
  const [year, month, day] = appointment.date.split('-')

  return (
    <div className="text-center py-6">
      <div className={cn(
        'w-20 h-20 rounded-full border-2 flex items-center justify-center mx-auto mb-6',
        awaitingApproval
          ? 'bg-[var(--primary)]/10 border-[var(--primary)]/35'
          : 'bg-[var(--primary)]/15 border-[var(--primary)]/40',
      )}>
        {awaitingApproval
          ? <Hourglass className="h-9 w-9 text-[var(--primary)]" />
          : <Check className="h-10 w-10 text-[var(--primary)]" />}
      </div>

      <h2 className="font-display text-2xl font-bold tracking-tight mb-2">
        {awaitingApproval ? 'Solicitação enviada!' : 'Agendamento confirmado!'}
      </h2>

      <p className="text-[var(--muted-foreground)] text-sm mb-6">
        <span className="text-[var(--foreground)] font-medium">{appointment.serviceName}</span>{' '}
        no dia{' '}
        <span className="text-[var(--foreground)] font-medium">{day}/{month}/{year}</span>{' '}
        às <span className="text-[var(--foreground)] font-medium">{appointment.startsAtClock}</span>
        {' '}– {appointment.endsAtClock}.
      </p>

      <div className="border border-[var(--primary)]/30 bg-[var(--primary)]/5 rounded-xl p-4 mb-8 text-left">
        {awaitingApproval ? (
          <>
            <p className="text-xs text-[var(--muted-foreground)] mb-1">Ainda não está confirmado</p>
            <p className="text-sm text-[var(--foreground)]">
              A barbearia precisa confirmar seu pedido. Seguramos este horário
              por {Math.round(pendingTtlMinutes / 60)}h enquanto isso — depois
              disso ele volta a ficar disponível para outras pessoas.
            </p>
            {policy?.paymentRequired && (
              <p className="text-sm text-[var(--foreground)] mt-2">
                Assim que a barbearia aprovar, você terá{' '}
                {policy.paymentWindowMinutes} minutos para pagar e confirmar.
                Acompanhe por aqui.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-xs text-[var(--muted-foreground)] mb-1">Lembrete</p>
            <p className="text-sm text-[var(--foreground)]">
              Chegue com 5 minutos de antecedência. Em caso de imprevisto, avise
              a barbearia com antecedência.
            </p>
          </>
        )}
      </div>

      <div className="space-y-3">
        {/*
          O caminho principal daqui é ACOMPANHAR, não agendar de novo: é onde a
          aprovação, o pagamento e a confirmação aparecem. O token vai na URL
          para o link continuar valendo em outro dispositivo.
        */}
        <Button className="w-full h-11" asChild>
          <a href={`/agendamento/${encodeURIComponent(result.publicToken)}`}>
            Acompanhar meu agendamento
          </a>
        </Button>
        <Button variant="outline" className="w-full h-11" onClick={onRestart}>
          Fazer outro agendamento
        </Button>
        <Button variant="ghost" className="w-full h-11 text-[var(--muted-foreground)]" asChild>
          <a href="/">Voltar ao início</a>
        </Button>
      </div>
    </div>
  )
}

/**
 * Retomada de um agendamento interrompido.
 *
 * Aparece como ESCOLHA, nunca como redirecionamento automático. Antes, uma
 * seleção guardada jogava a pessoa direto na confirmação e ela não conseguia
 * mais trocar serviço nem horário — ficava presa no fim do fluxo.
 */
function ResumePrompt({
  onResume,
  onDiscard,
}: {
  onResume: () => void
  onDiscard: () => void
}) {
  return (
    <div className="border border-[var(--primary)]/25 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-5 mb-6">
      <h2 className="text-base font-semibold mb-1">Você tem um agendamento em andamento</h2>
      <p className="text-sm text-[var(--muted-foreground)] mb-4">
        Podemos retomar de onde você parou ou começar do zero.
      </p>
      <div className="space-y-2">
        <Button className="w-full h-11" onClick={onResume}>
          Continuar agendamento
        </Button>
        <Button variant="outline" className="w-full h-11" onClick={onDiscard}>
          Começar novo agendamento
        </Button>
      </div>
    </div>
  )
}

export default function Schedule() {
  // A sessão serve APENAS para poupar digitação de quem já entrou. Ela não
  // autoriza nada aqui: a solicitação é pública e o backend valida tudo de
  // novo a partir do telefone enviado.
  const { user } = useAuth()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState(() => user?.phoneFormatted || '')
  const [fullName, setFullName] = useState(() => user?.fullName || '')

  useEffect(() => {
    if (!user) return
    // O perfil pode não trazer o telefone formatado; nunca deixe o campo
    // virar undefined, senão a máscara quebra no primeiro render.
    setPhone(current => current || user.phoneFormatted || '')
    setFullName(current => current || user.fullName || '')
  }, [user])
  const [service, setService] = useState<Service | null>(null)
  const [date, setDate] = useState<Date | null>(null)
  const [slot, setSlot] = useState<AvailableSlot | null>(null)
  const [result, setResult] = useState<BookingRequestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * Existe uma seleção guardada? Lida UMA vez, na montagem, e apenas para
   * oferecer a retomada. Nada é restaurado sem a pessoa pedir.
   */
  /**
   * Contato já gravado no backend, com o handle das etapas seguintes.
   *
   * Vive só em memória: nome e telefone nunca vão para sessionStorage nem
   * localStorage. Recarregar a página obriga a passar pelo cadastro de novo,
   * que é o comportamento correto para dado pessoal.
   */
  const [contact, setContact] = useState<ContactRegistration | null>(null)
  const [contactLoading, setContactLoading] = useState(false)
  const [contactError, setContactError] = useState<string | null>(null)
  const contactSubmission = useRef<AbortController | null>(null)
  const previousContactHandle = useRef<string | undefined>(undefined)
  useEffect(() => () => { contactSubmission.current?.abort() }, [])

  function invalidateContact() {
    contactSubmission.current?.abort()
    contactSubmission.current = null
    previousContactHandle.current = contact?.contactHandle ?? previousContactHandle.current
    setContact(null)
    setContactError(null)
    setContactLoading(false)
  }

  const [pendingIntent, setPendingIntent] = useState(() => readBookingIntent())
  // Política servida pelo backend: quem decide se o pedido aguarda aprovação
  // é a regra de negócio, não o navegador.
  const [policy, setPolicy] = useState<BookingPolicy | null>(null)
  useEffect(() => {
    let cancelled = false
    void getBookingPolicy()
      .then(value => { if (!cancelled) setPolicy(value) })
      .catch(() => { /* o rótulo cai no padrão conservador */ })
    return () => { cancelled = true }
  }, [])
  const [resuming, setResuming] = useState(false)

  /**
   * Retomada voluntária: reconstrói serviço, data e horário e revalida a
   * disponibilidade antes de mostrar a confirmação.
   *
   * O telefone NÃO é guardado — dado pessoal não fica no armazenamento do
   * navegador —, então a retomada volta para a etapa de contato com o resto
   * já preenchido.
   */
  async function resumeIntent() {
    const intent = pendingIntent
    if (!intent) return

    setResuming(true)
    setError(null)
    try {
      const services = await listServices()
      const chosen = services.find(entry => entry.id === intent.serviceId)
      if (!chosen) {
        clearBookingIntent()
        setPendingIntent(null)
        setNotice('O serviço escolhido não está mais disponível. Escolha outro.')
        return
      }

      const [year, month, day] = intent.date.split('-').map(Number)
      const chosenDate = new Date(year!, month! - 1, day!)

      const availability = await getAvailability(intent.date, chosen.id)
      const stillFree = availability.slots.find(
        entry => entry.startsAtClock === intent.startsAt,
      )

      setService(chosen)
      setDate(chosenDate)
      setSlot(stillFree ?? null)
      setPendingIntent(null)
      if (!stillFree) {
        setNotice('O horário que você tinha escolhido não está mais livre. Escolha outro.')
      }
      // Sempre começa pelo contato: o telefone não é preservado.
      setStep('phone')
    } catch {
      setNotice('Não foi possível recuperar sua seleção. Comece um novo agendamento.')
      clearBookingIntent()
      setPendingIntent(null)
    } finally {
      setResuming(false)
    }
  }

  function discardIntent() {
    invalidateContact()
    setPhone('')
    setFullName('')
    clearBookingIntent()
    setPendingIntent(null)
    setContact(null)
    setService(null)
    setDate(null)
    setSlot(null)
    setNotice(null)
    setStep('phone')
  }

  /**
   * Conclui a etapa de cadastro.
   *
   * Grava o contato no backend e guarda o handle. Editar nome ou telefone
   * invalida o handle anterior (ver `onChange`), então voltar e alterar
   * obriga uma nova validação — nada é aproveitado às cegas.
   */
  async function submitContact() {
    if (contactSubmission.current) return
    const controller = new AbortController()
    contactSubmission.current = controller
    setContactLoading(true)
    setContactError(null)
    try {
      const registered = await registerContact(fullName.trim(), phone, { signal: controller.signal, previousHandle: contact?.contactHandle ?? previousContactHandle.current })
      if (controller.signal.aborted) return
      previousContactHandle.current = undefined
      setContact(registered)
      setNotice(null)
      // Se a seleção já estava completa (retomada ou edição), volta direto
      // para a revisão em vez de repetir as escolhas.
      setStep(slot && service && date ? 'confirm' : 'service')
    } catch (err) {
      if (!controller.signal.aborted) setContactError(describeError(err, 'Não foi possível salvar seus dados.'))
    } finally {
      if (contactSubmission.current === controller) {
        contactSubmission.current = null
        setContactLoading(false)
      }
    }
  }

  /** Para onde o botão "voltar" leva, em cada etapa. */
  function goBack(from: Step) {
    setError(null)
    if (from === 'service') return setStep('phone')
    if (from === 'date') return setStep('service')
    if (from === 'time') return setStep('date')
    if (from === 'confirm') return setStep('time')
  }

  /**
   * Envia a solicitação.
   *
   * Sem login e sem sessão: o WhatsApp informado no começo identifica o
   * contato. Nada de duração, preço ou status vai daqui — o servidor deriva
   * tudo do serviço no banco e revalida o horário antes de gravar.
   */
  const submission = useRef(false)
  async function handleConfirm() {
    if (submission.current || !contact || !service || !date || !slot) return
    submission.current = true

    const dateISO = format(date, 'yyyy-MM-dd')
    setLoading(true)
    setError(null)
    try {
      const created = await requestBooking({
        contactHandle: contact.contactHandle,
        serviceId: service.id,
        date: dateISO,
        startsAt: slot.startsAtClock,
      })
      // Confirmado: a seleção em andamento deixa de existir.
      clearBookingIntent()
      rememberRequestToken(created.publicToken)
      setResult(created)
      setStep('success')
    } catch (err) {
      setError(describeError(err, 'Não foi possível enviar sua solicitação.'))
      if (err instanceof ApiError && err.code === "CONTACT_HANDLE_INVALID") {
        invalidateContact()
        setContactError(err.message)
        setStep("phone")
        return
      }
      // Conflito: alguém pegou antes. Volta para a lista já atualizada.
      if (err instanceof ApiError && err.status === 409) {
        setSlot(null)
        setStep('time')
      }
    } finally {
      submission.current = false
      setLoading(false)
    }
  }

  function restart() {
    invalidateContact()
    setPhone('')
    setFullName('')
    clearBookingIntent()
    setService(null)
    setDate(null)
    setSlot(null)
    setResult(null)
    setError(null)
    setNotice(null)
    setPendingIntent(null)
    setStep('phone')
  }

  if (step === 'success' && result) {
    return <SuccessStep result={result} policy={policy} onRestart={restart} />
  }

  // A retomada é oferecida antes de qualquer etapa, e só uma vez.
  if (pendingIntent && step === 'phone') {
    return (
      <div>
        <ResumePrompt
          onResume={() => void resumeIntent()}
          onDiscard={discardIntent}
        />
        {resuming && (
          <p role="status" className="text-sm text-[var(--muted-foreground)] text-center">
            Recuperando sua seleção…
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      <StepProgress current={step} />

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

      {step === 'phone' && (
        <ContactStep
          phone={phone}
          fullName={fullName}
          onChangePhone={value => { invalidateContact(); setPhone(value) }}
          onChangeName={value => { invalidateContact(); setFullName(value) }}
          onContinue={() => void submitContact()}
          loading={contactLoading}
          error={contactError}
        />
      )}
      {step === 'service' && (
        <ServiceStep
          onSelect={s => {
            // Trocar o serviço invalida o horário escolhido: um intervalo que
            // comportava 30 min pode não comportar 50. Guardá-lo em silêncio
            // levaria a pessoa a confirmar algo que o backend vai recusar.
            if (service && service.id !== s.id && slot) {
              setSlot(null)
              setNotice('O horário foi limpo porque a duração do serviço mudou.')
            } else {
              setNotice(null)
            }
            setService(s)
            setStep('date')
          }}
          onBack={() => goBack('service')}
        />
      )}
      {step === 'date' && (
        <DateStep onSelect={d => { setDate(d); setStep('time') }} onBack={() => goBack('date')} />
      )}
      {step === 'time' && date && service && (
        <TimeStep
          date={date}
          service={service}
          onSelect={s => {
            setSlot(s)
            setError(null)
            setNotice(null)
            // Guarda a seleção para uma eventual retomada. Só serviço, data e
            // horário — nenhum dado pessoal vai para o armazenamento.
            saveBookingIntent({
              serviceId: service.id,
              date: format(date, 'yyyy-MM-dd'),
              startsAt: s.startsAtClock,
            })
            setStep('confirm')
          }}
          onBack={() => goBack('time')}
        />
      )}
      {step === 'confirm' && service && date && slot && contact && (
        <ConfirmStep
          service={service}
          date={date}
          slot={slot}
          fullName={contact.fullName}
          phoneMasked={contact.phoneMasked}
          onConfirm={handleConfirm}
          onBack={() => goBack('confirm')}
          onEditContact={() => setStep('phone')}
          loading={loading}
          error={error}
          requiresApproval={policy?.requiresApproval ?? true}
        />
      )}
    </div>
  )
}
