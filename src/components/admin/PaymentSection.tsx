import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BadgeCheck, Check, Clock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/services/api'
import { settleAppointmentPayment, type AdminAppointment } from '@/services/admin-booking'
import { cn } from '@/lib/utils'

/**
 * Seção de PAGAMENTO do agendamento, no painel.
 *
 * É por aqui que o barbeiro fecha o Pix estático: ele confere o extrato da
 * barbearia e registra o que encontrou. Nenhuma regra financeira vive aqui —
 * o servidor decide se a confirmação é possível (`canConfirmManually`), quanto
 * vale a cobrança e para que estado o agendamento vai. Esta tela mostra e chama.
 */

const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function formatDate(dateISO: string) {
  const [year, month, day] = dateISO.split('-')
  return `${day} de ${MONTHS[Number(month) - 1]} de ${year}`
}

const STATUS_TEXT: Record<NonNullable<AdminAppointment['payment']>['status'], string> = {
  PENDING: 'Aguardando pagamento',
  PAID: 'Pago',
  FAILED: 'Não identificado',
  EXPIRED: 'Expirado',
  CANCELED: 'Cancelado',
}

/** "29:58" ou "45s" — o formato menor não mente sobre precisão. */
function formatRemaining(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export default function PaymentSection({
  appointment,
  onSettled,
}: {
  appointment: AdminAppointment
  /** Recebe o agendamento já atualizado pelo servidor. */
  onSettled: (updated: AdminAppointment) => void
}) {
  const { payment } = appointment
  const [asking, setAsking] = useState<'PAID' | 'FAILED' | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Contagem a partir do prazo que o SERVIDOR informou: o relógio da máquina
  // do barbeiro pode estar errado, o prazo do servidor não.
  const [remaining, setRemaining] = useState(payment?.expiresInSeconds ?? 0)
  useEffect(() => {
    setRemaining(payment?.expiresInSeconds ?? 0)
    if (!payment || payment.status !== 'PENDING') return
    const timer = setInterval(() => setRemaining(seconds => Math.max(0, seconds - 1)), 1000)
    return () => clearInterval(timer)
  }, [payment?.expiresInSeconds, payment?.status])

  // Uma requisição por vez, mesmo com duplo clique ou Enter repetido.
  const inFlight = useRef(false)

  if (!payment) return null

  async function settle(decision: 'PAID' | 'FAILED') {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      const updated = await settleAppointmentPayment(appointment.id, decision)
      setAsking(null)
      setNotice(
        decision === 'PAID'
          ? 'Pagamento confirmado. Agendamento confirmado.'
          : 'Registrado como não identificado. O cliente ainda pode pagar dentro do prazo.',
      )
      onSettled(updated)
    } catch (err) {
      /**
       * 409 significa que outra sessão já resolveu isto. Não é erro do barbeiro,
       * e mostrar vermelho genérico só o faria clicar de novo. Fechamos o modal
       * e recarregamos o estado real.
       */
      if (err instanceof ApiError && err.status === 409) {
        setAsking(null)
        setNotice(err.message)
        try {
          const { getAdminAppointment } = await import('@/services/admin-booking')
          onSettled(await getAdminAppointment(appointment.id))
        } catch {
          // Sem recarregar, o aviso acima já diz o que aconteceu.
        }
        return
      }
      setError(
        err instanceof ApiError ? err.message : 'Não foi possível registrar o pagamento.',
      )
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  const tone =
    payment.status === 'PAID'
      ? 'border-[var(--primary)]/40'
      : payment.windowClosed || payment.status === 'FAILED'
        ? 'border-amber-500/40'
        : 'border-[var(--primary)]/20'

  return (
    <section
      aria-labelledby="pagamento-heading"
      className={cn(
        'border bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-5',
        tone,
      )}
    >
      <h2
        id="pagamento-heading"
        className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-4"
      >
        Pagamento
      </h2>

      <dl className="space-y-3 mb-4">
        <Row label="Método" value={payment.method === 'PIX_MANUAL' ? 'Pix' : 'Provedor'} />
        <Row label="Valor" value={`R$ ${payment.amountFormatted}`} />
        <Row
          label="Status"
          value={
            <span
              className={cn(
                'font-medium',
                payment.status === 'PAID' && 'text-[var(--primary)]',
                (payment.status === 'FAILED' || payment.windowClosed) && 'text-amber-400',
              )}
            >
              {payment.windowClosed && payment.status === 'PENDING'
                ? 'Prazo vencido'
                : STATUS_TEXT[payment.status]}
            </span>
          }
        />
        {appointment.reference && (
          <Row
            label="Referência"
            value={<span className="font-mono tracking-wide">{appointment.reference}</span>}
          />
        )}
        {payment.status === 'PENDING' && !payment.windowClosed && (
          <Row
            label="Prazo"
            value={
              <span className="tabular-nums">
                {remaining > 0 ? formatRemaining(remaining) : 'encerrando…'}
              </span>
            }
          />
        )}
      </dl>

      {notice && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-[var(--primary)]/35 bg-[var(--primary)]/10 px-3 py-2 text-sm mb-3"
        >
          <BadgeCheck className="h-4 w-4 mt-0.5 shrink-0 text-[var(--primary)]" />
          <span>{notice}</span>
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300 mb-3"
        >
          {error}
        </p>
      )}

      {/*
        Confirmação manual só existe para Pix da barbearia, cobrança em aberto,
        horário aguardando pagamento e prazo válido. Quem avalia isso é o
        servidor; aqui só obedecemos.
      */}
      {payment.canConfirmManually && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--muted-foreground)] mb-3">
            Confira o recebimento no extrato da barbearia antes de confirmar.
          </p>
          <Button className="w-full h-11" onClick={() => setAsking('PAID')} disabled={pending}>
            <Check className="h-4 w-4 mr-2" />
            Confirmar recebimento do Pix
          </Button>
          <Button
            variant="outline"
            className="w-full h-11"
            onClick={() => setAsking('FAILED')}
            disabled={pending}
          >
            <X className="h-4 w-4 mr-2" />
            Pagamento não identificado
          </Button>
        </div>
      )}

      {/*
        Prazo vencido com cobrança em aberto.
        O botão normal sai da tela — confirmar num clique aqui poderia fechar um
        horário que já voltou a ser oferecido. Se o Pix realmente caiu, a
        barbearia trata o caso por fora: o servidor ainda aceita a conciliação
        enquanto o horário não tiver sido tomado, e recusa com conflito se tiver.
      */}
      {payment.status === 'PENDING' && payment.windowClosed && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            O prazo venceu e o horário voltou a ficar disponível. Se o Pix foi
            recebido, trate o caso manualmente com o cliente — não confirme por
            aqui, porque o horário pode já ter sido reservado por outra pessoa.
          </span>
        </p>
      )}

      {/* Cobrança de provedor: a confirmação é dele, não nossa. */}
      {payment.method === 'PROVIDER' && payment.status === 'PENDING' && !payment.windowClosed && (
        <p className="flex items-start gap-2 text-sm text-[var(--muted-foreground)]">
          <Clock className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            A confirmação chega automaticamente pelo provedor de pagamento. Não é
            preciso — nem possível — confirmar por aqui.
          </span>
        </p>
      )}

      {payment.status === 'PAID' && (
        <p className="flex items-center gap-2 text-sm text-[var(--primary)]">
          <BadgeCheck className="h-4 w-4 shrink-0" />
          Pagamento confirmado.
        </p>
      )}

      {asking && (
        <ConfirmDialog
          decision={asking}
          appointment={appointment}
          pending={pending}
          onCancel={() => setAsking(null)}
          onConfirm={() => void settle(asking)}
        />
      )}
    </section>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm text-[var(--muted-foreground)]">{label}</dt>
      <dd className="text-sm text-right text-[var(--foreground)]">{value}</dd>
    </div>
  )
}

