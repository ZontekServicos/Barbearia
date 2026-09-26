import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertCircle, Check, Clock, Copy, Hourglass, MessageCircle, RefreshCw, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiError, isAbortError } from '@/services/api'
import {
  forgetRequestToken,
  getBookingRequest,
  readRequestToken,
  type BookingRequestView,
  type PaymentView,
} from '@/services/public-booking'
import { cn } from '@/lib/utils'

/**
 * Acompanhamento de UMA solicitação: aprovação, pagamento e confirmação.
 *
 * Por que é uma tela separada do fluxo de agendamento, e não um sexto passo do
 * stepper: o pagamento só existe DEPOIS da aprovação do barbeiro, que acontece
 * minutos ou horas mais tarde. Quem acabou de solicitar fecha o navegador e
 * volta depois — não há como pagar na mesma visita. Um passo 6 prometeria uma
 * etapa que aquela sessão não pode cumprir.
 *
 * A chave é o token da solicitação, entregue uma única vez na criação e guardado
 * localmente. Telefone não abre nada aqui: quem tem o token vê aquele pedido e
 * mais nada — sem listagem, sem histórico.
 */

type Phase = 'loading' | 'ready' | 'missing' | 'error'

/** De quanto em quanto tempo reconsultamos enquanto algo pode mudar. */
const POLL_MS = 15_000

