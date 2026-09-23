import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, X, AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/Modal'
import { Logo } from '@/components/Logo'
import { ApiError } from '@/services/api'
import { cancelMyAppointment, listMyAppointments, type Appointment } from '@/services/booking'

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** A data já vem no fuso da barbearia, então é só formatar. */
function formatDate(dateISO: string) {
  const [, month, day] = dateISO.split('-')
  return `${day} de ${MONTHS[Number(month) - 1]}`
}

export default function Appointments() {
  const [upcoming, setUpcoming] = useState<Appointment[]>([])
  const [history, setHistory] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [next, past] = await Promise.all([
        listMyAppointments('upcoming'),
        listMyAppointments('history'),
      ])
      setUpcoming(next)
      setHistory(past)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Não foi possível carregar seus agendamentos.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /** Sem atualização otimista: só recarrega depois que o backend confirma. */
  async function handleCancel(id: string) {
    setCancelling(true)
    setCancelError(null)
    try {
      await cancelMyAppointment(id)
      setCancelId(null)
      await load()
    } catch (err) {
      setCancelError(
        err instanceof ApiError ? err.message : 'Não foi possível cancelar o agendamento.',
      )
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight">Meus Horários</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">Seus agendamentos passados e futuros.</p>
      </div>

      {loading ? (
        <p role="status" className="text-sm text-[var(--muted-foreground)] py-6">
          Carregando seus agendamentos…
        </p>
      ) : error ? (
        <div role="alert" className="border border-red-500/40 bg-red-500/10 rounded-2xl p-5 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-200 mb-4">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          {/* Próximos */}
          <section className="mb-8">
            <h3 className="text-xs font-semibold tracking-widest text-[var(--primary)] uppercase mb-3">Próximos</h3>

            {upcoming.length === 0 ? (
              <div className="border border-dashed border-[var(--primary)]/25 bg-[var(--surface-bronze)] rounded-2xl p-8 text-center">
                <Logo className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
                <p className="text-[var(--muted-foreground)] text-sm mb-4">Você ainda não possui agendamentos futuros.</p>
                <Button asChild size="sm">
                  <Link to="/client/schedule">Agendar agora</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {upcoming.map(appointment => (
                  <div
                    key={appointment.id}
                    className="border border-[var(--primary)]/30 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-4"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold text-[var(--foreground)]">{appointment.serviceName}</p>
                        <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] mt-1">
                          <Clock className="h-3 w-3" />
                          <span>{formatDate(appointment.date)} às {appointment.startsAtClock}</span>
                        </div>
                      </div>
                      <StatusBadge status={appointment.status} />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--primary)] font-bold">
                        R$ {appointment.servicePriceFormatted}
                      </span>
                      <button
                        onClick={() => { setCancelId(appointment.id); setCancelError(null) }}
                        className="min-h-11 px-2 flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                        Cancelar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Histórico */}
          <section>
            <h3 className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-3">Histórico</h3>

            {history.length === 0 ? (
              <p className="text-[var(--muted-foreground)] text-sm">Nenhum atendimento anterior.</p>
            ) : (
              <div className="space-y-2">
                {history.map(appointment => (
                  <div
                    key={appointment.id}
                    className="border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl px-4 py-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium text-sm text-[var(--foreground)]">{appointment.serviceName}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {formatDate(appointment.date)} às {appointment.startsAtClock}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-[var(--muted-foreground)]">
                        R$ {appointment.servicePriceFormatted}
                      </span>
                      <StatusBadge status={appointment.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Confirmação de cancelamento */}
      {cancelId && (
        <Modal titleId="cancel-appointment-title" onClose={() => setCancelId(null)}>
          <h3 id="cancel-appointment-title" className="text-lg font-bold mb-2">Cancelar agendamento?</h3>
          <p className="text-sm text-[var(--muted-foreground)] mb-6">
            O horário voltará a ficar disponível para outras pessoas.
          </p>

          {cancelError && (
            <p role="alert" className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {cancelError}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setCancelId(null)} disabled={cancelling}>
              Manter
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => void handleCancel(cancelId)}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelando...' : 'Cancelar agendamento'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
