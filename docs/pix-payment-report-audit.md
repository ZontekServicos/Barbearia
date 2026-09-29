# Auditoria independente — proteção de Pix informado

Data: 29/09/2026. Base inspecionada: `46e8b9e`, branch `main`.
Escopo: implementação ainda não commitada, código completo dos consumidores de prazo,
diff, testes HTTP, PostgreSQL 18 real e Chromium local. Relatórios anteriores não
foram usados como evidência. Skill aplicada: security-best-practices.

## Resultado

Gates críticos aprovados após as correções abaixo. Declaração pública não confirma
dinheiro nem agendamento. Não houve acesso a banco de produção, alteração no
Railway ou deploy manual. Evidências locais: `.tmp-pix-review-audit/` (ignorado
pelo Git); testes reexecutáveis permanecem no repositório.

## Problemas encontrados e correções

| ID | Gravidade | Problema verificado | Correção / evidência |
| --- | --- | --- | --- |
| PIX-01 | Crítica | Consulta pública expirava a reserva e admin recusava confirmação pelo prazo original, embora a conferência estivesse aberta. | Prazo vigente em consulta e conciliação; regressão falhou antes e passou depois. `public-booking.service.ts:364`, `payment.service.ts:400`. |
| PIX-02 | Alta | Cleanup selecionava IDs vencidos e depois atualizava sem revalidar estado/prazo; podia apagar uma declaração concorrente. | UPDATE com predicados e RETURNING atômicos; teste com barreira de lock observada em pg_stat_activity. `appointments.service.ts:171`. |
| PIX-03 | Alta | Rota aceitava FAILED e devolvia sucesso idempotente antes de checar estados terminais. | Exige PENDING + AWAITING_PAYMENT + janela válida antes de repetir; terminal recebe 409. `payment.service.ts:526`. |
| PIX-04 | Alta | Recusa limpava os instantes e permitia renovar review; FAILED escondia o QR no componente apesar de a API oferecê-lo. | ADMIN reabre a mesma cobrança PENDING somente no prazo; auditoria guarda/restaura os primeiros instantes; recusas repetidas nunca aumentam hold. Vencido: EXPIRED imediato. `payment.service.ts:427`, `:562`. |
| PIX-05 | Média | Fallback do pop-up pertencia ao componente do QR e sumia ao atualizar. Teste antigo mascarava isso devolvendo QR após o POST. | Fallback no pai, estado local informado após POST mesmo se GET/window.open falhar; teste usa transição real. `BookingStatus.tsx:163`, `:184`. |
| PIX-06 | Média | Cliente ainda era orientado a pagar após declarar; admin omitia AWAITING_PAYMENT vencido do filtro EXPIRED. | Mensagens de conferência, prazo absoluto no admin e filtro corrigidos. `BookingStatus.tsx:250`, `PaymentSection.tsx:190`, `appointments.service.ts:334`. |
| PIX-07 | Média | Comando test:integration omitia suítes de Pix/provedor; teste legado do WhatsApp exigia zero POST. | Runner inclui essas suítes e migration; teste verifica POST antes do pop-up e ausência de opener. |

Os caminhos abreviados acima estão em `server/src/modules/booking/`,
`server/src/modules/payment/`, `src/pages/client/` e `src/components/admin/`.

## PAYMENT REPORT

PASS. POST público identifica exclusivamente pelo SHA-256 do publicToken.
Corpo vazio estrito; campos financeiros, datas, provider, userId e status extras
recebem 400. Token desconhecido recebe 404; token inválido, 400.
Pix manual é denominado `STATIC_PIX` na configuração e `static-pix` no Payment
(o equivalente a PIX_MANUAL no pedido de auditoria). Sem cobrança, provedor
dinâmico ou estado incompatível: 409. Horário de produção é lido no servidor
após obter o lock. Após declarar: Payment PENDING, paidAt null, Appointment
AWAITING_PAYMENT, nenhuma auditoria PAYMENT_PAID.

## IDEMPOTENCY

PASS. Duas e dez chamadas sequenciais, dez primeiras declarações simultâneas,
repetição após vencimento e token de outro pedido testados. Uma cobrança e os
mesmos dois instantes; nenhuma extensão por novo clique.
Na nova tentativa autorizada pelo ADMIN, os instantes originais são restaurados
da auditoria PAYMENT_FAILED. Preservar essa auditoria é parte da regra.

