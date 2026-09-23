# ErickCorttes Barbearia

Frontend React 19 + Vite 8 + Tailwind 4 e API Node.js + Express 5 + Prisma 7.10 + PostgreSQL.

O projeto integra autenticação por telefone e senha, perfil, aprovação administrativa e agendamento persistido em PostgreSQL. Frontend, API e migrations devem ser publicados juntos; veja o [procedimento do Railway](docs/deployment.md).

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
| `BOOTSTRAP_ADMIN_PHONE` / `BOOTSTRAP_ADMIN_NAME` | Somente para o script de bootstrap |
| `BOOTSTRAP_ADMIN_PASSWORD` | Senha do primeiro admin; defina no shell, rode o script e remova |
| `BOOTSTRAP_ADMIN_RESET_PASSWORD` | `false`; exige intenção explícita para substituir credencial existente |
| `BOOTSTRAP_ADMIN_ALLOW_PROMOTION` | `false`; exige intenção explícita para promover ou reativar registro existente |

A validação impede startup com env inválido. Produção recusa origens HTTP e segredos fracos conhecidos. Autenticar não depende de nenhum serviço externo: não há variáveis de SMS para configurar.

No frontend, `VITE_API_URL` define a URL pública da API. O padrão em desenvolvimento é `http://localhost:3333`; no build de produção é `/api`. Nunca coloque segredos em variáveis `VITE_*`.

### Topologias de produção

- Mesmo domínio com proxy: frontend usa `VITE_API_URL=/api`. O proxy encaminha `/api/*` ao backend removendo `/api`. Configure `REFRESH_COOKIE_PATH=/api/auth`, `REFRESH_COOKIE_SAME_SITE=lax` e a origem HTTPS do frontend.
- Subdomínios do mesmo site: `VITE_API_URL=https://api.exemplo.com`, cookie `/auth`, `SameSite=lax`, CORS com `https://app.exemplo.com` e `credentials` habilitado.
- Sites diferentes: cookie `/auth`, `SameSite=none`, `Secure` e origens HTTPS exatas. Bloqueios de cookies de terceiros pelo navegador ainda podem impedir essa topologia; prefira um proxy no mesmo site.

Cookies são host-only, httpOnly e Secure em produção; emissão e remoção usam o mesmo path/SameSite. Toda chamada POST em `/auth` exige `X-CSRF-Protection: 1`. A allow-list de CORS e esse header impedem formulários cross-site de iniciar/renovar/encerrar sessões. Clientes HTTP próprios também devem enviar esse header. `trust proxy` incorreto afeta limites por IP; o servidor deve ser acessível somente pela cadeia configurada quando confiar em proxies.

## Autenticação, sessão e autorização

O login é **telefone + senha**. O telefone continua sendo o identificador único da conta; a senha é a credencial. Não existe OTP, SMS nem provedor externo, e não há caminho alternativo que dispense a senha.

1. `POST /auth/register { fullName, phone, password, confirmPassword }`: normaliza o celular para E.164, colapsa espaços do nome, confere a confirmação e cria a conta como `CUSTOMER/PENDING`. Telefone já cadastrado responde 409.
2. `POST /auth/login { phone, password }`: busca pela forma canônica do telefone e compara a senha. Qualquer falha — telefone inexistente, senha errada ou conta sem credencial — responde o mesmo 401 `INVALID_CREDENTIALS` com "Telefone ou senha inválidos.".
3. `POST /auth/refresh {}`, `POST /auth/logout {}`, `GET /auth/me`: inalterados pela migração.
4. `PATCH /users/me/password`: troca a senha exigindo a atual e encerra **todas** as sessões, inclusive a que pediu a troca.

### Hash de senha

Argon2id com os parâmetros mínimos recomendados pelo [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): **m=19 MiB, t=2, p=1**, via `@node-rs/argon2`. O lockfile inclui binários para Linux GNU/musl. A execução nativa foi validada em Windows; a instalação e o consumo sob carga precisam ser verificados no container real do Railway. Cada operação usa cerca de 19 MiB; limites por IP não substituem dimensionamento nem limitam concorrência distribuída globalmente.

A senha é normalizada em NFKC antes de hashear, para que a mesma senha digitada com composições Unicode diferentes (comum em teclado mobile) continue validando. Não fazemos `trim`: espaço no início ou no fim é parte da senha. Senhas novas têm de 15 a 128 pontos de código após normalização, sem regras de composição. O mínimo segue a orientação de fator único do [NIST](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/); isso não representa conformidade integral com a norma. O login preserva compatibilidade com credenciais existentes de menor tamanho.

O hash nunca sai da camada de dados: o serializador público expõe apenas `hasPassword` (booleano). Senha e hash não aparecem em logs, JWT, respostas da API nem auditoria. Senhas são recebidas no corpo das requisições por HTTPS para cadastro/login/troca; nunca persistem no armazenamento do navegador.

### Anti-enumeração e força bruta

