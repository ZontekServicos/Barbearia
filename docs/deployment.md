# Publicação integrada no Railway

## Serviços e sequência

Configuração informada pelo responsável pelo projeto:

- Repositório `ZontekServicos/Barbearia`, branch `main`, auto-deploy ativo.
- Backend `easygoing-nourishment`, Root Directory `/server`.
- Build do pacote: `pnpm build` (`prisma generate && tsc -p tsconfig.json`).
- Pre-deploy: `pnpm db:migrate:deploy` (`prisma migrate deploy`).
- Start: `npm run start` (`node dist/server.js`).

Um push para `main` pode iniciar a implantação e aplicar as migrations automaticamente. O [pré-deploy do Railway](https://docs.railway.com/deployments/pre-deploy-command) ocorre depois do build e antes da ativação da aplicação nova; sua falha impede a continuação do deploy. O Prisma CLI é dependência de produção para continuar disponível caso a imagem remova devDependencies. Prisma Client é gerado no build e compilado em `dist/generated`.

O primeiro corte foi autorizado considerando que não existem dados reais de clientes/agendamentos no PostgreSQL de produção. A passagem entre runtimes OTP e senha pode interromper autenticação de contas de teste. Não há migração sem interrupção garantida. Se essa premissa deixar de ser verdadeira, interrompa a publicação e planeje manutenção, backup e estabelecimento de credenciais dos usuários existentes.

O bootstrap e o seed **não** são executados no build, start ou pré-deploy. Não usar `db push`, `migrate reset` ou `migrate dev` como procedimento de produção. Não executar o seed de demonstração em produção; ele é bloqueado pelo código.

## Migrations desta versão

- `20260922100000_booking_domain`: serviços, expediente, bloqueios e agendamentos com FKs, CHECKs e constraint de exclusão para impedir reservas confirmadas sobrepostas.
- `20260922160000_password_auth`: credenciais Argon2id e contadores por usuário; remove toda a tabela `otp_challenges` e revoga sessões antigas.

As duas migrations anteriores da fundação são mantidas. `migrate deploy` aplica apenas migrations pendentes do histórico. O schema e as migrations devem acompanhar o backend no mesmo commit. Não editar SQL de migrations já aplicadas.

A migration de senha mantém usuários, IDs, telefone único, auditoria e relações. Contas antigas recebem hash nulo, sem senha padrão: não podem entrar nem ser tomadas por recadastro. Administradores existentes precisam estabelecer senha pelo bootstrap controlado; clientes existentes dependem de redefinição assistida após confirmação presencial de identidade. O DROP inclui desafios OTP ainda válidos, apesar do comentário histórico sobre códigos expirados. Não tratar o corte como apenas aditivo para a autenticação.

## Ambiente

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL do serviço, disponível no pré-deploy e runtime |
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | Origem HTTPS exata do frontend; múltiplas separadas por vírgula, sem caminhos nem wildcard |
| `JWT_ACCESS_SECRET` | Segredo aleatório de pelo menos 32 caracteres, somente no backend |
| `PORT` | Porta fornecida pelo Railway; o servidor lê essa variável |
| `TRUST_PROXY_HOPS` | Definir conforme a cadeia real de proxies; padrão zero |
| `REFRESH_COOKIE_PATH` | `/auth` se API sem prefixo; `/api/auth` se o proxy público remover `/api` |
| `REFRESH_COOKIE_SAME_SITE` | `lax` por padrão; `none` apenas para sites diferentes sobre HTTPS |
| `ACCESS_TOKEN_TTL_MINUTES` | 15 por padrão, máximo 60 |
| `REFRESH_TOKEN_TTL_DAYS` | 30 por padrão |

**`JWT_REFRESH_SECRET` não é consumido nem exigido.** O refresh é um valor opaco aleatório, armazenado no PostgreSQL somente como SHA-256. Não criar outro segredo sem uso para satisfazer um exemplo genérico de configuração.

Variáveis sem uso no runtime novo, removíveis após confirmar sucesso da implantação e encerrar eventual janela de rollback: `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_TIMEOUT_MS`, `AUTH_OTP_DEV_MODE`, `OTP_TTL_MINUTES`, `OTP_MAX_ATTEMPTS`. Não expor valores em tickets, Git, logs ou screenshots.

A variável exata do frontend é **`VITE_API_URL`**, lida em `src/services/api.ts`. É pública e incorporada durante o build. Seu padrão de produção é `/api`; esse padrão só funciona quando existe proxy para a API no mesmo domínio. Para frontend/API separados, o operador deve configurar a URL HTTPS pública correta da API no build do frontend e alinhar `FRONTEND_URL`, CORS e cookies no backend. Nunca usar a URL privada do PostgreSQL nem segredos em `VITE_*`.

O backend não serve os arquivos do frontend. Configurar/verificar separadamente hospedagem SPA, fallback das rotas do React e build do frontend. Publicação no GitHub não comprova que esse serviço frontend foi implantado.

## Primeiro administrador após a migration

Apenas o operador autorizado deve executar este procedimento, depois de o pré-deploy concluir e o backend novo iniciar. Não usar credenciais fictícias ou contas compartilhadas. A senha nova deve ter 15–128 pontos de código após NFKC; espaços nas bordas fazem parte da senha.

Abrir um terminal **dentro do container do deployment de produção do backend**, pelo comando “Copy SSH Command” no painel. Alternativamente, no projeto correto vinculado à CLI:

```sh
railway ssh --service easygoing-nourishment --environment <NOME_EXATO_DO_AMBIENTE_DE_PRODUCAO>
```

O ambiente de destino precisa ser confirmado pelo operador. [Railway SSH](https://docs.railway.com/cli/ssh) executa no container, com acesso à rede privada; não substituir por `railway run` no computador local presumindo que tenha a mesma conectividade.

No diretório do aplicativo do container, onde existem `package.json`, `dist/server.js` e `dist/scripts/bootstrap-admin.js`, abrir Bash e fornecer credenciais por entrada interativa, sem gravá-las no histórico:

```bash
set +x
set +o history
read -r -p 'Telefone real do administrador, com DDD: ' BOOTSTRAP_ADMIN_PHONE
read -r -s -p 'Senha do administrador: ' BOOTSTRAP_ADMIN_PASSWORD
printf '\n'
export BOOTSTRAP_ADMIN_PHONE BOOTSTRAP_ADMIN_PASSWORD
node dist/scripts/bootstrap-admin.js
unset BOOTSTRAP_ADMIN_PHONE BOOTSTRAP_ADMIN_PASSWORD
exit
```

Comando exato do bootstrap em produção: **`node dist/scripts/bootstrap-admin.js`**. Ele usa a configuração de banco/JWT/CORS existente no processo, não depende de `tsx` nem de devDependencies e não imprime a credencial. Não adicionar esse comando ao start ou ao pré-deploy. As variáveis acima são temporárias para a sessão; não precisam ficar salvas no painel do Railway.

`BOOTSTRAP_ADMIN_NAME` é opcional. Uma base vazia cria ADMIN/ACTIVE com telefone e senha informados. Um ADMIN/ACTIVE já com senha é preservado por padrão. `BOOTSTRAP_ADMIN_RESET_PASSWORD=true` confirma substituição intencional da senha existente; `BOOTSTRAP_ADMIN_ALLOW_PROMOTION=true` confirma promoção/reativação de outro registro. Não habilitar flags para contornar uma conta de identidade desconhecida. Ao estabelecer credencial, sessões anteriores são revogadas e o evento é auditado sem senha/hash.

Após autenticar como admin, cadastrar serviços reais, durações/preços e revisar o expediente/bloqueios pela interface. Um catálogo vazio não recebe serviços fictícios automaticamente. Dias sem configuração usam o expediente padrão do backend; revise antes de abrir agendamentos ao público.

## Verificação após a publicação

1. Conferir no Railway o SHA implantado, sucesso do build/pré-deploy/start e as migrations pendentes aplicadas. Nenhuma mensagem de push substitui essas evidências.
2. Confirmar `/health`, conectividade real do banco e carregamento do binário Argon2 no container Linux. O healthcheck sozinho é liveness, não testa o banco.
3. Executar o bootstrap autorizado e login admin; cadastrar catálogo/expediente reais. Salvar expediente usa `PUT`, permitido no CORS apenas para origens autorizadas.
4. Confirmar URL da API no frontend, CORS, cookie HttpOnly/Secure/SameSite/path, renovação e logout em navegador real sobre HTTPS.
5. Executar cadastro PENDING, aprovação administrativa, login, retorno à seleção, confirmação e Meus horários com uma conta de validação autorizada; conferir titularidade. Testar BLOCKED, sessão expirada e conflito de horário. Nenhuma senha/hash deve aparecer em respostas, auditoria ou logs.
6. Somente após isso considerar backend/frontend funcionando em produção. Até lá, o resultado de push é apenas **publicado no GitHub**.

## Rollback

O runtime OTP antigo não funciona sem `otp_challenges`. Não selecionar uma imagem antiga nem executar `git revert` presumindo reversão automática do banco. Nunca reativar refresh tokens ou desafios OTP antigos.

Se o novo deploy falhar, manter o serviço indisponível para autenticação pública até correção ou rollback coordenado. Obter autorização específica antes de intervir no banco. Com dados reais ou escritas após o corte, manter backup/PITR e preservar essas escritas; não restaurar um snapshot antigo cegamente.

Um rollback para OTP exige uma combinação revisada de frontend/backend/schema: recriação da estrutura OTP **vazia** conforme o histórico, preservação de usuários, senhas e agendamentos, reconciliação explícita do histórico Prisma e credenciais Twilio adequadas em ambiente seguro. Campos novos podem permanecer sem uso pelo runtime antigo. Alternativamente, restaurar backup aprovado e ensaiado, com invalidação de sessões/desafios restaurados antes de liberar tráfego. Nunca usar `migrate reset`.

A versão anterior `101d9d5` não contém o domínio de agenda desta entrega: incluir isso na escolha da versão e no plano de preservação dos dados. O rollback de produção não é automático e não foi executado nesta etapa.
