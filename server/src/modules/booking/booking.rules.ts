/**
 * Regras de agenda. Ficam centralizadas aqui para não se espalharem pelo
 * código — e para que virarem configuração administrativa no futuro seja uma
 * mudança localizada.
 */
export const BookingRules = {
  /**
   * Grade operacional: de quanto em quanto tempo um início é sugerido.
   *
   * NÃO é a duração de nenhum serviço. Um corte de 30 min continua durando 30
   * min; o que a grade define é a cadência de inícios oferecidos, para o
   * barbeiro não receber opções de 15 em 15.
   */
  baseSlotMinutes: 40,

  /**
   * Teto de opções de início exibidas por dia.
   *
   * Quando a grade produz mais que isto, a lista é reduzida por amostragem
   * espaçada ao longo do dia — nunca cortando o fim do expediente. É limite de
   * OPÇÕES EXIBIDAS, não de reservas aceitas: o barbeiro pode ter mais
   * atendimentos no dia do que opções oferecidas de uma vez.
   */
  maxDailyStartOptions: 20,

  /**
   * Política adaptativa: além da grade fixa, oferecer início logo no fim de um
   * atendimento já marcado.
   *
   * Com 09:00–09:50 ocupado e grade de 40 min, a grade sozinha só voltaria a
   * oferecer 10:20. Ligada, a engine também oferece 09:50, desde que todo o
   * intervalo necessário esteja livre. Desligada, vale só a grade.
   *
   * Controla apenas a geração de horários NOVOS. Nenhuma reserva existente é
   * deslocada por causa disso.
   */
  adaptiveSchedulingEnabled: true,

  /**
   * Intervalo mínimo que um atendimento ocupa na agenda, independentemente de
   * durar menos: `max(baseSlotMinutes, duração + buffers)`.
   *
   * Existe para o barbeiro não ficar com sobras de 10 min impossíveis de
   * vender. O cliente continua vendo a duração real do serviço — nunca
   * dizemos que um corte de 30 min dura 40.
   */
  enforceMinimumReservation: true,

  /**
   * Solicitação pública aguarda confirmação do barbeiro.
   *
   * DECISÃO DE NEGÓCIO. A regra antiga ("admin aprova o cliente antes do
   * primeiro agendamento") não sobrevive à remoção do login, porque não há
   * mais conta para aprovar. Em vez de descartá-la em silêncio, ela foi
   * movida para o agendamento:
   *
   *   true  → a reserva nasce PENDING, o cliente vê "Solicitação enviada" e o
   *           barbeiro confirma ou recusa. O horário fica segurado enquanto
   *           pendente (ver pendingRequestTtlMinutes).
   *   false → a reserva nasce CONFIRMED e o cliente vê "Agendamento
   *           confirmado".
   *
   * Os dois caminhos estão implementados e testados; trocar é mudar esta
   * linha. O texto do botão e da tela de sucesso acompanha automaticamente.
   */
  publicRequestsRequireApproval: true,

  /**
   * Por quanto tempo uma solicitação pendente segura o horário.
   *
   * Sem isto, um pedido esquecido bloquearia a agenda para sempre. Passado o
   * prazo a solicitação vira EXPIRED e o horário volta a ser oferecido.
   */
  pendingRequestTtlMinutes: 120,

  /** Antecedência mínima entre agora e o início do atendimento. */
  minimumAdvanceMinutes: 60,
  /** Até quando o cliente pode agendar. */
  maximumAdvanceDays: 60,
  /** Prazo para o cliente cancelar sozinho. Depois disso, só a barbearia. */
  customerCancellationCutoffMinutes: 120,

  /**
   * Janela para pagar, contada da APROVAÇÃO do barbeiro.
   *
   * Durante ela o horário continua reservado — a EXCLUDE cobre
   * AWAITING_PAYMENT. Vencida sem pagamento, a solicitação expira e o horário
   * volta a ser oferecido, exatamente como uma pendente abandonada.
   *
   * Mora aqui, com as outras regras de agenda, em vez de num número solto no
   * meio do serviço de pagamento.
   */
  paymentWindowMinutes: 15,

  /**
   * Quanto cobrar para confirmar.
   *
   *   FULL    → o valor inteiro do serviço.
   *   DEPOSIT → um sinal (ver depositPercent / depositMinimumCents).
   *
   * Sem definição comercial ainda, o padrão é FULL — cobrar o preço do
   * catálogo é o comportamento que ninguém precisa explicar. A arquitetura
   * suporta os dois; trocar é mudar esta linha.
   */
  paymentMode: "FULL" as "FULL" | "DEPOSIT",

  /** Percentual do sinal quando paymentMode = DEPOSIT. */
  depositPercent: 50,
  /** Piso do sinal, para não gerar cobrança de centavos. */
  depositMinimumCents: 1000,
} as const

/**
 * Quanto cobrar por um atendimento, em centavos.
 *
 * SEMPRE derivado do preço congelado na reserva, que por sua vez veio de
 * `Service.priceCents` no banco. Valor enviado pelo navegador nunca entra
 * nesta conta — não há parâmetro por onde entrar.
 */
export function paymentAmountCents(servicePriceCents: number): number {
  if (BookingRules.paymentMode === "FULL") return servicePriceCents
  const share = Math.round((servicePriceCents * BookingRules.depositPercent) / 100)
  // O sinal nunca passa do preço: um piso alto num serviço barato viraria
  // cobrança maior que o serviço.
  return Math.min(servicePriceCents, Math.max(share, BookingRules.depositMinimumCents))
}

/**
 * Quanto tempo de agenda um atendimento realmente consome.
 *
 * Distinção que percorre todo o sistema:
 *   - `durationMinutes` — o que o cliente compra e vê. Nunca inflado.
 *   - reserva operacional — o que a agenda bloqueia. Pode ser maior.
 *
 * Um corte de 30 min com grade de 40 ocupa 40; uma pigmentação de 50 ocupa
 * 50, porque o serviço manda quando é maior que a grade.
 */
export function reservedMinutesFor(
  durationMinutes: number,
  bufferBeforeMinutes = 0,
  bufferAfterMinutes = 0,
): number {
  const withBuffers = durationMinutes + bufferBeforeMinutes + bufferAfterMinutes
  if (!BookingRules.enforceMinimumReservation) return withBuffers
  return Math.max(BookingRules.baseSlotMinutes, withBuffers)
}
