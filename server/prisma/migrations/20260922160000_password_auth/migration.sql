-- Migração de autenticação: OTP por SMS -> telefone + senha.
--
-- Aditiva para dados de negócio: nenhum usuário, agendamento ou
-- relacionamento é removido. O telefone continua sendo o identificador único.

-- Credenciais.
--
-- password_hash é NULLABLE de propósito: as contas criadas pelo fluxo OTP não
-- possuem senha, e inventar uma seria pior do que não ter. Nenhuma senha
-- padrão, previsível ou compartilhada é atribuída aqui. Enquanto a coluna for
-- nula, o login por senha é recusado com a mesma resposta genérica de senha
-- errada, e o cadastro não pode reivindicar o telefone de uma conta existente.
-- A única saída é a redefinição assistida por um administrador, auditada.
ALTER TABLE "users"
  ADD COLUMN "password_hash" VARCHAR(255),
  ADD COLUMN "password_updated_at" TIMESTAMP(3),
  ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMP(3);

-- O contador de falhas nunca é negativo.
ALTER TABLE "users"
  ADD CONSTRAINT "users_failed_login_attempts_non_negative"
  CHECK ("failed_login_attempts" >= 0);

-- Um hash Argon2id tem prefixo conhecido. A checagem impede que alguém grave
-- senha em texto puro na coluna por engano, via script ou console de banco.
ALTER TABLE "users"
  ADD CONSTRAINT "users_password_hash_is_argon2id"
  CHECK ("password_hash" IS NULL OR "password_hash" LIKE '$argon2id$%');

-- Índice parcial para a varredura de contas ainda sem credencial, usada pelo
-- painel administrativo para saber quem precisa de redefinição assistida.
CREATE INDEX "users_without_password_idx"
  ON "users" ("created_at")
  WHERE "password_hash" IS NULL;

-- O desafio de OTP deixa de existir: sem ele não há caminho alternativo de
-- autenticação. A tabela guarda apenas hashes efêmeros de códigos já
-- expirados — nenhum dado de usuário, agendamento ou relacionamento.
DROP TABLE IF EXISTS "otp_challenges";

-- Sessões emitidas sob o modelo antigo são encerradas: quem entrou por OTP
-- precisa autenticar de novo pelo fluxo de senha.
UPDATE "refresh_tokens"
  SET "revoked_at" = NOW()
  WHERE "revoked_at" IS NULL;