export default function BookingStatus() {
  const params = useParams<{ token?: string }>()
  // Token da URL tem prioridade: é o link que a pessoa abriu. Sem ele, o
  // comprovante guardado no navegador.
  const token = params.token ?? readRequestToken() ?? null

  const [phase, setPhase] = useState<Phase>(token ? 'loading' : 'missing')
  const [view, setView] = useState<BookingRequestView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      if (!token) return
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller
      if (!options.quiet) setPhase('loading')
      try {
        const next = await getBookingRequest(token, { signal: controller.signal })
        if (controller.signal.aborted) return
        setView(next)
        setError(null)
        setPhase('ready')
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return
        if (err instanceof ApiError && err.status === 404) {
          // Token que não corresponde a pedido nenhum: não insistimos, e o
          // comprovante inválido sai do navegador.
          forgetRequestToken()
          setPhase('missing')
          return
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'Não foi possível consultar sua solicitação.',
        )
        // Uma falha de rede não apaga o que já estava na tela.
        setPhase(view ? 'ready' : 'error')
      } finally {
        if (inFlight.current === controller) inFlight.current = null
      }
    },
    [token, view],
  )

  useEffect(() => {
    void load()
    return () => inFlight.current?.abort()
    // Só o token define a consulta. `load` muda a cada render por depender de
    // `view`, e incluí-lo aqui recriaria o efeito em laço.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  /**
   * Reconsulta periódica enquanto o estado ainda pode mudar sozinho.
   *
   * Só nos dois estados que dependem de alguém: aguardando o barbeiro e
   * aguardando o pagamento. Confirmado, recusado ou expirado são finais — ficar
   * consultando seria bater no servidor à toa.
   */
  const status = view?.appointment.status
  const watching = status === 'PENDING' || status === 'AWAITING_PAYMENT'
  useEffect(() => {
    if (!watching) return
    const timer = setInterval(() => void load({ quiet: true }), POLL_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, token])

  if (phase === 'missing') {
    return (
      <Empty
        title="Não encontramos essa solicitação"
        message="O link pode ter expirado ou o pedido já não existe. Você pode fazer um novo agendamento."
      />
    )
  }

  if (phase === 'loading' && !view) {
    return (
      <div role="status" className="py-16 text-center text-[var(--muted-foreground)]">
        <RefreshCw className="h-6 w-6 mx-auto mb-3 animate-spin text-[var(--primary)]" />
        <p className="text-sm">Carregando sua solicitação…</p>
      </div>
    )
  }

  if (phase === 'error' || !view) {
    return (
      <Empty
        title="Não foi possível consultar"
        message={error ?? 'Tente novamente em alguns instantes.'}
        onRetry={() => void load()}
      />
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 p-3 text-sm"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-[var(--destructive)]" />
          <span>{error}</span>
        </p>
      )}

      <StatusHeader view={view} />
      <Details view={view} />

      {view.appointment.status === 'AWAITING_PAYMENT' && view.payment && (
        <PaymentPanel payment={view.payment} onRefresh={() => void load({ quiet: true })} />
      )}

      {view.appointment.status === 'CONFIRMED' && <Confirmed view={view} />}

      <div className="space-y-3 pt-2">
        {watching && (
          <Button
            variant="outline"
            className="w-full h-11"
            onClick={() => void load()}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
        )}
        <Button variant="ghost" className="w-full h-11 text-[var(--muted-foreground)]" asChild>
          <Link to="/agendar">Fazer outro agendamento</Link>
        </Button>
      </div>
    </div>
  )
}

/** Cabeçalho: o que está acontecendo, em uma frase honesta. */
function StatusHeader({ view }: { view: BookingRequestView }) {
  const { status } = view.appointment
  const paid = view.payment?.status === 'PAID'

  const presentation = {
    PENDING: {
      icon: <Hourglass className="h-9 w-9 text-[var(--primary)]" />,
      title: 'Aguardando confirmação',
      // Nunca "confirmado" antes de a barbearia decidir.
      message: 'A barbearia está avaliando seu pedido. Seguramos este horário enquanto isso.',
    },
    AWAITING_PAYMENT: {
      icon: <Clock className="h-9 w-9 text-[var(--primary)]" />,
      title: 'Pedido aprovado!',
      message: 'Falta o pagamento para confirmar. Seu horário está reservado durante esse prazo.',
    },
    CONFIRMED: {
      icon: <Check className="h-10 w-10 text-[var(--primary)]" />,
      title: 'Agendamento confirmado!',
      message: paid
        ? 'Pagamento confirmado. Te esperamos no horário.'
        : 'Está tudo certo. Te esperamos no horário.',
    },
    REJECTED: {
      icon: <XCircle className="h-9 w-9 text-[var(--destructive)]" />,
      title: 'Pedido não aceito',
      message: 'A barbearia não conseguiu atender neste horário. Você pode escolher outro.',
    },
    EXPIRED: {
      icon: <XCircle className="h-9 w-9 text-[var(--muted-foreground)]" />,
      title: 'Solicitação expirada',
      message: 'O prazo terminou e o horário voltou a ficar disponível. Faça um novo agendamento.',
    },
    CANCELLED: {
      icon: <XCircle className="h-9 w-9 text-[var(--muted-foreground)]" />,
      title: 'Agendamento cancelado',
      message: 'Este agendamento foi cancelado.',
    },
    COMPLETED: {
      icon: <Check className="h-9 w-9 text-[var(--primary)]" />,
      title: "Atendimento concluído",
      message: "Obrigado pela visita! Esperamos te ver de novo.",
    },
    NO_SHOW: {
      icon: <XCircle className="h-9 w-9 text-[var(--muted-foreground)]" />,
      title: "Você não compareceu",
      message: "Este horário foi registrado como ausência. Faça um novo agendamento quando quiser.",
    },
  }[status] ?? {
    icon: <Check className="h-9 w-9 text-[var(--primary)]" />,
    title: 'Agendamento',
    message: '',
  }

  return (
    <div className="text-center pt-2">
      <div
        className={cn(
          'w-20 h-20 rounded-full border-2 flex items-center justify-center mx-auto mb-5',
          status === 'CONFIRMED'
            ? 'bg-[var(--primary)]/15 border-[var(--primary)]/40'
            : 'bg-[var(--primary)]/10 border-[var(--primary)]/35',
        )}
      >
        {presentation.icon}
      </div>
      <h1 className="font-display text-2xl font-bold tracking-tight mb-2">
        {presentation.title}
      </h1>
      <p className="text-sm text-[var(--muted-foreground)]">{presentation.message}</p>
    </div>
  )
}

/** Serviço, data, horário e referência. Sem dado financeiro sensível. */
function Details({ view }: { view: BookingRequestView }) {
  const { appointment } = view
  const [year, month, day] = appointment.date.split('-')

  return (
    <dl className="rounded-2xl border border-[var(--primary)]/25 bg-[var(--surface-bronze)] divide-y divide-[var(--border)]/60">
      <Row label="Serviço" value={appointment.serviceName} />
      <Row label="Data" value={`${day}/${month}/${year}`} />
      <Row
        label="Horário"
        value={`${appointment.startsAtClock} – ${appointment.endsAtClock}`}
      />
      <Row label="Valor" value={`R$ ${appointment.servicePriceFormatted}`} />
      {view.reference && (
        <Row
          label="Referência"
          value={<span className="font-mono tracking-wide">{view.reference}</span>}
        />
      )}
    </dl>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
      <dd className="text-sm font-medium text-right">{value}</dd>
    </div>
  )
}

/**
 * Painel de pagamento.
 *
 * Não existe botão "já paguei": o estado só muda quando o BACKEND recebe e
 * valida a notificação do provedor. O que esta tela oferece é abrir o checkout,
 * copiar o Pix e reconsultar — nada que afirme pagamento por conta própria.
 */
function PaymentPanel({
  payment,
  onRefresh,
}: {
  payment: PaymentView
  onRefresh: () => void
}) {
  // Contagem regressiva a partir do que o servidor informou. O relógio do
  // dispositivo pode estar errado; o prazo do servidor não.
  const [remaining, setRemaining] = useState(payment.expiresInSeconds)
  useEffect(() => {
    setRemaining(payment.expiresInSeconds)
    const timer = setInterval(() => setRemaining(seconds => Math.max(0, seconds - 1)), 1000)
    return () => clearInterval(timer)
  }, [payment.expiresInSeconds])

  // Prazo esgotado na tela: reconsulta para pegar o estado real do servidor em
  // vez de decidir sozinha que expirou.
  useEffect(() => {
    if (remaining === 0 && payment.status === 'PENDING') onRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining === 0])

  const [copied, setCopied] = useState(false)

  const label = {
    PENDING: 'Aguardando pagamento',
    PAID: 'Pagamento confirmado',
    FAILED: 'Pagamento recusado',
    EXPIRED: 'Pagamento expirado',
    CANCELED: 'Pagamento cancelado',
  }[payment.status]

  const tone =
    payment.status === 'PAID'
      ? 'border-[var(--primary)]/40 bg-[var(--primary)]/10'
      : payment.status === 'PENDING'
        ? 'border-[var(--primary)]/25 bg-[var(--surface-bronze)]'
        : 'border-[var(--destructive)]/40 bg-[var(--destructive)]/10'

  async function copyPix() {
    if (!payment.pixQrCode) return
    try {
      await navigator.clipboard.writeText(payment.pixQrCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Área de transferência bloqueada: o código segue visível para copiar
      // à mão. Não é motivo para mostrar erro.
    }
  }

  return (
    <section className={cn('rounded-2xl border p-4 space-y-4', tone)}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-[var(--muted-foreground)] mb-0.5">
            {payment.mode === 'DEPOSIT' ? 'Sinal' : 'Valor total'}
          </p>
          <p className="font-display text-2xl font-bold tracking-tight">
            R$ {payment.amountFormatted}
          </p>
        </div>
        <span
          role="status"
          className="text-xs font-medium px-2.5 py-1 rounded-full border border-current/30 text-[var(--primary)] shrink-0"
        >
          {label}
        </span>
      </header>

      {payment.status === 'PENDING' && (
        <>
          <p className="text-sm text-[var(--muted-foreground)]">
            {remaining > 0 ? (
              <>
                Tempo para pagar:{' '}
                <span className="text-[var(--foreground)] font-medium tabular-nums">
                  {formatRemaining(remaining)}
                </span>
              </>
            ) : (
              'O prazo terminou. Estamos verificando…'
            )}
          </p>

          {payment.checkoutUrl && (
            <Button className="w-full h-11" asChild>
              <a href={payment.checkoutUrl} target="_blank" rel="noopener noreferrer">
                Pagar agora
              </a>
            </Button>
          )}

          {payment.pixQrCode && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--muted-foreground)]">Pix copia e cola</p>
              <p className="font-mono text-[11px] leading-relaxed break-all rounded-lg bg-black/30 p-3 text-[var(--muted-foreground)]">
                {payment.pixQrCode}
              </p>
              <Button variant="outline" className="w-full h-11" onClick={copyPix}>
                <Copy className="h-4 w-4 mr-2" />
                {copied ? 'Código copiado' : 'Copiar código Pix'}
              </Button>
            </div>
          )}

          <p className="text-xs text-[var(--muted-foreground)]">
            A confirmação é automática assim que o pagamento é processado. Você
            não precisa avisar ninguém.
          </p>
        </>
      )}

      {payment.status === 'FAILED' && remaining > 0 && (
        <p className="text-sm">
          O pagamento não foi aprovado. Você ainda pode tentar de novo dentro do
          prazo — seu horário continua reservado por{' '}
          <span className="font-medium tabular-nums">{formatRemaining(remaining)}</span>.
        </p>
      )}
    </section>
  )
}

