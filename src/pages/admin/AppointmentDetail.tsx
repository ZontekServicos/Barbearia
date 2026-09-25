import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Phone, User, Scissors, Clock, Calendar, DollarSign,
  CheckCircle, XCircle, AlertCircle, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { ApiError } from '@/services/api'
import {
  getAdminAppointment,
  updateAppointmentStatus,
  type AdminAppointment,  decideBookingRequest,
} from '@/services/admin-booking'

const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function formatDate(dateISO: string) {
  const [year, month, day] = dateISO.split('-')
  return `${day} de ${MONTHS[Number(month) - 1]} de ${year}`
}

export default function AppointmentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [appointment, setAppointment] = useState<AdminAppointment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      setAppointment(await getAdminAppointment(id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar o agendamento.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  /** Sem atualização otimista: o status só muda na tela depois do backend confirmar. */
  /** Confirma ou recusa uma solicitação pública que ainda aguarda decisão. */
  async function handleDecision(decision: 'CONFIRMED' | 'REJECTED', label: string) {
    if (!id) return
    setPending(label)
    setActionError(null)
    try {
      setAppointment(await decideBookingRequest(id, decision))
      setToast(label + '.')
      setTimeout(() => setToast(null), 3000)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível decidir a solicitação.')
    } finally {
      setPending(null)
    }
  }

  async function handleAction(status: 'COMPLETED' | 'CANCELLED' | 'NO_SHOW', label: string) {
    if (!id) return
    setPending(label)
    setActionError(null)
    try {
      setAppointment(await updateAppointmentStatus(id, status))
      setToast(`${label} com sucesso.`)
      setTimeout(() => setToast(null), 3000)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível atualizar.')
    } finally {
      setPending(null)
    }
  }

  if (loading) {
    return (
      <p role="status" className="text-sm text-[var(--muted-foreground)] py-10">
        Carregando agendamento…
      </p>
    )
  }

  if (error || !appointment) {
    return (
      <div className="max-w-xl">
        <div role="alert" className="border border-red-500/40 bg-red-500/10 rounded-2xl p-6 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-200 mb-4">{error ?? 'Agendamento não encontrado.'}</p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Tentar novamente
            </Button>
            <Button size="sm" onClick={() => navigate('/admin/agenda')}>Voltar à agenda</Button>
          </div>
        </div>
      </div>
    )
  }

  const details = [
    { icon: User, label: 'Cliente', value: appointment.customer.fullName ?? 'Sem nome' },
    { icon: Phone, label: 'Telefone', value: appointment.customer.phoneFormatted },
    { icon: Scissors, label: 'Serviço', value: appointment.serviceName },
    { icon: Calendar, label: 'Data', value: formatDate(appointment.date) },
    {
      icon: Clock,
      label: 'Horário',
      value: `${appointment.startsAtClock} – ${appointment.endsAtClock} · ${appointment.durationMinutes} min`,
    },
    { icon: DollarSign, label: 'Valor', value: `R$ ${appointment.servicePriceFormatted}` },
  ]

  return (
    <div className="max-w-xl">
      {toast && (
        <div role="status" className="fixed top-4 right-4 left-4 sm:left-auto z-50 bg-[var(--card)] border border-green-500/50 text-green-400 px-4 py-3 rounded-xl text-sm shadow-xl">
          {toast}
        </div>
      )}

      <button
        onClick={() => navigate('/admin/agenda')}
        className="flex items-center gap-1.5 min-h-11 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar à agenda
      </button>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold tracking-tight">Agendamento</h2>
        <StatusBadge status={appointment.status} />
      </div>

      <div className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl overflow-hidden mb-6">
        <div className="p-5 border-b border-[var(--primary)]/20 bg-[var(--primary)]/8">
          <p className="text-xs text-[var(--primary)] font-semibold tracking-widest uppercase">Detalhes</p>
        </div>
        <div className="p-5 space-y-4">
          {details.map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 text-[var(--primary)]" />
              </div>
              <div>
                <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
                <p className="text-sm font-semibold text-[var(--foreground)]">{value}</p>
              </div>
            </div>
          ))}
          {appointment.notes && (
            <div className="pt-3 border-t border-[var(--primary)]/20">
              <p className="text-xs text-[var(--muted-foreground)] mb-1">Observações</p>
              <p className="text-sm text-[var(--foreground)]">{appointment.notes}</p>
            </div>
          )}
        </div>
      </div>

      <div className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-5 space-y-2">
        <p className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-3">Ações</p>

        {actionError && (
          <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300 mb-2">
            {actionError}
          </p>
        )}

        {appointment.status === 'PENDING' ? (
          <>
            <p className="text-sm text-[var(--muted-foreground)] mb-3">
              Solicitação feita pelo WhatsApp do cliente. O horário está segurado até você decidir.
            </p>
            <Button
              className="w-full h-11 mb-2"
              onClick={() => void handleDecision('CONFIRMED', 'Agendamento confirmado')}
              disabled={pending !== null}
            >
              {pending === 'Agendamento confirmado' ? 'Processando...' : 'Confirmar agendamento'}
            </Button>
            <Button
              variant="outline"
              className="w-full h-11"
              onClick={() => void handleDecision('REJECTED', 'Solicitação recusada')}
              disabled={pending !== null}
            >
              {pending === 'Solicitação recusada' ? 'Processando...' : 'Recusar solicitação'}
            </Button>
          </>
        ) : appointment.status === 'CONFIRMED' ? (
          <>
            <Button
              className="w-full h-11"
              onClick={() => void handleAction('COMPLETED', 'Atendimento concluído')}
              disabled={pending !== null}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {pending === 'Atendimento concluído' ? 'Processando...' : 'Concluir atendimento'}
            </Button>
            <Button
              variant="outline"
              className="w-full h-11"
              onClick={() => void handleAction('NO_SHOW', 'Marcado como falta')}
              disabled={pending !== null}
            >
              <AlertCircle className="h-4 w-4 mr-2" />
              {pending === 'Marcado como falta' ? 'Processando...' : 'Marcar como falta'}
            </Button>
            <Button
              variant="destructive"
              className="w-full h-11"
              onClick={() => void handleAction('CANCELLED', 'Agendamento cancelado')}
              disabled={pending !== null}
            >
              <XCircle className="h-4 w-4 mr-2" />
              {pending === 'Agendamento cancelado' ? 'Processando...' : 'Cancelar agendamento'}
            </Button>
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-[var(--muted-foreground)]">Este agendamento já foi encerrado.</p>
          </div>
        )}

        <div className="pt-2 border-t border-[var(--primary)]/20">
          <Link
            to={`/admin/clients/${appointment.customer.id}`}
            className="flex items-center justify-center gap-2 min-h-11 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <User className="h-4 w-4" />
            Ver perfil do cliente
          </Link>
        </div>
      </div>
    </div>
  )
}
