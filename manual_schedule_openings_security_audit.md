# Auditoria de segurança — abertura manual da agenda

## Resumo executivo

A feature não introduz vulnerabilidade crítica, alta ou média conhecida. As novas rotas administrativas herdam autenticação, conta ativa e papel `ADMIN`; os payloads de escrita usam schemas estritos; autoria e escopo são derivados da sessão e da rota; a disponibilidade pública não expõe motivo interno, identificadores de bloqueio/agendamento nem PII. A criação de reserva reconfirma a abertura dentro da transação protegida pelo lock compartilhado das regras.

Permanece uma pendência de dependência já conhecida e não bloqueante: `source-map-js@1.2.1` aparece na cadeia de configuração/CLI do Prisma. O pacote está no grafo de dependências de produção porque `prisma` está declarado em `dependencies`, mas não é importado pelo servidor HTTP nem recebe entrada pública em runtime.

## Crítico

Nenhum achado.

## Alto

Nenhum achado.

## Médio

Nenhum achado.

## Baixo

### SEC-001 — advisory transitivo em tooling do Prisma

- **Severidade:** baixa para esta aplicação; o registro classifica o advisory do pacote como alto quando a API vulnerável é alcançável.
- **Local:** `server/pnpm-lock.yaml:1380`, `server/pnpm-lock.yaml:2463`, `server/pnpm-lock.yaml:2597`.
- **Evidência:** `prisma -> @prisma/config -> c12 -> magicast -> source-map-js@1.2.1`; `pnpm audit --prod` aponta GHSA-68fv-2mgg-jv7q e correção em `source-map-js >= 1.2.2`.
- **Impacto:** a falha permite bloqueio do event loop ao processar source maps indexados maliciosos. Nesta aplicação a cadeia é carregada pela configuração/CLI do Prisma durante generate/migrate/build; o servidor HTTP usa o cliente gerado e não oferece source maps controlados pelo visitante a essa cadeia.
- **Correção:** acompanhar atualização compatível do Prisma/cadeia transitiva. Não aplicar major upgrade nem override ad hoc nesta feature.
- **Mitigação:** manter comandos Prisma fora do caminho de requisições públicas e continuar auditando o lockfile.
- **Nota de falso positivo:** a dependência não é `devDependency` no manifesto atual; a classificação de risco reduzido decorre da alcançabilidade do código, não da seção do `package.json`.

## Controles verificados

- Autorização administrativa central em `server/src/modules/admin/admin.routes.ts:26` e montagem das rotas em `server/src/modules/admin/admin.routes.ts:29`.
- Schemas estritos para faixa, substituição semanal, cópia e override em `server/src/modules/booking/booking.schemas.ts:269`, `server/src/modules/booking/booking.schemas.ts:282`, `server/src/modules/booking/booking.schemas.ts:286` e `server/src/modules/booking/booking.schemas.ts:297`.
- Lock exclusivo nas mutações em `server/src/modules/booking/opening.service.ts:212`, `server/src/modules/booking/opening.service.ts:247`, `server/src/modules/booking/opening.service.ts:325` e `server/src/modules/booking/opening.service.ts:357`.
- Lock compartilhado e reconferência transacional na reserva em `server/src/modules/booking/appointments.service.ts:190` e `server/src/modules/booking/appointments.service.ts:191`.
- Resposta pública de expediente derivada da nova fonte em `server/src/modules/booking/booking.routes.ts:65`.
- Helmet e remoção de fingerprint do Express em `server/src/app.ts:26` e `server/src/app.ts:28`; handler de erro central em `server/src/app.ts:101`.
- Testes de forma pública e mass assignment em `server/src/config/schedule-openings.integration.test.ts:878` e `server/src/config/schedule-openings.integration.test.ts:930`.
- Busca estática sem ocorrências, no escopo alterado, de `dangerouslySetInnerHTML`, sinks DOM, avaliação dinâmica, execução de processo ou redirect controlado pelo usuário.

## Resultado

Aprovada do ponto de vista de segurança da feature. A pendência SEC-001 deve continuar registrada para atualização compatível da cadeia do Prisma e não exige alteração nesta entrega.
