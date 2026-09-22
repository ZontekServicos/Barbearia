# Auditoria de backend, segurança e QA — ErickCorttes

Data: 22/09/2026. Escopo: autenticação, sessões, usuários, administração e integração React/Express/Prisma/PostgreSQL. Alterações feitas no workspace, sem commit, push ou deploy. Identidade visual preservada; não foram implementados módulos de serviços, barbeiros, disponibilidade ou agendamentos.

## 1. Resultado e evidências

A fundação passou nas validações locais e pode sustentar o desenvolvimento da próxima fase. Não está liberada para login público em produção: o envio real de SMS continua pendente, conforme o escopo solicitado. As limitações operacionais estão na seção 8.

| Verificação | Resultado |
| --- | --- |
| PostgreSQL externo real utilizado | **SIM — PostgreSQL 18.2**, cluster descartável local, porta 55439 |
| Prisma + adapter-pg contra PostgreSQL real | **SIM — Prisma/client/adapter 7.10.0** |
| Migrations aplicadas | **SIM — inicial e incremental**, via `prisma migrate deploy` |
| Schema versus banco após migrations | **PASS — `prisma migrate diff ... --exit-code`: No difference detected** |
| Testes backend | **78 PASS / 0 FAIL / 0 SKIP** na execução com integração habilitada |
| Testes do cliente HTTP frontend | **8 PASS / 0 FAIL** |
| Total automatizado | **86 PASS / 0 FAIL** |
| Validações adicionais em Edge/Playwright | **10 PASS / 0 FAIL**, com API e banco reais e SMS capturado em memória |
| Build frontend | **PASS** |
| Build backend | **PASS** |
| Typecheck frontend / backend | **PASS / PASS** |
| Inicialização do backend compilado em modo produção | **PASS**, configuração sintética: `/health` 200 e `/auth/me` sem sessão 401 |
| Formatação dos 37 arquivos TS/TSX trabalhados | **PASS**, após corrigir um defeito do formatador antigo |
| Lint | **Não configurado no repositório**; oxfmt não foi apresentado como linter |
| Auditoria final de dependências | **0 advisories na raiz e 0 no backend**, incluindo ferramentas de desenvolvimento |

Os 27 testes de integração PostgreSQL estão incluídos nos 78 do backend. A execução separada de `test:integration` confirmou o comando documentado, sem duplicá-los na contagem. Os seis testes PGlite continuam separados conceitualmente e não foram usados como prova de PostgreSQL externo.

Antes das correções, os 41 testes existentes passavam, mas não detectavam estes comportamentos reproduzidos em PostgreSQL real:

- Duas verificações simultâneas do mesmo OTP: **2 autenticações bem-sucedidas**.
- Dois refreshes simultâneos com o mesmo token: **2 rotações bem-sucedidas**.
- Usuário `ADMIN/PENDING` em `/admin/users`: **HTTP 200**.

Após as correções, as regressões verificam respectivamente: uma única autenticação; uma rotação seguida de revogação segura por reuso; e HTTP 403 para administrador pendente.

## 2. Arquitetura confirmada

| Camada | Versões instaladas / comportamento verificado |
| --- | --- |
| Frontend | React/React DOM 19.2.4, Vite 8.0.16, Tailwind 4.2.2, React Router 7.18.3, TypeScript 5.9.3 |
| Backend | Express 5.2.1, Prisma/client/adapter-pg 7.10.0, Zod 4.6.5, jsonwebtoken 9.0.3, Helmet 8.3.0, cors 2.8.6, express-rate-limit 8.7.0 |
| Ferramentas backend | TypeScript 5.7.3, tsx 4.23.15, PGlite 0.5.8 |
| Ambiente executado | Node 24.13.1, pnpm 10.20.0; `.mise.toml` do projeto seleciona Node 22 |
| Banco | `users`, `otp_challenges`, `refresh_tokens`, `admin_audit_logs`; enums CUSTOMER/ADMIN e PENDING/ACTIVE/BLOCKED |
| Prisma 7 | URL no `prisma.config.ts` e no adapter em runtime; client gerado localmente; pool único e encerramento no shutdown |
| API | Routers separados para auth, users e admin; Zod na entrada; respostas em envelope uniforme |
| Frontend auth | Access somente em memória; cookie httpOnly; Context; guards de UX; autorização efetiva permanece na API |

