# Auditoria final de marca e assets

Data: 2026-09-16

## BRANCH / ÚLTIMO COMMIT INICIAL

main; b7e2caa — style: simplify landing and refine branded mobile experience.

Estado inicial: alterações locais em .figma/make/site.json, src/components/DemoNotice.tsx e src/pages/Landing.tsx; três PNGs novos em public/brand. Diff completo revisado antes de editar. Nenhuma alteração foi descartada sem análise.

## ASSETS ENCONTRADOS

| Arquivo | Bytes | Dimensões | Uso final |
| --- | ---: | --- | --- |
| Front.png | 1.675.384 | 941 × 1672 | Referência visual preservada |
| icone.png | 343.876 | 570 × 430 | Prancha de referência preservada |
| dividir.png | 1.755.727 | 1254 × 1254 | Sistema de marca preservado |
| favicon.svg | 408 | viewBox 40 × 40 | Favicon compacto derivado do monograma SVG já usado pela aplicação |
| interior.jpg | 225.484 | 1536 × 1024 | Novo fundo decorativo do hero |

Todos os cinco arquivos retornaram HTTP 200 com MIME correto. Conteúdo servido e cópia no dist conferidos byte a byte com public/brand. Nenhuma referência quebrada detectada. Originais PNG não alterados.

## FRONT.PNG

Interpretado como referência de ambiente e composição: barbearia escura, cadeira de couro, luz quente, profundidade, dourado e tipografia serifada. A implementação inicial tinha somente gradientes e um monograma pequeno; não transmitia suficientemente o ambiente da referência.

Correção: fundo próprio gerado por IA a partir da referência, sem textos, logotipos ou interface rasterizados. JPEG otimizado, overlay escuro, recorte responsivo com object-cover, marca maior e wordmark em HTML. A imagem é ilustrativa, não uma fotografia do estabelecimento real. Headline, texto de apoio e CTA permanecem textos acessíveis. Proximidade visual aprovada como interpretação da referência, sem alegar reprodução exata do emblema ou da tipografia proprietária.

## ICONE.PNG

A imagem contém título de documentação e legenda em torno do ícone. Não é adequada como favicon reduzido. Substituída por SVG compacto baseado no monograma EC existente. Original preservado. A imagem também foi retirada do Open Graph por ser uma prancha, não uma peça de compartilhamento. Metadados de título/descrição permanecem; não há imagem OG personalizada nesta entrega. Não existe suporte PWA/manifest neste projeto.

## DIVIDIR.PNG

Referência de dourado, molduras circulares, letras serifadas, monograma e wordmark. A UI mantém a versão vetorial simplificada EC para tamanhos pequenos. Não foi renderizada a prancha completa nem recriado um falso arquivo oficial de marca.

## LANDING

PASS. Header → hero → serviços → Como funciona → informações → CTA final. Sem depoimentos, avaliações, avatares ou contagem fictícia de clientes. Área Admin continua oculta no header mobile e discreta no desktop/rodapé.

## HERO

PASS. Headline e apoio conforme solicitados, marca ampliada e único CTA principal. Sem chips e sem CTA secundário concorrente. CTA inteiro na primeira dobra, inclusive em viewport com 640px de altura nas cinco larguras.

## SERVIÇOS

PASS. Nome, descrição, duração, preço e link Agendar presentes; altura de toque de 44px preservada.

## COMO FUNCIONA

PASS. Exatamente três passos: Escolha o serviço; Selecione o horário; Confirme. Layout compacto no mobile. Corrigidas promessas de agenda em tempo real e confirmação efetiva: os textos agora descrevem a simulação.

## LOGIN / AGENDAMENTO / ADMIN

PASS como demonstração. Telefone, OTP, colagem de código, cadastro, serviço, data, horário, confirmação, sucesso e reinício verificados. Horários ocupados verificados como disabled, com nome acessível indisponível e texto riscado; seleção de horário livre habilita Continuar. Também voltar entre etapas, cancelamento, histórico, estado vazio, modais, foco e menu mobile.

