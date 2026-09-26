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
- `20260926120000_appointment_awaiting_payment`: acrescenta o valor `AWAITING_PAYMENT` ao enum `AppointmentStatus`. Sozinha numa migration porque o PostgreSQL não permite USAR um valor de enum na mesma transação que o adiciona. Irreversível — não existe `DROP VALUE`.
- `20260926120100_payments`: coluna `public_reference`, tabelas `payments` e `payment_webhook_events`, e reconstrução da `appointments_no_overlap` para cobrir `AWAITING_PAYMENT`. A reconstrução da EXCLUDE adquire lock na tabela de agendamentos; ver a nota sobre locks mais abaixo.

As duas migrations anteriores da fundação são mantidas. `migrate deploy` aplica apenas migrations pendentes do histórico. O schema e as migrations devem acompanhar o backend no mesmo commit. Não editar SQL de migrations já aplicadas.

As migrations de pagamento são **estritamente aditivas**: nenhuma linha existente muda de estado, nenhum agendamento é deslocado, nenhuma coluna é removida. Sem `PAYMENT_PROVIDER` configurado o pagamento fica desligado e aprovar uma solicitação a confirma direto, como antes — subir o código sem configurar pagamento não altera comportamento nenhum. Ver [docs/payments.md](./payments.md).

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
| `PAYMENT_PROVIDER` | Opcional. Vazio = pagamento desligado. `manual` é adaptador de teste e é **recusado em produção** |
| `PAYMENT_WEBHOOK_SECRET` | Obrigatório sempre que `PAYMENT_PROVIDER` estiver preenchido; mínimo 32 caracteres |
| `BARBERSHOP_WHATSAPP_NUMBER` | Opcional, E.164. Destino do botão de confirmação. Vazio = botão não é oferecido |

**`JWT_REFRESH_SECRET` não é consumido nem exigido.** O refresh é um valor opaco aleatório, armazenado no PostgreSQL somente como SHA-256. Não criar outro segredo sem uso para satisfazer um exemplo genérico de configuração.

Variáveis sem uso no runtime novo, removíveis após confirmar sucesso da implantação e encerrar eventual janela de rollback: `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_TIMEOUT_MS`, `AUTH_OTP_DEV_MODE`, `OTP_TTL_MINUTES`, `OTP_MAX_ATTEMPTS`. Não expor valores em tickets, Git, logs ou screenshots.

A variável exata do frontend é **`VITE_API_URL`**, lida em `src/services/api.ts`. É pública e incorporada durante o build. Seu padrão de produção é `/api`; esse padrão só funciona quando existe proxy para a API no mesmo domínio. Para frontend/API separados, o operador deve configurar a URL HTTPS pública correta da API no build do frontend e alinhar `FRONTEND_URL`, CORS e cookies no backend. Nunca usar a URL privada do PostgreSQL nem segredos em `VITE_*`.

### Descompasso de versão entre frontend e backend

Como os dois serviços sobem **separadamente**, publicar um sem o outro deixa o
navegador executando um pacote de uma versão e a API de outra. Foi exatamente o
que produziu o erro **"Dados inválidos."** no envio final do agendamento: o
backend novo passou a exigir `contactHandle` em `POST /booking/requests`,
enquanto o pacote anterior ainda mandava `fullName` + `phone`.

Duas medidas:

- `POST /booking/requests` aceita **as duas formas** de identificação, então um
  navegador uma versão atrás continua funcionando em vez de quebrar. É rede de
  segurança, não substituto de publicar o frontend. A forma anterior pode ser
  removida depois de confirmar que o pacote novo está no ar.
- **Ordem obrigatória: BACKEND primeiro, FRONTEND depois.** Verificado nas duas
  direções:

  | Combinação | Resultado |
  | --- | --- |
  | frontend antigo + backend novo | **funciona** — o backend aceita a forma anterior |
  | frontend novo + backend antigo | **quebra** — o backend anterior não expõe `POST /booking/contacts`, e a primeira etapa do agendamento falha com 404 |

  Só uma das direções é compatível, então a ordem não é preferência. Publicar o
  frontend primeiro troca o erro do incidente por outro, na etapa de cadastro.

