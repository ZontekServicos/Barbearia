import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Phone, User, Scissors, Clock, Calendar, DollarSign,
  CheckCircle, XCircle, AlertCircle, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/Modal'
import PaymentSection from '@/components/admin/PaymentSection'
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
  /**
   * A política do servidor não é mais consultada aqui.
   *
   * Ela existia para o botão dizer se aprovar abriria a janela de pagamento. Com
   * a cobrança nascendo junto com a solicitação, o que decide o texto é a
   * PRÓPRIA cobrança deste agendamento (`appointment.payment`), que já vem no
   * detalhe — e um fato concreto é melhor que uma configuração global. Buscar a
   * política virava uma requisição por abertura de tela sem nada que a leia.
   */
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  /** Recusa com Pix declarado passa por uma confirmação à parte. */
  const [confirmingReject, setConfirmingReject] = useState(false)

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
  async function handleDecision(
    decision: 'CONFIRMED' | 'REJECTED',
    label: string,
    acknowledgePaidReport?: boolean,
  ) {
    if (!id) return
    setPending(label)
    setActionError(null)
    try {
      setAppointment(await decideBookingRequest(id, decision, acknowledgePaidReport))
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

  /**
   * Cobrança em aberto: a confirmação é a do pagamento, não a daqui.
   *
   * Espelha exatamente a guarda do servidor (cobrança existente que não está
   * `PAID`). Divergir aqui faria a tela oferecer um botão que o backend recusa.
   */
  const awaitingMoney = appointment.payment != null && appointment.payment.status !== 'PAID'

  /**
   * Há dinheiro de outra pessoa em jogo.
   *
   * Declarado pelo cliente ou já confirmado: nos dois casos, recusar é decisão
   * com consequência financeira, e não existe devolução automática.
   */
  const moneyAtStake =
    appointment.payment != null &&
    (appointment.payment.reportedAt != null || appointment.payment.status === 'PAID')

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

      {/*
        Pagamento vem antes de Ações porque é o que decide o que fazer: um
        horário aguardando Pix não deve ser concluído nem marcado como falta.
      */}
      {appointment.payment && (
        <div className="mb-6">
          <PaymentSection appointment={appointment} onSettled={setAppointment} />
        </div>
      )}

      <div className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-5 space-y-2">
        <p className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-3">Ações</p>

        {actionError && (
          <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300 mb-2">
            {actionError}
          </p>
        )}

        {appointment.status === 'PENDING' ? (
          <>
            {/*
              Com cobrança em aberto, confirmar NÃO passa por aqui.
              O Pix já está na tela do cliente desde a solicitação, e a
              confirmação acontece junto com o pagamento, na seção Pagamento
              acima — numa transação só. Oferecer "aprovar" aqui bateria no 409
              do servidor e, se passasse, confirmaria o horário de quem não
              pagou. A condição é a MESMA que o servidor aplica.
            */}
            {awaitingMoney ? (
              <p className="text-sm text-[var(--muted-foreground)] mb-3">
                O Pix já está na tela do cliente e o horário segue segurado até o prazo.
                Para confirmar, confira o extrato e use{' '}
                <strong className="text-[var(--foreground)]">Confirmar pagamento e agendamento</strong>{' '}
                em Pagamento.
              </p>
            ) : (
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
              </>
            )}
            <Button
              variant="outline"
              className="w-full h-11"
              /* Com dinheiro em jogo, a recusa passa por uma confirmação à
                 parte: recusar não devolve nada automaticamente. */
              onClick={() =>
                moneyAtStake
                  ? setConfirmingReject(true)
                  : void handleDecision('REJECTED', 'Solicitação recusada')
              }
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
        ) : appointment.status === 'AWAITING_PAYMENT' ? (
          <div className="py-2">
            {/*
              Nada a fazer aqui, e isso é intencional: quem confirma é o
              pagamento validado pelo backend. Um botão de "confirmar mesmo
              assim" seria exatamente a confirmação sem dinheiro que o desenho
              evita. Cancelar continua possível pela agenda.
            */}
            <p className="text-sm text-[var(--muted-foreground)]">
              Aprovado. Aguardando o pagamento do cliente — a confirmação é
              automática quando o pagamento for aprovado pelo provedor. Se o
              prazo terminar, o horário volta a ficar livre.
            </p>
          </div>
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

      {/*
        Recusar com Pix declarado ou já confirmado.

        Um clique a mais aqui é barato; já ter recusado, não. O texto diz o que
        o sistema NÃO faz — devolver dinheiro — porque é a parte que a pessoa
        precisa assumir antes de clicar, e não depois de descobrir.
      */}
      {confirmingReject && appointment.payment && (
        <Modal titleId="reject-with-payment" onClose={() => setConfirmingReject(false)}>
          <h2 id="reject-with-payment" className="text-lg font-bold mb-2">
            Recusar com pagamento em jogo?
          </h2>
          <p className="text-sm text-[var(--muted-foreground)] mb-3">
            {appointment.payment.status === 'PAID'
              ? `Este pagamento de R$ ${appointment.payment.amountFormatted} já foi confirmado.`
              : `O cliente informou ter pagado R$ ${appointment.payment.amountFormatted}.`}
          </p>
          <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-3 mb-4 flex gap-2.5">
            <AlertCircle className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200">
              Recusar <strong>não devolve</strong> o dinheiro. Se o Pix entrou, a devolução
              é feita pela barbearia por fora, falando com o cliente.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmingReject(false)}
              disabled={pending !== null}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={pending !== null}
              onClick={() => {
                setConfirmingReject(false)
                void handleDecision('REJECTED', 'Solicitação recusada', true)
              }}
            >
              Recusar mesmo assim
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
