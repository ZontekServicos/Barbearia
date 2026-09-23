import { z } from "zod"

/** Data no calendário da barbearia. A conversão para instante é do servidor. */
export const shopDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.")

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

export const createServiceSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do serviço.").max(80),
  description: z.string().trim().max(240).default(""),
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
  active: z.boolean().default(true),
})

/** Atualização parcial, mas sem permitir objeto vazio. */
export const updateServiceSchema = createServiceSchema.partial().refine(
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
// Horário de funcionamento
// ---------------------------------------------------------------------------

const businessHoursDaySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    closed: z.boolean(),
    opensAt: clockSchema,
    closesAt: clockSchema,
    breakStartsAt: clockSchema.nullable().default(null),
    breakEndsAt: clockSchema.nullable().default(null),
  })
  .refine(day => day.closed || day.opensAt < day.closesAt, {
    message: "O fechamento deve ser depois da abertura.",
    path: ["closesAt"],
  })
  .refine(
    day =>
      (day.breakStartsAt === null && day.breakEndsAt === null) ||
      (day.breakStartsAt !== null && day.breakEndsAt !== null),
    { message: "Informe início e fim do intervalo, ou nenhum dos dois.", path: ["breakStartsAt"] },
  )
  .refine(
    day =>
      day.breakStartsAt === null ||
      day.breakEndsAt === null ||
      (day.breakStartsAt < day.breakEndsAt &&
        day.breakStartsAt >= day.opensAt &&
        day.breakEndsAt <= day.closesAt),
    { message: "O intervalo precisa estar dentro do expediente.", path: ["breakStartsAt"] },
  )

/** A semana inteira é enviada de uma vez: evita estado parcial inconsistente. */
export const updateBusinessHoursSchema = z.object({
  days: z
    .array(businessHoursDaySchema)
    .length(7, "Envie os sete dias da semana.")
    .refine(
      days => new Set(days.map(day => day.weekday)).size === 7,
      "Cada dia da semana deve aparecer exatamente uma vez.",
    ),
})

// ---------------------------------------------------------------------------
// Bloqueios
// ---------------------------------------------------------------------------

export const createBlockSchema = z
  .object({
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
    status: z.enum(["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
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
