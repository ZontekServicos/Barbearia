# Validação de QA — 2026-09-15

## Estado inicial

- Branch: `main`.
- Commit inicial: `9af3201` (`first commit`).
- Árvore de trabalho limpa; `git fetch origin` e comparação com `origin/main`: 0 commits de diferença.

## Toolchain e quality gates

- `.mise.toml`: mantido Node `22`; alterado exclusivamente `"npm:pnpm"` de `10.34.3` para `10.20.0`.
- Validação executada com Node `22.23.2` e pnpm `10.20.0`, disponibilizados por `npx --package=node@22 --package=pnpm@10.20.0 --call "..."`.
- `mise install`: não executado, pois mise não está instalado no ambiente Windows. A instalação pelo backend do mise e a evidência de trusted publisher no ambiente de deploy não foram verificadas localmente.
- `pnpm install --frozen-lockfile`: passou. `package.json` e `pnpm-lock.yaml` preservados.
- Lint: não há script nem configuração de linter. O script `format` é um formatador, não um linter.
- Typecheck: não há script; executado `pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters`, sem erros.
- Testes: não há suíte/script no projeto. Foram executadas verificações temporárias com Playwright e Edge, sem adicionar dependências ou scripts ao projeto.
- `pnpm build`: passou com Node 22 e pnpm 10.20.0.
- `git diff --check`: passou.

## Correções

- Imports e variáveis não utilizados removidos.
- Agenda: botões de semana funcionais, título acompanha a semana e lista inclui todas as datas dos dados existentes. Removida ordenação que mutava o array compartilhado sem uso.
- Agendamento: botão de novo agendamento reinicia todas as seleções.
- Serviços: editar não reativa serviço inativo; preço aceita centavos.
- Mobile: horários das configurações quebram linha, ações de cancelamento empilham, cabeçalhos permitem quebra.
- Acessibilidade: labels vinculados aos inputs, descrição de erros e nomes acessíveis em controles; menu fechado deixa de receber foco; estados dos controles de configuração expostos.
- Configurações: controle de permissão de cancelamento alterna o estado local, seguindo o comportamento demonstrativo da tela.
- URLs desconhecidas mostram página de recuperação.
- Metadados corrigidos para a barbearia, idioma pt-BR e favicon sem recurso inexistente.

## Navegador

- 15 URLs verificadas em 360, 390 e 430 px (45 combinações): todas renderizaram; nenhuma apresentou overflow horizontal do documento ou elementos medidos além da borda direita da viewport.
- URLs: `/`, `/login`, `/client`, `/client/schedule`, `/client/appointments`, `/client/profile`, `/admin`, `/admin/agenda`, `/admin/agenda/a1`, `/admin/agenda/missing`, `/admin/clients`, `/admin/clients/c7`, `/admin/clients/missing`, `/admin/services`, `/admin/settings`.
- Fluxos verificados: agendamento demonstrativo até confirmação e reinício; próxima/anterior semana; listagem dos 12 agendamentos; edição de serviço inativo com preço decimal; modal de cancelamento em 360 px; login demonstrativo; alternância de configuração; navegação pelo menu mobile; recuperação de URL desconhecida.
- Execução final sem erros de console ou exceções de página.
- Verificação de layout baseada em geometria do DOM; não representa auditoria visual exaustiva nem conformidade integral de acessibilidade.

## Limitações existentes e prontidão

O build do frontend demonstrativo está validado. A aplicação não está pronta para operar agendamentos reais:

- Login/OTP simulados; não há autenticação, autorização do admin ou envio de WhatsApp.
- Agendamento apenas mostra confirmação; não grava uma reserva nem sincroniza com a lista.
- Cancelamentos, serviços, bloqueios, observações e configurações usam estado local e não persistem entre telas/recarregamentos.
- Dados e parte das datas são fixos em setembro de 2026. Disponibilidade, duração, conflitos, horários passados e regras de cancelamento não são validados por um backend.
- Atalhos de novo cliente/agendamento administrativo apenas abrem listas; não há fluxo de cadastro correspondente.
- Contatos, depoimentos e identidade comercial são dados de demonstração.
- Dois usos de `any` permanecem no adaptador WebSocket de desenvolvimento do scaffold Figma; não participam do build de produção.
- O host de produção precisa servir `index.html` nas rotas do BrowserRouter. O teste local usou Vite preview; não foi realizado deploy nem verificado o roteamento do host remoto.

Implementar backend, persistência e autenticação exigiria ampliar o escopo além desta correção de toolchain e QA. Nenhuma dessas capacidades é considerada validada por este relatório.

## Revisão de arquivos

Arquivos de build, dependências e ferramentas temporárias de QA permanecem ignorados. Nenhum `.env` está incluído. A busca por padrões comuns de credenciais não encontrou ocorrências nos arquivos do projeto revisados; não substitui uma auditoria de segurança.

Arquivos alterados: `.mise.toml`, `.figma/make/site.json`, `src/App.tsx`, `src/components/layouts/AdminLayout.tsx`, `src/components/ui/input.tsx`, `src/pages/admin/Agenda.tsx`, `src/pages/admin/AppointmentDetail.tsx`, `src/pages/admin/ClientProfile.tsx`, `src/pages/admin/Clients.tsx`, `src/pages/admin/Dashboard.tsx`, `src/pages/admin/Services.tsx`, `src/pages/admin/Settings.tsx`, `src/pages/client/Appointments.tsx`, `src/pages/client/ClientHome.tsx`, `src/pages/client/Login.tsx`, `src/pages/client/Profile.tsx`, `src/pages/client/Schedule.tsx` e este relatório.
