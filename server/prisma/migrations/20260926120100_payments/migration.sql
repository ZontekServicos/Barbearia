-- ---------------------------------------------------------------------------
-- Confirmação mediante pagamento.
--
-- Estritamente aditiva: nenhuma linha existente muda de estado, nenhum
-- agendamento é deslocado, nenhuma coluna é removida. Instalações sem provedor
-- de pagamento configurado continuam funcionando exatamente como antes —
-- aprovar uma solicitação segue levando direto a CONFIRMED.
-- ---------------------------------------------------------------------------
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Referência pública curta
--
-- Preenchida a partir da aprovação. Fica nula nas reservas antigas: é
-- identificador de conveniência, não chave de acesso, e inventar valor para
-- histórico não serviria a ninguém.
-- ---------------------------------------------------------------------------
ALTER TABLE "appointments" ADD COLUMN "public_reference" VARCHAR(16);

CREATE UNIQUE INDEX "appointments_public_reference_key"
  ON "appointments" ("public_reference");

-- ---------------------------------------------------------------------------
-- 2. Estado do DINHEIRO, separado do estado do agendamento
-- ---------------------------------------------------------------------------
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELED');
CREATE TYPE "PaymentMode" AS ENUM ('FULL', 'DEPOSIT');

CREATE TABLE "payments" (
  "id"                  UUID           NOT NULL,
  "appointment_id"      UUID           NOT NULL,
  "provider"            VARCHAR(40)    NOT NULL,
  "provider_payment_id" VARCHAR(120),
  "mode"                "PaymentMode"  NOT NULL,
  "amount_cents"        INTEGER        NOT NULL,
  "currency"            VARCHAR(3)     NOT NULL DEFAULT 'BRL',
  "status"              "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at"          TIMESTAMPTZ(3) NOT NULL,
  "paid_at"             TIMESTAMPTZ(3),
  "checkout_url"        VARCHAR(500),
  "pix_qr_code"         TEXT,
  "created_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  -- Dinheiro é inteiro em centavos e nunca negativo.
  CONSTRAINT "payments_amount_positive" CHECK ("amount_cents" > 0),
  -- PAID exige a data do pagamento; sem ela não há como auditar a confirmação.
  CONSTRAINT "payments_paid_has_timestamp"
    CHECK (("status" <> 'PAID') OR ("paid_at" IS NOT NULL)),
  CONSTRAINT "payments_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Um agendamento tem no máximo uma cobrança.
CREATE UNIQUE INDEX "payments_appointment_id_key" ON "payments" ("appointment_id");
-- Uma cobrança do provedor corresponde a no máximo um registro nosso: é isto
-- que impede duas linhas apontando para o mesmo pagamento externo.
CREATE UNIQUE INDEX "payments_provider_provider_payment_id_key"
  ON "payments" ("provider", "provider_payment_id");
CREATE INDEX "payments_status_expires_at_idx" ON "payments" ("status", "expires_at");

-- ---------------------------------------------------------------------------
-- 3. Idempotência do webhook
--
-- A unicidade (provider, external_id) é a garantia: a mesma notificação
-- reenviada grava uma linha e as demais tentativas colidem dentro da
-- transação que aplicaria o efeito. Reenvio não duplica nada.
-- ---------------------------------------------------------------------------
CREATE TABLE "payment_webhook_events" (
  "id"          UUID           NOT NULL,
  "provider"    VARCHAR(40)    NOT NULL,
  "external_id" VARCHAR(200)   NOT NULL,
  "payment_id"  UUID,
  "outcome"     VARCHAR(40)    NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_webhook_events_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payment_webhook_events_provider_external_id_key"
  ON "payment_webhook_events" ("provider", "external_id");
CREATE INDEX "payment_webhook_events_payment_id_idx"
  ON "payment_webhook_events" ("payment_id");

-- ---------------------------------------------------------------------------
-- 4. A reserva continua protegida durante a janela de pagamento
--
-- Sem isto, um agendamento aprovado e esperando pagamento sairia da proteção
-- contra reserva dupla e outra pessoa poderia gravar o mesmo horário. O
-- intervalo protegido segue sendo [starts_at, reserved_ends_at) — a reserva
-- operacional, não a duração do serviço.
--
-- Reconstruir a EXCLUDE exige lock na tabela. Ver docs/deployment.md.
-- ---------------------------------------------------------------------------
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_no_overlap";

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    tstzrange("starts_at", "reserved_ends_at", '[)') WITH &&
  ) WHERE ("status" IN ('PENDING', 'AWAITING_PAYMENT', 'CONFIRMED'));

COMMIT;
