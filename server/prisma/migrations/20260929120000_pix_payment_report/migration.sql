-- ---------------------------------------------------------------------------
-- Declaração de pagamento pelo cliente, e prazo de conferência da barbearia.
--
-- Separa dois prazos que antes eram um só:
--   expires_at           → até quando o CLIENTE paga e informa;
--   review_expires_at    → até quando a BARBEARIA confere o que foi informado.
--
-- O defeito que isto corrige: a janela de pagamento vencia enquanto o dinheiro
-- já estava na conta, liberando o horário de quem tinha pagado.
--
-- Estritamente aditiva. Ambas nulas nas cobranças existentes, que continuam
-- valendo pelo `expires_at` — nenhuma reserva muda de estado.
-- ---------------------------------------------------------------------------
BEGIN;

ALTER TABLE "payments" ADD COLUMN "payment_reported_at" TIMESTAMPTZ(3);
ALTER TABLE "payments" ADD COLUMN "review_expires_at"   TIMESTAMPTZ(3);

-- Prazo de conferência só existe depois de haver declaração. Um sem o outro
-- seria estado impossível: conferência sem nada informado, ou declaração sem
-- prazo para tratá-la.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_review_requires_report"
  CHECK (("review_expires_at" IS NULL) = ("payment_reported_at" IS NULL));

-- A conferência nunca começa antes da declaração.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_review_after_report"
  CHECK ("review_expires_at" IS NULL OR "review_expires_at" > "payment_reported_at");

-- Busca das cobranças declaradas e ainda não conferidas — o que o painel
-- precisa destacar e o que a varredura precisa encontrar.
CREATE INDEX "payments_reported_review_idx"
  ON "payments" ("payment_reported_at", "review_expires_at")
  WHERE "payment_reported_at" IS NOT NULL;

COMMIT;
