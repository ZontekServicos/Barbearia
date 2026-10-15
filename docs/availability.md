# Disponibilidade e bloqueios

## A agenda é fechada por padrão

Antes, um dia sem configuração caía num expediente embutido no código
(`DEFAULT_WEEK`), e a agenda abria sozinha em dias que a barbearia nunca
confirmou. Agora só existe horário onde há **abertura explícita**.

Duas tabelas descrevem isso, as duas de disponibilidade **positiva**:

| Tabela | O que guarda |
| --- | --- |
| `schedule_openings` | uma faixa aberta: `weekday` (regra semanal) **ou** `date` (exceção), nunca as duas |
| `schedule_date_overrides` | que uma DATA tem regra própria, ignorando a semana |

Várias linhas por dia dão as múltiplas faixas: terça 09:00–12:00 e 14:00–18:00
são duas linhas, e o almoço é simplesmente o vão entre elas — não um campo.

`ScheduleBlock` continua sendo disponibilidade **negativa** e não foi invertida.
"Bloqueio" significando abertura em algum contexto tornaria qualquer consulta
ambígua.

### Precedência

```
1. exceção da DATA   (existe linha em schedule_date_overrides)
2. regra SEMANAL     (faixas com weekday)
3. fechado
```

A exceção vence por **existir**, não por ter faixas: uma exceção sem faixas é
"fechado nesta data". Se a ausência de faixas caísse na regra semanal, fechar
uma data isolada seria impossível.

Depois da janela aberta, nada mudou: a engine subtrai bloqueios, agendamentos e
passado, e aplica duração e reserva.

### Fechado é derivado, nunca guardado

Não existe booleano `closed`. Fechado é não ter faixa. Um booleano persistido
poderia contradizer as linhas — "fechado" com três faixas abertas — e nenhuma
constraint resolveria isso.

### Garantias no banco

- `CHECK` de escopo: `(weekday IS NULL) <> (date IS NULL)`;
- `CHECK` de limites: dentro do dia e com fim depois do início;
- `EXCLUDE` por faixa: sobreposição é **impossível por construção**, o que
  também resolve dois administradores salvando no mesmo instante.

A `EXCLUDE` usa um eixo inteiro com uma faixa de 1440 minutos por dia
(`weekday * 1440 + minuto`) em vez de `weekday WITH =`. A segunda forma exigiria
a extensão `btree_gist`, e nenhuma migration deste projeto cria extensão —
introduzir essa dependência faria a migration falhar justamente no ambiente
gerenciado, onde o papel pode não ter permissão.

### Alterar disponibilidade nunca cancela agendamento

Fechar uma faixa que contém agendamento é **permitido** e não toca em ninguém: a
resposta devolve `appointmentsOutside` para a tela avisar quantos ficaram fora.
Só agendamento NOVO é proibido.

A assimetria é intencional:

- fechar **depois** de a reserva existir → a reserva continua valendo;
- reservar **depois** de fechar → recusado.

Quem garante a segunda metade é uma reconferência da janela **dentro** da
transação de criação, sob `pg_advisory_xact_lock_shared('schedule-rules')`. A
alteração de expediente toma o mesmo lock em modo exclusivo. Reservas não
esperam umas às outras (é o caminho quente), mas esperam uma alteração em curso
— e, enquanto ela grava, nenhuma reserva nova entra.

### `business_hours` ficou para trás

A tabela continua no banco, sem leitor, preservada por migration aditiva —
apagá-la num deploy reversível destruiria configuração real sem volta. As rotas
`GET/PUT /admin/business-hours` e o editor em Configurações foram removidos:
manter um editor que grava onde ninguém lê faria o administrador salvar o
expediente e a agenda não mudar.

O `GET /booking/business-hours` público continua existindo e passou a **derivar**
das aberturas, para a vitrine não anunciar "Ter 09:00–19:00" com a agenda
fechada.

## Duas grades, uma verdade

O mesmo dia é descrito para dois públicos, e a diferença é deliberada.

| | Grade pública | Grade administrativa |
| --- | --- | --- |
| Rota | `GET /booking/availability` | `GET /admin/availability` |
| Campos por horário | `startsAtClock`, `endsAtClock`, `startsAt`, `available` | os mesmos + `reason`, `blockId`, `blockReason`, `appointmentId` |
| Motivo | **nunca** | sempre |

A versão pública diz apenas se o horário pode ser escolhido. Saber que às 15:00
existe um agendamento já é dado de outra pessoa — e a barbearia não precisa que o
cliente saiba por que não pode, só que não pode.