/**
 * Confirmação em duas etapas.
 *
 * Um clique só, direto na lista, confirmaria dinheiro por engano — e desfazer
 * isso significa ligar para o cliente. O modal repete o que está em jogo:
 * cliente, serviço, valor, data, horário e referência.
 */
function ConfirmDialog({
  decision,
  appointment,
  pending,
  onCancel,
  onConfirm,
}: {
  decision: 'PAID' | 'FAILED'
  appointment: AdminAppointment
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const confirming = decision === 'PAID'
  const panel = useRef<HTMLDivElement>(null)

  // Esc fecha, e o foco começa dentro do diálogo para quem usa teclado.
  useEffect(() => {
    panel.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, pending])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      onClick={event => {
        if (event.target === event.currentTarget && !pending) onCancel()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmar-pagamento-titulo"
        tabIndex={-1}
        className="w-full max-w-sm rounded-2xl border border-[var(--primary)]/30 bg-[var(--background)] p-5 shadow-[0_10px_40px_rgba(0,0,0,0.6)] outline-none max-h-[85dvh] overflow-y-auto"
      >
        <h3
          id="confirmar-pagamento-titulo"
          className="font-display text-lg font-bold tracking-tight mb-2"
        >
          {confirming ? 'Confirmar pagamento?' : 'Marcar como não identificado?'}
        </h3>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          {confirming
            ? 'Confirme somente após verificar o recebimento do Pix no extrato da barbearia.'
            : 'O agendamento continua aguardando pagamento e o cliente pode tentar de novo enquanto o prazo não vencer.'}
        </p>

        <dl className="space-y-2 rounded-xl border border-[var(--border)]/60 bg-[var(--surface-bronze)] p-3 mb-5">
          <Row label="Cliente" value={appointment.customer.fullName ?? appointment.customer.phoneFormatted} />
          <Row label="Serviço" value={appointment.serviceName} />
          <Row label="Valor" value={`R$ ${appointment.payment?.amountFormatted ?? ''}`} />
          <Row label="Data" value={formatDate(appointment.date)} />
          <Row label="Horário" value={appointment.startsAtClock} />
          {appointment.reference && (
            <Row
              label="Referência"
              value={<span className="font-mono tracking-wide">{appointment.reference}</span>}
            />
          )}
        </dl>

        <div className="space-y-2">
          <Button
            className="w-full h-11"
            variant={confirming ? 'default' : 'destructive'}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending
              ? 'Processando...'
              : confirming
                ? 'Confirmar pagamento'
                : 'Marcar como não identificado'}
          </Button>
          <Button variant="ghost" className="w-full h-11" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  )
}
