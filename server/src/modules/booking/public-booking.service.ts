import type { Prisma } from "../../generated/prisma/client.js"
import { digestPublicToken } from "./public-token.js"
import { prisma } from "../../config/prisma.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { logger } from "../../utils/logger.js"
import { lockKey, lockUser } from "../../utils/locks.js"
import { BookingRules } from "./booking.rules.js"
import { createAppointment } from "./appointments.service.js"
import { toPublicAppointment, type PublicAppointment } from "./booking.mapper.js"
import { CONTACT_HANDLE_TTL_MS, invalidContactHandle, issueContactHandle, readContactHandle } from "./contact-handle.js"
import { takeContactRegistrationQuota } from "./public-quota.js"
import { maskPhoneForDisplay } from "../../utils/phone.js"

/**
 * Quantas reservas futuras vivas um mesmo telefone pode acumular.
 *
 * Freio durável contra flood: vive no banco, então vale entre réplicas e não
 * depende do IP, que o atacante troca à vontade. Complementa — não substitui —
 * o limite por IP do middleware.
 */
const MAX_ACTIVE_REQUESTS_PER_PHONE = 3

export interface BookingRequestInput {
  /** Handle emitido na etapa de cadastro. Não é sessão (ver contact-handle). */
  contactHandle: string
  serviceId: string
  date: string
  startsAt: string
  notes?: string
}

export interface ContactRegistrationInput {
  previousHandle?: string
  fullName: string
  /** Já normalizado em E.164 pelo schema. */
  phone: string
}

export interface ContactRegistration {
  contactHandle: string
  /** Só o que a pessoa acabou de informar, para ela conferir. */
  fullName: string
  /** "(71) *****-6090" — nunca o número inteiro de volta. */
  phoneMasked: string
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
 * Etapa de cadastro do fluxo público.
 *
 * Valida e grava o contato logo na primeira tela: quem digitou um telefone
 * inválido descobre ali, não cinco etapas depois. Devolve apenas um handle de
 * uso restrito — nenhum dado anterior do telefone informado, nenhuma sessão,
 * nenhum token de acesso, nenhuma senha.
 *
 * Informar o número de outra pessoa não revela nada sobre ela: o nome de
 * retorno é o que a própria pessoa acabou de digitar, e o telefone volta
 * mascarado.
 */
export async function registerPublicContact(
  input: ContactRegistrationInput,
  now: Date = new Date(),
): Promise<ContactRegistration> {
  const contactHandle = issueContactHandle(now)
  const tokenHash = readContactHandle(contactHandle, now)
  let previousHash: string | undefined
  if (input.previousHandle) {
    try { previousHash = readContactHandle(input.previousHandle, now) }
    catch { /* An expired previous selection must not prevent a new registration. */ }
  }
  await prisma.$transaction(async tx => {
    await takeContactRegistrationQuota(tx, input.phone, now)
    await lockKey(tx, "auth:" + input.phone)
    const contact = await resolveContact(tx, input.phone, input.fullName)
    await lockUser(tx, contact.id)
    if (previousHash) {
      await tx.publicContactHandle.updateMany({
        where: { tokenHash: previousHash, consumedAt: null },
        data: { consumedAt: now },
      })
    }
    await tx.publicContactHandle.create({
      data: { tokenHash, userId: contact.id, expiresAt: new Date(now.getTime() + CONTACT_HANDLE_TTL_MS) },
    })
  })

  // Same response for all account states. A handle never authenticates; the
  // request transaction checks BLOCKED again before it can create anything.
  logger.info("Etapa de cadastro público concluída")
  return { contactHandle, fullName: input.fullName, phoneMasked: maskPhoneForDisplay(input.phone) }
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
  // O handle diz de quem é o pedido. O contato já foi validado e gravado na
  // etapa de cadastro; aqui só confirmamos que ele continua apto.
  const tokenHash = readContactHandle(input.contactHandle, now)
  const handle = await prisma.publicContactHandle.findUnique({ where: { tokenHash } })
  if (!handle || handle.consumedAt || handle.expiresAt <= now) throw invalidContactHandle()
  const contactId = handle.userId

  const placed = await createAppointment(
    {
      userId: contactId,
      serviceId: input.serviceId,
      date: input.date,
      startsAt: input.startsAt,
      notes: input.notes,
    },
    now,
    "PUBLIC",
    async tx => {
      // Tudo nesta conexão: o lock cobre a contagem E o insert.
      await lockUser(tx, contactId)
      const checkedAt = new Date(Math.max(now.getTime(), Date.now()))
      const claimed = await tx.publicContactHandle.updateMany({
        where: { tokenHash, userId: contactId, consumedAt: null, expiresAt: { gt: checkedAt } },
        data: { consumedAt: checkedAt },
      })
      if (claimed.count !== 1) throw invalidContactHandle()
      const current = await tx.user.findUnique({ where: { id: contactId } })
      const refuse = () =>
        AppError.conflict(
          ErrorCodes.CONFLICT,
          "Não foi possível concluir a solicitação. Fale com a barbearia.",
        )
      // Bloqueado entre o cadastro e o envio: recusa com a mesma mensagem
      // neutra, sem revelar o motivo.
      if (!current || current.status === "BLOCKED") throw refuse()
      const active = await tx.appointment.count({
        where: {
          userId: contactId,
          startsAt: { gte: now },
          OR: [
            { status: "CONFIRMED" },
            { status: "PENDING", pendingExpiresAt: { gt: now } },
          ],
        },
      })
      if (active >= MAX_ACTIVE_REQUESTS_PER_PHONE) throw refuse()
      return contactId
    },
  )

  logger.info("Solicitação pública de agendamento criada", {
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
