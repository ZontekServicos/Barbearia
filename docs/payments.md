# Confirmação mediante pagamento

## Estado atual

A arquitetura está pronta e testada; **nenhum provedor real está conectado**.
Sem `PAYMENT_PROVIDER` o pagamento fica desligado e aprovar uma solicitação a
confirma direto — o comportamento anterior a esta versão, preservado inteiro.

O único adaptador que existe é `manual`, de teste. Ele não fala com serviço
nenhum e é **recusado em produção**: a validação de ambiente derruba o processo
na inicialização. Isso é deliberado — confirmar dinheiro que não entrou não pode
ser possível por descuido de configuração.

## Ordem do fluxo

Há **duas** ordens, e a diferença não é arbitrária: depende de abrir a cobrança
ter ou não efeito no mundo.

### Pix estático (o caminho em produção)

```
cliente solicita        → PENDING + Payment PENDING   (horário segurado, Pix já na tela)
cliente paga
cliente avisa           → paymentReportedAt           (NÃO confirma nada)
barbearia confere extrato
barbearia confirma      → Payment PAID + CONFIRMED    (transação única)
                          ↓
                        botão "Confirmar pelo WhatsApp"
```

O Pix nasce **com a solicitação**. Mostrar um BR Code estático não cobra
ninguém: é a chave da barbearia com um valor sugerido, e só sai dinheiro se a
pessoa decidir pagar. Em troca, quem acabou de pedir horário paga ali, com o
celular na mão — antes essa pessoa via "aguardando aprovação", guardava o
celular e muitas vezes não voltava.

O agendamento fica em `PENDING` até a decisão final. Ver o QR não aprova nada.

A confirmação é **uma porta só**: `Confirmar pagamento e agendamento`, que marca
`Payment → PAID` e `Appointment → CONFIRMED` na mesma transação. Aprovar "no
seco" pela rota de decisão é recusado com 409 enquanto existir cobrança não paga
— duas portas para o mesmo destino é como um agendamento termina confirmado sem
pagamento.

### Provedor dinâmico

```
cliente solicita        → PENDING           (horário segurado)
barbeiro aprova         → AWAITING_PAYMENT  (janela de pagamento)
cliente paga
provedor notifica       → webhook valida
backend confirma        → CONFIRMED
```

Aqui a ordem antiga permanece, de propósito. Abrir cobrança no provedor é efeito
externo de verdade, com identificador de terceiro e dinheiro capturável; criá-la
antes da aprovação seria cobrar quem ainda pode ser recusado, e uma recusa
passaria a exigir devolução — que este sistema não faz automaticamente.

Janela vencida sem pagamento → `EXPIRED`, e o horário volta a ser oferecido.

### Recusar não devolve dinheiro

Com `paymentReportedAt` preenchido ou pagamento já `PAID`, a recusa exige
`acknowledgePaidReport` — sem ele, 409. Um clique a mais é barato; já ter
recusado, não.

Recusa não gera devolução automática em nenhum caso: o Pix estático cai direto
na conta da barbearia e só ela pode devolver, por fora. Cobrança não paga vira
`CANCELED` (ninguém deve pagar horário recusado); cobrança `PAID` **permanece
PAID**, porque apagar esse registro esconderia que existe devolução pendente. A
auditoria guarda valor, estado e instante da declaração.

## Dois estados, não um

`Appointment.status` é o estado do **agendamento**. `Payment.status` é o estado
do **dinheiro**. Um pagamento recusado não apaga a reserva; uma reserva cancelada
não reescreve o histórico financeiro.

