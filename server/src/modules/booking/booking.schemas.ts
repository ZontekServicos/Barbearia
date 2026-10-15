import { z } from "zod"
import { parseShopDate } from "../../utils/time.js"
import { fullNameSchema, phoneSchema } from "../shared/contact.schemas.js"

/** Data no calendário da barbearia. A conversão para instante é do servidor. */
export const shopDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.")
  .refine(value => {
    try {
      parseShopDate(value)
      return true
    } catch {
      return false
    }
  }, "Data inexistente no calendário.")

const clockSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Use o formato HH:MM.")

export const uuidParamSchema = z.object({
  id: z.uuid("Identificador inválido."),
})

// ---------------------------------------------------------------------------
// Serviços
// ---------------------------------------------------------------------------

const serviceSchema = z.strictObject({
  name: z.string().trim().min(2, "Informe o nome do serviço.").max(80),
  description: z.string().trim().max(240),
  /** Dinheiro em centavos: inteiro, nunca float. */
  priceCents: z
    .number()
    .int("O preço deve ser informado em centavos (número inteiro).")
    .min(0, "O preço não pode ser negativo.")
    .max(10_000_000, "Preço acima do limite."),
  durationMinutes: z
    .number()
    .int()
    .positive("A duração deve ser maior que zero.")
    .max(480, "Duração acima do limite (8 horas)."),
  active: z.boolean(),
})

export const createServiceSchema = serviceSchema.extend({
  description: serviceSchema.shape.description.default(""),
  active: serviceSchema.shape.active.default(true),
})

/** Atualização parcial, mas sem permitir objeto vazio. */
// Defaults da criação não podem reativar um serviço nem apagar sua descrição
// quando um PATCH altera somente preço ou duração.
export const updateServiceSchema = serviceSchema.partial().refine(
  value => Object.keys(value).length > 0,
  "Informe ao menos um campo para atualizar.",
)

export const listServicesQuerySchema = z.object({
  includeInactive: z
    .enum(["true", "false"])
    .default("false")
    .transform(value => value === "true"),
})
// ---------------------------------------------------------------------------
// Bloqueios
// ---------------------------------------------------------------------------

export const createBlockSchema = z
  .strictObject({
    date: shopDateSchema,
    startsAt: clockSchema,
    endsAt: clockSchema,
    reason: z.string().trim().min(2, "Descreva o motivo.").max(160),
  })
  .refine(block => block.startsAt < block.endsAt, {
    message: "O fim do bloqueio deve ser depois do início.",
    path: ["endsAt"],
  })

export const listBlocksQuerySchema = z
  .object({
    from: shopDateSchema,
    to: shopDateSchema,
  })
  .refine(range => range.from <= range.to, {
    message: "A data inicial deve ser anterior ou igual à final.",
    path: ["to"],
  })

// ---------------------------------------------------------------------------
// Disponibilidade e agendamentos
// ---------------------------------------------------------------------------

export const availabilityQuerySchema = z.object({
  date: shopDateSchema,
  serviceId: z.uuid("Serviço inválido."),
})

/**
 * O cliente envia data + horário local e o serviço. Duração, fim e preço são
 * calculados no servidor — nada disso vem do cliente.
 */
export const createAppointmentSchema = z.object({
  serviceId: z.uuid("Serviço inválido."),
  date: shopDateSchema,
  startsAt: clockSchema,
  notes: z.string().trim().max(280).optional(),
})

export const listMyAppointmentsQuerySchema = z.object({
  scope: z.enum(["upcoming", "history", "all"]).default("all"),
})

export const adminAgendaQuerySchema = z
  .object({
    from: shopDateSchema,
    to: shopDateSchema.optional(),
    status: z.enum(["PENDING", "AWAITING_PAYMENT", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW", "REJECTED", "EXPIRED"]).optional(),
  })
  .transform(query => ({ ...query, to: query.to ?? query.from }))
  .refine(range => range.from <= range.to, {
    message: "A data inicial deve ser anterior ou igual à final.",
    path: ["to"],
  })

/**
 * Transições que a administração pode aplicar. `CONFIRMED` fica de fora de
 * propósito: reabrir um atendimento encerrado exige criar um novo agendamento,
 * que passa pela checagem de conflito.
 */
export const updateAppointmentStatusSchema = z.object({
  status: z.enum(["COMPLETED", "CANCELLED", "NO_SHOW"]),
})

// ---------------------------------------------------------------------------
// Solicitação pública (sem login)
// ---------------------------------------------------------------------------

/**
 * O que o navegador pode enviar numa solicitação pública.
 *
 * `strictObject`: qualquer campo extra — `userId`, `status`, `priceCents`,
 * `durationMinutes`, `role` — é REJEITADO, não ignorado. Duração, preço, fim e
 * status são decididos pelo servidor a partir do serviço no banco.
 */
/**
 * Etapa de cadastro: o que o navegador envia antes de escolher qualquer coisa.
 *
 * `strictObject`: `role`, `status`, `password` e afins são rejeitados, não
 * ignorados. Nada aqui cria credencial.
 */
export const createContactSchema = z.strictObject({
  previousHandle: z.string().max(300).optional(),
  fullName: fullNameSchema,
  phone: phoneSchema,
})

/**
 * Solicitação de agendamento.
 *
 * O contato vem pelo handle emitido na etapa de cadastro — nome e telefone não
 * trafegam de novo. Duração, preço, fim e status continuam sendo decididos
 * pelo servidor a partir do serviço no banco.
 */
export const publicBookingRequestSchema = z
  .strictObject({
    /** Forma atual: o contato já foi validado e gravado na etapa de cadastro. */
    contactHandle: z
      .string()
      .trim()
      .min(1, "Informe seus dados novamente.")
      .max(300)
      .optional(),
    /**
     * Forma anterior, aceita por compatibilidade de versão.
     *
     * Frontend e backend são implantados SEPARADAMENTE (ver docs/deployment.md:
     * "O backend não serve os arquivos do frontend"). Quando só o backend sobe,
     * o navegador continua executando o pacote antigo, que manda nome e
     * telefone aqui em vez do handle. Rejeitar isso derrubava o fluxo inteiro
     * com "Dados inválidos." — um campo desconhecido num strictObject.
     *
     * O servidor faz o cadastro ele mesmo e segue pelo MESMO caminho: cota,
     * lock por telefone, reaproveitamento do contato, nome existente
     * preservado, checagem de bloqueio. Telefone continua identificando sem
     * autenticar. Remover quando o frontend novo estiver publicado.
     */
    fullName: fullNameSchema.optional(),
    phone: phoneSchema.optional(),
    serviceId: z.uuid("Serviço inválido."),
    date: shopDateSchema,
    startsAt: clockSchema,
    notes: z.string().trim().max(280).optional(),
  })
  /**
   * Exatamente uma das duas formas, completa e sem mistura.
   *
   * Com handle, nome e telefone não podem vir — senão viravam campos ignorados
   * em silêncio, e a regra aqui é recusar o que não pertence ao pedido. Sem
   * handle, os dois são obrigatórios: meia identificação não serve.
   */
  .refine(
    body => {
      const sentContact = body.fullName !== undefined || body.phone !== undefined
      return body.contactHandle
        ? !sentContact
        : body.fullName !== undefined && body.phone !== undefined
    },
    { message: "Informe seus dados novamente.", path: ["contactHandle"] },
  )

/** Token opaco de 256 bits em base64url. */
export const publicTokenParamSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{43}$/, "Solicitação não encontrada."),
})

