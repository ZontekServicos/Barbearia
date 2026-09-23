import { prisma } from "../../config/prisma.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"
import { lockKey, lockUser } from "../../utils/locks.js"
import { logger } from "../../utils/logger.js"
import { maskPhone } from "../../utils/phone.js"
import { burnTime, hashPassword, verifyPassword } from "./password.service.js"
import { createSession, type SessionTokens } from "./token.service.js"
import { toPublicUser, type PublicUser } from "../users/users.mapper.js"

export interface AuthResult {
  user: PublicUser
  tokens: SessionTokens
}

/**
 * Freio durável contra força bruta: vive no banco, então vale entre réplicas
 * e não depende do IP, que o atacante troca à vontade.
 *
 * O bloqueio é silencioso — enquanto dura, o login responde exatamente como
 * responderia a uma senha errada. Dizer "conta temporariamente bloqueada"
 * confirmaria que o telefone existe, que é justamente o que evitamos. O preço
 * é um usuário legítimo confuso por 15 minutos depois de 10 erros seguidos;
 * na prática isso quase não acontece, e o silêncio vale mais.
 */
const MAX_FAILED_ATTEMPTS = 10
const LOCK_DURATION_MS = 15 * 60_000

/** Resposta única para qualquer login malsucedido. Nunca diga o motivo. */
function invalidCredentials(): AppError {
  return new AppError(
    ErrorCodes.INVALID_CREDENTIALS,
    "Telefone ou senha inválidos.",
    401,
  )
}

/**
 * Cria a conta do cliente. Nasce CUSTOMER/PENDING: a barbearia aprova antes
 * de liberar agendamento, política que a migração de autenticação preserva.
 */
export async function registerCustomer(
  phone: string,
  password: string,
  fullName: string,
): Promise<AuthResult> {
  // Hash fora da transação: Argon2id leva ~25 ms e segurar uma transação
  // aberta por isso é desperdício de conexão. Hashear mesmo quando o telefone
  // já existe também iguala o tempo das duas respostas.
  const passwordHash = await hashPassword(password)

  const result = await prisma.$transaction(async (tx) => {
    await lockKey(tx, "auth:" + phone)

    const existing = await tx.user.findUnique({
      where: { phone },
      select: { id: true },
    })
    if (existing) {
      return {
        error: AppError.conflict(
          ErrorCodes.PHONE_ALREADY_REGISTERED,
          "Este telefone já possui cadastro. Entre com sua senha.",
        ),
      }
    }

    const user = await tx.user.create({
      data: {
        phone,
        fullName,
        passwordHash,
        passwordUpdatedAt: new Date(),
        role: "CUSTOMER",
        status: "PENDING",
      },
    })

    const tokens = await createSession(tx, user)
    return { value: { user: toPublicUser(user), tokens } }
  })

  if (result.error) throw result.error
  logger.info("Cadastro criado", { phone: maskPhone(phone) })
  return result.value!
}

/**
 * Autentica por telefone + senha.
 *
 * O telefone chega já normalizado em E.164 pelo schema, então a busca usa
 * sempre a mesma forma canônica — nunca o que o usuário digitou.
 */
export async function loginWithPassword(
  phone: string,
  password: string,
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { phone } })

  if (!user) {
    // Gasta o mesmo tempo de uma verificação real: sem isso, o relógio
    // responderia quais telefones estão cadastrados.
    await burnTime()
    throw invalidCredentials()
  }

  const locked =
    user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now()

  // Conta sem senha (herdada do fluxo OTP) cai aqui com `false`: não pode ser
  // reivindicada e não se distingue de uma senha errada.
  const matches = await verifyPassword(user.passwordHash, password)

  if (locked || !matches) {
    await registerFailedAttempt(user.id, user.passwordHash)
    throw invalidCredentials()
  }

  // Só depois de provar posse da credencial o estado da conta é revelado.
  if (user.status === "BLOCKED") {
    throw AppError.forbidden(
      ErrorCodes.ACCOUNT_BLOCKED,
      "Sua conta está bloqueada. Fale com a barbearia.",
    )
  }

  return prisma.$transaction(async (tx) => {
    await lockUser(tx, user.id)
    const current = await tx.user.findUnique({ where: { id: user.id } })
    // A reset, account block or lockout may have committed while Argon2 ran.
    if (!current || current.passwordHash !== user.passwordHash ||
        (current.lockedUntil !== null && current.lockedUntil.getTime() > Date.now())) {
      throw invalidCredentials()
    }
    if (current.status === "BLOCKED") {
      throw AppError.forbidden(ErrorCodes.ACCOUNT_BLOCKED, "Sua conta está bloqueada. Fale com a barbearia.")
    }
    const updated = await tx.user.update({
      where: { id: current.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    })
    const tokens = await createSession(tx, updated)
    return { user: toPublicUser(updated), tokens }
  })
}

/**
 * Conta a falha e bloqueia ao atingir o teto. Erro aqui nunca derruba o
 * login: a resposta ao cliente já é a mesma, e falhar em contar é menos grave
 * que devolver 500 e revelar que algo diferente aconteceu com esse telefone.
 */
async function registerFailedAttempt(userId: string, checkedHash: string | null): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await lockUser(tx, userId)
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { failedLoginAttempts: true, lockedUntil: true, passwordHash: true },
      })
      if (!current || current.passwordHash !== checkedHash) return

      const expiredLock =
        current.lockedUntil !== null &&
        current.lockedUntil.getTime() <= Date.now()
      const attempts = (expiredLock ? 0 : current.failedLoginAttempts) + 1
      const reachedLimit = attempts >= MAX_FAILED_ATTEMPTS

      await tx.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: reachedLimit ? 0 : attempts,
          lockedUntil: reachedLimit
            ? new Date(Date.now() + LOCK_DURATION_MS)
            : expiredLock
              ? null
              : current.lockedUntil,
        },
      })

      if (reachedLimit) {
        logger.warn("Conta bloqueada temporariamente por tentativas de login", {
          userId,
          lockMinutes: LOCK_DURATION_MS / 60_000,
        })
      }
    })
  } catch {
    logger.error("Falha ao registrar tentativa de login malsucedida", {
      userId,
    })
  }
}

/**
 * Define uma nova senha e encerra todas as sessões abertas.
 *
 * Trocar a senha precisa expulsar quem já estava dentro: é exatamente o que
 * se espera de quem suspeita que a conta foi acessada por outra pessoa.
 * `requireAuth` consulta a sessão no banco a cada requisição, então revogar
 * os refresh tokens também derruba os access tokens vivos na hora.
 */
export async function setUserPassword(
  userId: string,
  newPassword: string,
  expectedPasswordHash: string,
): Promise<void> {
  const passwordHash = await hashPassword(newPassword)
  await prisma.$transaction(async (tx) => {
    await lockUser(tx, userId)
    const current = await tx.user.findUnique({ where: { id: userId } })
    if (!current || !expectedPasswordHash || current.passwordHash !== expectedPasswordHash || current.status === "BLOCKED") {
      throw invalidCredentials()
    }
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordUpdatedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    })
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  })
}