| Agendamento | Dinheiro | Situação |
| --- | --- | --- |
| `PENDING` | — | aguardando o barbeiro; sem cobrança (sem pagamento ou serviço gratuito) |
| `PENDING` | `PENDING` | Pix na tela, esperando pagar — **o caminho normal** |
| `PENDING` | `PENDING` + `paymentReportedAt` | cliente avisou; aguardando conferência |
| `PENDING` | `FAILED` | Pix não localizado; dá para tentar de novo no prazo |
| `AWAITING_PAYMENT` | `PENDING` | provedor dinâmico: aprovado, esperando pagar |
| `CONFIRMED` | `PAID` | único estado final de sucesso |
| `EXPIRED` | `EXPIRED` | prazo venceu; horário liberado |
| `REJECTED` | — | recusado sem que houvesse cobrança |
| `REJECTED` | `CANCELED` | recusado com cobrança aberta; nada foi pago |
| `REJECTED` | `PAID` | recusado com dinheiro recebido: **devolução manual pendente** |

`CONFIRMED` exige as **duas** coisas: decisão da barbearia e dinheiro
confirmado. No Pix estático as duas acontecem no mesmo ato.

## O horário fica reservado durante o pagamento

A `EXCLUDE` do PostgreSQL cobre `PENDING`, `AWAITING_PAYMENT` e `CONFIRMED`
sobre `[starts_at, reserved_ends_at)`. Sem `AWAITING_PAYMENT` ali, um horário
aprovado e em pagamento sairia da proteção e poderia ser vendido duas vezes.

Os dois estados com prazo usam `pendingExpiresAt` como "até quando esta reserva
vale", então a expiração de pendentes abandonadas e a de janelas de pagamento
vencidas são a **mesma** varredura — a que já roda dentro da transação do insert,
restrita ao intervalo em disputa.

## Webhook: a única porta de confirmação

Não existe caminho que confirme pagamento a partir do navegador. Não há rota
"marcar como pago", não há botão "já paguei", e redirect, query string ou
screenshot não movem nada. `PaymentProvider` nem expõe uma operação dessas.

O que o backend confere antes de aceitar:

1. **assinatura** sobre os *bytes* do corpo (por isso `express.json` guarda o
   corpo cru nessa rota — reserializar muda espaços e a assinatura não bate);
2. a cobrança existe e é nossa;
3. a **referência** é a daquele agendamento;
4. o **valor** é exatamente o esperado — pagar menos não compra o horário;
5. a **moeda** é a esperada;
6. a **janela** não venceu.

### Idempotência

A unicidade `(provider, external_id)` em `payment_webhook_events` é a garantia.
A gravação do evento é a **última** operação da transação: um reenvio colide ali
e desfaz tudo que faria acima. Dez reenvios = uma confirmação. Vale também para
reenvios simultâneos, porque quem decide é o índice único do banco, não a
aplicação.

### Fora de ordem

Notificação `PENDING` chegando depois de `PAID` não rebaixa nada. Pagamento
depois da janela não ressuscita a reserva: o horário pode já ser de outra
pessoa, e forçar violaria a `EXCLUDE`. Nesse caso o pagamento fica registrado
para a barbearia estornar — e o resultado é gravado em
`payment_webhook_events.outcome` para auditoria.

## Valor

Sempre derivado de `Service.priceCents` via o preço **congelado na reserva**.
`paymentAmountCents` recebe um número e nada mais: não há parâmetro por onde o
navegador influenciar quanto se cobra.

`BookingRules.paymentMode`:

- `FULL` (padrão) — o valor inteiro;
- `DEPOSIT` — `depositPercent` com piso `depositMinimumCents`, nunca acima do
  preço do serviço.

Sem definição comercial, o padrão é `FULL`: cobrar o preço do catálogo é o
comportamento que ninguém precisa explicar.

## Conectar um provedor real

1. Implementar `PaymentProvider` (`server/src/modules/payment/payment.provider.ts`).
2. Registrar em `payment.registry.ts`.
3. Adicionar o nome ao enum de `PAYMENT_PROVIDER` em `server/src/config/env.ts`.
4. Configurar `PAYMENT_PROVIDER` e `PAYMENT_WEBHOOK_SECRET`.
5. Apontar o webhook do provedor para `POST /booking/payments/webhook`.

Nada acima dessa camada muda. Candidatos com Pix: Mercado Pago, Asaas, Pagar.me,
ou API Pix do próprio banco.