Telefone inexistente e senha errada produzem respostas byte a byte idênticas. Quando o telefone não existe, o servidor executa Argon2id contra um hash-isca para reduzir diferenças de custo. Isso não garante tempo idêntico: banco, inicialização do hash-isca e atualização de contadores introduzem variação. O cadastro retorna 409 para telefone existente, portanto não há garantia global de anti-enumeração.

Há dois freios, complementares:

- **Por IP**, em memória por processo: 5 cadastros e 10 logins a cada 15 minutos; troca de senha e redefinição administrativa compartilham outro limite de 10 por IP/15 minutos.
- **Por conta**, no banco: 10 falhas bloqueiam por 15 minutos. Por ficar no PostgreSQL, vale entre réplicas e continua valendo quando o atacante troca de IP.

O bloqueio por conta é **silencioso**: enquanto dura, o login responde exatamente como responderia a uma senha errada, mesmo se a senha estiver certa. Dizer "conta temporariamente bloqueada" confirmaria que o telefone existe. Uma pessoa que saiba o telefone pode provocar bloqueios repetidos da conta. É uma limitação operacional conhecida; não foi feito teste de carga distribuída.

O estado da conta (`BLOCKED`) só é revelado **depois** que a senha confere: quem não conhece a credencial recebe a resposta genérica.

### Contas herdadas do fluxo OTP

`password_hash` é nullable de propósito. As contas criadas por OTP não têm senha, e inventar uma seria pior do que não ter. Nenhuma senha padrão, previsível ou compartilhada foi atribuída na migração.

Enquanto a coluna for nula:

- o **login** recusa com a resposta genérica, indistinguível de senha errada;
- o **cadastro** com aquele telefone responde 409 e **não** define credencial no registro existente — ninguém assume uma conta antiga só por saber o número.

A saída é a redefinição assistida (abaixo). A migration revoga todas as sessões antigas quando executada; nenhuma migration foi aplicada em produção nesta auditoria. Leia o [procedimento de migração e rollback](docs/deployment.md) antes de publicar.

### Recuperação de senha

Sem SMS e sem e-mail não existe canal automático capaz de provar posse do telefone, então **não há autoatendimento de recuperação** — implementar um seria segurança de fachada.

A recuperação é presencial e assistida: o administrador confirma a identidade, e a interface gera 128 bits aleatórios com Web Crypto, representados por 32 caracteres hexadecimais. Envia `POST /admin/users/:id/reset-password { password, confirmPassword }`; o backend guarda somente Argon2id, retorna apenas o usuário público, audita a ação e encerra todas as sessões do alvo. A interface exibe a senha que já possui em memória apenas após o sucesso; ela não vem da resposta nem é persistida. Oriente o cliente a trocá-la imediatamente. Não há expiração própria nem troca obrigatória no primeiro acesso. Um admin não pode redefinir a própria senha nessa rota: deve usar a troca autenticada com a senha atual.

### Alteração de telefone

`PATCH /users/me` aceita **somente** `fullName`. O schema é `strictObject`, então enviar `phone`, `role` ou `status` é rejeitado com 400 em vez de ignorado em silêncio — sem mass assignment.

O telefone é o identificador de login e a chave única da conta. Sem um canal que prove posse do novo número, permitir a troca abriria três buracos: tomar o número de outra pessoa, colidir com um cadastro existente e perder o acesso por digitar errado. Não existe endpoint de troca de telefone nesta entrega. Uma futura política administrativa de alteração deve confirmar identidade, unicidade e auditoria antes de ser implementada.

### Sessão

Access JWT usa HS256, issuer, audience, expiração e identificador de sessão. Cada rota autenticada consulta a sessão e o estado atual do usuário no banco; claims de papel não concedem autorização sozinhas. Rotação também invalida o access anterior. O refresh vai em cookie httpOnly, rotativo, e reuso encerra todas as sessões do usuário. Toda chamada POST em `/auth` exige `X-CSRF-Protection: 1`.

| Estado | Login | Perfil próprio | Área de cliente ativo | Administração |
| --- | --- | --- | --- | --- |
| PENDING | Sim | Sim | Não | Não |
| ACTIVE | Sim | Sim | Sim | Somente ADMIN |
| BLOCKED | Não | Não | Não | Não |

Apenas `fullName` é editável em `/users/me`. O administrador não pode alterar o próprio status. Alterações administrativas revalidam o ator dentro da transação e preservam pelo menos um admin ativo. Aprovação, bloqueio, reativação e redefinição de senha registram ator, alvo, ação e data — sem tokens, senhas ou hashes.

## Agendar antes de ter conta

O fluxo público começa na landing e só pede identificação no fim:

```
Landing -> Agendar horário -> serviço -> data -> horário -> login/cadastro -> confirmação
```

`GET /booking/services`, `/booking/business-hours` e `/booking/availability` são públicos. Disponibilidade entrou nessa lista com a migração: sem ela a pessoa teria de se cadastrar às cegas, sem saber se existe horário. O que sai é agregado e sem dado pessoal — apenas horários livres, a mesma informação que qualquer vitrine de agendamento exibe. Quem reservou o quê continua exigindo sessão.

