# Auditoria de segurança e QA — Twilio SMS OTP

Data: 22/09/2026. Base: `140ad7e09a979985c308749778441ba107996e4f`.

## Resultado

Implementação automatizada aprovada após correções. **Entrega real de SMS pendente; autenticação pública no Railway não está aprovada por esta auditoria.** Não foram usados credenciais reais ou destinatários reais de SMS. Não houve deploy nem alteração de variáveis do Railway.

O candidato foi validado em uma cópia isolada da base mais os arquivos Twilio. Existem alterações locais de agendamento, migration de booking e frontend que não pertencem a este escopo: foram preservadas e excluídas do commit. O schema e as duas migrations referidos abaixo são os do candidato a commit, não o schema de booking ainda não versionado.

## Achados e correções

### TWILIO-01 — Média — falso sucesso em resposta inválida (corrigido)

- Local: `server/src/modules/auth/sms/sms-provider.ts:183`, `:213` e `:265`, `sendOtp`/`readJsonSafely`.
- Evidência original: qualquer resposta HTTP bem-sucedida era aceita, inclusive corpo vazio, JSON inválido ou leitura interrompida. O teste anterior afirmava explicitamente que HTTP 201 vazio era sucesso.
- Impacto: API podia responder 200 e manter o desafio ativo sem confirmação válida de aceitação pelo provedor.
- Correção: exigir HTTP 201, SID de mensagem `SM` + 32 hexadecimais e estado de saída imediato reconhecido. Corpo inválido, incompleto, excessivo para análise ou status inesperado resulta em `SMS_UNAVAILABLE`. Redirecionamentos são recusados; não há repetição automática de envios.
- Verificação: regressões reproduziram a falha antes da correção. Testes de API + PostgreSQL confirmam 503, invalidação do desafio e impossibilidade de autenticar com esse OTP.

### TWILIO-02 — Média — metadados não validados em logs (corrigido)

- Regra: validação de dados externos e prevenção de exposição em logs.
- Local: `server/src/modules/auth/sms/sms-provider.ts:186`, `:201` e `:226`; `server/src/utils/logger.ts`.
- Evidência original: `sid`, `status` e qualquer `code` numérico retornado pelo provedor podiam ser registrados sem validação suficiente.
- Impacto: uma resposta anômala que ecoasse dados sensíveis poderia inseri-los nos logs. Não foi identificado vazamento real; o cenário foi reproduzido com respostas simuladas.
- Correção: validar formato do SID, permitir somente status conhecidos e códigos operacionais conhecidos; jamais registrar corpo de resposta ou causa original de rede. Logger mascara chaves Twilio, autorização e corpo da mensagem, inclusive em objetos aninhados.
- Verificação: testes com metadados contendo OTP/segredo e teste de redação aninhada passam. Telefone completo e credenciais não aparecem nos logs testados.

### TWILIO-03 — Baixa — aceitação apresentada como envio concluído (corrigido)

- Local: `server/src/modules/auth/sms/sms-provider.ts:226` e `README.md`, seção Provider de SMS.
- Evidência original: log `OTP enviado por SMS` para status `queued`/`accepted`.
- Correção: log informa solicitação aceita pela Twilio; documentação distingue aceitação de entrega ao aparelho e remove a afirmação antiga de provider não implementado.
- Limite: erros posteriores à aceitação não são conhecidos sincronamente. Não há webhook de acompanhamento de entrega nesta implementação.

### TWILIO-04 — Informativo — fixtures acionaram a proteção do GitHub (corrigido)

O primeiro push foi recusado porque os Account SIDs literais, embora fictícios, correspondiam ao detector de credenciais Twilio. Os testes passaram a construir identificadores explicitamente sintéticos; tokens fictícios também usam uma expressão claramente de teste. A suíte foi reexecutada. O commit local ainda não publicado foi atualizado, mantendo um único commit sobre a base, sem desabilitar a proteção e sem force push.

## Controles revisados

| Controle | Resultado |
| --- | --- |
| API real | POST HTTPS para `api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json`, Basic auth e formulário `To`/`Body` com `MessagingServiceSid` ou `From`; sem stub no caminho de produção |
| Credenciais | Somente ambiente no runtime; literais de testes são sintéticos. Exemplos mantêm credenciais Twilio vazias |
| Ambiente | `SMS_PROVIDER=twilio` exige SID, token e remetente; formatos e timeout são validados no boot |
| OTP dev em produção | `AUTH_OTP_DEV_MODE=true` e provider `console` recusados; testes de ambiente confirmam |
| Exposição de OTP | API não retorna OTP; produção não o registra. Console local só imprime com habilitação explícita fora de produção |
| Expiração/tentativas | Padrão 5 minutos e 5 tentativas; hash scrypt com salt; consumo e tentativas persistidos; uso único e concorrência testados |
| Rate limiting | Pedido: 5/15 min/IP; verificação: 10/15 min/IP; geral: 120/min/IP; adicional durável por telefone: 5 pedidos/15 min, inclusive falhas de envio |
| Falhas Twilio | Rede, timeout, HTTP de erro, resposta inválida e estados de falha produzem erro genérico; desafio invalidado; sem falso 200 nesses casos |
| Testes sem disparos | Transporte injetado; provider unitário bloqueia `globalThis.fetch`; integração usa transporte simulado e API em loopback |
| Autenticação/admin | OTP, sessões, refresh, logout, aprovação, bloqueio, auditoria, bootstrap, autorização por papel/status, CORS e cookies cobertos pela suíte de regressão |