**Antes de ligar em produção:** confirmar que `parseWebhook` valida a assinatura
do jeito que aquele provedor documenta, que `getPayment` reconcilia de verdade
(o adaptador de teste não implementa), e ensaiar reenvio, valor divergente e
pagamento fora da janela contra o ambiente de teste do provedor.

## Referência pública

`EC-7F3K2Q` — alfabeto sem `0`, `O`, `1`, `I` e `S`, porque é ditada por
telefone. Existe para circular: aparece na mensagem do WhatsApp e no extrato do
provedor.

Não é credencial e não abre consulta nenhuma. O `publicToken` é que abre, e por
isso **nunca** sai do aparelho de quem solicitou.

## WhatsApp

Link montado no backend: o destinatário vem de `BARBERSHOP_WHATSAPP_NUMBER` e de
lugar nenhum mais, e a mensagem é montada a partir do banco. Assim o navegador
não tem como desviar a conversa nem anunciar como confirmado algo que não foi
pago.

Oferecido **apenas** com o agendamento `CONFIRMED`. A mensagem leva serviço,
data, horário, valor pago e referência — e nenhum token, handle, JWT, id interno
ou segredo do provedor.

O redirect é ação explícita da pessoa, nunca abertura automática: navegador móvel
bloqueia pop-up sem gesto. Se o WhatsApp não abrir, a tela continua mostrando o
agendamento confirmado — o estado da reserva não depende disso.

## Casos que a auditoria independente corrigiu

Registrados aqui porque são exatamente os pontos onde "pagamento é opcional"
deixa de ser óbvio.

### Referência pública nasce com a solicitação

A referência é sorteada na **criação**, com ou sem pagamento configurado. Ligada
apenas ao caminho de pagamento, um agendamento confirmado numa instalação sem
provedor — a configuração padrão — ficava sem referência, e a confirmação pelo
WhatsApp nunca aparecia, porque o link depende dela. Presa à aprovação, um pedido
pendente não tinha identificador nenhum que pudesse circular.

Na aprovação de reservas antigas que ainda não a tenham, ela é gravada **antes**
da chamada ao provedor, sob lock da linha. Sorteada só em memória, duas
aprovações simultâneas geravam referências diferentes e duas cobranças; a do
perdedor ficava órfã — sem linha no banco e ainda pagável.

### Serviço de preço zero

O catálogo aceita `priceCents: 0` (cortesia, retoque incluso). Com pagamento
ligado, abrir cobrança de zero violava o CHECK `amount_cents > 0`: a aprovação
falhava com erro interno e o pedido ficava preso em `PENDING` para sempre.

Sem valor a cobrar, nenhuma cobrança nasce com a solicitação e aprovar confirma
direto — igual a uma instalação sem pagamento. A cobrança só existe quando há o
que cobrar, e é a ausência dela que devolve o botão `Confirmar agendamento` ao
painel.

### Cancelar durante a janela de pagamento

`AWAITING_PAYMENT → CANCELLED` é permitido. Sem isso, a barbearia perdia a
capacidade de cancelar um agendamento aprovado — algo que sempre pôde fazer
quando aprovar resultava direto em `CONFIRMED` — e ficava presa até a janela
vencer, com um pagamento ainda podendo confirmar no meio.

Cancelar limpa o prazo, libera o horário e marca a cobrança pendente como
`CANCELED`. Um `PAID` que chegue depois **não** ressuscita a reserva: fica
registrado para estorno. `COMPLETED` e `NO_SHOW` continuam exigindo `CONFIRMED`.

A transição roda sob lock da linha, então cancelamento e webhook simultâneos
resolvem num único estado — nunca nos dois.

## Pix

### Dois caminhos, nunca misturados

| | `STATIC_PIX` | `DYNAMIC_PROVIDER_PIX` |
| --- | --- | --- |
| Configuração | `BARBERSHOP_PIX_KEY` + nome + cidade | `PAYMENT_PROVIDER` |
| QR | montado por nós, a partir da chave | o da cobrança do provedor |
| Chave exibida | sim, com botão de copiar | não |
| Confirmação | **manual**, pela barbearia | automática, por webhook |

