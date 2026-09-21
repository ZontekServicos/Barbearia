# Auditoria final — simplificação da landing

Data: 2026-09-21. Branch: main. Base: bba990a.

## Escopo e arquivos auditados

Diff inicial completo: somente src/pages/Landing.tsx (6 inserções, 20 remoções).
Inspecionados também src/App.tsx, src/index.css, src/pages/client/Login.tsx,
src/pages/client/Schedule.tsx, src/components/DemoNotice.tsx,
src/components/layouts/ClientLayout.tsx, src/components/ui/button.tsx,
package.json, tsconfig.json, vite.config.ts e .figma/make/site.json.
As rotas cliente e administrativas foram verificadas em navegador.

## Resultado e correção

- Landing aprovada: um h1, quatro h2 (Serviços, Como funciona, Horários e Localização), com h3 subordinados. Nenhum título duplicado.
- Textos restantes explicam a proposta e as etapas; serviços, preços, duração, funcionamento e localização permanecem. A ausência de título no CTA final não interrompe a hierarquia.
- Logo, fotografia, paleta e componentes preservados. Nenhum depoimento, avaliação fictícia, prova social, badge ou efeito adicional introduzido.
- Oito CTAs de agendamento testados individualmente em cada largura: todos abrem /login. Login simulado e agendamento completo aprovados.
- O login já tinha aviso de demonstração. No acesso direto ao agendamento, havia apenas o rótulo Confirmar simulação antes de concluir. Adicionado texto explícito de que nenhuma reserva será criada ou salva, imediatamente antes do botão, ligado por aria-describedby. Nenhuma alteração adicional na landing.

## Validação

Edge/Chromium via Playwright, build de produção servido localmente:

| Largura | Resultado |
| --- | --- |
| 360px | PASS |
| 375px | PASS |
| 390px | PASS |
| 412px | PASS |
| 430px | PASS |

105 verificações de páginas/estados: geometria, conteúdo renderizado e axe.
Sem overflow horizontal, controles cortados ou erros de console/runtime.
Capturas completas das cinco larguras revisadas visualmente; aviso de confirmação inspecionado em 360px.
Hero também aprovado em altura de 640px pelo script existente. Desktop 1440px sem overflow.

Rotas: /, /login, /client, /client/schedule, /client/appointments,
/client/profile, /admin, /admin/agenda, /admin/agenda/a1,
/admin/clients, /admin/clients/c7, /admin/services e /admin/settings.
Também testados IDs inexistentes e fallback /missing.

Acessibilidade: nenhuma violação automática nas regras WCAG A/AA configuradas no axe,
hierarquia da landing correta, foco visível por teclado, redução de movimento respeitada
e aviso associado ao botão. Alguns contrastes sobre fundos exigem avaliação manual
(regra color-contrast incompleta no axe); o resultado não equivale a certificação WCAG.

Typecheck: npx --no-install tsc --noEmit, exit 0 após a correção.
Build: npm run build, exit 0 após a correção.
Diff: git diff --check aprovado.

Não há suíte de testes versionada nem script test em package.json. Scripts QA locais
existentes executados com sucesso: primary-audit.cjs, simplified-check.cjs e edge-cases.cjs.
Auditoria complementar: .tmp-qa/hierarchy-audit.cjs; resultados e capturas em .tmp-qa,
ignorado pelo Git. A primeira execução teve uma expectativa incorreta de seis CTAs;
corrigida para os oito existentes, a execução completa passou.

## Limites e pendências

Nenhum bloqueio crítico encontrado no escopo da simplificação.
Safari/iOS, dispositivos físicos e leitor de tela real não foram testados.
Reservas, login e dados continuam demonstrativos; backend/persistência reais não integram esta alteração.
Contatos externos não foram acionados nem validados como dados operacionais.
Commit e push sem force serão registrados na entrega após sua execução.