export const decideRequestSchema = z.strictObject({
  decision: z.enum(["CONFIRMED", "REJECTED"]),
  /**
   * "Sim, recusar mesmo com Pix declarado."
   *
   * Só tem efeito ao recusar: sem isto, uma recusa sobre pedido com pagamento
   * declarado (ou já pago) é barrada com 409, para o segundo clique ser uma
   * decisão e não um reflexo. Recusar não devolve dinheiro — a devolução, se
   * houver, é feita pela barbearia por fora.
   */
  acknowledgePaidReport: z.boolean().optional(),
})

/**
 * Decisão administrativa sobre um pagamento em Pix estático.
 *
 * `strictObject`: nada de valor, data de pagamento ou status de agendamento
 * vindo do navegador — o servidor decide tudo a partir da cobrança no banco.
 */
export const settlePaymentSchema = z.strictObject({
  decision: z.enum(["PAID", "FAILED"]),
})

/**
 * Declaração de pagamento do cliente.
 *
 * Corpo VAZIO e estrito. Não há campo a enviar: quem é o pedido vem do token, e
 * horário de declaração, prazo de conferência e estados são decididos pelo
 * servidor. Qualquer campo extra — `paidAt`, `status`, `amount`,
 * `paymentReportedAt`, `reviewExpiresAt` — é recusado, não ignorado.
 */
export const reportPaymentSchema = z.strictObject({})

/** Grade administrativa de disponibilidade de um dia, para um serviço. */
// ---------------------------------------------------------------------------
// Abertura da agenda
// ---------------------------------------------------------------------------

/**
 * Uma faixa aberta, em hora local.
 *
 * `strictObject`: nada de id, weekday, date ou createdById vindo do navegador.
 * O escopo (semanal ou data) e a autoria são decididos pela ROTA — o corpo
 * descreve só as horas.
 */
const openingRangeSchema = z.strictObject({
  opensAt: clockSchema,
  closesAt: clockSchema,
})

/** Teto de faixas por dia: evita um corpo com milhares de intervalos. */
const rangeListSchema = z.array(openingRangeSchema).max(12, "Faixas demais para um dia.")

export const weekdayParamSchema = z.object({
  weekday: z.coerce.number().int().min(0, "Dia inválido.").max(6, "Dia inválido."),
})

/** Lista completa do dia: salvar substitui, não acrescenta. Vazio = fechado. */
export const replaceOpeningsSchema = z.strictObject({
  ranges: rangeListSchema,
})

export const copyOpeningsSchema = z.strictObject({
  from: z.number().int().min(0).max(6),
  to: z.array(z.number().int().min(0).max(6)).min(1, "Escolha ao menos um dia.").max(7),
})

export const listOverridesQuerySchema = z.object({
  from: shopDateSchema,
  to: shopDateSchema,
})

/** Exceção de uma data. `ranges: []` é o que fecha a data. */
export const upsertOverrideSchema = z.strictObject({
  date: shopDateSchema,
  ranges: rangeListSchema,
  note: z.string().trim().max(160).nullable().optional(),
})

export const dateParamSchema = z.object({
  date: shopDateSchema,
})

export const adminAvailabilityQuerySchema = z.object({
  date: shopDateSchema,
  serviceId: z.uuid("Serviço inválido."),
})

/**
 * Bloqueio do dia inteiro.
 *
 * `strictObject`: nada de `startsAt`/`endsAt` vindo do navegador — o dia inteiro
 * é de meia-noite a meia-noite, calculado no servidor no fuso da barbearia.
 */
export const blockWholeDaySchema = z.strictObject({
  date: shopDateSchema,
  reason: z.string().trim().min(2, "Descreva o motivo.").max(160),
})