`paymentMethod` resolve na ordem **provedor → Pix estático → nenhum**. Com os
dois configurados, o provedor ganha: só a cobrança dele se concilia sozinha.

**Não existe queda de um para o outro.** Se a cobrança é de provedor e o
"Copia e Cola" dele vier inválido, a tela não oferece o Pix estático: o cliente
pagaria na conta da barbearia um valor que o provedor nunca vai conciliar,
enquanto o sistema espera um webhook sobre dinheiro que foi para outro lugar.
Nesse caso não há QR, e a tela manda falar com a barbearia.

### O QR é um BR Code de verdade

Montado em `modules/payment/pix/brcode.ts` conforme o padrão EMV®QRCPS do Banco
Central: campos `ID + tamanho + valor` e CRC16/CCITT-FALSE. Um QR com a chave em
texto cru **não** é um pagamento — o aplicativo do banco mostra "QR inválido".

O CRC é verificado no teste contra o valor canônico do algoritmo
(`"123456789"` → `29B1`), que é o que prova ser a variante certa. Vetores de
payload Pix copiados de memória não servem como referência.

O **valor entra no QR**, então o aplicativo abre com a quantia certa e o cliente
não digita nem erra. Vem de `paymentAmountCents` sobre o preço congelado no
agendamento; não há parâmetro por onde o navegador informar quanto cobrar.

A referência pública viaja como `txid` (só letras e números: `EC-7F3K2Q` →
`EC7F3K2Q`), o que permite conciliar no extrato.

### O que o Pix estático NÃO faz

Exibir o QR, copiar a chave, copiar o código ou recarregar a tela **não mudam
estado nenhum**. Não existe botão "já paguei", e nenhuma rota pública aceita
"pago" — nem poderia: a única transição para `PAID` sem provedor é
`POST /admin/appointments/:id/payment`, que exige sessão de ADMIN ativa, recusa
cobrança de provedor, roda sob lock da linha e fica na trilha de auditoria.

O texto na tela acompanha quem confirma: no estático, *"Após o pagamento,
aguarde a confirmação da barbearia"*; no dinâmico, *"A confirmação é automática"*.
Dizer "automática" num Pix estático faria a pessoa não avisar a barbearia e
perder o horário.

### Configuração

Chave, nome e cidade são as três obrigatórias em conjunto — sem nome ou cidade o
BR Code é recusado pelo aplicativo do banco, então a validação de ambiente exige
as três ou nenhuma.

Prefira **chave aleatória**: telefone, CPF e e-mail ficam estampados no QR de
todo mundo que for pagar.

A chave só sai pela tela de pagamento de um pedido específico. `GET /booking/policy`
informa apenas o *método* — nunca a chave nem o recebedor.

## Confirmação do Pix pelo painel

O barbeiro confere o extrato e registra o resultado em
**Agenda → agendamento → Pagamento**. A rota é
`POST /admin/appointments/:id/payment` com `{ decision: "PAID" | "FAILED" }` — e
só isso. Valor, data do pagamento, provedor e o novo estado do agendamento são
resolvidos pelo servidor a partir da cobrança; o painel não tem por onde
influenciar nenhum deles.

Quem decide se o botão existe é o **servidor**, em `canConfirmManually`: Pix da
barbearia, cobrança em aberto, horário aguardando pagamento e prazo válido, as
quatro juntas. O navegador não recombina essas condições esperando acertar todas.

Cobrança de provedor nunca oferece confirmação manual — ali quem confirma é o
webhook dele, e a tela diz isso.

`FAILED` registra que o dinheiro não foi encontrado **sem** destruir a reserva:
dentro do prazo o cliente ainda pode pagar, e o barbeiro pode confirmar depois.

Confirmar exige modal repetindo cliente, serviço, valor, data, horário e
referência. Um clique direto na lista confirmaria dinheiro por engano, e desfazer
isso significa ligar para o cliente.

