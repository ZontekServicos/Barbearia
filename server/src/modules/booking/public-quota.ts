import { createHmac } from "node:crypto"
import { ipKeyGenerator } from "express-rate-limit"
import { prisma } from "../../config/prisma.js"
import { env } from "../../config/env.js"
import type { Prisma } from "../../generated/prisma/client.js"
import { AppError } from "../../utils/errors.js"

export const CONTACT_REGISTRATIONS_PER_HOUR = 100
const FIFTEEN_MINUTES = 15 * 60_000

/** Atomic shared counter. Failed over-budget increments roll back to the cap. */
export async function takePublicQuota(
  tx: Prisma.TransactionClient,
  scope: string,
  subject: string,
  limit: number,
  windowMs: number,
  now = new Date(),
): Promise<void> {
  const key = scope + ":" + createHmac("sha256", env.JWT_ACCESS_SECRET)
    .update("booking-quota:" + subject).digest("hex")
  const expiresAt = new Date(now.getTime() + windowMs)
  const rows = await tx.$queryRaw<Array<{ count: number }>>`
    INSERT INTO public_booking_quotas (key, count, expires_at)
    VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN public_booking_quotas.expires_at <= ${now} THEN 1 ELSE public_booking_quotas.count + 1 END,
      expires_at = CASE WHEN public_booking_quotas.expires_at <= ${now} THEN ${expiresAt} ELSE public_booking_quotas.expires_at END
    RETURNING count`
  if (rows[0]!.count > limit) throw AppError.tooManyRequests()
}

/** req.ip is resolved by Express's configured trusted proxy boundary. */
export async function enforcePublicIpQuota(scope: "contacts" | "requests", ip: string): Promise<void> {
  await prisma.$transaction(tx => takePublicQuota(tx, scope + "-ip", ipKeyGenerator(ip), 10, FIFTEEN_MINUTES))
}

export async function takeContactRegistrationQuota(tx: Prisma.TransactionClient, phone: string, now: Date): Promise<void> {
  // Identical policy for new/existing/blocked: no account-existence signal at the cap.
  await takePublicQuota(tx, "contacts-global", "all", CONTACT_REGISTRATIONS_PER_HOUR, 60 * 60_000, now)
  await takePublicQuota(tx, "contacts-phone", phone, 10, FIFTEEN_MINUTES, now)
}