A seleção é guardada em `sessionStorage` (serviço, data, horário — nada pessoal, expira em 2 horas) e restaurada depois do login. **Preservar a seleção não reserva nada**: ao voltar, o frontend reconsulta a disponibilidade e, se o horário já tiver sido tomado, devolve a pessoa para a lista com um aviso. A criação da reserva continua exigindo conta `ACTIVE`, e a `EXCLUDE` constraint do PostgreSQL garante que duas pessoas nunca fiquem com o mesmo horário.

Cliente `PENDING` percorre o fluxo e vê a mensagem de cadastro em análise em vez de uma confirmação — a política de aprovação da barbearia não mudou, e quem a aplica é o backend.

## Bootstrap de administrador

PowerShell, dentro de `server/`, após configurar banco e segredo:

```powershell
$env:BOOTSTRAP_ADMIN_PHONE = '+55DD9XXXXXXXX' # substitua pelo celular real do administrador
$env:BOOTSTRAP_ADMIN_NAME = 'Nome do administrador'
$credential = Get-Credential -Message 'Informe a senha do administrador (15 a 128 caracteres)'
$env:BOOTSTRAP_ADMIN_PASSWORD = $credential.GetNetworkCredential().Password
pnpm bootstrap:admin
Remove-Item Env:\BOOTSTRAP_ADMIN_PASSWORD
Remove-Variable credential
```

Se o telefone não existir, cria `ADMIN/ACTIVE` com a senha informada. Se já for admin ativo **com senha**, não altera nada nem duplica auditoria. Para promover ou reativar outro registro existente, defina `BOOTSTRAP_ADMIN_ALLOW_PROMOTION=true`. Para **substituir** a senha de uma conta que já tem credencial, defina também `BOOTSTRAP_ADMIN_RESET_PASSWORD=true` — sem isso, a promoção preserva a senha existente e o script recusa sobrescrevê-la. O script exige `BOOTSTRAP_ADMIN_PASSWORD`: um admin sem credencial seria uma conta que ninguém consegue usar. A senha nunca é impressa nem registrada; quem executou já a conhece. Estabelecer ou trocar credencial revoga as sessões anteriores. Remova a variável do ambiente depois do uso.

## Rotas

| Método | Rota | Autorização |
| --- | --- | --- |
| GET | `/health` | Pública; liveness, não verifica disponibilidade do banco |
| POST | `/auth/register`, `/auth/login` | Públicas com CSRF header e rate limit |
| POST | `/auth/refresh`, `/auth/logout` | Cookie e CSRF header |
| GET | `/auth/me`, `/users/me` | Sessão válida; PENDING pode acessar |
| PATCH | `/users/me` | Sessão válida; somente nome |
| PATCH | `/users/me/password` | Sessão válida; exige senha atual e encerra sessões |
| POST | `/admin/users/:id/reset-password` | ADMIN ACTIVE; confirmação de identidade pelo operador |
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
# Para executar unitários separadamente, desative a integração:
Remove-Item Env:\TEST_DATABASE_URL
pnpm test
```

`test:integration` exige a variável, aplica migrations com Prisma e roda em sequência o upgrade de contas legadas, autenticação e agenda com Express + Prisma + PostgreSQL. Não execute as suítes destrutivas de integração em paralelo no mesmo banco. Sem `TEST_DATABASE_URL`, `pnpm test` pula explicitamente essa suíte. Os testes PGlite são testes embarcados de SQL e não substituem a integração real. Os testes de produção verificam flags de cookies, claims JWT e sanitização de erros sem conectar a banco de produção.

A implantação, o bootstrap em produção e o rollback estão documentados em [docs/deployment.md](docs/deployment.md). O relatório histórico da fundação permanece em [security_best_practices_report.md](security_best_practices_report.md).

## Limites operacionais atuais

- Não há autoatendimento de recuperação de senha. Quem esquece depende da redefinição assistida presencial; sem um segundo administrador ativo, um admin que perca a senha só se recupera rodando `pnpm bootstrap:admin` com `BOOTSTRAP_ADMIN_RESET_PASSWORD=true`.
- O bloqueio por conta após 10 falhas pode ser usado para manter uma conta conhecida travada em janelas de 15 minutos. É o contrapeso aceito para não revelar quais telefones existem.
- Renovação single-flight coordena a mesma página; duas abas independentes ainda podem provocar a política conservadora de revogação por reuso se rotacionarem o mesmo cookie simultaneamente.
- Logout sem conexão encerra o estado em memória, mas não garante a remoção do cookie httpOnly no servidor/navegador; uma recarga pode restaurar a sessão até que a revogação remota tenha sucesso.
- Ainda não existe job de retenção para sessões expiradas. Defina manutenção antes de operação prolongada; não remova o histórico necessário à detecção de reuso de refresh token.
- Configuração final de HTTPS, proxy, CORS e política de cookies precisa ser validada no ambiente de implantação. Nenhum deploy faz parte desta auditoria.
