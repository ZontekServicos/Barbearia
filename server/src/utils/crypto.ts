import { randomBytes, randomInt, createHash } from "node:crypto"

/** Refresh token opaco de alta entropia (256 bits). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * Hash do refresh token. SHA-256 é suficiente aqui: o token tem 256 bits de
 * entropia aleatória, então não há superfície de força bruta — diferente de
 * uma senha escolhida por pessoa, que exige Argon2id (ver password.service).
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/**
 * Alfabeto sem caracteres ambíguos (0/O, 1/l/I): a senha temporária é ditada
 * ou escrita num papel pelo balcão da barbearia, então precisa sobreviver à
 * transcrição humana.
 */
const UNAMBIGUOUS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

/**
 * Senha temporária para redefinição assistida pelo administrador.
 *
 * 16 caracteres do alfabeto acima ≈ 91 bits de entropia, gerados com CSPRNG
 * (`randomInt`, nunca `Math.random`). É entregue uma única vez a quem operou
 * a redefinição e nunca fica armazenada em texto puro.
 */
export function generateTemporaryPassword(length = 16): string {
  let password = ""
  for (let i = 0; i < length; i++) {
    password += UNAMBIGUOUS[randomInt(0, UNAMBIGUOUS.length)]
  }
  return password
}
