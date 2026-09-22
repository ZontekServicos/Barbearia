# ErickCorttes Barbearia

Frontend React 19 + Vite 8 + Tailwind 4 e API Node.js + Express 5 + Prisma 7.10 + PostgreSQL.

A fundação implementada cobre autenticação por celular, perfil, aprovação de usuários e auditoria administrativa. As telas de serviços, barbeiros, agenda e indicadores ainda usam demonstrações locais; esses módulos não têm backend implementado.

## Setup

Use Node 22 atualizado (a `.mise.toml` seleciona 22) ou Node 24 e pnpm 10.20.0. Os pacotes raiz e `server/` têm instalações e lockfiles independentes. A auditoria foi executada com Node 24.13.1 e PostgreSQL 18.2.

```sh
corepack pnpm@10.20.0 install --frozen-lockfile
corepack pnpm@10.20.0 --dir server install --frozen-lockfile
```

Copie `.env.example` para `.env.local` na raiz e `server/.env.example` para `server/.env`. Não versione os arquivos preenchidos. Execute comandos do backend a partir de `server/`, ou use `pnpm --dir server ...`, para carregar o `.env` correto.

Gere o segredo de assinatura do access token:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

`JWT_REFRESH_SECRET` não é necessário: o refresh é um token opaco aleatório de 256 bits, cujo hash SHA-256 é armazenado no banco. Ele não é JWT.

## PostgreSQL e migrations

Use um banco exclusivo de desenvolvimento. Exemplo opcional com Docker, sem reutilizar banco existente:

```sh
docker run --name erickcorttes-dev -e POSTGRES_PASSWORD=local-development-only -e POSTGRES_DB=erickcorttes -p 127.0.0.1:55432:5432 -d postgres:18
```

Nesse exemplo, configure `DATABASE_URL=postgresql://postgres:local-development-only@localhost:55432/erickcorttes`. Pode usar uma instalação nativa de PostgreSQL. As credenciais do exemplo são apenas locais.

```sh
cd server
pnpm db:generate
pnpm db:migrate:deploy
pnpm dev
```

`db:migrate:deploy` aplica SQL já versionado. Use `db:migrate` apenas para desenvolver uma nova migration. Não use `db push` para substituir o histórico.

A migration inicial foi mantida. A migration `20260921220000_auth_integrity` preserva os atores da auditoria com FK `RESTRICT` e adiciona a FK da cadeia de rotação de refresh. Exclusão de usuário remove seus refreshes; exclusão de alvo de auditoria preserva o evento com alvo nulo. O script de seed é opcional, usa dados de demonstração e recusa `NODE_ENV=production`.

Em outro terminal, na raiz:

```sh
pnpm dev
```

O frontend usa a porta 8443 e a API 3333 por padrão. O access token fica somente em memória; o navegador recebe o refresh em cookie httpOnly.

## Ambiente

| Variável do backend | Regra / padrão |
| --- | --- |
| `DATABASE_URL` | Obrigatória, URL PostgreSQL |
| `JWT_ACCESS_SECRET` | Obrigatória, mínimo 32 caracteres; gere valor aleatório, não um placeholder |
| `NODE_ENV` | `development`, `test` ou `production` |
| `PORT` | 3333 |
| `FRONTEND_URL` | Origens exatas separadas por vírgula, padrão `http://localhost:8443`; HTTPS obrigatório em produção |
| `TRUST_PROXY_HOPS` | 0; configure somente conforme a cadeia real de proxies confiáveis |
| `REFRESH_COOKIE_SAME_SITE` | `lax`; `none` somente em produção HTTPS quando os sites forem diferentes |
| `REFRESH_COOKIE_PATH` | `/auth`; use `/api/auth` quando esse for o caminho público do proxy |
| `ACCESS_TOKEN_TTL_MINUTES` | 15, máximo 60 |
| `REFRESH_TOKEN_TTL_DAYS` | 30 |
| `OTP_TTL_MINUTES` / `OTP_MAX_ATTEMPTS` | 5 minutos / 5 tentativas |
| `AUTH_OTP_DEV_MODE` | `false`; `true` expõe OTP somente no terminal de desenvolvimento |
| `SMS_PROVIDER` | `console` para desenvolvimento; `twilio` obrigatório em produção |
| `TWILIO_ACCOUNT_SID` | Obrigatória com `twilio`; formato `AC` + 32 hexadecimais |
| `TWILIO_AUTH_TOKEN` | Obrigatória com `twilio`; mínimo 32 caracteres |
| `TWILIO_MESSAGING_SERVICE_SID` | Remetente por Messaging Service, formato `MG` + 32 hexadecimais |
| `TWILIO_FROM_NUMBER` | Remetente por número, em E.164. Configure este **ou** o Messaging Service |
| `TWILIO_TIMEOUT_MS` | 10000; faixa aceita de 1000 a 30000 |
| `BOOTSTRAP_ADMIN_PHONE` / `BOOTSTRAP_ADMIN_NAME` | Somente para o script de bootstrap |
| `BOOTSTRAP_ADMIN_ALLOW_PROMOTION` | `false`; exige intenção explícita para promover ou reativar registro existente |