O backend não serve os arquivos do frontend. Configurar/verificar separadamente hospedagem SPA, fallback das rotas do React e build do frontend. Publicação no GitHub não comprova que esse serviço frontend foi implantado.

**Fallback de SPA é requisito, não detalhe.** O acompanhamento do pedido vive em
`/agendamento/<token>` — um link que o cliente abre dias depois, direto, sem
passar pela raiz. Sem o fallback para `index.html`, essa URL responde 404 na
hospedagem e a pessoa não consegue ver nem pagar o próprio agendamento.

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

## Upgrade do agendamento público (20260925100000)

Esta versão mantém login administrativo por senha e adiciona pedidos públicos sem autenticar o telefone. O frontend requer `VITE_API_URL` correto; backend mantém `DATABASE_URL`, `JWT_ACCESS_SECRET`, `FRONTEND_URL`, `NODE_ENV=production`, `PORT` e configuração de cookies/proxy existentes. Não há variável Twilio/OTP nova. Não alterar a política `publicRequestsRequireApproval=true` sem nova revisão.

O upgrade preenche `reserved_ends_at = ends_at` no histórico, instala CHECK, índice UNIQUE para o digest do token e EXCLUDE de `[starts_at,reserved_ends_at)` para PENDING/CONFIRMED. Não aumenta reservas antigas para 40 minutos. Buffers permanecem bloqueados por CHECK e schemas; ativá-los futuramente exige definir antes/depois, evitar contagem duplicada, migrar constraints/snapshots e testar todas as janelas e concorrência novamente.

Há duas transações: novos valores do enum precisam estar commitados antes de serem utilizados; a segunda engloba colunas, preenchimento e substituição da constraint. Falha na segunda faz rollback desse DDL, mas os valores do enum já adicionados permanecem. Não editar migrations aplicadas nem executar reset/resolve às cegas.

ALTER TABLE e reconstrução da EXCLUDE exigem locks que podem bloquear leituras/escritas até o commit. O ensaio local com fixture pequena mediu dezenas de milissegundos após adquirir o lock; sob um leitor concorrente, `lock_timeout=300ms` falhou como esperado, sem DDL parcial. Isso não estima duração em produção: volume e transações abertas determinam o bloqueio. Ver [locks do PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).

O [pré-deploy do Railway](https://docs.railway.com/deployments/pre-deploy-command) executa antes do novo runtime. A versão antiga não escreve o novo campo NOT NULL; portanto existe janela de incompatibilidade de escrita entre migration e troca de aplicação. Planejar janela operacional, backup/PITR, drenagem de escritas e acompanhamento do lock antes de liberar tráfego. Não fazer rollback isolado da imagem antiga: ela não entende o novo campo obrigatório e os estados novos. A estratégia de rollback precisa ser coordenada com banco e preservação dos pedidos criados após o corte.

Após o auto-deploy, conferir SHA, migrations e constraint reais, catálogo/expediente, jornada anônima PENDING, confirmação/recusa administrativa, expiração, concorrência, CORS HTTPS e cookies do admin. Configurar `TRUST_PROXY_HOPS` somente conforme topologia verificada, sem aceitar caminhos diretos que permitam forjar X-Forwarded-For. O limitador por IP é local à réplica; a cota por telefone é transacional e compartilhada no PostgreSQL.

Não registrar `/booking/requests/:token` em access logs, analytics ou APM sem mascarar o token. A sanitização da aplicação não cobre a infraestrutura. A criação por telefone não prova titularidade; a barbearia deve avaliar pedidos antes da confirmação. Não há envio de SMS nem notificação automática neste fluxo.

Esta auditoria usa somente PostgreSQL local isolado. Push dispara a automação já existente, mas não comprova deploy, migration ou comportamento no Railway. Esses itens permanecem pendentes de validação separada.
