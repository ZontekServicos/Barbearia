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

```
cliente solicita        → PENDING           (horário segurado)
barbeiro aprova         → AWAITING_PAYMENT  (horário segurado, janela de pagamento)
cliente paga
provedor notifica       → webhook valida
backend confirma        → CONFIRMED
                          ↓
                        botão "Confirmar pelo WhatsApp"
```

Cobrar **depois** da aprovação, não antes: cobrar primeiro seria cobrar quem vai
ser recusado, e devolver dinheiro é pior que esperar.

Janela vencida sem pagamento → `EXPIRED`, e o horário volta a ser oferecido.

## Dois estados, não um

`Appointment.status` é o estado do **agendamento**. `Payment.status` é o estado
do **dinheiro**. Um pagamento recusado não apaga a reserva; uma reserva cancelada
não reescreve o histórico financeiro.

| Agendamento | Dinheiro | Situação |
| --- | --- | --- |
| `PENDING` | — | aguardando o barbeiro; sem cobrança |
| `AWAITING_PAYMENT` | `PENDING` | aprovado, esperando pagar |
| `AWAITING_PAYMENT` | `FAILED` | recusado; dá para tentar de novo no prazo |
| `CONFIRMED` | `PAID` | único estado final de sucesso |
| `EXPIRED` | `EXPIRED` | prazo venceu; horário liberado |
| `REJECTED` | — | barbeiro recusou; nunca houve cobrança |

`CONFIRMED` exige as **duas** coisas: aprovação do barbeiro e dinheiro
confirmado pelo backend.

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

### Referência pública nasce em toda aprovação

A referência é reservada ao aprovar, **com ou sem pagamento configurado**. Ligada
apenas ao caminho de pagamento, um agendamento confirmado numa instalação sem
provedor — a configuração padrão — ficava sem referência, e a confirmação pelo
WhatsApp nunca aparecia, porque o link depende dela.

Ela também é gravada **antes** da chamada ao provedor, sob lock da linha. Sorteada
só em memória, duas aprovações simultâneas geravam referências diferentes e duas
cobranças; a do perdedor ficava órfã — sem linha no banco e ainda pagável.

### Serviço de preço zero

O catálogo aceita `priceCents: 0` (cortesia, retoque incluso). Com pagamento
ligado, abrir cobrança de zero violava o CHECK `amount_cents > 0`: a aprovação
falhava com erro interno e o pedido ficava preso em `PENDING` para sempre.

Sem valor a cobrar, aprovar confirma direto — igual a uma instalação sem
pagamento. A cobrança só existe quando há o que cobrar.

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

### Janela de 30 minutos no Pix manual

`BookingRules.staticPixPaymentWindowMinutes = 30`, contra 15 do provedor, porque
o gargalo é humano: ninguém nos notifica, então alguém precisa abrir o extrato,
achar o lançamento e confirmar. Entre atender uma pessoa e conferir o celular, 15
minutos derrubam reservas legitimamente pagas.

`paymentWindowMinutesFor(method)` é o único lugar que decide isso — inclusive
para o número que a tela do cliente mostra. Quando um provedor real precisar de
outra janela, é ali que ela entra.

### Prazo vencido

O botão normal **desaparece**. No lugar entra o aviso de que o horário voltou a
ficar disponível e que um Pix recebido depois precisa de tratamento manual com o
cliente.

Confirmar num clique ali poderia fechar um horário já oferecido a outra pessoa.
O servidor continua aceitando a conciliação enquanto a reserva não tiver sido
tomada — e recusa com conflito quando tiver, porque a varredura já a expirou.
Nunca há double booking: a `EXCLUDE` cobre `AWAITING_PAYMENT` até a expiração
efetiva.