A migration inicial correspondia ao schema encontrado antes das alterações. Ela foi preservada. As mudanças de FK foram feitas em migration incremental, e a cadeia completa corresponde ao schema final. Não houve uso de `db push`.

## 3. Achados classificados e correções

Nenhum achado **CRÍTICO** foi confirmado. A classificação abaixo considera o impacto demonstrado ou o risco concreto no código; não pressupõe comprometimento anterior.

### ALTO

| ID | Problema encontrado e impacto | Correção / evidência atual |
| --- | --- | --- |
| QA-01 | Verificação de OTP consumia o desafio separadamente da emissão de sessão. Concorrência autenticava duas vezes. | Lock por telefone no PostgreSQL; consumo, criação/localização do usuário e sessão na mesma transação. `server/src/modules/auth/auth.service.ts:60`, `server/src/utils/locks.ts`. Regressão real concorrente passou. |
| QA-02 | Rotação de refresh não era atômica. Dois sucessores podiam permanecer válidos; revogar refreshes não invalidava imediatamente access já emitido. | Lock do usuário e rotação transacional; reuso confirma revogação antes de lançar erro; JWT vinculado à sessão consultada no banco. Logout alcança sucessoras. `server/src/modules/auth/token.service.ts:94`, `server/src/middlewares/auth.ts:20`. |
| QA-03 | Middleware administrativo exigia ADMIN, mas não conta ACTIVE. `ADMIN/PENDING` tinha acesso confirmado à API. | Encadeamento `requireAuth`, `requireActiveAccount`, `requireRole('ADMIN')`; frontend também exige estado autenticado ativo. `server/src/modules/admin/admin.routes.ts:22`, `src/components/RouteGuards.tsx:65`. |
| QA-04 | Alterações de status não protegiam invariantes entre administradores concorrentes. Bloqueios cruzados poderiam deixar o sistema sem admin ativo. | Transição serializada, locks dos usuários, revalidação do ator dentro da transação e proteção do último admin. Self-change continua recusado. Status, auditoria e revogação são atômicos. `server/src/modules/admin/admin.service.ts:86`. Teste concorrente preserva exatamente um admin ativo. |
| QA-05 | Auditoria apontou vulnerabilidades em ferramentas, incluindo bypass de `fs.deny` no Vite antigo em Windows quando exposto à rede. | Vite 8.0.16 e correções transitivas específicas, detalhadas na seção 7. Auditorias finais sem advisories. A gravidade do advisory não implica que a falha tenha sido explorada neste ambiente. |

### MÉDIO

| ID | Problema encontrado | Correção / evidência atual |
| --- | --- | --- |
| QA-06 | ConsoleSmsProvider imprimia OTP em desenvolvimento mesmo com a flag de modo dev desligada. | Console exige `AUTH_OTP_DEV_MODE=true`; padrão e exemplo agora false. Produção continua proibindo console e OTP dev. Falha de envio gera 503 e consome o desafio. `server/src/modules/auth/sms/sms-provider.ts:30`. |
| QA-07 | Bootstrap promovia automaticamente qualquer registro do telefone indicado, inclusive bloqueado; alteração e auditoria não eram atômicas. | Promoção/reativação existente exige flag explícita, operação transacional e idempotente; sessões antigas são revogadas; saída mascara telefone. `server/src/modules/admin/bootstrap.service.ts:6`. |
| QA-08 | Excluir o ator apagava o histórico administrativo por cascata. A ligação do refresh sucessor não tinha FK. | FK de ator com RESTRICT e FK de sucessor com SET NULL, via `20260921220000_auth_integrity`. Exclusão de alvo preserva o evento; exclusão de usuário remove suas sessões. Regressões reais das FKs passaram. |
| QA-09 | Limites de envio dependiam apenas do IP; `trust proxy=1` era fixo, sem relação obrigatória com a topologia. | Limite durável de cinco pedidos por telefone normalizado a cada 15 minutos, serializado no banco, além do limite por IP. Proxy configurável com padrão zero. `auth.service.ts:17`, `server/src/config/env.ts`. |
| QA-10 | Requisições 401 e restauração em StrictMode podiam disparar várias rotações; logout falho mantinha estado; guards deixavam passar estado de erro. | Single-flight por página, uma repetição por chamada, proteção contra refresh tardio após logout, limpeza local imediata e guards fechados durante loading/erro. `src/services/api.ts:89`, `src/context/AuthContext.tsx`, `src/components/RouteGuards.tsx`. Oito testes do cliente HTTP passaram. |
| QA-11 | Frontend cortava telefones com +55; backend removia indiscriminadamente letras e aceitava DDD não atribuído. Busca textual admin incluía `phone contains ''`, retornando todos. | Backend centraliza validação; frontend preserva entrada. DDD e caracteres são validados. Busca só aplica filtro de telefone quando há dígitos; ordenação estável e paginação real na interface. `server/src/utils/phone.ts`, `admin.service.ts:24`, `src/pages/admin/Users.tsx:61`. |