A validação impede startup com env inválido. Produção recusa modo OTP dev, provider console, origens HTTP e segredos fracos conhecidos. O provider console também recusa envio se `AUTH_OTP_DEV_MODE=false`.

No frontend, `VITE_API_URL` define a URL pública da API. O padrão em desenvolvimento é `http://localhost:3333`; no build de produção é `/api`. Nunca coloque segredos em variáveis `VITE_*`.

### Topologias de produção

- Mesmo domínio com proxy: frontend usa `VITE_API_URL=/api`. O proxy encaminha `/api/*` ao backend removendo `/api`. Configure `REFRESH_COOKIE_PATH=/api/auth`, `REFRESH_COOKIE_SAME_SITE=lax` e a origem HTTPS do frontend.
- Subdomínios do mesmo site: `VITE_API_URL=https://api.exemplo.com`, cookie `/auth`, `SameSite=lax`, CORS com `https://app.exemplo.com` e `credentials` habilitado.
- Sites diferentes: cookie `/auth`, `SameSite=none`, `Secure` e origens HTTPS exatas. Bloqueios de cookies de terceiros pelo navegador ainda podem impedir essa topologia; prefira um proxy no mesmo site.

Cookies são host-only, httpOnly e Secure em produção; emissão e remoção usam o mesmo path/SameSite. Toda chamada POST em `/auth` exige `X-CSRF-Protection: 1`. A allow-list de CORS e esse header impedem formulários cross-site de iniciar/renovar/encerrar sessões. Clientes HTTP próprios também devem enviar esse header. `trust proxy` incorreto afeta limites por IP; o servidor deve ser acessível somente pela cadeia configurada quando confiar em proxies.

## OTP, sessão e autorização

1. `POST /auth/request-otp { phone }`: normaliza celular brasileiro para E.164, gera seis dígitos com CSPRNG e salva scrypt com salt. A resposta é igual para conta nova ou existente e não contém o código.
2. Cada novo pedido invalida todos os códigos anteriores do telefone. Apenas o último desafio pode autenticar. Se o envio falhar, ele é invalidado e a API retorna 503; o desafio anterior não é reativado. SMS pode chegar fora de ordem, então use o código do último pedido.
3. `POST /auth/verify-otp { phone, code, fullName? }`: consome o desafio e cria a sessão na mesma transação. Locks do PostgreSQL coordenam processos concorrentes. Cliente novo nasce `CUSTOMER/PENDING`.
4. `POST /auth/refresh {}`: lê somente o cookie, rotaciona atomicamente e revoga o token anterior. Reuso encerra todas as sessões do usuário, inclusive autorização dos access tokens vinculados a elas. Novo login por OTP permite nova sessão.
5. `POST /auth/logout {}`: revoga a sessão e sucessoras e apaga o cookie. O frontend limpa estado local inclusive em falha de rede; revogação remota exige que o servidor responda.

Access JWT usa HS256, issuer, audience, expiração e identificador de sessão. Cada rota autenticada consulta a sessão e o estado atual do usuário no banco; claims de papel não concedem autorização sozinhas. Rotação também invalida o access anterior. O cliente HTTP compartilha uma única renovação por página e repete cada requisição no máximo uma vez; restauração não expõe conteúdo protegido enquanto carrega.

Pedidos de OTP: 5 por IP em 15 minutos e 5 por telefone em 15 minutos, sendo o limite por telefone persistido no PostgreSQL. Verificação: 10 por IP em 15 minutos e até 5 tentativas por desafio. Limite geral: 120 por IP por minuto. Limites por IP usam memória por processo; para múltiplas réplicas, configure um store compartilhado/limite de borda. O limite por telefone e a proteção de concorrência já valem entre processos.

A normalização aceita `+5571999999999`, `5571999999999`, `71999999999`, `(71) 99999-9999` e `71 99999-9999`, valida DDD atribuído e celular com nono dígito. A API é a fonte de verdade; o frontend não corta o prefixo internacional.

| Estado | Login | Perfil próprio | Área de cliente ativo | Administração |
| --- | --- | --- | --- | --- |
| PENDING | Sim | Sim | Não | Não |
| ACTIVE | Sim | Sim | Sim | Somente ADMIN |
| BLOCKED | Não | Não | Não | Não |

