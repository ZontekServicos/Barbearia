import { Algorithm, hash, verify } from "@node-rs/argon2"
import { logger } from "../../utils/logger.js"

/**
 * Argon2id, parâmetros de referência do OWASP: m=19 MiB, t=2, p=1.
 *
 * Por que Argon2id e não scrypt (que já usamos no OTP): é a primeira escolha
 * do OWASP para senhas novas e resiste tanto a GPU quanto a side-channel.
 * Usamos `@node-rs/argon2` porque publica binários prontos para
 * linux-x64-gnu/musl — o build do Railway não precisa de compilador.
 *
 * Custo de memória: 19 MiB por hash em andamento. Com o limite de login por
 * IP e ~25 ms por verificação, a concorrência real fica baixa; ainda assim é
 * o número a revisar se o container do Railway for redimensionado.
 */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

/**
 * NIST SP 800-63B-4: mínimo para autenticação de fator único. Deliberadamente sem exigência de maiúscula/símbolo/dígito:
 * regras arbitrárias empurram o usuário para senhas piores e previsíveis.
 */
export const PASSWORD_MIN_LENGTH = 15

/**
 * Teto alto o bastante para frases-senha e baixo o bastante para não virar
 * vetor de abuso. Contado em caracteres depois da normalização Unicode.
 */
export const PASSWORD_MAX_LENGTH = 128

/**
 * Hash-isca com os mesmos parâmetros, usado para gastar o mesmo tempo quando
 * o telefone não existe. Sem isso, o tempo de resposta diria ao atacante
 * quais números estão cadastrados.
 */
let decoyHash: string | null = null

/**
 * Normaliza a senha antes de hashear. NFKC evita que a mesma senha digitada
 * com composições Unicode diferentes (comum em teclado mobile) gere hashes
 * incompatíveis. Não fazemos trim: espaço no início/fim é parte da senha.
 */
function normalize(plain: string): string {
  return plain.normalize("NFKC")
}

export async function hashPassword(plain: string): Promise<string> {
  const normalized = normalize(plain)
  if (
    Array.from(normalized).length < PASSWORD_MIN_LENGTH ||
    Array.from(normalized).length > PASSWORD_MAX_LENGTH
  ) {
    // Rede de segurança: o Zod já barra isso antes. Se chegou aqui, é bug.
    throw new Error("Senha fora do tamanho permitido.")
  }
  return hash(normalized, ARGON2_OPTIONS)
}

/**
 * Compara senha e hash. Nunca lança: um hash corrompido ou de formato
 * desconhecido é apenas "não confere" — não pode derrubar o login.
 */
export async function verifyPassword(
  storedHash: string | null | undefined,
  plain: string,
): Promise<boolean> {
  if (!storedHash) {
    // Conta sem credencial estabelecida. Gasta o mesmo tempo e recusa.
    await burnTime()
    return false
  }
  try {
    return await verify(storedHash, normalize(plain), ARGON2_OPTIONS)
  } catch {
    // Não registramos o hash nem a senha — só o fato.
    logger.warn("Hash de senha ilegível durante a verificação")
    return false
  }
}

/**
 * Consome o mesmo custo de uma verificação real. Chamado quando o telefone
 * não existe, para que "não cadastrado" e "senha errada" levem o mesmo tempo.
 */
export async function burnTime(): Promise<void> {
  decoyHash ??= await hash("isca-sem-uso-para-igualar-o-tempo", ARGON2_OPTIONS)
  try {
    await verify(decoyHash, "valor-que-nunca-confere", ARGON2_OPTIONS)
  } catch {
    // Irrelevante: só queremos o custo de CPU/memória.
  }
}
