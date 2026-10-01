import type { Prisma } from "../../generated/prisma/client.js"
import { prisma } from "../../config/prisma.js"
import { logger } from "../../utils/logger.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { STATIC_PIX_PROVIDER } from "./pix/pix.service.js"
import {
  BookingRules,
  canReviewPayment,
  paymentAmountCents,
  paymentReviewDeadline,
} from "../booking/booking.rules.js"
import { getPaymentProvider, requirePaymentProvider as requirePaymentProviderForWebhook } from "./payment.registry.js"
import type { RawWebhookRequest } from "./payment.provider.js"

/**
 * Pagamento como gatilho da confirmação.
 *
 * Dois princípios governam este módulo:
 *
 * 1. O estado do DINHEIRO (`Payment.status`) é separado do estado do
 *    AGENDAMENTO (`Appointment.status`). Um pagamento recusado não apaga a
 *    reserva; uma reserva cancelada não reescreve o histórico financeiro.
 *
 * 2. CONFIRMED exige as duas coisas: aprovação do barbeiro E dinheiro
 *    confirmado pelo BACKEND a partir do provedor. Não existe caminho por
 *    redirect, query string ou botão "já paguei" — nenhuma função aqui aceita
 *    "está pago" como parâmetro.
 */

/** O que o cliente pode ver sobre a própria cobrança. */
export interface PublicPayment {
  status: "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELED"
  amountCents: number
  amountFormatted: string
  currency: string
  mode: "FULL" | "DEPOSIT"
  /**
   * Quanto falta do prazo VIGENTE, em segundos. Nunca negativo.
   *
   * Antes da declaração é o prazo para pagar; depois dela, o prazo de
   * conferência da barbearia. A tela mostra um número só porque, para quem
   * espera, existe um prazo só.
   */
  expiresInSeconds: number
  expiresAt: string
  checkoutUrl: string | null
  pixQrCode: string | null
  /** Quando o cliente declarou ter pago. `null` = ainda não declarou. */
  reportedAt: string | null
  /** Prazo da barbearia para conferir. `null` sem declaração. */
  reviewExpiresAt: string | null
}

const formatCents = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function toPublicPayment(
  payment: {
    status: PublicPayment["status"]
    amountCents: number
    currency: string
    mode: PublicPayment["mode"]
    expiresAt: Date
    checkoutUrl: string | null
    pixQrCode: string | null
    paymentReportedAt?: Date | null
    reviewExpiresAt?: Date | null
  },
  now: Date = new Date(),
  reservationExpiresAt?: Date | null,
): PublicPayment {
  /**
   * Declarado o pagamento, quem manda é o prazo de conferência.
   *
   * Continuar mostrando o prazo original faria a tela contar para zero enquanto
   * a barbearia ainda tem um dia para olhar o extrato — e o cliente pensaria que
   * perdeu o horário que acabou de pagar.
   */
  const deadline = payment.reviewExpiresAt ?? reservationExpiresAt ?? payment.expiresAt
  return {
    status: payment.status,
    amountCents: payment.amountCents,
    amountFormatted: formatCents(payment.amountCents),
    currency: payment.currency,
    mode: payment.mode,
    expiresInSeconds: Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / 1000)),
    expiresAt: deadline.toISOString(),
    checkoutUrl: payment.checkoutUrl,
    pixQrCode: payment.pixQrCode,
    reportedAt: payment.paymentReportedAt?.toISOString() ?? null,
    reviewExpiresAt: payment.reviewExpiresAt?.toISOString() ?? null,
  }
}

/**
 * Abre a cobrança de um agendamento recém-aprovado.
 *
 * Chamada de DENTRO da transação de aprovação, para que aprovar e cobrar sejam
 * atômicos: não existe estado "aprovado mas sem cobrança" visível para
 * ninguém. O provedor é chamado antes da transação (ver `decidePendingRequest`)
 * porque rede não pertence a transação de banco.
 *
 * O valor vem de `servicePriceCents` congelado na reserva, que veio de
 * `Service.priceCents`. Não há parâmetro de valor — não há por onde o navegador
 * influenciar quanto se cobra.
 */