## PAYMENT WINDOW

PASS. Manual 120 minutos; dinâmico 15 minutos. Constantes de negócio em
BookingRules, consumidas por paymentWindowMinutesFor. Outros 120/15 encontrados
em políticas distintas, fixtures e documentação não decidem a janela Pix.

## REVIEW WINDOW

PASS. Exatamente min(paymentReportedAt + 24h, startsAt - 60min).
Relógio fixo cobre atendimento distante, 8h, 90min, 61min, 60min, 59min, entradas
em fusos distintos e virada de dia. Fronteiras 61/60/59 também exercitam escrita
real no PostgreSQL.

## PENDINGEXPIRESAT AUDIT

Busca completa no repositório, excluídos artefatos ignorados/gerados:

| Consumidor | Significado e resultado |
| --- | --- |
| appointments.service — criação PENDING | Prazo de aprovação. |
| appointments.service — aprovação | Prazo original de pagamento ou null sem pagamento. |
| payment.service — declaração | Passa ao prazo de conferência na mesma transação. |
| payment.service — confirmação | Null após CONFIRMED; PAID gravado atomicamente. |
| payment.service — não localizado | Menor prazo entre original e reserva vigente; nunca aumenta por recusa repetida. |
| appointments.service — cleanup | Expira somente linhas ainda vencidas sob lock; cobrança acompanha. |
| availability.service | PENDING/AWAITING_PAYMENT ocupam enquanto prazo > now. |
| public-booking.service — quota | Conta reservas com prazo vigente. |
| public-booking.service — consulta | Prazo vigente, sem cortar review pelo expiresAt original. |
| booking.mapper — cliente/admin | Expiração lógica, contador vigente e reviewOverdue. |
| appointments.service — agenda | Filtros ativos/vencidos incluem AWAITING_PAYMENT. |
| appointments.service — cancelamento | Null; estado sai da EXCLUDE, Payment pendente vira CANCELED. |
| schema/migrations | Coluna nullable e índice; comentários atualizados. |
| frontend | Não lê pendingExpiresAt diretamente; recebe status/contador/prazo derivados. |

