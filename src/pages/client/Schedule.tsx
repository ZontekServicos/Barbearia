import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Check, Scissors, Clock,
  CalendarCheck, ChevronLeft, ChevronRight
} from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, isToday, isBefore, startOfDay, addMonths,
  subMonths, getDay
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { SERVICES, AVAILABLE_TIMES, OCCUPIED_TIMES_BY_DATE, CLOSED_DAYS } from '@/data/mock'
import type { Service } from '@/data/mock'
import { cn } from '@/lib/utils'

type Step = 'service' | 'date' | 'time' | 'confirm' | 'success'

const STEPS: { key: Step; label: string }[] = [
  { key: 'service', label: 'Serviço' },
  { key: 'date', label: 'Data' },
  { key: 'time', label: 'Horário' },
  { key: 'confirm', label: 'Confirmar' },
]

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
                'flex-1 h-px mx-2 mt-[-14px]',
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
  const [selected, setSelected] = useState<string | null>(null)
  const active = SERVICES.filter(s => s.active)

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight">Escolha o serviço</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">Selecione o que você precisa hoje.</p>
      </div>

      <div className="space-y-3 mb-6">
        {active.map(service => (
          <button
            key={service.id}
            onClick={() => setSelected(service.id)}
            className={cn(
              'w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left',
              selected === service.id
                ? 'border-[var(--primary)] bg-[var(--primary)]/10 shadow-[0_0_12px_rgba(212,175,55,0.15)]'
                : 'border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40'
            )}
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                selected === service.id ? 'bg-[var(--primary)]/20' : 'bg-[var(--secondary)]'
              )}>
                <Scissors className={cn('h-5 w-5', selected === service.id ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]')} />
              </div>
              <div>
                <p className="font-semibold text-[var(--foreground)]">{service.name}</p>
                <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] mt-0.5">
                  <Clock className="h-3 w-3" />
                  <span>{service.duration} min</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-[var(--primary)]">R$ {service.price}</span>
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
          const service = SERVICES.find(s => s.id === selected)!
          onSelect(service)
        }}
      >
        Continuar
      </Button>
    </div>
  )
}