Duas sessões confirmando ao mesmo tempo: uma vence, a outra recebe **409** com
`"Este pagamento já foi confirmado."` — que o painel mostra como **aviso**, não
como falha, e então recarrega o estado real. Erro vermelho genérico ali só faria
o barbeiro clicar de novo.

### Janela de pagamento do Pix manual

`BookingRules.staticPixPaymentWindowMinutes = 120`, contra 15 do provedor.
Este prazo cobre o cliente pagar e informar. Depois da declaração, vale a janela
de conferência descrita abaixo, inclusive na consulta pública e na confirmação
administrativa.

`paymentWindowMinutesFor(method)` é o único lugar que decide isso — inclusive
para o número que a tela do cliente mostra. Quando um provedor real precisar de
outra janela, é ali que ela entra.

### Prazo vencido

O botão normal **desaparece**. No lugar entra o aviso de que o horário voltou a
ficar disponível e que um Pix recebido depois precisa de tratamento manual com o
cliente.

Confirmar num clique ali poderia fechar um horário já oferecido a outra pessoa.
O servidor recusa com HTTP 409 quando vence o prazo da cobrança ou da reserva,
mesmo antes de a varredura persistir `EXPIRED`. A tentativa não altera o pagamento,
o agendamento ou a auditoria financeira. Um Pix tardio precisa de tratamento
manual com o cliente; esta rota não reativa a reserva.

## Aviso de nova solicitação

Depois de solicitar, a tela oferece **"Avisar a barbearia no WhatsApp"** — e o
mesmo botão reaparece no acompanhamento enquanto o pedido está `PENDING`, para
quem fecha a aba e volta pelo link.

O link vem pronto do backend em `notifyUrl`: destino de
`BARBERSHOP_WHATSAPP_NUMBER`, mensagem montada a partir do banco. Sem número
configurado ele vem nulo e o botão não aparece — nunca um `wa.me/undefined`.

Abrir é **ação explícita da pessoa**. Nada é aberto sozinho ao criar a reserva:
o navegador bloquearia o popup e tiraria o cliente da confirmação que acabou de
receber. E abrir o WhatsApp é só comunicação — não aprova, não confirma, não
consome token e não toca no agendamento, que segue `PENDING` até a barbearia
decidir no painel. Por isso a mensagem diz "Status: Aguardando confirmação".

### A referência nasce com a reserva

`publicReference` deixou de ser criada apenas na aprovação e passa a existir
desde a criação do agendamento.

O motivo é este aviso: um pedido pendente não tinha identificador nenhum que
pudesse circular, e o cliente que quisesse falar sobre o próprio pedido teria de
citar o `publicToken` — que é credencial de consulta e não pode sair do aparelho
dele. A referência não é credencial: não abre consulta, não substitui o token, e
saber uma não dá acesso a nada.

Ela é **estável** da criação até o fim: aprovar não sorteia outra, e um pedido
recusado a mantém, de modo que o histórico continua identificável dos dois lados
do balcão.

### "Já fiz o Pix"

Com o QR na tela, o cliente ganha um segundo botão: **"Já fiz o Pix — confirmar
pelo WhatsApp"**, que abre a conversa com a mensagem já escrita — valor,
referência, serviço, data e horário.

**É comunicação e nada mais.** Abrir não marca `Payment` como `PAID`, não confirma
o agendamento, não cria registro na trilha financeira e não chama a rota
administrativa. Quem confirma continua sendo a barbearia, depois de ver o dinheiro
no extrato. Por isso a mensagem *pede* — "Poderia confirmar o recebimento, por
favor?" — em vez de anunciar.

Aparece **só no Pix estático**: numa cobrança de provedor a confirmação chega
sozinha por webhook, e oferecer o botão ali faria a pessoa cobrar atenção humana
para algo já automatizado. O link deriva da mesma apresentação de Pix que desenha
o QR, então, com número de WhatsApp e referência configurados, acompanha o QR da barbearia — e
desaparece junto quando o prazo vence, porque reserva expirada não deve receber
pagamento nem pedido de conferência.

