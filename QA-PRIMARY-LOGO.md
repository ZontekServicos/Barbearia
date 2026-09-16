# Auditoria e publicação da logo principal

Data: 2026-09-16. Branch: main. Base: 90e0503.

## Alterações auditadas

Landing.tsx passou a usar logo-principal.jpg na hero, manteve o monograma em elementos secundários, ajustou enquadramento/overlay e removeu o stacking context que isolava o blend da logo. Original preservado: SHA-256 769a51ba8487c359e1374cb69d68406f09c2b476053c2e344ab70524cafa2941, idêntico ao arquivo de origem indicado em Downloads.

## Resultado local

- Logo: PASS. JPEG 1024 × 1536, 259.395 bytes; exibido em recorte quadrado de 176px no mobile, sem deformação e sem caixa preta. Alt: ErickCorttes Barbearia.
- Fundo: PASS. interior.jpg, 1536 × 1024, 225.484 bytes; ambiente visível com overlay e texto legível. É imagem ilustrativa gerada por IA, não foto real do estabelecimento.
- Mobile: 360, 375, 390, 412 e 430px PASS. Screenshots reais inspecionados. CTA na primeira dobra inclusive com 640px de altura. Sem overflow horizontal.
- Assets: logo, interior e favicon retornam 200 e MIME correto; bytes idênticos ao fonte e dist. Favicon: 408 bytes.
- Fluxos: 140 verificações de páginas/estados PASS, incluindo login, OTP/cadastro, cliente, agendamento, confirmação/sucesso e admin.
- Acessibilidade: 135 verificações axe sem violações detectadas; teclado, Escape, contenção/restauração de foco e movimento reduzido verificados. Sem certificação WCAG completa.
- install: PASS — pnpm install --frozen-lockfile.
- typecheck: PASS — pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters.
- build: PASS — pnpm build.
- lint/test: NOT CONFIGURED como scripts. Testes externos Playwright/axe executados.
- pnpm 10.20.0 preservado, sem alterações de dependências.

## Problema confirmado no Railway

URL: https://barbearia-production-fe28.up.railway.app/

Antes do push, o HTML carregava index-DgxfH9-H.js, correspondente à versão com fundo. O endpoint /brand/interior.jpg retornava status 200 e MIME image/jpeg, mas apenas 131 bytes de texto de ponteiro Git LFS. A imagem falhava ao decodificar no navegador. Logo principal ainda ausente: seu endpoint retornava fallback HTML, não JPEG. Portanto, o fundo ausente não era explicado somente por um build antigo.

## Correção de publicação

Adicionadas exceções específicas em .gitattributes para PNG/JPG/JPEG de public/brand. Arquivos dessa pasta passam a ser binários Git comuns, preservando conteúdo. Regras LFS do restante do projeto permanecem. Os quatro assets anteriormente rastreados em LFS foram renormalizados; a nova logo também será versionada diretamente. Isso permite que os arquivos entregues ao build Railway contenham as imagens, sem depender de git lfs pull. Histórico LFS não foi reescrito; git lfs fsck passou.

## Diff final

Landing.tsx, .gitattributes, nova logo, quatro assets migrados de ponteiro LFS para binário e este relatório. Sem .env, secrets, logs, caches, dist, node_modules ou screenshots temporários. Screenshots e scripts locais em .tmp-qa, ignorado pelo Git.

## Publicação

Commit único e push normal para main após aprovação local. A versão publicada será verificada após o push: assets por MIME/hash, decodificação no navegador, logo, fundo, CTA e hash do bundle. Hash do commit e resultado do deploy constarão na entrega. Logs privados do Railway não estão disponíveis nesta sessão.

## Limites

Demonstração frontend; backend, autenticação real e reservas persistidas continuam pendentes. Caminhos absolutos adequados à implantação atual na raiz do domínio. Safari/iOS e aparelhos físicos não testados. A aprovação local não substitui a verificação pública após o deploy.
