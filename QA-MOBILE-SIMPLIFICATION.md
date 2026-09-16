# Auditoria final — simplificação mobile

Data: 2026-09-15

## BRANCH

main. Base auditada: eadc88e. As 20 alterações locais existentes foram revisadas e preservadas quando adequadas; nenhuma foi descartada sem análise.

## ARQUIVOS AUDITADOS / MODIFICADOS

Diff final de código (20 arquivos):

- src/components/DemoNotice.tsx
- src/components/layouts/AdminLayout.tsx
- src/components/layouts/ClientLayout.tsx
- src/components/ui/Modal.tsx
- src/components/ui/button.tsx
- src/components/ui/card.tsx
- src/index.css
- src/pages/Landing.tsx
- src/pages/admin/Agenda.tsx
- src/pages/admin/AppointmentDetail.tsx
- src/pages/admin/ClientProfile.tsx
- src/pages/admin/Clients.tsx
- src/pages/admin/Dashboard.tsx
- src/pages/admin/Services.tsx
- src/pages/admin/Settings.tsx
- src/pages/client/Appointments.tsx
- src/pages/client/ClientHome.tsx
- src/pages/client/Login.tsx
- src/pages/client/Profile.tsx
- src/pages/client/Schedule.tsx

Também conferidos package.json, pnpm-lock.yaml e .mise.toml, sem alterações. Este relatório é o único novo arquivo versionado. Scripts de auditoria, resultados e screenshots ficaram em .tmp-qa, ignorado pelo Git.

## LANDING

APROVADA para demonstração. A alegação inicial de remoção dos depoimentos era incorreta: havia seção completa, estrelas, avaliações e contagem fictícia. Tudo foi removido. Serviços e informações úteis permanecem.

## HERO MOBILE

APROVADO. Chips removidos, CTA secundário removido, texto encurtado e glows do hero retirados. Monograma, título, texto curto, CTA principal e aviso discreto de demonstração. Agendar horário inteiramente visível mesmo com viewport de 640px de altura nas cinco larguras.

## DEPOIMENTOS

Removidos: SIM. Sem nomes, estrelas, notas ou contagem de clientes usados como prova social na landing. Os dados fictícios do painel continuam necessários para demonstrar a aplicação.

## HEADER MOBILE

APROVADO. Área Admin oculta no header abaixo de 640px; acesso discreto permanece no rodapé. Agendar é a ação principal.

## IDENTIDADE VISUAL

APROVADA. Preto, carvão, creme, bronze e dourado fosco. Botões principais e horário selecionado sem gradiente metálico ou glow; sombras escuras discretas preservadas. Tipografia e monograma mantidos.

## MOBILE

| Largura | Resultado |
| --- | --- |
| 360px | PASS |
| 375px | PASS |
| 390px | PASS |
| 412px | PASS |
| 430px | PASS |

140 verificações de páginas/estados em Edge/Chromium via Playwright, com viewport de 800px de altura e cadastro também em 400px. Sem overflow horizontal, controles cortados lateralmente ou botões abaixo dos limites verificados. Teste adicional em 640px para primeira dobra. Cabeçalho sticky e navegação inferior fixed confirmados pelo CSS computado; conteúdo final acessível acima da navegação após rolagem.

## FLUXO DE AGENDAMENTO

APROVADO como simulação. Landing → login → telefone → OTP → serviço → data → horário → confirmação → sucesso → reinício. Cadastro de novo usuário, colagem de OTP, próximos agendamentos, histórico, cancelamento e estado vazio após cancelar todos os próximos agendamentos validados.

## ÁREA ADMIN

APROVADA como simulação. Dashboard, agenda por dia/lista, detalhes, clientes/perfil, serviços e configurações. Verificados criação/edição/exclusão de serviço, campos inválidos, alteração de status, troca de parâmetros de rota, menu mobile e redimensionamento para desktop.

## ACESSIBILIDADE

135 execuções axe nos estados cobertos, com regras WCAG 2 A/AA, 2.1 AA e 2.2 AA, sem violações detectadas. Foco contido em diálogos, Escape, restauração de foco, labels e estados disabled verificados. Movimento reduzido respeitado. Links Agendar dos serviços agora têm altura mínima de 44px. OTP usa seis colunas flexíveis, sem exceder o painel em 360px. Isso não substitui uma certificação de acessibilidade nem testes em dispositivos físicos/leitores de tela.

## QUALITY GATES

- install: PASS — pnpm install --frozen-lockfile.
- lint: NOT CONFIGURED.
- typecheck: NOT CONFIGURED como script; verificação direta PASS: pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters.
- tests: NOT CONFIGURED como script; auditoria externa Playwright/axe PASS.
- build: PASS — pnpm build, Vite 8.0.5.
- Toolchain: Node 22.23.2 e pnpm 10.20.0 executados via npx; .mise.toml preservado com node 22 e npm:pnpm 10.20.0. O executável mise não foi usado.
- Diff: revisado; sem mudanças de dependências, lockfile ou inclusão de segredos, arquivos pessoais, node_modules, dist ou artefatos temporários.

## SCREENSHOTS

Capturados e inspecionados visualmente, disponíveis localmente:

- .tmp-qa/simplified-landing-390.png
- .tmp-qa/simplified-services-390.png
- .tmp-qa/simplified-booking-390.png
- .tmp-qa/simplified-login-390.png
- .tmp-qa/simplified-landing-desktop.png
- .tmp-qa/simplified-dashboard-desktop.png

Resultados estruturados: .tmp-qa/final-results.json. Scripts: brand-audit.cjs, edge-cases.cjs e simplified-check.cjs no mesmo diretório temporário. Uma asserção antiga de movimento reduzido foi adaptada à remoção do elemento animado; nova execução passou.

## CORREÇÕES REALIZADAS

- Remoção efetiva dos depoimentos, estrelas e prova social fictícia.
- Hero compacto, sem chips e com uma ação principal.
- Aviso visível informa que reservas não são salvas.
- Dourado fosco nos botões, navegação e horários selecionados.
- Classes relative conflitantes removidas do header sticky e nav fixed.
- Classe inválida de sombra/opacidade no dashboard corrigida.
- OTP adaptado à largura interna do novo painel.
- Área de toque dos links de serviços ampliada.

## PENDÊNCIAS

Backend, autenticação/OTP reais, autorização administrativa, persistência e reserva efetiva não fazem parte desta demonstração. Dados, datas e contatos são exemplos e precisam ser substituídos/validados antes de uso operacional. Links externos de contato não foram acionados. Safari/iOS e dispositivos físicos não foram testados.

## GIT

Este relatório acompanha o commit da auditoria. Hash e confirmação do push serão informados na entrega após a execução do Git, sem force push.

## RESULTADO FINAL

Pronto para deploy como demonstração frontend. Não pronto para operar agendamentos reais. Deploy não executado nesta tarefa.
