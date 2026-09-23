-- Domínio de agendamento: serviços, horário de funcionamento, bloqueios e reservas.

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(240) NOT NULL DEFAULT '',
    "price_cents" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_hours" (
    "id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "open_minute" INTEGER NOT NULL,
    "close_minute" INTEGER NOT NULL,
    "break_start_minute" INTEGER,
    "break_end_minute" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_blocks" (
    "id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "notes" VARCHAR(280),
    "service_name" VARCHAR(80) NOT NULL,
    "service_price_cents" INTEGER NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "services_active_idx" ON "services"("active");

-- CreateIndex
CREATE UNIQUE INDEX "business_hours_weekday_key" ON "business_hours"("weekday");

-- CreateIndex
CREATE INDEX "schedule_blocks_starts_at_ends_at_idx" ON "schedule_blocks"("starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "appointments_starts_at_idx" ON "appointments"("starts_at");

-- CreateIndex
CREATE INDEX "appointments_user_id_starts_at_idx" ON "appointments"("user_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_status_starts_at_idx" ON "appointments"("status", "starts_at");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariantes de domínio no banco.
--
-- O Prisma não expressa CHECK nem EXCLUDE no schema, então elas entram aqui.
-- São a última linha de defesa: mesmo que a aplicação tenha um bug, o
-- PostgreSQL recusa o dado inconsistente.
-- ---------------------------------------------------------------------------

-- Preço não pode ser negativo e duração precisa ser positiva.
ALTER TABLE "services"
  ADD CONSTRAINT "services_price_cents_non_negative" CHECK ("price_cents" >= 0),
  ADD CONSTRAINT "services_duration_positive" CHECK ("duration_minutes" > 0);

-- Janelas coerentes no horário de funcionamento (minutos a partir da meia-noite local).
ALTER TABLE "business_hours"
  ADD CONSTRAINT "business_hours_weekday_range" CHECK ("weekday" BETWEEN 0 AND 6),
  ADD CONSTRAINT "business_hours_window" CHECK (
    "open_minute" >= 0 AND "close_minute" <= 1440 AND "open_minute" < "close_minute"
  ),
  ADD CONSTRAINT "business_hours_break" CHECK (
    ("break_start_minute" IS NULL AND "break_end_minute" IS NULL)
    OR (
      "break_start_minute" IS NOT NULL AND "break_end_minute" IS NOT NULL
      AND "break_start_minute" < "break_end_minute"
      AND "break_start_minute" >= "open_minute"
      AND "break_end_minute" <= "close_minute"
    )
  );

-- Bloqueio precisa terminar depois de começar.
ALTER TABLE "schedule_blocks"
  ADD CONSTRAINT "schedule_blocks_window" CHECK ("starts_at" < "ends_at");

-- Agendamento precisa terminar depois de começar.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_window" CHECK ("starts_at" < "ends_at");

-- ---------------------------------------------------------------------------
-- Proteção contra reserva dupla.
--
-- Esta é a garantia real de concorrência. Duas transações simultâneas pedindo
-- o mesmo horário não conseguem ambas commitar: a segunda viola a exclusão e
-- é rejeitada pelo PostgreSQL, sem depender de verificação na aplicação.
--
-- O filtro por status é intencional: horários cancelados ou marcados como
-- falta liberam a vaga novamente. Uma barbearia, um barbeiro nesta fase —
-- por isso a exclusão é global, sem partição por profissional.
--
-- O intervalo é [início, fim): um atendimento que termina às 10:00 não conflita
-- com outro que começa às 10:00.
-- ---------------------------------------------------------------------------
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("status" = 'CONFIRMED');