O comprovante não é anexado nem enviado ao nosso backend: a pessoa junta a imagem
dentro do WhatsApp, se quiser, depois que a conversa abrir.

O texto da tela acompanha: *"Após realizar o Pix, envie a confirmação pelo
WhatsApp. O agendamento será confirmado após a barbearia verificar o
recebimento."*

Ao zerar o contador no navegador, QR, chave, Copia e Cola, checkout e CTAs de
pagamento desaparecem imediatamente, inclusive se a API estiver indisponível.
O texto orienta a não realizar pagamento após o prazo. O CTA abre uma única
janela por clique explícito com `noopener,noreferrer`; a página nunca abre o
WhatsApp sozinha. Sem número configurado, não orienta um envio indisponível.

## Dois prazos, não um

O defeito que esta separação corrige: a janela de pagamento vencia **enquanto o
dinheiro já estava na conta**, liberando o horário de quem tinha pagado — porque
o mesmo prazo cobria duas esperas diferentes.

| Prazo | Quem se espera | Valor |
| --- | --- | --- |
| `expiresAt` | o cliente pagar e informar | `staticPixPaymentWindowMinutes` = **120min** |
| `reviewExpiresAt` | a barbearia conferir o extrato | `min(informado + 24h, início − 60min)` |

Duas horas para pagar porque o cliente pode estar sem o app do banco à mão. Um
dia para conferir porque olhar extrato é trabalho humano que não acontece no meio
de um corte.

`paymentReviewDeadline(reportedAt, startsAt)` e `canReviewPayment(...)` são os
únicos lugares que decidem isso — nenhum `24` ou `60` espalhado.

### A declaração

`POST /booking/requests/:token/payment-reported`, pública, corpo **vazio e
estrito**: quem é o pedido vem do token, e horários e estados são do servidor.

Ela **não confirma nada**. `Payment` segue `PENDING`, `Appointment` segue
`AWAITING_PAYMENT`, `paidAt` segue nulo e nenhuma trilha financeira é criada. O
que muda é `Appointment.pendingExpiresAt`, que passa a valer o prazo de
conferência — e é só isso que faz a proteção do horário continuar funcionando,
porque disponibilidade e expiração usam esse campo como prazo vigente.
A `EXCLUDE` protege os estados ativos, sem consultar o relógio: a transação de
nova reserva expira as linhas vencidas antes do insert. O UPDATE revalida estado
e prazo depois de obter o lock, impedindo apagar uma conferência concorrente.

`expiresAt` **nunca** é reescrito: o prazo original fica no histórico.

Idempotente. Dez cliques valem um: o primeiro instante manda e a conferência não
estica — senão o cliente esticaria a reserva à vontade clicando de novo.

### Ordem do clique

Registro **primeiro**, WhatsApp depois. Abrindo antes, uma falha no registro
deixaria a pessoa achando que avisou enquanto o horário seguia vencendo pelo
prazo de pagamento. Falhando o registro, a tela mostra o erro do servidor e
**não** diz que informou.

Abrir depois de um `await` pode cair no bloqueador de pop-up. Quando isso
acontece, a tela oferece um link para tocar — a declaração já está registrada,
que é a parte que não pode se perder.

### Atendimento perto demais

Dentro da folga de 60 minutos não cabe conferência: a declaração é **recusada**
com orientação para falar com a barbearia. Aceitar criaria prazo nulo ou negativo
e o cliente sairia achando que avisou quando ninguém teria tempo de olhar antes
da cadeira. `paymentHelpUrl` continua na tela como a saída de última hora.

### Conferência vencida sem decisão

Nada é confirmado automaticamente, e nada é marcado como pago. O horário volta
para a agenda pela regra normal — não existe hold infinito —, mas o painel passa
a marcar `reviewOverdue`: *"O cliente informou o Pix e o prazo de conferência
venceu sem decisão. Verifique o extrato."*

O alerta é derivado de `paymentReportedAt` + prazo vencido + nunca confirmado, e
**não** depende do status da cobrança — de propósito: a varredura marca a
cobrança `EXPIRED`, e amarrar o alerta a `PENDING` o faria desaparecer justamente
quando passa a importar. Não foi preciso um estado novo no enum.