## Validação executada

Ambiente: Node 24.13.1, pnpm 10.20.0, PostgreSQL 18.2 descartável em loopback. Nenhum banco de produção utilizado.

- Backend: **120 testes aprovados, zero falhas, zero skips**, incluindo **30 testes de integração com PostgreSQL real** e **32 testes do provider/logs**.
- Frontend: **8 testes do cliente HTTP aprovados**.
- Backend: `pnpm typecheck` e `pnpm build` aprovados.
- Frontend: `pnpm typecheck` e `pnpm build` aprovados.
- Prisma: `validate`, aplicação das migrations `20260921120000_init` e `20260921220000_auth_integrity`, `migrate status` e `migrate diff --exit-code` aprovados, sem divergência.
- Artefato compilado: startup com `NODE_ENV=production` e configuração Twilio sintética; `/health` respondeu 200 e `/auth/me` sem sessão respondeu 401. Esse smoke test não solicita OTP nem comprova entrega.
- Não há linter configurado. Não foi declarada aprovação de lint ou de entrega real.

## Variáveis e pendências para Railway

| Variável | Configuração |
| --- | --- |
| `NODE_ENV` | `production` |
| `SMS_PROVIDER` | `twilio` |
| `AUTH_OTP_DEV_MODE` | `false` |
| `TWILIO_ACCOUNT_SID` | Account SID real, `AC` + 32 hexadecimais |
| `TWILIO_AUTH_TOKEN` | Auth Token real, mínimo 32 caracteres; segredo somente no backend |
| `TWILIO_MESSAGING_SERVICE_SID` | `MG` + 32 hexadecimais; alternativa ao número e preferência se ambos existirem |
| `TWILIO_FROM_NUMBER` | Número habilitado em E.164, se não usar Messaging Service |
| `TWILIO_TIMEOUT_MS` | 10000 por padrão; 1000 a 30000 |
| `DATABASE_URL`, `JWT_ACCESS_SECRET` | PostgreSQL do ambiente e segredo aleatório forte |
| `FRONTEND_URL` | Origens HTTPS exatas autorizadas |
| `PORT` | Porta fornecida pelo Railway, consumida pelo servidor |
| `TRUST_PROXY_HOPS`, `REFRESH_COOKIE_SAME_SITE`, `REFRESH_COOKIE_PATH` | Conferir conforme topologia real de proxy, domínio e caminho público |
| `VITE_API_URL` | URL pública da API no build do frontend; nunca colocar credenciais Twilio em `VITE_*` |

Configurar serviço backend com raiz `/server`, Node 22 atualizado ou 24, instalação com lockfile congelado, build `pnpm build`, pré-deploy `pnpm db:migrate:deploy` e start `node dist/server.js`. O Prisma CLI precisa estar disponível na etapa de migrations. O processo já usa `PORT`, aceita conexões de rede e trata encerramento; `/health` é liveness, não prova disponibilidade de SMS ou banco. As configurações reais do serviço Railway não foram inspecionadas nesta auditoria.

Antes de abrir login público: configurar credenciais/remetente, permissões de envio para o destino e restrições da conta; testar envio autorizado, confirmar recebimento no aparelho e status no painel Twilio; concluir verificação do OTP e fluxo de aprovação administrativa pelo domínio público; validar HTTPS, CORS, cookies e IP sob o proxy real.

Os limites por IP são em memória por processo. O limite por telefone é durável no PostgreSQL. Avaliar limite compartilhado antes de escalar réplicas e controles de custo na conta Twilio. Persistem os limites operacionais já documentados da fundação; nenhuma funcionalidade de agendamento foi auditada ou publicada neste commit.

## Arquivos do commit

- `README.md`
- `server/.env.example` (somente modelo sem credenciais reais)
- `server/src/config/auth.integration.test.ts`
- `server/src/config/env.test.ts`
- `server/src/config/env.ts`
- `server/src/config/production.test.ts`
- `server/src/modules/auth/sms/sms-provider.ts`
- `server/src/modules/auth/sms/sms-provider.test.ts`
- `server/src/utils/logger.ts`
- `twilio_security_audit.md`

Commit previsto: `feat: implement Twilio SMS OTP provider`. Hash e resultado efetivo do push serão informados no retorno final, após revisão do índice. Artefatos de teste, banco descartável e logs permanecem em diretório ignorado e não integram o commit.

## Referências oficiais

- [Twilio Messages API e status da mensagem](https://www.twilio.com/docs/messaging/api/message-resource)
- [Twilio: transições assíncronas de status](https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks)
- [Railway: monorepos e raiz do serviço](https://docs.railway.com/deployments/monorepo)
- [Railway: Express](https://docs.railway.com/guides/express)