function DateStep({ onSelect, onBack }: { onSelect: (d: Date) => void; onBack: () => void }) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selected, setSelected] = useState<Date | null>(null)
  const today = startOfDay(new Date())

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  })

  const firstDayOfWeek = getDay(startOfMonth(currentMonth)) // 0=Sun

  const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

  const isDisabled = (day: Date) =>
    isBefore(day, today) || CLOSED_DAYS.includes(getDay(day))

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button aria-label="Voltar à etapa anterior" onClick={onBack} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Escolha a data</h2>
          <p className="text-sm text-[var(--muted-foreground)]">Selecione um dia disponível.</p>
        </div>
      </div>

      <div className="border border-[var(--border)] bg-[var(--card)] rounded-2xl p-4 mb-6">
        {/* Month header */}
        <div className="flex items-center justify-between mb-4">
          <button
            aria-label="Mês anterior"
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="font-semibold text-sm capitalize">
            {format(currentMonth, "MMMM 'de' yyyy", { locale: ptBR })}
          </span>
          <button
            aria-label="Próximo mês"
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-1.5 rounded-lg hover:bg-[var(--secondary)] transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Week days header */}
        <div className="grid grid-cols-7 mb-2">
          {weekDays.map(d => (
            <div key={d} className="text-center text-xs text-[var(--muted-foreground)] font-medium py-1">{d}</div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {/* Empty cells for first week */}
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
                disabled={disabled}
                onClick={() => setSelected(day)}
                className={cn(
                  'aspect-square flex items-center justify-center text-sm rounded-lg transition-all',
                  sel && 'bg-[var(--primary)] text-black font-bold',
                  !sel && todayDay && 'border border-[var(--primary)]/50 text-[var(--primary)]',
                  !sel && !disabled && !todayDay && 'hover:bg-[var(--secondary)] text-[var(--foreground)]',
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
    </div>
  )
}

function TimeStep({
  date,
  onSelect,
  onBack
}: {
  date: Date
  onSelect: (t: string) => void
  onBack: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const dateKey = format(date, 'yyyy-MM-dd')
  const occupied = OCCUPIED_TIMES_BY_DATE[dateKey] || []

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button aria-label="Voltar à etapa anterior" onClick={onBack} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Escolha o horário</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {format(date, "EEEE, dd 'de' MMMM", { locale: ptBR })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-6">
        {AVAILABLE_TIMES.map(time => {
          const isOccupied = occupied.includes(time)
          const isSelected = selected === time
          return (
            <button
              key={time}
              disabled={isOccupied}
              onClick={() => setSelected(time)}
              className={cn(
                'py-3 rounded-xl text-sm font-medium border transition-all',
                isSelected && 'bg-[var(--primary)] text-black border-[var(--primary)] font-bold',
                !isSelected && !isOccupied && 'border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40 text-[var(--foreground)]',
                isOccupied && 'border-[var(--border)] bg-[var(--secondary)]/50 text-[var(--muted-foreground)]/40 cursor-not-allowed line-through'
              )}
            >
              {time}
            </button>
          )
        })}
      </div>

      <Button
        className="w-full h-12"
        disabled={!selected}
        onClick={() => selected && onSelect(selected)}
      >
        Continuar
      </Button>
    </div>
  )
}

function ConfirmStep({
  service,
  date,
  time,
  onConfirm,
  onBack,
  loading
}: {
  service: Service
  date: Date
  time: string
  onConfirm: () => void
  onBack: () => void
  loading: boolean
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button aria-label="Voltar à etapa anterior" onClick={onBack} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Confirmar agendamento</h2>
          <p className="text-sm text-[var(--muted-foreground)]">Revise os detalhes abaixo.</p>
        </div>
      </div>

      <div className="border border-[var(--border)] bg-[var(--card)] rounded-2xl overflow-hidden mb-6">
        <div className="p-4 border-b border-[var(--border)] bg-[var(--primary)]/5">
          <div className="flex items-center gap-2 text-[var(--primary)] text-sm font-medium">
            <CalendarCheck className="h-4 w-4" />
            Resumo do agendamento
          </div>
        </div>
        <div className="p-4 space-y-3">
          {[
            { label: 'Serviço', value: service.name },
            { label: 'Data', value: format(date, "dd 'de' MMMM", { locale: ptBR }) },
            { label: 'Horário', value: time },
            { label: 'Duração', value: `${service.duration} minutos` },
            { label: 'Valor', value: `R$ ${service.price}`, highlight: true },
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

      <Button className="w-full h-12 text-base" onClick={onConfirm} disabled={loading}>
        {loading ? 'Confirmando...' : 'Confirmar agendamento'}
      </Button>
    </div>
  )
}

function SuccessStep({ service, date, time, onRestart }: { service: Service; date: Date; time: string; onRestart: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="text-center py-6">
      <div className="w-20 h-20 rounded-full bg-[var(--primary)]/15 border-2 border-[var(--primary)]/40 flex items-center justify-center mx-auto mb-6">
        <Check className="h-10 w-10 text-[var(--primary)]" />
      </div>
      <h2 className="text-2xl font-bold tracking-tight mb-2">Agendamento confirmado!</h2>
      <p className="text-[var(--muted-foreground)] text-sm mb-8">
        Você está agendado para{' '}
        <span className="text-[var(--foreground)] font-medium">{service.name}</span>{' '}
        no dia <span className="text-[var(--foreground)] font-medium">{format(date, "dd/MM", { locale: ptBR })}</span>{' '}
        às <span className="text-[var(--foreground)] font-medium">{time}</span>.
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
  const [step, setStep] = useState<Step>('service')
  const [service, setService] = useState<Service | null>(null)
  const [date, setDate] = useState<Date | null>(null)
  const [time, setTime] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    setLoading(true)
    await new Promise(r => setTimeout(r, 1000))
    setLoading(false)
    setStep('success')
  }

  if (step === 'success' && service && date && time) {
    return <SuccessStep service={service} date={date} time={time} onRestart={() => { setService(null); setDate(null); setTime(null); setStep('service') }} />
  }

  return (
    <div>
      {step !== 'success' && <StepProgress current={step} />}

      {step === 'service' && (
        <ServiceStep onSelect={s => { setService(s); setStep('date') }} />
      )}
      {step === 'date' && (
        <DateStep onSelect={d => { setDate(d); setStep('time') }} onBack={() => setStep('service')} />
      )}
      {step === 'time' && date && (
        <TimeStep date={date} onSelect={t => { setTime(t); setStep('confirm') }} onBack={() => setStep('date')} />
      )}
      {step === 'confirm' && service && date && time && (
        <ConfirmStep
          service={service}
          date={date}
          time={time}
          onConfirm={handleConfirm}
          onBack={() => setStep('time')}
          loading={loading}
        />
      )}
    </div>
  )
}