EXCLUDE usa estados ativos e intervalo temporal do atendimento, não compara
pendingExpiresAt com o relógio. A transação de nova reserva faz a expiração
persistida antes do insert. A reavaliação do WHERE após espera por lock é
documentada pelo [PostgreSQL 18](https://www.postgresql.org/docs/18/transaction-iso.html).

## SLOT PROTECTION

PASS. Com expiresAt original vencido e review aberto, availability não retorna
o slot; outro cliente recebe 409. EXCLUDE continua cobrindo PENDING,
AWAITING_PAYMENT e CONFIRMED. Sem declaração, vencimento remove QR e CTA e
apresenta EXPIRED; availability libera o horário. A persistência de EXPIRED
ocorre no cleanup transacional ao disputar o intervalo, não por um novo cron.

## NEAR APPOINTMENT

PASS. Em <=60min a declaração é recusada sem gravar os dois campos. Contato com
a barbearia continua disponível quando WhatsApp está configurado.

## REVIEW EXPIRATION

PASS. Nunca PAID/CONFIRMED automaticamente. O horário volta à disponibilidade;
nova reserva expira a anterior. reviewOverdue continua visível ao ADMIN antes e
depois do cleanup. **Mesmo quem realmente pagou pode perder o horário se o
barbeiro não conferir a tempo; nesse caso precisa de tratamento manual e
eventual estorno.** A consequência consta também em docs/payments.md.

## CLIENT

PASS. Antes: QR/Copia e Cola/CTA. Depois: pagamento informado, aguardando
conferência e reserva temporária; QR e convite a pagar saem. Erro do GET posterior
não restaura o QR. Não anuncia pagamento/agendamento confirmado pelo POST público.

## ADMIN

PASS. Distingue sem declaração, informado, conferência vencida, confirmado e
expirado; mostra valor, referência, instante informado e limite da conferência.
Sem sessão: 401; CUSTOMER: 403; ADMIN ativo: permitido.
Confirmação válida grava PAID + paidAt + CONFIRMED atomicamente.
Não localizado registra decisão administrativa e oferece nova tentativa somente
no prazo, sem novo Payment e sem renovar a primeira conferência.

## WHATSAPP

PASS. POST com sucesso precede window.open; erro do POST não abre WhatsApp.
Bloqueio/retorno null/exceção na abertura não apagam a declaração; link manual
permanece após o QR desmontar. Pop-up real no Chromium verifica opener null.
Não inferimos bloqueio somente pelo retorno null, que também pode ocorrer com
noopener, conforme [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/open).

## CONCURRENCY

PASS em PostgreSQL real: report × report; report × confirmação; report × não
localizado; report × cleanup de expiração com barreira determinística; review
expirada × nova reserva; dez reservas no mesmo horário. Uma reserva ativa,
conflitos 409, nenhum erro 500 esperado. Cancelamento e EXCLUDE revalidados pelas
suítes completas. Testes HTTP e transações reais complementam os testes de UI.

## MIGRATION

PASS. 20260929120000_pix_payment_report é aditiva. CHECKs exigem par de timestamps
e review posterior ao report; índice parcial presente. Fixture com schema anterior
preserva integralmente pagamento/agendamento existentes. Falha de lock prova
rollback transacional. migrate deploy repetido sem pendências; migrate status
atualizado; migrate diff exit 0, zero drift, com CHECKs/índice verificados
separadamente no catálogo PostgreSQL. Rollback lógico documentado: resolver
reviews antes de voltar ao código antigo e preservar histórico/colunas.

## POSTGRESQL

PostgreSQL 18 descartável, 127.0.0.1:55441, banco erickcorttes_test. Guardas de
testes recusam hosts remotos e outro nome de banco. Nenhum comando de banco
apontou para produção. Cluster de auditoria mantido localmente como artefato,
sem ser versionado.

## TESTS

- Backend completo: 452 passaram, zero falhas/skip.
- Frontend unitário: 28 passaram.
- Browser completo: 120 passaram; 1 reprodução histórica ignorada intencionalmente.
- Mobile: 360, 375, 390, 412 e 430; overflow e alvos de toque verificados.
- pnpm test:integration atualizado: passou, incluindo Pix e migration.
- Backend/frontend typecheck e build: passaram.
- pnpm audit --prod (raiz e server): nenhuma vulnerabilidade conhecida.
- git diff --check: passou.
- Varredura de credenciais nos arquivos de publicação: nenhum achado.

Uma rodada de browser teve recarga inesperada no teste de navegação durante
atividades paralelas. A rodada final foi executada com arquivos estáveis e sem
builds concorrentes. A única exclusão intencional é o teste de reprodução histórica
da Agenda, que exige LEGACY_AGENDA_REF; não é um gate da implementação atual.

## SECURITY

Token aleatório de 256 bits armazenado como digest; validação estrita, rate limit,
sem mass assignment ou identificadores internos em links de WhatsApp. Autorização
ADMIN permanece no middleware e serviço. Nenhuma confirmação financeira pelo
cliente. Varredura automática de padrões de segredo mais revisão do diff, sem
publicar logs nem banco descartável.

Limites: testes Chromium usam API interceptada; comportamento Express/Prisma,
autorização, migrations e concorrência foram testados separadamente contra
PostgreSQL real. Não houve transação Pix bancária nem envio real de mensagem.
Build frontend emite aviso não bloqueante de import dinâmico já também estático.

## COMMIT / HASH / PUSH

A revisão cobre os arquivos deste commit. O hash e a confirmação do push normal
para main são registrados na resposta de entrega; não se embute o hash do próprio
commit no arquivo versionado. Nenhum force push ou deploy manual é autorizado
por este relatório.

## PENDÊNCIAS

Nenhuma falha crítica identificada permaneceu após os gates. Operação deve
acompanhar reviewOverdue e tratar manualmente/estornar pagamentos cuja revisão
venceu. Três relatórios anteriores não relacionados permaneceram fora do commit:
password_auth_migration_runbook.md, password_auth_security_audit.md e
public_booking_security_audit.md.
