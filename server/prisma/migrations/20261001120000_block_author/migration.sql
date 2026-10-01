-- ---------------------------------------------------------------------------
-- Autoria do bloqueio administrativo de agenda.
--
-- A gestão de disponibilidade passa a registrar QUEM bloqueou um horário. Sem
-- isso, um bloqueio inesperado na agenda não tem a quem perguntar.
--
-- Estritamente aditiva e anulável: bloqueios criados antes deste campo
-- continuam valendo com autor nulo. Apagá-los para "limpar" seria destruir
-- agenda real por causa de um metadado que não existia.
-- ---------------------------------------------------------------------------
BEGIN;

ALTER TABLE "schedule_blocks" ADD COLUMN "created_by_id" UUID;

-- ON DELETE SET NULL de propósito: se a conta do administrador for removida, o
-- bloqueio PERMANECE. O horário continua indisponível de verdade — perder o
-- bloqueio junto com o autor abriria a agenda sem ninguém pedir.
ALTER TABLE "schedule_blocks"
  ADD CONSTRAINT "schedule_blocks_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "schedule_blocks_created_by_id_idx" ON "schedule_blocks" ("created_by_id");

COMMIT;