Apenas `fullName` é editável em `/users/me`; campos administrativos extras são recusados. O administrador não pode alterar seu próprio status. Alterações administrativas revalidam o ator dentro da transação e preservam pelo menos um admin ativo, inclusive em bloqueios cruzados concorrentes. Aprovação, bloqueio e reativação registram ator, alvo, ação, data e status anterior/novo, sem tokens ou OTP.

## Bootstrap de administrador

PowerShell, dentro de `server/`, após configurar banco e segredo:

```powershell
$env:BOOTSTRAP_ADMIN_PHONE = '+55DD9XXXXXXXX' # substitua pelo celular real do administrador
$env:BOOTSTRAP_ADMIN_NAME = 'Nome do administrador'
pnpm bootstrap:admin
```

Se o telefone não existir, cria `ADMIN/ACTIVE`. Se já for admin ativo, não altera nada nem duplica auditoria. Para promover/reativar outro registro existente, defina explicitamente `BOOTSTRAP_ADMIN_ALLOW_PROMOTION=true`; sem isso a operação é recusada. Promoção revoga sessões anteriores. O script normaliza o telefone, usa transação, não define senha e imprime o telefone mascarado. Remova essas variáveis depois do uso. Bootstrap não confirma posse do telefone: o login continua exigindo OTP.

## Provider de SMS

`SmsProvider` é a única fronteira que conhece o fornecedor. Há duas implementações: `console` (desenvolvimento) e `twilio` (produção).

### Twilio

`TwilioSmsProvider` faz um POST em `/2010-04-01/Accounts/{SID}/Messages.json` com `fetch` nativo e autenticação Basic. Optamos pela API REST em vez do SDK oficial: a chamada é um único POST form-urlencoded, o SDK traria uma árvore grande de dependências para dentro do caminho de autenticação, e injetar `fetch` permite testar falhas, timeouts e respostas do provedor sem disparar SMS.

O código continua sendo gerado, hasheado e validado pelo backend. A Twilio é só transporte e nunca decide o conteúdo do OTP. A mensagem é fixa:

> ERICKCORTTES BARBEARIA: seu código de confirmação é XXXXXX. Não compartilhe este código.

**Nomes das variáveis.** As antigas `SMS_API_KEY`/`SMS_API_SECRET`/`SMS_FROM_NUMBER` pertenciam ao provider ainda não implementado e foram substituídas por nomes explícitos do provedor. Um Account SID não é uma "API key" — a Twilio tem os dois conceitos, e guardar um no nome do outro convida a erro de configuração. `SMS_PROVIDER` permanece como a chave que seleciona a implementação.

**Remetente.** A Twilio aceita `MessagingServiceSid` ou `From`. Exigir os dois impediria integrações legítimas; não exigir nenhum deixaria subir um servidor incapaz de enviar. A regra é: pelo menos um dos dois, e quando ambos estiverem presentes o Messaging Service tem precedência.

**Validação no boot.** Com `SMS_PROVIDER=twilio`, a validação de ambiente exige Account SID, Auth Token e um remetente, e confere o formato de cada um. Formatos inválidos são recusados mesmo com o provider desligado. O construtor repete as checagens essenciais, então o provider não depende de ter sido criado pelo caminho feliz. Produção continua recusando `SMS_PROVIDER=console` e `AUTH_OTP_DEV_MODE=true`.

**Falhas.** Timeout (`AbortSignal.timeout`), erro de rede, HTTP de erro e mensagem marcada como `failed`/`undelivered`/`canceled` num 201 são todos tratados como falha de envio. O provider lança `SMS_UNAVAILABLE`; `requestOtp` invalida o desafio que não foi entregue e a API responde 503. Respostas sem JSON válido, sem Message SID válido, com status desconhecido ou com HTTP diferente de 201 também falham. Redirecionamentos HTTP são recusados.

Nada da Twilio atravessa a fronteira HTTP: o cliente recebe sempre a mesma mensagem genérica, sem código de erro do provedor, corpo da resposta ou stack. O log guarda apenas o operacional — telefone mascarado, `messageSid`, status HTTP, código de erro conhecido do provedor e uma classificação (`credenciais-invalidas`, `destinatario-invalido`, `configuracao-invalida`, `limite-do-provedor`, `provedor-indisponivel`). O corpo da mensagem, que carrega o OTP, nunca é registrado, e o redator do logger também cobre as chaves da Twilio.

Para desenvolvimento local, selecione `SMS_PROVIDER=console` e habilite conscientemente `AUTH_OTP_DEV_MODE=true`. Essa é a única exceção de exposição do OTP, somente no terminal, e é proibida em produção. Os testes automatizados usam um `fetch` de mentira e capturam SMS em memória somente no processo de teste, sem endpoint de debug.

