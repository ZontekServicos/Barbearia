import type { Prisma } from "../../generated/prisma/client.js"
import { digestPublicToken } from "./public-token.js"
import { prisma } from "../../config/prisma.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { logger } from "../../utils/logger.js"
import { maskPhone } from "../../utils/phone.js"
import { lockKey, lockUser } from "../../utils/locks.js"
import { BookingRules } from "./booking.rules.js"
import { createAppointment } from "./appointments.service.js"
import { toPublicAppointment, type PublicAppointment } from "./booking.mapper.js"

/**
 * Quantas reservas futuras vivas um mesmo telefone pode acumular.
 *
 * Freio durável contra flood: vive no banco, então vale entre réplicas e não
 * depende do IP, que o atacante troca à vontade. Complementa — não substitui —
 * o limite por IP do middleware.
 */
const MAX_ACTIVE_REQUESTS_PER_PHONE = 3

export interface BookingRequestInput {
  /** Já normalizado em E.164 pelo schema. */
  phone: string
  fullName: string
  serviceId: string
  date: string
  startsAt: string
  notes?: string
}

export interface BookingRequestResult {
  appointment: PublicAppointment
  /** Entregue uma única vez: é como a pessoa acompanha o próprio pedido. */
  publicToken: string
  /** `true` quando ainda depende do barbeiro. */
  awaitingApproval: boolean
}

/**
 * Localiza ou cria o contato correspondente ao telefone.
 *
 * Reaproveitamos a entidade `User` em vez de criar uma tabela separada de
 * contatos: o agendamento já aponta para ela, a tela administrativa de
 * clientes já a lista, e o histórico de quem tinha conta continua ligado ao
 * mesmo registro. Um contato sem conta é simplesmente um `User` com
 * `passwordHash` nulo — semântica que o login já recusa desde a migração de
 * senha, então nada aqui vira credencial.
 *
 * Regras de segurança, todas porque telefone NÃO prova identidade:
 *  - um registro existente nunca é rebaixado nem promovido; um ADMIN que
 *    agenda com o próprio número continua ADMIN;
 *  - nome existente nunca é sobrescrito — senão bastaria saber o telefone de
 *    alguém para renomear o cadastro dela;
 *  - nada do registro encontrado é devolvido para quem chamou.
 */
async function resolveContact(
  tx: Prisma.TransactionClient,
  phone: string,
  fullName: string,
): Promise<{ id: string; blocked: boolean }> {
  const existing = await tx.user.findUnique({
    where: { phone },
    select: { id: true, status: true, fullName: true },
  })

  if (existing) {
    if (existing.status === "BLOCKED") return { id: existing.id, blocked: true }

    return { id: existing.id, blocked: false }
  }

  const created = await tx.user.create({
    data: {
      phone,
      fullName,
      role: "CUSTOMER",
      // PENDING = contato ainda não avaliado pela barbearia. Não concede nada:
      // sem senha, o login recusa de qualquer forma.
      status: "PENDING",
    },
    select: { id: true },
  })
  return { id: created.id, blocked: false }
}

/**
 * Solicitação de agendamento sem login.
 *
 * O telefone identifica o contato, não autentica ninguém. Por isso esta função
 * jamais devolve histórico, dados cadastrais ou qualquer reserva anterior —
 * só a que acabou de ser criada, e mesmo assim acompanhada de um token
 * aleatório que é a única chave de consulta posterior.
 */
export async function requestPublicAppointment(
  input: BookingRequestInput,
  now: Date = new Date(),
): Promise<BookingRequestResult> {
  const placed = await createAppointment(
    {userId:"",serviceId:input.serviceId,date:input.date,startsAt:input.startsAt,notes:input.notes},
    now,
    "PUBLIC",
    async tx => {
      // All reads/writes use this same connection. The lock covers count AND insert.
      await lockKey(tx, "auth:" + input.phone)
      const contact = await resolveContact(tx, input.phone, input.fullName)
      await lockUser(tx, contact.id)
      const current = await tx.user.findUniqueOrThrow({where:{id:contact.id}})
      const refuse = () => AppError.conflict(ErrorCodes.CONFLICT, "Não foi possível concluir a solicitação. Fale com a barbearia.")
      if (current.status === "BLOCKED") throw refuse()
      const active = await tx.appointment.count({where:{userId:contact.id,startsAt:{gte:now},OR:[{status:"CONFIRMED"},{status:"PENDING",pendingExpiresAt:{gt:now}}]}})
      if (active >= MAX_ACTIVE_REQUESTS_PER_PHONE) throw refuse()
      return contact.id
    },
  )

  logger.info("Solicitação pública de agendamento criada", {
    phone: maskPhone(input.phone),
    status: placed.appointment.status,
  })

  return {
    appointment: placed.appointment,
    publicToken: placed.publicToken!,
    awaitingApproval: placed.appointment.status === "PENDING",
  }
}

/**
 * Consulta de UMA solicitação pelo token entregue na criação.
 *
 * O token é a credencial da reserva — não o telefone. Quem tem o link vê
 * apenas aquele pedido; não há listagem, não há histórico, e o contato não é
 * identificado na resposta além do que a própria pessoa acabou de informar.
 */
export async function getPublicRequest(
  token: string,
  now: Date = new Date(),
): Promise<PublicAppointment> {
  const appointment = await prisma.appointment.findUnique({
    where: { publicToken: digestPublicToken(token) },
  })

  if (!appointment) {
    throw AppError.notFound(ErrorCodes.NOT_FOUND, "Solicitação não encontrada.")
  }

  // Pendente vencida é apresentada como expirada mesmo antes de alguém
  // reservar o horário: a pessoa precisa saber que o pedido caducou.
  if (
    appointment.status === "PENDING" &&
    appointment.pendingExpiresAt !== null &&
    appointment.pendingExpiresAt.getTime() <= now.getTime()
  ) {
    return toPublicAppointment({ ...appointment, status: "EXPIRED" })
  }

  return toPublicAppointment(appointment)
}

/** Quanto tempo uma solicitação pendente segura o horário, para a interface. */
export const PENDING_REQUEST_TTL_MINUTES = BookingRules.pendingRequestTtlMinutes
