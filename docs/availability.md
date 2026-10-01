# Disponibilidade e bloqueios

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