A administrativa traz o **motivo** porque é ele que decide a ação possível:
bloqueio manual se desfaz, agendamento não.

## A grade mostra o dia inteiro

Horário ocupado aparece **cinza e desabilitado**, não desaparece. Sumir com o que
está ocupado deixa buracos que parecem defeito da página, e esconde do cliente a
informação mais útil que ele tem: como o dia está.

Nenhum rótulo por horário ("Ocupado", "Disponível"): o texto visível é só a hora.
Para leitor de tela o botão indisponível recebe `aria-label` com `indisponível` —
que é estado, não motivo.

`grid` inclui inícios cujo atendimento não caberia na janela (o 18:40 de um corte
que fecha às 19:00). Eles saem como `OUTSIDE_HOURS` e continuam visíveis.

## `computeSlotGrid` descreve; `computeSlotStarts` decide

São duas funções paralelas, e **não** se fundem. `computeSlotStarts` decide o que
pode ser reservado e é o caminho que a criação de agendamento valida;
`computeSlotGrid` apenas descreve. Misturá-las arriscaria fazer um horário
indisponível virar reservável.

O invariante que amarra as duas, testado em seis cenários: **tudo que a grade
marca disponível está na lista de inícios reserváveis, e nenhum início reservável
fica fora da grade**. Se divergirem, a tela oferece um botão que a criação recusa
— ou esconde um horário vendável.

Na resposta pública há um segundo filtro: `available` exige também que o início
esteja entre os realmente **oferecidos** (`maxDailyStartOptions`), para um
horário livre mas cortado pelo teto de exibição não virar botão clicável.

## Precedência dos motivos

Do mais absoluto para o mais circunstancial:

```
PAST  →  OUTSIDE_HOURS  →  APPOINTMENT  →  BLOCK
```

Passado vem primeiro porque nada o reverte. Depois o encaixe no expediente, que é
geometria. Só então os conflitos, que a barbearia pode mexer.

`APPOINTMENT` vence `BLOCK` quando os dois cobrem o mesmo horário, e isso é o
ponto: `blockId` só vem quando o motivo é `BLOCK`. Sem ele a tela não tem o que
liberar — e não pode oferecer um botão que apagaria a reserva de alguém.

## Bloquear é por intervalo, nunca por índice de slot

`ScheduleBlock` guarda `[startsAt, endsAt)` absolutos. Um bloqueio de 09:30–11:00
não coincide com nenhum início da grade de 40 min e ainda assim derruba 09:00,
09:40 e 10:20 — todos cujo intervalo **reservado** encosta nele. 11:00 fica livre:
o intervalo é meio-aberto.

Três formas, todas a mesma entidade:

- **um horário** — bloqueia `[início, início + reservedMinutes)`, exatamente o que
  um cliente ocuparia ali;
- **um intervalo** — início e fim informados;
- **o dia inteiro** — um bloqueio só, de meia-noite a meia-noite. Liberar depois é
  um clique, não quinze, e sobrevive a mudança de expediente.

## O que esta ferramenta não faz

**Nunca desfaz um agendamento.** A garantia é estrutural, não uma checagem que
alguém pode esquecer de repetir: `DELETE /admin/blocks/:id` procura em
`schedule_blocks`, e o id de um agendamento simplesmente não está lá — responde
404 e nada acontece.

**Bloquear não cancela.** Um horário já reservado continua reservado; tentar
bloquear um intervalo que já tem cliente responde `409`. Desmarcar o cliente é
uma decisão separada e passa pelo fluxo de cancelamento, que avisa quem ia ser
atendido.

## Autoria

`ScheduleBlock.createdById` vem da **sessão**, nunca do corpo da requisição: quem
bloqueou é um fato, não um campo que o cliente da API escolhe.

`onDelete: SetNull` — remover o admin que bloqueou não apaga o bloqueio. A decisão
sobrevive a quem a tomou; o horário continua bloqueado, só sem autor conhecido.

## Concorrência

A `EXCLUDE` do PostgreSQL cobre `PENDING`, `AWAITING_PAYMENT` e `CONFIRMED` sobre
`[starts_at, reserved_ends_at)`, então dois clientes no mesmo horário produzem
exatamente um vencedor.

Bloqueios e agendamentos também usam o mesmo advisory lock transacional por dia.
Depois de obter o lock, cada operação consulta novamente o outro tipo de intervalo
antes de gravar. Assim, quando admin e cliente agem ao mesmo tempo, exatamente
uma operação responde `201` e a outra responde `409`; nunca fica um estado
híbrido com bloqueio e agendamento sobrepostos.
