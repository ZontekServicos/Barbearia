-- Buffers de preparação e limpeza por serviço.
--
-- Aditiva e neutra: tudo nasce com 0, então o comportamento da agenda é
-- exatamente o mesmo até alguém configurar um buffer de propósito. O objetivo
-- aqui é ter a arquitetura pronta (ex.: pigmentação com 10 min de preparo)
-- sem obrigar o uso agora.
ALTER TABLE "services"
  ADD COLUMN "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0;

-- Congelados na reserva, ao lado de nome e preço: editar o serviço depois não
-- pode reescrever o espaço que um agendamento antigo já ocupa na agenda.
ALTER TABLE "appointments"
  ADD COLUMN "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0;

-- Buffer negativo encolheria o atendimento; o teto evita que um erro de
-- digitação tire o dia inteiro da agenda.
ALTER TABLE "services"
  ADD CONSTRAINT "services_buffer_before_range"
  CHECK ("buffer_before_minutes" >= 0 AND "buffer_before_minutes" <= 120),
  ADD CONSTRAINT "services_buffer_after_range"
  CHECK ("buffer_after_minutes" >= 0 AND "buffer_after_minutes" <= 120);

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_buffer_before_range"
  CHECK ("buffer_before_minutes" >= 0 AND "buffer_before_minutes" <= 120),
  ADD CONSTRAINT "appointments_buffer_after_range"
  CHECK ("buffer_after_minutes" >= 0 AND "buffer_after_minutes" <= 120);