**Aceitação não confirma entrega.** O log informa que a solicitação foi aceita pela Twilio. Os estados `accepted`/`queued` indicam processamento pendente; pode ocorrer falha posterior na operadora. Não há acompanhamento por webhook nesta implementação. A entrega real precisa ser conferida no painel da Twilio e no telefone de teste antes de liberar autenticação pública. Não repetimos automaticamente um envio após timeout, pois o provedor pode já tê-lo aceitado.

### Deploy com Twilio

No serviço de backend, configure:

```
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=MG...   # ou TWILIO_FROM_NUMBER=+55...
TWILIO_TIMEOUT_MS=10000
AUTH_OTP_DEV_MODE=false
```

Em conta trial a Twilio só entrega para números verificados e prefixa a mensagem; o erro 21608 no log indica exatamente isso. Entrega para o Brasil exige remetente e cadastro compatíveis com as regras locais da operadora.

A implementação automatizada foi auditada sem disparos reais de SMS. A autenticação pública ainda depende de teste real de entrega no ambiente Railway, com credenciais e destinatário autorizados. Consulte [a auditoria Twilio](twilio_security_audit.md) para os resultados e pendências.

## Rotas

| Método | Rota | Autorização |
| --- | --- | --- |
| GET | `/health` | Pública; liveness, não verifica disponibilidade de SMS/banco |
| POST | `/auth/request-otp`, `/auth/verify-otp` | Públicas com CSRF header e rate limit |
| POST | `/auth/refresh`, `/auth/logout` | Cookie e CSRF header |
| GET | `/auth/me`, `/users/me` | Sessão válida; PENDING pode acessar |
| PATCH | `/users/me` | Sessão válida; somente nome |
| GET | `/admin/users`, `/admin/users/pending-count`, `/admin/users/:id` | ADMIN ACTIVE |
| PATCH | `/admin/users/:id/status` | ADMIN ACTIVE |
| GET | `/admin/audit-log` | ADMIN ACTIVE, últimos 50 eventos |

Lista de usuários: `status`, `role`, `search`, `page` (1–100000), `perPage` (1–100, padrão 20). Ordenação estável por criação e ID; a interface possui paginação. Sucesso usa `{ success: true, data }`; falhas usam `{ success: false, error: { code, message, details? } }`. Respostas autenticadas usam `Cache-Control: no-store`. Erros internos não devolvem SQL, stack ou credenciais.

## Validação

```sh
# raiz
pnpm typecheck
pnpm test:auth
pnpm build
pnpm audit

# backend
cd server
pnpm typecheck
pnpm test
pnpm build
pnpm audit
pnpm start
```

Não há linter configurado no repositório. `oxfmt` é formatador, não linter; use `pnpm exec oxfmt --check <arquivos>` para verificar formatação sem reformatar todo o projeto. A versão 0.2 pode remover separadores de tipos compactos; execute typecheck após qualquer formatação.

### Integração real

Crie um banco **descartável**, chamado exatamente `erickcorttes_test`, em PostgreSQL local. Os testes recusam host remoto ou outro nome e apagam os dados desse banco. Nunca use dados reais nele. Exemplo PowerShell, dentro de `server/`:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:55432/erickcorttes_test'
pnpm test:integration
# Para executar também toda a suíte com integração habilitada:
pnpm test
```

`test:integration` exige a variável, aplica migrations com Prisma e roda Express + Prisma + PostgreSQL. Sem `TEST_DATABASE_URL`, `pnpm test` pula explicitamente essa suíte. Os seis testes PGlite são testes embarcados de SQL e não substituem a integração real. Os testes de produção verificam flags de cookies, claims JWT e sanitização de erros sem conectar a banco de produção.

A execução e os achados da auditoria estão em [security_best_practices_report.md](security_best_practices_report.md).

## Limites operacionais atuais

- API real de SMS implementada; entrega real ainda não validada. Aceitação pelo provedor não comprova recebimento no aparelho.
- Renovação single-flight coordena a mesma página; duas abas independentes ainda podem provocar a política conservadora de revogação por reuso se rotacionarem o mesmo cookie simultaneamente.
- Logout sem conexão encerra o estado em memória, mas não garante a remoção do cookie httpOnly no servidor/navegador; uma recarga pode restaurar a sessão até que a revogação remota tenha sucesso.
- Ainda não existe job de retenção para desafios e sessões expiradas. Defina manutenção antes de operação prolongada; não remova desafios recentes usados pelo limite de 15 minutos nem histórico necessário à detecção de reuso.
- Configuração final de HTTPS, proxy, CORS e política de cookies precisa ser validada no ambiente de implantação. Nenhum deploy faz parte desta auditoria.
