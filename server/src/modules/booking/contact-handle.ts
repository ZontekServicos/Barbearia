import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { env } from "../../config/env.js"
import { AppError, ErrorCodes } from "../../utils/errors.js"

export const CONTACT_HANDLE_TTL_MS = 30 * 60_000
// Domain-separated key: no JWT signature can be reused as a contact signature.
const key = createHmac("sha256", env.JWT_ACCESS_SECRET).update("booking-contact-key:v2").digest()
const sign = (payload: string) => createHmac("sha256", key).update(payload).digest("base64url")

export function invalidContactHandle(): AppError {
  return AppError.badRequest(ErrorCodes.CONTACT_HANDLE_INVALID, "Seus dados expiraram. Informe nome e WhatsApp novamente.")
}

/** No account ID or personal data in this bearer capability. DB enforces single use. */
export function issueContactHandle(now: Date = new Date()): string {
  const payload = `v2.${randomBytes(32).toString("base64url")}.${now.getTime() + CONTACT_HANDLE_TTL_MS}`
  return `${payload}.${sign(payload)}`
}

/** Returns the digest used for lookup, never a client-controlled contact ID. */
export function readContactHandle(handle: string, now: Date = new Date()): string {
  if (typeof handle !== "string" || !/^v2\.[A-Za-z0-9_-]{43}\.[0-9]{13}\.[A-Za-z0-9_-]{43}$/.test(handle)) throw invalidContactHandle()
  const [prefix, nonce, expiresAt, signature] = handle.split(".") as [string, string, string, string]
  const expected = sign(`${prefix}.${nonce}.${expiresAt}`)
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw invalidContactHandle()
  const remaining = Number(expiresAt) - now.getTime()
  if (remaining <= 0 || remaining > CONTACT_HANDLE_TTL_MS) throw invalidContactHandle()
  return createHash("sha256").update(handle).digest("hex")
}
