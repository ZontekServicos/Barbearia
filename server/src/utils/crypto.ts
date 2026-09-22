import {
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto"
import { promisify } from "node:util"

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const SCRYPT_KEY_LENGTH = 32
const SCRYPT_SALT_LENGTH = 16

/** Código OTP numérico de 6 dígitos, gerado com CSPRNG (nunca Math.random). */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0")
}

/**
 * Hash do OTP com scrypt (KDF lenta) + salt por registro.
 *
 * O espaço de busca de um OTP é pequeno (10^6), então um hash rápido seria
 * quebrado instantaneamente caso o banco vazasse. scrypt vem do `node:crypto`,
 * o que nos dá uma KDF adequada sem adicionar dependência nativa.
 */
export async function hashOtpCode(code: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_LENGTH)
  const derived = await scrypt(code, salt, SCRYPT_KEY_LENGTH)
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`
}

/** Comparação em tempo constante do OTP informado contra o hash persistido. */
export async function verifyOtpCode(
  code: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split("$")
  if (parts.length !== 3 || parts[0] !== "scrypt") return false

  const saltHex = parts[1]
  const expectedHex = parts[2]
  if (
    !saltHex ||
    !expectedHex ||
    !/^[a-f0-9]{32}$/i.test(saltHex) ||
    !/^[a-f0-9]{64}$/i.test(expectedHex)
  )
    return false

  let expected: Buffer
  let salt: Buffer
  try {
    salt = Buffer.from(saltHex, "hex")
    expected = Buffer.from(expectedHex, "hex")
  } catch {
    return false
  }

  const derived = await scrypt(code, salt, expected.length)
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

/** Refresh token opaco de alta entropia (256 bits). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * Hash do refresh token. SHA-256 é suficiente aqui: o token tem 256 bits de
 * entropia aleatória, então não existe superfície de força bruta como no OTP.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}