/** Confirmado: resumo + WhatsApp, com a reserva independente do redirect. */
function Confirmed({ view }: { view: BookingRequestView }) {
  return (
    <div className="space-y-4">
      {view.payment?.status === 'PAID' && (
        <p className="flex items-center gap-2 rounded-xl border border-[var(--primary)]/35 bg-[var(--primary)]/10 px-4 py-3 text-sm">
          <Check className="h-4 w-4 shrink-0 text-[var(--primary)]" />
          <span>
            Pagamento confirmado — R$ {view.payment.amountFormatted}
          </span>
        </p>
      )}

      {view.whatsappUrl && (
        <>
          <Button className="w-full h-11" asChild>
            {/*
              Ação explícita da pessoa, nunca abertura automática: navegador
              móvel bloqueia pop-up sem gesto, e o usuário ficaria olhando uma
              tela que não fez nada.
            */}
            <a href={view.whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4 mr-2" />
              Confirmar pelo WhatsApp
            </a>
          </Button>
          <p className="text-xs text-center text-[var(--muted-foreground)]">
            Seu agendamento já está confirmado. O WhatsApp é só para avisar a
            barbearia — se ele não abrir, está tudo certo do mesmo jeito.
          </p>
        </>
      )}

      <p className="text-sm text-[var(--muted-foreground)] text-center">
        Chegue com 5 minutos de antecedência.
      </p>
    </div>
  )
}

function Empty({
  title,
  message,
  onRetry,
}: {
  title: string
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="py-12 text-center">
      <AlertCircle className="h-8 w-8 mx-auto mb-4 text-[var(--muted-foreground)]" />
      <h1 className="font-display text-xl font-bold tracking-tight mb-2">{title}</h1>
      <p className="text-sm text-[var(--muted-foreground)] mb-6">{message}</p>
      <div className="space-y-3">
        {onRetry && (
          <Button variant="outline" className="w-full h-11" onClick={onRetry}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Tentar novamente
          </Button>
        )}
        <Button className="w-full h-11" asChild>
          <Link to="/agendar">Fazer um agendamento</Link>
        </Button>
      </div>
    </div>
  )
}

/** "14:59" ou "45s" — o formato menor não mente sobre precisão. */
function formatRemaining(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}