### BAIXO / robustez

| ID | Problema encontrado | Correção |
| --- | --- | --- |
| QA-12 | Documentação dizia que refresh era JWT e exigia segredo que nunca era usado; opção vazia de nome no env de exemplo precisava ser compatível com validação. | Removida exigência de `JWT_REFRESH_SECRET`; documentado token opaco SHA-256; nome vazio opcional tratado corretamente; README e exemplos reescritos conforme execução real. |
| QA-13 | Erros de JSON, CORS e constraints podiam virar 500 genérico; hashes OTP malformados não tinham validação estrutural suficiente. | Mapeamento de erros 400/403/404/409/413/503 conforme caso; erro interno sem SQL/stack/credenciais; validação exata do salt/hash antes de comparar; timeout do pool e logs Prisma brutos desabilitados. Não foi declarado bypass explorável por hash malformado. |
| QA-14 | Redação de logs devolvia objetos profundos sem sanitização. | Profundidade excessiva vira marcador truncado; chaves sensíveis seguem redigidas. `server/src/utils/logger.ts:26`. |
| QA-15 | oxfmt 0.2.0 removeu separadores em tipos compactos e uma marca de atribuição em teste durante a revisão. | Tipos expandidos e inicialização explícita; checagem do formatador, TypeScript, testes e builds refeitos. A ferramenta antiga foi preservada; typecheck é obrigatório depois de formatação. |

Outras correções funcionais: cliente aprovado sai corretamente da tela de espera; cadastro de conta já ativa respeita papel/status depois de informar nome; logout da tela bloqueada redireciona; PENDING pode acessar perfil próprio; saudação mostra a identidade autenticada; busca/paginação ignoram respostas antigas.

Não foi encontrada escalada efetiva por mass assignment no código original: a escrita já selecionava campos permitidos. Os schemas foram endurecidos para recusar campos extras explicitamente, e tentativas de enviar `role`/`status` foram testadas com HTTP 400 e sem promoção no banco.

## 4. Controles de segurança validados

