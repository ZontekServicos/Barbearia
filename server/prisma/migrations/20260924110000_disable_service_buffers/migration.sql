-- A exclusao atual cobre apenas [starts_at, ends_at). Ate existir uma
-- exclusao do periodo ocupado completo, nenhum escritor pode habilitar buffers.
-- Nao reescrevemos reservas nem alteramos a EXCLUDE que ja protege a producao.
-- Se houver buffer nao zero, a migration falha atomicamente para investigacao.
BEGIN;

ALTER TABLE "services"
  ADD CONSTRAINT "services_buffers_disabled"
  CHECK ("buffer_before_minutes" = 0 AND "buffer_after_minutes" = 0);

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_buffers_disabled"
  CHECK ("buffer_before_minutes" = 0 AND "buffer_after_minutes" = 0);

COMMIT;