Dashboard, agenda por dia/lista, detalhes, clientes/perfis, serviços e configurações passaram. Criação/edição/exclusão de serviços, validação de campos/horários e troca de parâmetros de rota verificadas. Dados e ações continuam simulados; a agenda administrativa usa fixtures de setembro de 2026.

## MOBILE

| Largura | Resultado |
| --- | --- |
| 360px | PASS |
| 375px | PASS |
| 390px | PASS |
| 412px | PASS |
| 430px | PASS |

140 verificações de páginas/estados em Edge/Chromium via Playwright. Sem overflow horizontal ou controles cortados lateralmente nos cenários testados. Cadastro também testado com 400px de altura. Nav fixed, header sticky e espaço para conteúdo final verificados. Safe-area CSS preservada; notch físico e Safari/iOS não foram testados.

## ACESSIBILIDADE

135 execuções axe nos estados cobertos, sem violações detectadas nas regras WCAG 2 A/AA, 2.1 AA e 2.2 AA. Teclado, Escape, contenção/restauração de foco, campos rotulados e movimento reduzido verificados. Imagem de fundo decorativa tem alt vazio e aria-hidden. Overlay reforça contraste sobre a fotografia; avaliação visual complementar realizada. Não representa certificação WCAG completa nem teste com leitor de tela físico.

## PERFORMANCE / ASSETS

Os três PNGs originais somam 3.774.987 bytes (3,77 MB decimais), confirmando aproximadamente o relato inicial. Continuam incluídos no dist por estarem em public, mas não são requisitados pela landing. Preservá-los é aceitável neste escopo e evita perda das referências.

Total de public/brand após os ajustes: 4.000.879 bytes. Rede da landing confirmou apenas interior.jpg (225.484 bytes) e favicon.svg (408 bytes) entre assets de marca. Fundo com dimensões explícitas, prioridade alta e sem dependência nova. Sem medição em conexão móvel física; valores de tamanho não equivalem a uma certificação de Core Web Vitals.

## QUALITY GATES

- install: PASS — pnpm install --frozen-lockfile.
- lint: NOT CONFIGURED.
- typecheck: PASS — pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters; não existe script typecheck.
- tests: NOT CONFIGURED como script; auditoria externa Playwright/axe PASS.
- build: PASS — pnpm build.
- Toolchain: Node 22.23.2 e pnpm 10.20.0 via npx. .mise.toml preservado; mise não executado.
- Dependências e lockfile: sem alterações.

## SCREENSHOTS

Capturados e inspecionados localmente em .tmp-qa (não versionado): simplified-landing-390.png, simplified-services-390.png, simplified-booking-390.png, simplified-login-390.png, asset-landing-desktop.jpg, simplified-dashboard-desktop.png e how-it-works.png. Resultados em final-results.json e asset-results.json.

## PROBLEMAS ENCONTRADOS / CORREÇÕES

- Hero sem ambiente próximo da referência → imagem de barbearia própria, overlay e hierarquia de marca.
- Prancha usada como favicon/OG → favicon compacto e remoção da imagem OG inadequada.
- Promessas incompatíveis com mock → textos honestos em Como funciona.
- Seção explicativa longa no mobile → passos compactos e alinhados à esquerda.

## PENDÊNCIAS

Os PNGs e o JPEG seguem as regras Git LFS existentes. O ambiente de build deve baixar os objetos LFS (git lfs pull) antes de compilar; caso contrário, receberá ponteiros em lugar de imagens.

Imagem OG dedicada opcional depende de peça apropriada e URL pública definida. PWA não implementada. Backend, autenticação/OTP reais, autorização administrativa, persistência, disponibilidade real e contatos/dados definitivos continuam fora do escopo. Não usar como sistema operacional de reservas.

## GIT

Arquivos finais: três arquivos de código/configuração previamente alterados, três PNGs originais, favicon.svg, interior.jpg e este relatório. Diff revisado. Nenhum .env, segredo, cache, log, node_modules, dist ou screenshot temporário incluído. Commit único e push normal para main após os gates; hash e resultado serão informados na entrega.

## RESULTADO FINAL

Pronto para deploy como demonstração frontend. Não pronto para operar agendamentos reais. Deploy não realizado nesta tarefa.
