-- ---------------------------------------------------------------------------
-- Novo estado do AGENDAMENTO: aprovado pelo barbeiro, aguardando pagamento.
--
-- Sozinho numa migration de propósito: o PostgreSQL não permite USAR um valor
-- de enum na mesma transação que o adiciona. A EXCLUDE que precisa referenciar
-- 'AWAITING_PAYMENT' vem na migration seguinte, já com o valor commitado.
--
-- Aditivo e irreversível (não existe DROP VALUE). Nenhuma linha muda de estado.
-- ---------------------------------------------------------------------------
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT' AFTER 'PENDING';
