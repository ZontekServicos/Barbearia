import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertCircle, Check, Clock, Hourglass, MessageCircle, RefreshCw, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiError, isAbortError } from '@/services/api'
import PixPayment from '@/components/booking/PixPayment'
import {
  forgetRequestToken,
  getBookingRequest,
  reportPixPayment,
  readRequestToken,
  type BookingRequestView,
  type PaymentView,
  type PixView,
} from '@/services/public-booking'
import { cn } from '@/lib/utils'

/**
 * Acompanhamento de UMA solicitação: aprovação, pagamento e confirmação.
 *
 * Por que é uma tela separada do fluxo de agendamento, e não um sexto passo do
 * stepper: ela é o lugar onde a pessoa VOLTA. A confirmação depende de a
 * barbearia conferir o extrato, o que acontece minutos ou horas mais tarde, e
 * quem fecha o navegador precisa reencontrar tudo pelo link — o Pix, o prazo e,
 * no fim, a confirmação. Um passo 6 do stepper existiria só naquela sessão.
 *
 * O Pix, porém, já está aqui na primeira visita: a cobrança nasce com a
 * solicitação, então quem quer pagar na hora paga, sem esperar aprovação. O
 * agendamento segue PENDING até a barbearia decidir — e esta tela nunca diz
 * "confirmado" antes disso.
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
  /** Consulta manual em andamento. Mantém o botão ocupado sem piscar a tela. */
  const [refreshing, setRefreshing] = useState(false)
  const inFlight = useRef<AbortController | null>(null)
  /** Último estado conhecido, legível por funções estáveis (ver `load`). */
  const latest = useRef<BookingRequestView | null>(null)
  const [reportFallbackUrl, setReportFallbackUrl] = useState<string | null>(null)

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
        latest.current = next
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
        /**
         * Uma falha de rede não apaga o que já estava na tela.
         *
         * O último estado conhecido é lido do REF, não do closure: `load` é
         * estável de propósito (ver dependências), então uma cópia de `view`
         * capturada aqui ficaria velha e poderia jogar a tela para o estado de
         * erro mesmo havendo dados bons já renderizados.
         */
        setPhase(latest.current ? 'ready' : 'error')
      } finally {
        if (inFlight.current === controller) inFlight.current = null
      }
    },
    /**
     * Só o token. `load` precisa ser ESTÁVEL: ela é capturada por intervalos e
     * por ouvintes de evento, e recriá-la a cada mudança de `view` deixava
     * versões velhas rodando — com um `view` velho dentro, e com o risco de
     * ouvintes registrados apontarem para uma função que já não é a atual.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  )

  /**
   * Consulta manual do botão "Atualizar".
   *
   * `quiet` para a tela não voltar ao esqueleto de carregamento: o estado atual
   * continua visível enquanto a resposta vem, e só o botão mostra progresso.
   * Cliques repetidos são ignorados enquanto a anterior não termina.
   */
  const refresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await load({ quiet: true })
    } finally {
      setRefreshing(false)
    }
  }, [load, refreshing])

  useEffect(() => {
    void load()
    return () => inFlight.current?.abort()
    // Só o token define a consulta. `load` é mantida estável e lê o último
    // estado pelo ref, evitando recriar o efeito a cada resposta.
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
  /**
   * Estados que ainda podem mudar por ação de outra pessoa.
   *
   * CONFIRMED, REJECTED, CANCELLED, EXPIRED, COMPLETED e NO_SHOW são finais:
   * continuar consultando ali seria bater no servidor sem motivo.
   */
  const watching = status === 'PENDING' || status === 'AWAITING_PAYMENT'
  useEffect(() => {
    if (!watching) return
    const timer = setInterval(() => void load({ quiet: true }), POLL_MS)
    return () => clearInterval(timer)
  }, [watching, load])

  /**
   * Volta para a aba: consulta na hora.
   *
   * É a correção do sintoma relatado. O navegador estrangula — às vezes
   * suspende — `setInterval` em aba de segundo plano, então quem aprova no
   * painel em outra aba e volta para cá encontrava a tela parada no estado
   * antigo até o intervalo voltar a rodar. Esperar o próximo ciclo não serve:
   * a pessoa está olhando agora.
   *
   * `focus` entra junto porque cobre voltar ao navegador sem trocar de aba.
   */
  useEffect(() => {
    if (!watching) return
    const refresh = () => {
      if (document.visibilityState === 'visible') void load({ quiet: true })
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [watching, load])

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

      {/* PENDING entra junto: a cobrança nasce com a solicitação, então o Pix
          aparece antes de qualquer decisão da barbearia. AWAITING_PAYMENT
          continua valendo para pedidos criados antes dessa mudança. */}
      {(view.appointment.status === 'AWAITING_PAYMENT' ||
        view.appointment.status === 'PENDING') && view.payment && (
        <PaymentPanel
          payment={view.payment}
          pix={view.pix}
          helpUrl={view.paymentHelpUrl}
          paidUrl={view.pixPaidUrl}
          reported={view.paymentReported}
          onReport={async () => {
            if (!token) return
            const result = await reportPixPayment(token)
            const url = view.pixPaidUrl
            // O POST já persistiu: retire o QR mesmo se o GET seguinte falhar.
            inFlight.current?.abort()
            setView(current => current && current.payment ? {
              ...current, pix: null, pixPaidUrl: null, paymentReported: true,
              payment: {
                ...current.payment, ...result, expiresAt: result.reviewExpiresAt,
                expiresInSeconds: Math.min(current.payment.expiresInSeconds, Math.max(0, Math.floor((Date.parse(result.reviewExpiresAt) - Date.parse(result.reportedAt)) / 1000))),
              },
            } : current)
            setReportFallbackUrl(url)
            if (url) {
              try { window.open(url, '_blank', 'noopener,noreferrer') } catch { /* Link manual abaixo. */ }
            }
            await load({ quiet: true })
          }}
          onRefresh={() => void load({ quiet: true })}
        />
      )}

      {(view.appointment.status === 'PENDING' ||
        view.appointment.status === 'AWAITING_PAYMENT') &&
        view.paymentReported && reportFallbackUrl && (
        <p role="status" className="text-sm text-[var(--muted-foreground)]">
          Se o WhatsApp não abriu, você pode{' '}
          <a href={reportFallbackUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] underline">
            abrir o WhatsApp
          </a>.
        </p>
      )}
      {view.appointment.status === 'CONFIRMED' && <Confirmed view={view} />}

      <div className="space-y-3 pt-2">
        {/*
          Avisar a barbearia, enquanto o pedido aguarda análise.
          Repetido aqui, e não só na tela de sucesso, porque quem fecha a aba e
          volta pelo link precisa reencontrar a mesma ação — sem isto o aviso só
          existiria no instante seguinte à criação.
        */}
        {view.appointment.status === 'PENDING' && view.notifyUrl && (
          <>
            <p className="text-sm text-center text-[var(--muted-foreground)]">
              Avise a barbearia para que sua solicitação seja analisada.
            </p>
            <Button className="w-full h-11" asChild>
              <a href={view.notifyUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4 mr-2" />
                Avisar a barbearia no WhatsApp
              </a>
            </Button>
          </>
        )}
        {watching && (
          <Button
            variant="outline"
            className="w-full h-11"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', refreshing && 'animate-spin')} />
            {refreshing ? 'Atualizando...' : 'Atualizar'}
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
      /**
       * O título depende de haver pagamento a fazer.
       *
       * Com Pix na tela, "Aguardando aprovação" faz a pessoa guardar o celular e
       * esperar — exatamente o contrário do que a tela está pedindo. Sem Pix
       * (instalação sem pagamento), a espera é mesmo pela barbearia.
       *
       * Em nenhum dos casos a palavra "confirmado" aparece: o agendamento só
       * está confirmado depois de a barbearia decidir.
       */
      title: !view.payment
        ? 'Aguardando aprovação'
        : view.paymentReported
          ? 'Pagamento informado'
          : 'Falta o pagamento',
      message: !view.payment
        ? 'A barbearia está avaliando seu pedido. Seguramos este horário enquanto isso.'
        : view.paymentReported
          ? 'Aguarde a conferência da barbearia para o horário ser confirmado.'
          : 'Pague o Pix abaixo e avise a barbearia. Seguramos este horário até o prazo.',
    },
    AWAITING_PAYMENT: {
      icon: <Clock className="h-9 w-9 text-[var(--primary)]" />,
      title: 'Seu horário foi aprovado!',
      // A palavra "confirmado" não aparece aqui de propósito: o agendamento
      // ainda não está, e prometer isso é o erro que faz a pessoa não pagar.
      message: view.paymentReported
        ? 'Aguarde a conferência da barbearia.'
        : 'Agora realize o pagamento para confirmar o agendamento.',
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
      title: 'Solicitação recusada',
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
      <Row label="Valor do serviço" value={`R$ ${appointment.servicePriceFormatted}`} />
      {/*
        Linha separada para o que está sendo cobrado. Só aparece quando difere
        do preço do serviço — no modo sinal, por exemplo. Repetir o mesmo número
        com dois rótulos confundiria mais do que informa.
      */}
      {view.payment && view.payment.amountFormatted !== appointment.servicePriceFormatted && (
        <Row
          label={view.payment.status === 'PAID' ? 'Valor pago' : 'Valor a pagar'}
          value={`R$ ${view.payment.amountFormatted}`}
        />
      )}
      {view.payment?.status === 'PAID' &&
        view.payment.amountFormatted === appointment.servicePriceFormatted && (
          <Row label="Pagamento" value="Pago" />
        )}
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
 * O CTA "Já fiz o Pix" registra somente a declaração do cliente e abre a
 * conversa. Pagamento e agendamento continuam pendentes até a decisão do ADMIN.
 */
function PaymentPanel({
  payment,
  pix,
  helpUrl,
  paidUrl,
  reported,
  onReport,
  onRefresh,
}: {
  payment: PaymentView
  pix: PixView | null
  helpUrl: string | null
  paidUrl: string | null
  /** Cliente já declarou o pagamento; a barbearia ainda não decidiu. */
  reported: boolean
  onReport: () => Promise<void>
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

  const label = {
    PENDING: reported ? 'Aguardando conferência' : 'Aguardando pagamento',
    PAID: 'Pagamento confirmado',
    FAILED: 'Não foi possível confirmar o pagamento',
    EXPIRED: 'Pagamento expirado',
    CANCELED: 'Pagamento cancelado',
  }[payment.status]

  const tone =
    payment.status === 'PAID'
      ? 'border-[var(--primary)]/40 bg-[var(--primary)]/10'
      : payment.status === 'PENDING'
        ? 'border-[var(--primary)]/25 bg-[var(--surface-bronze)]'
        : 'border-[var(--destructive)]/40 bg-[var(--destructive)]/10'

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
                {reported ? 'Prazo para a barbearia conferir: ' : 'Tempo para pagar: '}
                <span className="text-[var(--foreground)] font-medium tabular-nums">
                  {formatRemaining(remaining)}
                </span>
              </>
            ) : (
              'O prazo terminou. Não realize o pagamento. Estamos verificando…'
            )}
          </p>

          {/*
            Pagamento declarado: o QR sai da tela.

            Mantê-lo convidaria a pagar de novo — e a pessoa já pagou. A partir
            daqui a tela fala de CONFERÊNCIA, e em nenhum momento diz
            "confirmado", que continua dependendo da barbearia.
          */}
          {reported && (
            <div className="rounded-2xl border border-[var(--primary)]/35 bg-[var(--primary)]/10 p-4 space-y-2">
              <p className="flex items-center gap-2 font-medium text-[var(--primary)]">
                <Check className="h-4 w-4 shrink-0" />
                Pagamento informado
              </p>
              <p className="text-sm text-[var(--foreground)]">
                Estamos aguardando a barbearia confirmar o recebimento.
              </p>
              <p className="text-sm text-[var(--muted-foreground)]">
                Seu horário permanece reservado durante a conferência.
              </p>
            </div>
          )}

          {/* Pix: QR, chave e Copia e Cola, tudo montado no backend. */}
          {remaining > 0 && pix && !reported && (
            <PixPayment
              pix={pix}
              amountFormatted={payment.amountFormatted}
              paidUrl={paidUrl}
              onReport={onReport}
            />
          )}

          {/*
            Checkout do provedor, quando existe. Complementa o Pix em vez de
            substituí-lo: alguns provedores oferecem cartão na mesma cobrança.
          */}
          {remaining > 0 && payment.checkoutUrl && (
            <Button variant={pix ? 'outline' : 'default'} className="w-full h-11" asChild>
              <a href={payment.checkoutUrl} target="_blank" rel="noopener noreferrer">
                Abrir outras formas de pagamento
              </a>
            </Button>
          )}

          {/*
            Sem Pix apresentável e sem checkout: não inventamos QR nenhum. A
            pessoa fala com a barbearia, que é a única saída honesta aqui.
          */}
          {remaining > 0 && !reported && !pix && !payment.checkoutUrl && (
            <p className="text-sm text-[var(--foreground)]">
              Não conseguimos gerar o pagamento agora. Fale com a barbearia para
              combinar o pagamento e garantir seu horário.
            </p>
          )}

          {/*
            "Falar com a barbearia" durante o pagamento — mensagem que diz
            APROVADO, nunca confirmado.
          */}
          {/* Ajuda genérica, secundária ao "já fiz o Pix". */}
          {remaining > 0 && helpUrl && (
            <Button variant="ghost" className="w-full h-11 text-[var(--primary)]" asChild>
              <a href={helpUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4 mr-2" />
                Falar com a barbearia
              </a>
            </Button>
          )}
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