### "Pagamento não localizado"

A decisão `FAILED` fica na auditoria. Se ainda há prazo, a mesma cobrança
retorna a `PENDING`, os campos de declaração saem da apresentação e o QR volta.
A rota pública exige estritamente `PENDING`; ela não reabre cobranças falhadas.

O prazo da reserva passa ao menor entre o prazo original de pagamento e o prazo
vigente. Se já venceu, pagamento e agendamento viram `EXPIRED` imediatamente.
Repetir a recusa não aumenta o prazo. Não existe outra cobrança.

Os primeiros `paymentReportedAt` e `reviewExpiresAt` ficam na auditoria
`PAYMENT_FAILED` e são restaurados numa nova declaração autorizada, sem renovar
as 24 horas. Esses registros fazem parte do histórico necessário à regra e devem
ser preservados durante a vida da reserva.

### Tela do cliente

Declarado o pagamento, o **QR sai da tela** — mantê-lo convidaria a pagar de
novo. No lugar: *"Pagamento informado"*, *"Estamos aguardando a barbearia
confirmar o recebimento"*, *"Seu horário permanece reservado durante a
conferência"*. A contagem passa a ser "prazo para a barbearia conferir". Em
nenhum momento aparece "confirmado".

### Consequência da conferência vencida

**Mesmo quem realmente pagou perde a proteção do horário ao vencer
`reviewExpiresAt`.** Se a barbearia não conferir a tempo, outro cliente poderá
reservar. O caso exige contato e tratamento manual, incluindo eventual estorno.
Não há confirmação automática, nem reativação automática do horário anterior.

### Migration e rollback lógico

`20260929120000_pix_payment_report` adiciona duas colunas nullable, dois CHECKs
(par obrigatório e prazo posterior à declaração) e índice parcial. Não reescreve
reservas antigas. A migration é transacional; falha de lock desfaz o conjunto.

Para rollback da aplicação, primeiro interromper novas declarações e resolver
as conferências abertas mantendo uma versão que respeite o prazo vigente.
Não voltar diretamente ao código antigo com reviews abertas: ele interpreta
`expiresAt` como limite e pode apresentar expiração antecipada. Conservar as
colunas e o histórico é o rollback preferido; não executar DROP nem reduzir
`pendingExpiresAt` em massa. Uma remoção física futura exige backup e decisão
explícita após não restar nenhuma conferência ativa.

Validação local: `prisma migrate deploy`, `prisma migrate status` e
`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`.
Os CHECKs e o índice parcial também são verificados diretamente no PostgreSQL,
pois o diff do Prisma não representa toda restrição SQL.

## Marca e titular da chave são coisas diferentes

`ErickCorttes` é o **nome comercial**: aparece na interface, nas mensagens de
WhatsApp e na descrição da cobrança de provedor.

`BARBERSHOP_PIX_RECEIVER_NAME` é o **titular da chave Pix**: é o nome que o
aplicativo do banco do cliente mostra ao ler o QR, e é o campo 59 do BR Code.

O sistema **nunca** usa a marca como titular — não existe fallback. Os dois podem
divergir, e durante os testes divergem de propósito: a chave pode ser de quem está
validando o fluxo, e aí o titular é essa pessoa.

Por isso a tela mostra **"Recebedor"** em linha própria, separado da chave. Juntar
os dois levaria o cliente a achar que paga para "ErickCorttes" quando o nome no
banco dele será outro — e desconfiança na hora de pagar custa o pagamento.

Na entrega, `BARBERSHOP_PIX_KEY` e `BARBERSHOP_PIX_RECEIVER_NAME` trocam **juntas**
pelos dados do recebedor definitivo.

**Não há validação de titularidade.** Com Pix estático não existe como provar que
o nome configurado é o dono da chave; o sistema não afirma em lugar nenhum que
houve conferência bancária. Quem garante é quem configura. Um provedor real poderá
validar isso no futuro.