export async function createPaymentForAppointment(
  tx: Prisma.TransactionClient,
  appointment: {
    id: string
    servicePriceCents: number
    serviceName: string
    publicReference: string
  },
  created: {
    /**
     * Quem recebe. Um provedor real, ou `static-pix` quando a barbearia recebe
     * pelo próprio Pix — aí não há cobrança externa e `providerPaymentId` fica
     * nulo, porque não existe identificador de terceiro a guardar.
     */
    provider: string
    providerPaymentId?: string
    checkoutUrl?: string
    pixQrCode?: string
  },
  expiresAt: Date,
): Promise<void> {
  await tx.payment.create({
    data: {
      appointmentId: appointment.id,
      provider: created.provider,
      providerPaymentId: created.providerPaymentId ?? null,
      mode: BookingRules.paymentMode,
      amountCents: paymentAmountCents(appointment.servicePriceCents),
      currency: "BRL",
      status: "PENDING",
      expiresAt,
      checkoutUrl: created.checkoutUrl ?? null,
      pixQrCode: created.pixQrCode ?? null,
    },
  })
}

/** Dados que o provedor precisa para abrir a cobrança. */
export function paymentRequestFor(appointment: {
  serviceName: string
  servicePriceCents: number
  publicReference: string
}, expiresAt: Date) {
  return {
    reference: appointment.publicReference,
    amountCents: paymentAmountCents(appointment.servicePriceCents),
    currency: "BRL",
    // Sem nome, telefone ou qualquer dado pessoal: isto atravessa sistema de
    // terceiro e aparece em extrato.
    description: `ErickCorttes — ${appointment.serviceName}`,
    expiresAt,
  }
}

export type WebhookOutcome =
  | "CONFIRMED"
  | "DUPLICATE"
  | "AMOUNT_MISMATCH"
  | "REFERENCE_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "PAYMENT_NOT_FOUND"
  | "WINDOW_CLOSED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELED"
  | "IGNORED"

/**
 * Processa a notificação do provedor. É o ÚNICO caminho que confirma dinheiro.
 *
 * Idempotente pela unicidade `(provider, external_id)` em
 * `payment_webhook_events`: a mesma notificação reenviada tenta gravar a mesma
 * linha, colide, e a transação inteira é descartada sem reaplicar efeito
 * nenhum. Dez reenvios = uma confirmação.
 *
 * Conferências antes de aceitar, todas porque a notificação vem de fora:
 *   - assinatura (feita pelo provedor, em `parseWebhook`);
 *   - a cobrança existe e é nossa;
 *   - a referência é a daquele agendamento;
 *   - o valor é exatamente o esperado;
 *   - a moeda é a esperada;
 *   - a janela de pagamento não venceu.
 *
 * Fora de ordem é tratado: uma notificação PENDING que chega depois de PAID não
 * rebaixa nada, e uma notificação após a expiração não ressuscita a reserva.
 */