- OTP: `randomInt`, seis dígitos, scrypt com salt aleatório de 16 bytes e hash de 32 bytes, `timingSafeEqual`, expiração e contador persistido. Uso único e tentativas são coordenados por locks transacionais entre processos.
- Reenvio: invalida desafios anteriores. Falha de envio invalida o novo e não ressuscita o antigo. Resposta de pedido é igual para conta existente e nova, sem código.
- Sessões: refresh opaco aleatório de 32 bytes, apenas hash no banco; JWT HS256 com issuer, audience, subject, sid e expiração validados. Access anterior deixa de autorizar depois da rotação. Reuso revoga sessões do usuário; novo OTP permite nova sessão.
- Autorização: consulta sessão e usuário atuais; CUSTOMER não entra em admin, ADMIN PENDING é negado, BLOCKED e usuário removido não autenticam. Perfil próprio é uma exceção intencional permitida para PENDING.
- Cookies: host-only, httpOnly, Secure em produção, Max-Age/Expires coerentes, path público configurável e remoção com mesmos atributos. Refresh pelo corpo foi removido.
- CORS/CSRF: allow-list exata, credentials, preflight e header obrigatório `X-CSRF-Protection: 1` em POST de auth. Não foi presumida exploração CSRF no código original: o header reforça o contrato que já dependia de validação de Origin. O padrão foi conferido na [orientação OWASP para APIs com headers customizados](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
- Administração: status e auditoria na mesma transação; ator revalidado; self-change negado; último admin protegido; revogação ao desativar. Logs de negócio guardam somente dados necessários à transição.
- Erros: respostas de produção não incluem stack, SQL, paths, hashes ou segredos; conflitos Prisma P2002/P2003 e ausência P2025 são mapeados.
- Frontend: nenhum access/refresh em localStorage/sessionStorage; requests incluem credentials; guards só renderizam conteúdo após autorização; falhas de rede não são apresentadas como autenticação bem-sucedida.

## 5. Banco e integridade

Cluster exclusivo de auditoria em `.tmp-qa/auth-postgres`, acessível localmente pela porta 55439, banco `erickcorttes_test`. O PostgreSQL já existente na porta padrão não foi utilizado. Nenhuma credencial ou tabela de produção foi usada. O cluster descartável foi encerrado após os testes.

Prisma, adapter-pg, transações, locks, enums, defaults, unique de telefone, timestamps, relações e FKs foram exercitados pelas migrations e pela suíte real. Os índices de telefone/criação do OTP, status/papel, usuário/expiração dos refreshes e ator/alvo da auditoria foram conferidos no schema e no diff do banco.

Os testes de integração exigem opt-in via `TEST_DATABASE_URL`, recusam host remoto/nome diferente e limpam apenas esse banco descartável. `test:integration` aplica migrations antes de testar. Quando essa variável não é informada, a suíte real é pulada explicitamente; isso não pode ser contado como integração validada por outro ambiente.

## 6. Testes e builds

Dos 41 testes anteriores, um caso de env foi atualizado para refletir o refresh opaco. Foram acrescentados **37 testes backend** e **8 testes frontend**, totalizando **45 novos testes e 86 no total**.

| Conjunto | Pass | Fail | Conteúdo |
| --- | ---: | ---: | --- |
| Backend existente + novas regressões sem PostgreSQL externo | 51 | 0 | Inclui 6 PGlite, env, crypto, telefone, guards, cookies de produção, claims JWT e erros |
| Express + Prisma + PostgreSQL externo | 27 | 0 | OTP e refresh concorrentes, reuse, limites, mass assignment, autorização, cookies, logout, busca, admin, bootstrap, FKs e CORS |
| API client frontend | 8 | 0 | Dez 401 simultâneos, StrictMode, 401 tardio, retry limitado, rede, logout concorrente, bloqueio e resposta inválida |
| Edge/Playwright — verificações adicionais | 10 | 0 | Jornada completa, perfil PENDING, ausência de flash, aprovação, paginação, logout, bloqueio, 360px sem overflow e ausência de exceções JS |

Migrations, geração do client, typechecks, builds e startup do `dist/server.js` foram executados. O runner de integração foi testado diretamente. O script frontend de testes usa o tsx instalado no pacote backend e funciona sem shim global do pnpm.

As verificações de cookies de produção exercitam a serialização real do Express sob `NODE_ENV=production`. Isso não substitui um teste HTTPS ponta a ponta na topologia final de hospedagem. O navegador local usou HTTP de desenvolvimento, com API e PostgreSQL reais e provider de teste em memória; não enviou SMS externo.

Evidências locais ignoradas pelo Git: `.tmp-qa/auth-tests-final.txt`, `.tmp-qa/auth-integration-final.txt`, `.tmp-qa/auth-browser-results.json`, `.tmp-qa/auth-pending-360.png` e os JSON de audit antes/depois. O script de reprodução da jornada fica em `.tmp-qa/auth-browser.ts`; usa o Playwright temporário do ambiente de QA. Os testes de regressão mantidos no projeto estão nos arquivos listados na seção 9.

## 7. Dependências

Na leitura inicial, o audit encontrou 9 advisories na raiz (6 altos, 3 moderados) e 6 no backend (3 altos, 3 moderados), nas ferramentas/transitivas identificadas. O audit final de ambos os pacotes retornou listas vazias.

| Dependência | Correção aplicada |
| --- | --- |
| Vite | 8.0.5 → 8.0.16, patch dirigido ao [advisory de Windows](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) |
| postcss | Override para 8.5.23 nos ranges vulneráveis |
| nanoid 3 | Override para 3.3.18 nos ranges vulneráveis |
| lodash | Override para 4.18.1, evitando também a release 4.18.0 marcada como defeituosa |
| mysql2 | Override para 3.23.1 na árvore das ferramentas Prisma; a aplicação usa PostgreSQL |
| deepmerge-ts | Override **somente de `@prisma/config`** para 8.0.0, corrigindo [recursão não limitada](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) |

O salto transitivo de deepmerge foi específico para o advisory. As [mudanças de Map e tipos do v8](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0) foram avaliadas; o projeto usa configuração simples, e generate, migrate, diff e build passaram com o override. Prisma permaneceu em 7.10.0; não foi adotada a versão 8 prerelease sugerida pelo CLI.

Lockfiles atualizados. A configuração de seed duplicada e obsoleta de `server/package.json` foi removida; permanece no `prisma.config.ts`.

## 8. Pendências reais e próxima fase

1. **SMS real:** Twilio continua sem implementação por determinação do escopo. A API retorna 503 honestamente. Bloqueia disponibilizar login público, mas não o desenvolvimento local da próxima fase.
2. **Topologia de produção:** validar HTTPS, proxy confiável, origens e path/SameSite do cookie na hospedagem escolhida. Cookies de terceiros podem ser bloqueados mesmo com None/Secure; README documenta preferência por proxy no mesmo site. Nenhum deploy foi feito.
3. **Múltiplas réplicas:** limites por IP ainda são em memória por processo. Antes de escalar horizontalmente, escolher store compartilhado ou limite na borda. Locks e limite por telefone já são compartilhados via PostgreSQL.
4. **Múltiplas abas:** single-flight cobre uma página. Abas independentes podem disputar o cookie e provocar revogação conservadora por reuso; não há coordenação entre abas nesta implementação.
5. **Logout offline:** estado local é limpo, mas revogação remota/remoção de cookie depende de conexão; recarregar pode restaurar uma sessão cujo logout não chegou à API.
6. **Retenção:** não existe job agendado de limpeza de desafios/sessões antigas. Planejar retenção antes de operação prolongada, preservando a janela do rate limit e histórico necessário à detecção de reuso.
7. **Ferramentas:** não há linter configurado. oxfmt 0.2 tem defeitos observados em tipos compactos; alterações formatadas devem continuar passando pelo TypeScript.

**Próxima fase: SIM, para desenvolvimento técnico após revisão destas alterações.** As invariantes prioritárias de autenticação, autorização e integridade estão cobertas por testes reais. Serviços, barbeiros, disponibilidade e agendamentos deverão aplicar autorização também na API; não devem depender dos guards React. Os pontos de operação acima continuam sendo critérios para lançamento público.

## 9. Arquivos criados ou alterados nesta auditoria

Lista desta intervenção, distinta dos arquivos que já estavam alterados/não rastreados ao retomá-la. O workspace anterior foi preservado.

```text
.env.example
README.md
package.json
pnpm-lock.yaml
security_best_practices_report.md
src/App.tsx
src/components/RouteGuards.tsx
src/context/AuthContext.tsx
src/pages/admin/Users.tsx
src/pages/client/AccountStatus.tsx
src/pages/client/ClientHome.tsx
src/pages/client/Login.tsx
src/pages/client/Profile.tsx
src/services/api.ts
src/services/api.test.ts                         (novo)
src/services/auth.ts
server/.env.example
server/package.json
server/pnpm-lock.yaml
server/prisma/schema.prisma
server/prisma/migrations/20260921220000_auth_integrity/migration.sql  (novo)
server/scripts/test-integration.ts               (novo)
server/src/app.ts
server/src/config/env.ts
server/src/config/env.test.ts
server/src/config/prisma.ts
server/src/config/auth.integration.test.ts       (novo)
server/src/config/production.test.ts             (novo)
server/src/middlewares/auth.ts
server/src/middlewares/error-handler.ts
server/src/modules/admin/admin.routes.ts
server/src/modules/admin/admin.service.ts
server/src/modules/admin/bootstrap.service.ts    (novo)
server/src/modules/auth/auth.controller.ts
server/src/modules/auth/auth.schemas.ts
server/src/modules/auth/auth.service.ts
server/src/modules/auth/token.service.ts
server/src/modules/auth/sms/sms-provider.ts
server/src/modules/users/users.routes.ts
server/src/scripts/bootstrap-admin.ts
server/src/utils/crypto.ts
server/src/utils/crypto.test.ts
server/src/utils/errors.ts
server/src/utils/locks.ts                        (novo)
server/src/utils/logger.ts
server/src/utils/phone.ts
server/src/utils/phone.test.ts
```

A migration inicial e os arquivos preexistentes de mocks/UI fora do fluxo de autenticação não foram reimplementados. Artefatos e banco de QA ficam ignorados. HEAD permaneceu `cae7ba32d24749a26483181000d27fd7e9367731`; nenhum arquivo foi staged e nenhum commit, push ou publicação foi realizado nesta auditoria.
