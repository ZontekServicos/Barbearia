# Auditoria final — ERICKCORTTES BARBEARIA

## BRANCH

`main`

## ÚLTIMO COMMIT ANALISADO

`7e392cb` — `fix: pin pnpm 10.20.0 and resolve frontend QA issues`.

Estado inicial: cinco arquivos rastreados modificados e `src/components/Logo.tsx` novo. Alterações locais de identidade visual, sem alterações de dependências. `git fetch origin` confirmou `HEAD` e `origin/main` sincronizados. As mudanças locais de marca, logo, cores e Instagram foram preservadas.

## ARQUIVOS AUDITADOS

- Diff recente completo: `src/components/Logo.tsx`, `src/components/layouts/AdminLayout.tsx`, `src/components/layouts/ClientLayout.tsx`, `src/index.css`, `src/pages/Landing.tsx`, `src/pages/admin/Settings.tsx`.
- Fluxos e componentes relacionados: `src/App.tsx`, páginas de cliente e administrador, componentes de UI, `src/data/mock.ts`, `src/lib/utils.ts`.
- Configuração: `.mise.toml`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.figma/make/site.json`, `.gitignore` e scripts de deploy do scaffold.
- Novos componentes revisados: `DemoNotice`, `Modal`, `Switch` e `Logo`.

## PROBLEMAS ENCONTRADOS E CORREÇÕES

| Problema | Correção |
|---|---|
| Marca antiga nos metadados após a atualização visual | Título e descrição atualizados para ErickCorttes |
| Serviço inativo com texto em contraste de aproximadamente 2,93–3,86:1 | Removida opacidade global do card; status textual preservado |
| Nomes cortados na agenda em 360 px | Cards permitem quebra e reservam espaço legível para o cliente |
| Controles pequenos no toque; foco de botão dependia de token não configurado | Áreas ampliadas, mínimo de altura de 44 px em ponteiro coarse e foco explícito |
| Modais sem semântica/foco/Escape; menu permitia fuga do foco | Diálogos nativos, ciclo de Tab/Shift+Tab, Escape, retorno ao acionador e fechamento do menu pelo fundo |
| Menu aberto ao passar para desktop | Fecha automaticamente na mudança do breakpoint |
| Estado de cliente/atendimento anterior podia aparecer ao trocar o parâmetro da rota | Conteúdo reiniciado por ID |
| Cancelamento local removia item sem atualizar histórico | Item passa ao histórico local como cancelado |
| Login dizia enviar OTP; agendamento e configurações diziam salvar dados reais | Aviso de demonstração, confirmação explicitamente simulada e mensagens sem promessa de envio/gravação |
| Atalhos “Novo cliente/agendamento” apenas abriam listas | Rótulos corrigidos para o destino efetivo |
| Nome de serviço só com espaços; formulário de horários aceitava fechamento anterior | Validação de nome, campos numéricos e intervalo de funcionamento |
| OTP não permitia colar o código inteiro; telefone vazio virava parêntese | Colagem de 6 dígitos, limpeza com foco e tratamento de valor vazio |
| Navegação de retorno durante confirmação assíncrona | Retorno bloqueado enquanto a simulação está pendente |
| Estado selecionado e rota ativa expostos apenas visualmente | `aria-pressed`, `aria-current`, rótulos de datas/horários e switches semânticos |
| Tipo de status duplicado | UI reutiliza o tipo definido nos dados |

## DESIGN SYSTEM

Identidade preservada: preto, carvão quente, creme e dourado como destaque. Capturas revisadas visualmente: landing, seleção de serviço e administração de serviços. Logo reutilizado; SVG decorativo oculto de leitores de tela. Cards e controles compartilham tokens. Não houve redesign da aplicação. O token `--primary-dark` adicionado na implementação original foi preservado, embora ainda não seja utilizado.

## MOBILE

| Largura | Resultado |
|---|---|
| 360 px | PASS |
| 375 px | PASS |
| 390 px | PASS |
| 412 px | PASS |
| 430 px | PASS |

140 verificações: 28 páginas/estados em cada largura, executadas com Playwright e Microsoft Edge, em contexto de toque/mobile. Incluem 16 rotas, etapas do agendamento, modais, menu, lista da agenda, OTP, cadastro e cadastro com viewport de 400 px de altura. Sem overflow horizontal do documento ou controles fora da viewport nos cenários medidos. Botões visíveis têm altura mínima medida de 44 px no contexto de toque; não se afirma que todos tenham largura de 44 px.

Navegação inferior recebe espaço de safe area. Testada também transição para desktop em 1280 px. Input de endereço pode rolar seu próprio texto para edição, comportamento normal de input de uma linha.

Limites: emulação Chromium, sem aparelho físico, sem teclado virtual real e sem Safari/iOS. A viewport reduzida não equivale a validar todos os comportamentos do teclado de cada sistema.

## ACESSIBILIDADE

- Axe-core executado com regras marcadas WCAG A/AA, 2.1 AA e 2.2 AA: zero violações detectadas em 135 estados; os cinco cenários extras com altura reduzida tiveram validação geométrica e interação.
- Verificados Tab/Shift+Tab, Escape, retorno do foco, clique no fundo do menu, foco visível e movimento reduzido.
- Modais cabem na viewport e permitem rolagem vertical.
- Estados não dependem exclusivamente de cor: rótulos de status, posição do switch e atributos acessíveis.
- Não representa certificação WCAG nem auditoria integral com leitor de tela.

## FLUXOS

- PASS: landing → serviço → data → horário → confirmação simulada → sucesso → reinício.
- PASS: telefone → OTP → cliente existente; telefone com `8888` → cadastro demonstrativo; colagem de OTP.
- PASS: próximos e histórico; cancelamento local e retorno do foco. Não existe página exclusiva de detalhes de agendamento do cliente; os dados disponíveis são apresentados nos cards.
- PASS: dashboard → agenda/lista → atendimento → cliente; troca de IDs sem vazamento de estado; serviços e configurações.
- PASS: criação, edição com centavos e preservação de inativo, exclusão de serviço; nome inválido rejeitado.
- PASS: configurações com horário inválido não exibem sucesso; alteração válida informa explicitamente que não foi gravada.
- Login administrativo: NOT IMPLEMENTED. Não foi criado um controle de acesso fictício no frontend.
- Sem erros de console ou exceções de página nos testes finais.

## REGRAS DE AGENDAMENTO E INTEGRAÇÃO

| Regra | Estado atual |
|---|---|
| Duração por serviço | Exibida; não governa a disponibilidade real |
| Horários ocupados/bloqueados | Fixtures filtram inícios exatos; não existe autoridade de disponibilidade |
| Fechamento e datas passadas | Calendário impede dias passados e domingo/segunda na demonstração |
| Conflitos e sobreposição por duração | Não implementados em servidor; não validados para reservas reais |
| Limite de agendamentos ativos | Campo demonstrativo; não aplicado por backend |
| Cliente bloqueado | Estado local administrativo; não vinculado a uma identidade autenticada |
| Cancelamentos e faltas | Simulados; sem política de backend ou persistência compartilhada |
| Histórico | Fixtures e alterações locais desta tela; não histórico persistido |

Fixtures permanecem isolados em `src/data/mock.ts`, com tipos explícitos e aviso de que não são autoridade de reservas. Nenhuma regra crítica foi apresentada como garantida pelo frontend. Antes de habilitar reservas reais, o backend autenticado deve validar disponibilidade, duração, sobreposição, bloqueios, limites e cancelamento de forma atômica; a UI deve tratar sucesso, conflito e erro a partir da resposta do servidor.

## QUALITY GATES

- **install: PASS** — Node `22.23.2`, pnpm `10.20.0`, `pnpm install --frozen-lockfile`.
- **lint: NOT CONFIGURED** — não existe script/configuração de linter; `format` não é lint.
- **typecheck: PASS** — sem script dedicado, executado `pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters`.
- **tests: NOT CONFIGURED** — não há suíte no repositório. Verificações temporárias de navegador: PASS (140 estados e casos adicionais descritos acima).
- **build: PASS** — `pnpm build`, produção, Node 22 e pnpm 10.20.0.
- `.mise.toml` preservado: `node = "22"`, `"npm:pnpm" = "10.20.0"`.
- `mise install`: indisponível neste computador; execução equivalente via `npx --package=node@22 --package=pnpm@10.20.0 --call "..."`.
- `package.json` e `pnpm-lock.yaml` sem alterações.
- Artefatos de QA, dependências e build ficam em caminhos ignorados; nenhuma dependência de teste adicionada ao projeto.

## PENDÊNCIAS

- Backend, persistência, autenticação/OTP real, login e autorização administrativa.
- Disponibilidade, conflitos e demais regras de negócio no servidor.
- Dados, datas de referência, contatos e depoimentos de demonstração precisam ser substituídos antes de operação real.
- Validar Safari/iOS, dispositivos físicos, teclado virtual e leitor de tela.
- Confirmar instalação pelo mise e deploy remoto. O host deve suportar fallback de rotas para `index.html`.
- Dois `any` do adaptador WebSocket de desenvolvimento do scaffold Figma permanecem; nenhum `any` no código de aplicação.

## RESULTADO FINAL

Aprovado tecnicamente para publicação do **frontend demonstrativo**, com limitações explícitas e sem regressões críticas identificadas nos cenários testados. **Não aprovado como sistema de agendamento operacional**: as integrações e regras de servidor continuam pendentes. Nenhum deploy remoto foi realizado ou certificado por esta auditoria.