export async function processPaymentWebhook(
  request: RawWebhookRequest,
  now: Date = new Date(),
): Promise<{ outcome: WebhookOutcome }> {
  // Webhook só existe com provedor real. Pix estático não tem quem notifique —
  // a confirmação dele é administrativa (ver confirmStaticPayment).
  const provider = requirePaymentProviderForWebhook()
  // Assinatura inválida lança aqui, antes de qualquer acesso ao banco: uma
  // mensagem não autenticada não merece consulta.
  const notification = await provider.parseWebhook(request)

  let outcome: WebhookOutcome = "IGNORED"
  try {
    await prisma.$transaction(async tx => {
      const payment = await tx.payment.findUnique({
        where: {
          provider_providerPaymentId: {
            provider: provider.name,
            providerPaymentId: notification.payment.providerPaymentId,
          },
        },
        include: { appointment: true },
      })

      if (!payment) {
        outcome = "PAYMENT_NOT_FOUND"
      } else if (payment.appointment.publicReference !== notification.payment.reference) {
        // Notificação de uma cobrança que não corresponde a este agendamento.
        outcome = "REFERENCE_MISMATCH"
      } else if (notification.payment.currency !== payment.currency) {
        outcome = "CURRENCY_MISMATCH"
      } else if (
        notification.payment.status === "PAID" &&
        notification.payment.amountCents !== payment.amountCents
      ) {
        // Valor divergente NUNCA confirma. Pagar menos não compra o horário.
        outcome = "AMOUNT_MISMATCH"
      } else if (payment.status === "PAID") {
        // Já confirmado: nada a reaplicar, e nenhuma notificação posterior
        // rebaixa um pagamento confirmado.
        outcome = "DUPLICATE"
      } else if (notification.payment.status === "PAID") {
        if (payment.expiresAt <= now) {
          // Pagou depois da janela. O horário já não é dele: pode ter sido
          // reservado por outra pessoa, e forçar aqui violaria a EXCLUDE.
          // Marcado como EXPIRED para a barbearia resolver o estorno.
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: "EXPIRED" },
          })
          outcome = "WINDOW_CLOSED"
        } else {
          await lockAppointment(tx, payment.appointmentId)
          const current = await tx.appointment.findUniqueOrThrow({
            where: { id: payment.appointmentId },
          })
          if (current.status !== "AWAITING_PAYMENT") {
            // O barbeiro cancelou, ou a reserva expirou, entre a cobrança e a
            // notificação. Não reabrimos: o dinheiro entrou e a barbearia
            // precisa estornar, mas a agenda manda.
            await tx.payment.update({
              where: { id: payment.id },
              data: { status: "PAID", paidAt: now },
            })
            outcome = "WINDOW_CLOSED"
          } else {
            await tx.payment.update({
              where: { id: payment.id },
              data: { status: "PAID", paidAt: now },
            })
            await tx.appointment.update({
              where: { id: payment.appointmentId },
              // Agora sim: aprovado pelo barbeiro E pago. `pendingExpiresAt`
              // volta a ser nulo — a reserva não depende mais de prazo.
              data: { status: "CONFIRMED", pendingExpiresAt: null },
            })
            outcome = "CONFIRMED"
          }
        }
      } else if (notification.payment.status === "PENDING") {
        // Nada a fazer: já está PENDING. Notificação fora de ordem não rebaixa.
        outcome = "IGNORED"
      } else {
        // FAILED, EXPIRED ou CANCELED: o dinheiro não entrou. A reserva
        // continua AWAITING_PAYMENT até a janela vencer — o cliente ainda pode
        // tentar de novo dentro do prazo.
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: notification.payment.status },
        })
        outcome = notification.payment.status as WebhookOutcome
      }

      // Última coisa da transação: é o carimbo de "esta notificação foi
      // processada". A unicidade faz o reenvio colidir AQUI, desfazendo tudo
      // acima — que é exatamente o comportamento idempotente desejado.
      await tx.paymentWebhookEvent.create({
        data: {
          provider: provider.name,
          externalId: notification.eventId,
          paymentId: payment?.id ?? null,
          outcome,
        },
      })
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Reenvio da mesma notificação. Tudo acima foi desfeito; o efeito da
      // primeira entrega permanece.
      logger.info("Notificação de pagamento repetida, descartada")
      return { outcome: "DUPLICATE" }
    }
    throw error
  }

  logger.info("Notificação de pagamento processada", { outcome })
  return { outcome }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === "P2002",
  )
}

