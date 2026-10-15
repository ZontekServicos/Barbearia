-- Abertura manual da agenda: disponibilidade POSITIVA.
--
-- Aditiva. Nenhuma migration anterior é tocada e nenhuma tabela é removida:
-- `business_hours` continua existindo e deixa de ser consultada pelo cálculo de
-- disponibilidade. Mantê-la evita destruir configuração real num deploy que
-- pode ser revertido.
--
-- NÃO há semeadura. A agenda nasce FECHADA: enquanto não houver linha em
-- `schedule_openings`, nenhum horário aceita agendamento. Foi decisão
-- explícita do produto — "agenda fechada por padrão" no sentido literal — e
-- tem consequência operacional: logo após o deploy a barbearia precisa abrir a
-- semana na tela "Abertura da agenda", senão a agenda pública fica sem nenhum
-- horário.

CREATE TABLE "schedule_openings" (
  "id"            UUID         NOT NULL,
  -- 0 = domingo ... 6 = sábado. Nulo quando a faixa pertence a uma data.
  "weekday"       INTEGER,
  -- Faixa válida só nesta data. Nulo quando a faixa é semanal.
  "date"          DATE,
  -- Minutos desde a meia-noite LOCAL da barbearia. Inteiro, sem fuso: a
  -- conversão para instante é feita num ponto só da aplicação.
  "start_minute"  INTEGER      NOT NULL,
  "end_minute"    INTEGER      NOT NULL,
  "created_by_id" UUID,
  "created_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "schedule_openings_pkey" PRIMARY KEY ("id"),

  -- Semanal OU de data, nunca as duas e nunca nenhuma. Sem isto existiria uma
  -- linha que não se sabe quando vale.
  CONSTRAINT "schedule_openings_scope" CHECK (("weekday" IS NULL) <> ("date" IS NULL)),
  CONSTRAINT "schedule_openings_weekday_range" CHECK ("weekday" IS NULL OR ("weekday" BETWEEN 0 AND 6)),
  -- Dentro do dia e com fim depois do início. 1440 = meia-noite do dia seguinte,
  -- aceito para permitir uma faixa que vai até o fim do dia.
  CONSTRAINT "schedule_openings_bounds" CHECK (
    "start_minute" >= 0 AND "end_minute" <= 1440 AND "start_minute" < "end_minute"
  ),

  CONSTRAINT "schedule_openings_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "schedule_openings_weekday_idx" ON "schedule_openings"("weekday");
CREATE INDEX "schedule_openings_date_idx" ON "schedule_openings"("date");
CREATE INDEX "schedule_openings_created_by_id_idx" ON "schedule_openings"("created_by_id");

-- Sobreposição é impossível por CONSTRUÇÃO, não por checagem no serviço.
--
-- A validação na aplicação existe para dar mensagem boa; esta é a que resiste a
-- dois administradores salvando faixas que se cruzam no mesmo instante. Sem
-- ela, a janela entre o SELECT de validação e o INSERT aceitaria 09:00–13:00 e
-- 12:00–18:00 no mesmo dia.
--
-- Por que uma FAIXA e não `(weekday WITH =, range WITH &&)`: a forma com `=`
-- exigiria a extensão `btree_gist`, e nenhuma migration deste projeto cria
-- extensão — introduzir essa dependência faria a migration falhar justamente no
-- ambiente gerenciado, onde o papel pode não ter permissão. Em vez disso cada
-- dia ganha uma faixa própria de 1440 minutos no mesmo eixo inteiro, e aí basta
-- o `&&` de intervalo que as outras tabelas já usam.
--
-- O CHECK `end_minute <= 1440` é o que garante que uma faixa nunca invada a
-- faixa do dia seguinte.
ALTER TABLE "schedule_openings"
  ADD CONSTRAINT "schedule_openings_weekly_no_overlap"
  EXCLUDE USING gist (
    int4range(
      "weekday" * 1440 + "start_minute",
      "weekday" * 1440 + "end_minute",
      '[)'
    ) WITH &&
  ) WHERE ("weekday" IS NOT NULL);

-- Mesmo eixo, contado em dias desde uma época fixa. A data entra na conta para
-- que 17/10 e 24/10 não possam colidir entre si.
ALTER TABLE "schedule_openings"
  ADD CONSTRAINT "schedule_openings_date_no_overlap"
  EXCLUDE USING gist (
    int4range(
      ("date" - DATE '2000-01-01') * 1440 + "start_minute",
      ("date" - DATE '2000-01-01') * 1440 + "end_minute",
      '[)'
    ) WITH &&
  ) WHERE ("date" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Exceções por data.
--
-- A existência da linha é o que faz a data ignorar a regra semanal. "Fechado"
-- é esta linha SEM faixas correspondentes em `schedule_openings`; horário
-- especial é esta linha COM faixas. Derivar o fechado em vez de guardar um
-- booleano impede um registro que diga "fechado" tendo faixas abertas.
-- ---------------------------------------------------------------------------
CREATE TABLE "schedule_date_overrides" (
  "id"            UUID         NOT NULL,
  "date"          DATE         NOT NULL,
  "note"          VARCHAR(160),
  "created_by_id" UUID,
  "created_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "schedule_date_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "schedule_date_overrides_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Uma regra por data: duas linhas para o mesmo dia seriam duas verdades.
CREATE UNIQUE INDEX "schedule_date_overrides_date_key" ON "schedule_date_overrides"("date");
CREATE INDEX "schedule_date_overrides_created_by_id_idx" ON "schedule_date_overrides"("created_by_id");
