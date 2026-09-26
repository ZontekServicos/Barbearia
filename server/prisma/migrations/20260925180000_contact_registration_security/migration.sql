BEGIN;
CREATE TABLE "public_contact_handles" (
 "token_hash" VARCHAR(64) PRIMARY KEY,
 "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "expires_at" TIMESTAMPTZ(3) NOT NULL,
 "consumed_at" TIMESTAMPTZ(3)
);
CREATE INDEX "public_contact_handles_user_id_idx" ON "public_contact_handles"("user_id");
CREATE INDEX "public_contact_handles_expires_at_idx" ON "public_contact_handles"("expires_at");
CREATE TABLE "public_booking_quotas" (
 "key" VARCHAR(96) PRIMARY KEY,
 "count" INTEGER NOT NULL CHECK ("count" > 0),
 "expires_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "public_booking_quotas_expires_at_idx" ON "public_booking_quotas"("expires_at");
COMMIT;