async function lockAppointment(tx: Prisma.TransactionClient, appointmentId: string) {
  await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${appointmentId}::uuid FOR UPDATE`
}

/**
 * Libera reservas cuja janela de pagamento venceu.
 *
 * Mesmo desenho da expiração de pendentes: acontece na transação do insert,
 * restrita ao intervalo em disputa (ver appointments.service). Esta função
 * existe para o caminho de LEITURA do cliente — abrir a própria solicitação
 * precisa mostrar "expirado" mesmo que ninguém tenha tentado reservar o horário
 * desde então.
 */
export function isPaymentWindowClosed(
  appointment: { status: string; pendingExpiresAt: Date | null },
  now: Date,
): boolean {
  /**
   * Os DOIS estados que seguram horário com prazo entram aqui.
   *
   * `PENDING` passou a ter cobrança desde que o Pix nasce com a solicitação, e
   * ali `pendingExpiresAt` é justamente o prazo para pagar. Deixá-lo de fora
   * fazia a janela nunca "fechar" nesse estado — ou seja, aceitaria declaração
   * e confirmação de uma reserva já caducada, com o horário possivelmente já
   * vendido para outra pessoa.
   */
  return (
    (appointment.status === "AWAITING_PAYMENT" || appointment.status === "PENDING") &&
    appointment.pendingExpiresAt !== null &&
    appointment.pendingExpiresAt.getTime() <= now.getTime()
  )
}

/** Pagamento está configurado nesta instalação? */
export const paymentsAvailable = () => getPaymentProvider() !== null

/**
 * Confirmação ADMINISTRATIVA de um pagamento em Pix estático.
 *
 * Existe porque o Pix estático não tem quem notifique: o dinheiro cai na conta
 * da barbearia e alguém de lá confere no extrato. Sem esta rota, um agendamento
 * pago ficaria preso em AWAITING_PAYMENT até a janela vencer.
 *
 * O que ela NÃO é: um atalho para o cliente. Exige sessão de ADMIN ativa, e o
 * cliente não tem como alcançá-la — nem clicando em "já paguei", que não existe.
 *
 * Recusada para cobrança de provedor: ali quem confirma é o webhook, e permitir
 * confirmação manual abriria caminho para marcar pago algo que o provedor nunca
 * recebeu.
 *
 * Roda sob lock da linha, pelo mesmo motivo do cancelamento: um webhook ou um
 * cancelamento concorrente não pode ser sobrescrito.
 */
export async function settleStaticPayment(
  actorId: string,
  appointmentId: string,
  decision: "PAID" | "FAILED",
  now?: Date,
): Promise<void> {
  await prisma.$transaction(async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId } })
    if (actor?.role !== "ADMIN" || actor.status !== "ACTIVE") throw AppError.forbidden()

    await lockAppointment(tx, appointmentId)
    const appointment = await tx.appointment.findUnique({
      where: { id: appointmentId },
      include: { payment: true },
    })
    if (!appointment) throw AppError.notFound(ErrorCodes.NOT_FOUND, "Agendamento não encontrado.")
    now ??= new Date()
    const payment = appointment.payment
    if (!payment) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, "Este agendamento não tem cobrança.")
    }
    if (payment.provider !== STATIC_PIX_PROVIDER) {
      throw AppError.conflict(
        ErrorCodes.CONFLICT,
        "Esta cobrança é de provedor: a confirmação vem da notificação dele.",
      )
    }
    if (payment.status === "PAID") {
      throw AppError.conflict(ErrorCodes.CONFLICT, "Este pagamento já foi confirmado.")
    }
    /**
     * De onde a confirmação pode partir.
     *
     * `PENDING` é o caminho normal desde que o Pix passou a nascer com a
     * solicitação: a barbearia vê o dinheiro no extrato e confirma o pagamento
     * E o agendamento no MESMO ato — é a ação "Confirmar pagamento e
     * agendamento", e é esta transação que a torna indivisível.
     *
     * `AWAITING_PAYMENT` continua aceito porque reservas criadas antes dessa
     * mudança ficaram nesse estado. Recusá-las aqui deixaria dinheiro já
     * recebido sem nenhuma forma de confirmar.
     */
    if (appointment.status !== "PENDING" && appointment.status !== "AWAITING_PAYMENT") {
      throw AppError.conflict(
        ErrorCodes.CONFLICT,
        "Este agendamento não está aguardando pagamento.",
      )
    }

    // O prazo vale mesmo antes da limpeza persistir EXPIRED no agendamento.
    // Recusar aqui impede reativar uma reserva que a tela já mostrou vencida.
    if ((payment.reviewExpiresAt ?? payment.expiresAt) <= now || isPaymentWindowClosed(appointment, now)) {
      throw AppError.conflict(ErrorCodes.CONFLICT, "O prazo de pagamento deste agendamento terminou.")
    }
    if (payment.status === "EXPIRED" || payment.status === "CANCELED") {
      throw AppError.conflict(ErrorCodes.CONFLICT, "Esta cobrança já foi encerrada.")
    }

    if (decision === "PAID") {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "PAID", paidAt: now },
      })
      // Agora sim: aprovado pelo barbeiro E pagamento conferido.
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: "CONFIRMED", pendingExpiresAt: null },
      })
    } else {
      /**
       * Pix não localizado no extrato.
       *
       * Dentro do menor prazo (pagamento original ou reserva vigente), reabre
       * a mesma cobrança PENDING e o QR. Fora dele, expira imediatamente.
       * A auditoria preserva os primeiros instantes para uma nova declaração
       * não renovar o hold. Recusas repetidas também não aumentam o prazo.
       */
      const retryDeadline = new Date(Math.min(payment.expiresAt.getTime(), (appointment.pendingExpiresAt ?? payment.expiresAt).getTime()))
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: retryDeadline > now ? "PENDING" : "EXPIRED",
          paymentReportedAt: null, reviewExpiresAt: null,
        },
      })
      await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          pendingExpiresAt: retryDeadline,
          ...(retryDeadline <= now ? { status: "EXPIRED" as const, decidedAt: now } : {}),
        },
      })
    }

    await tx.adminAuditLog.create({
      data: {
        actorId,
        targetUserId: appointment.userId,
        action: `PAYMENT_${decision}`,
        metadata: {
          appointmentId,
          provider: payment.provider,
          amountCents: payment.amountCents,
          // Preserva a declaração do cliente mesmo quando ela é desfeita: é o
          // registro de que alguém disse ter pagado e não foi encontrado.
          ...(payment.paymentReportedAt
            ? {
                paymentReportedAt: payment.paymentReportedAt.toISOString(),
                reviewExpiresAt: payment.reviewExpiresAt!.toISOString(),
              }
            : {}),
        },
      },
    })
  })

  logger.info("Pagamento em Pix estático decidido", { actorId, appointmentId, to: decision })
}

/** O que o cliente recebe ao declarar o pagamento. */
export interface PaymentReportResult {
  reportedAt: Date
  /** Até quando a barbearia pode conferir. */
  reviewExpiresAt: Date
  /** `true` quando esta chamada foi a que registrou (não uma repetição). */
  firstReport: boolean
}

/**
 * O cliente declara que fez o Pix: "já fiz o Pix".
 *
 * NÃO É CONFIRMAÇÃO. O pagamento continua PENDING e o agendamento continua
 * PENDING (AWAITING_PAYMENT só existe em reservas legadas). A única autoridade para PAID/CONFIRMED continua sendo a
 * barbearia, depois de ver o dinheiro no extrato (ver `settleStaticPayment`).
 *
 * O que a declaração muda é DE QUEM a agenda está esperando. Antes dela, o prazo
 * era do cliente e vencer significava desistência. Depois dela, o prazo é da
 * barbearia. O vencimento do prazo ORIGINAL não libera o horário; o vencimento
 * da conferência libera, exigindo tratamento manual se houve pagamento.
 *
 * Mecanicamente: `Appointment.pendingExpiresAt` passa a valer o prazo de
 * conferência. Disponibilidade e cleanup usam esse prazo. A EXCLUDE protege
 * os estados ativos; o cleanup atômico expira os vencidos antes de novo insert.
 *
 * Idempotente: a primeira declaração manda. Clicar dez vezes não move
 * `paymentReportedAt` nem estica a conferência — senão o cliente esticaria o
 * prazo à vontade e seguraria o horário indefinidamente.
 */
export async function reportStaticPixPayment(
  publicTokenDigest: string,
  now?: Date,
): Promise<PaymentReportResult> {
  return prisma.$transaction(async tx => {
    const appointment = await tx.appointment.findUnique({
      where: { publicToken: publicTokenDigest },
      include: { payment: true },
    })
    // Token desconhecido responde como qualquer outro não encontrado: quem não
    // tem o token do pedido não descobre nada sobre ele.
    if (!appointment) throw AppError.notFound(ErrorCodes.NOT_FOUND, "Solicitação não encontrada.")

    await lockAppointment(tx, appointment.id)
    const current = await tx.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      include: { payment: true },
    })
    const payment = current.payment
    // O relógio de produção é lido após adquirir o lock, não antes da espera.
    now ??= new Date()

    if (!payment || payment.provider !== STATIC_PIX_PROVIDER) {
      // Sem Pix da barbearia não há o que declarar: numa cobrança de provedor a
      // confirmação chega por webhook.
      throw AppError.conflict(ErrorCodes.CONFLICT, "Este agendamento não aguarda Pix.")
    }

    // `PENDING` é o estado normal de quem vai declarar: o Pix nasce com a
    // solicitação e a pessoa paga antes de qualquer decisão da barbearia.
    // `AWAITING_PAYMENT` segue valendo para as reservas anteriores à mudança.
    if (
      (current.status !== "AWAITING_PAYMENT" && current.status !== "PENDING") ||
      payment.status !== "PENDING"
    ) {
      throw AppError.conflict(ErrorCodes.CONFLICT, "Este agendamento não está aguardando pagamento.")
    }
    if (isPaymentWindowClosed(current, now) || (payment.reviewExpiresAt && payment.reviewExpiresAt <= now)) {
      throw AppError.conflict(ErrorCodes.CONFLICT, "O prazo para pagamento já venceu.")
    }

    // Repetição válida preserva o primeiro registro.
    if (payment.paymentReportedAt && payment.reviewExpiresAt) {
      return {
        reportedAt: payment.paymentReportedAt,
        reviewExpiresAt: payment.reviewExpiresAt,
        firstReport: false,
      }
    }

    // Prazo de pagamento já vencido sem declaração: a reserva caducou pela regra
    // normal e o horário voltou a ser oferecido.
    if (payment.expiresAt <= now) {
      throw AppError.conflict(ErrorCodes.CONFLICT, "O prazo para pagamento já venceu.")
    }
    /**
     * Atendimento perto demais para caber conferência.
     *
     * Aceitar aqui criaria prazo nulo ou negativo, e o cliente sairia achando
     * que avisou quando ninguém teria tempo de conferir antes da cadeira. A
     * saída honesta é falar com a barbearia, que a tela oferece ao lado.
     */
    if (!canReviewPayment(now, current.startsAt)) {
      throw AppError.conflict(
        ErrorCodes.CONFLICT,
        "Seu horário está muito próximo para conferirmos o Pix a tempo. Fale com a barbearia.",
      )
    }

    // Uma nova tentativa autorizada pelo ADMIN não renova a primeira janela.
    // A decisão preserva os dois instantes na auditoria antes de reabrir o QR.
    const decisions = await tx.adminAuditLog.findMany({
      where: { action: "PAYMENT_FAILED", metadata: { path: ["appointmentId"], equals: current.id } },
      orderBy: { createdAt: "asc" },
      select: { metadata: true },
    })
    const previous = decisions.map(entry => entry.metadata as Record<string, unknown> | null)
      .find(entry => typeof entry?.paymentReportedAt === "string" && typeof entry?.reviewExpiresAt === "string")
    const reportedAt = previous ? new Date(previous.paymentReportedAt as string) : now
    const reviewExpiresAt = previous
      ? new Date(Math.min(new Date(previous.reviewExpiresAt as string).getTime(), paymentReviewDeadline(reportedAt, current.startsAt).getTime()))
      : paymentReviewDeadline(now, current.startsAt)
    if (reviewExpiresAt <= now) {
      throw AppError.conflict(ErrorCodes.CONFLICT, "O prazo de conferência já venceu. Fale com a barbearia.")
    }
    await tx.payment.update({
      where: { id: payment.id },
      // Não altera o estado financeiro: declarar não confirma pagamento.
      data: { paymentReportedAt: reportedAt, reviewExpiresAt },
    })
    /**
     * O prazo da RESERVA passa a ser o da conferência.
     *
     * É esta linha que impede o horário de ser liberado enquanto a barbearia
     * ainda não olhou o extrato — sem ela, a varredura expiraria a reserva no
     * `expiresAt` original, com o dinheiro já na conta.
     */
    await tx.appointment.update({
      where: { id: current.id },
      data: { pendingExpiresAt: reviewExpiresAt },
    })

    // Sem dado pessoal: o que importa no log é que a etapa aconteceu.
    logger.info("Cliente declarou pagamento por Pix")
    return { reportedAt, reviewExpiresAt, firstReport: previous === undefined }
  })
}
