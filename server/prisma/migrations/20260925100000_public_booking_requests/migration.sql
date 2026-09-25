-- Agendamento público sem login + reserva operacional protegida pelo banco.
--
-- Nenhuma reserva existente é reescrita: reserved_ends_at nasce igual a
-- ends_at, então a agenda atual continua ocupando exatamente o que ocupava.
BEGIN;

-- Novos estados. PENDING segura o horário enquanto o barbeiro não decide;
-- REJECTED e EXPIRED o liberam.
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'CONFIRMED';
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

COMMIT;

BEGIN;

-- Fim da reserva operacional. Preenchido com ends_at para preservar o
-- histórico: um atendimento antigo de 30 min continua tendo ocupado 30 min.
ALTER TABLE "appointments"
  ADD COLUMN "reserved_ends_at" TIMESTAMPTZ(3),
  ADD COLUMN "public_token" VARCHAR(64),
  ADD COLUMN "pending_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "decided_at" TIMESTAMPTZ(3);

UPDATE "appointments" SET "reserved_ends_at" = "ends_at" WHERE "reserved_ends_at" IS NULL;

ALTER TABLE "appointments" ALTER COLUMN "reserved_ends_at" SET NOT NULL;

-- A reserva nunca pode ser menor que o atendimento: encurtá-la deixaria dois
-- serviços se sobreporem sem a EXCLUDE perceber.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_reserved_window"
  CHECK ("reserved_ends_at" >= "ends_at");

-- Token de consulta da própria solicitação. Único, e só existe quando foi
-- gerado — reservas criadas pela administração não precisam dele.
CREATE UNIQUE INDEX "appointments_public_token_key"
  ON "appointments" ("public_token") WHERE "public_token" IS NOT NULL;

CREATE INDEX "appointments_status_pending_expires_at_idx"
  ON "appointments" ("status", "pending_expires_at");

-- A proteção contra reserva dupla passa a cobrir o intervalo REALMENTE
-- ocupado, não só a duração do serviço: com grade de 40 min, um corte de 30
-- bloqueia 40, e a EXCLUDE precisa enxergar os 40. Também passa a incluir
-- PENDING: uma solicitação aguardando confirmação já segura o horário.
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_no_overlap";

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    tstzrange("starts_at", "reserved_ends_at", '[)') WITH &&
  ) WHERE ("status" IN ('PENDING', 'CONFIRMED'));

COMMIT;
