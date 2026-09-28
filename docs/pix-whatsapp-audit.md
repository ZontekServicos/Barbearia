# Auditoria final — confirmação de Pix via WhatsApp

Data: 28/09/2026. Base auditada: b8d0074, branch main. O código e o diff foram
inspecionados diretamente, sem usar relatórios anteriores como evidência.

## Achados corrigidos

1. **Alta — confirmação após expiração:** a rota administrativa aceitava PAID
   depois do prazo enquanto a limpeza ainda não tivesse persistido EXPIRED.
   Impacto: reativação de uma reserva que o cliente já via como vencida.
   Corrigido em [payment.service.ts](../server/src/modules/payment/payment.service.ts#L373):
   HTTP 409 ao vencer qualquer prazo; cobranças EXPIRED/CANCELED também recusadas.
   Testes verificam ausência de alterações no pagamento, reserva e auditoria.
2. **Alta — pagamento oferecido após o prazo:** a consulta pública verificava
   somente o prazo da reserva, e o navegador mantinha QR/CTAs durante a
   reconsulta. Impacto: incentivo a pagar uma cobrança vencida.
   Corrigido em [public-booking.service.ts](../server/src/modules/booking/public-booking.service.ts#L351)
   e [BookingStatus.tsx](../src/pages/client/BookingStatus.tsx#L412).
   Testes cobrem os dois prazos separadamente, igualdade exata ao prazo e API
   lenta/indisponível quando o contador chega a zero.
3. **Média — teste sem clique real:** o teste anterior usava click({ trial: true })
   e removia o target do link. Não exercitava a ação do usuário.
   Substituído por três cliques reais, interceptando o destino WhatsApp no browser,
   contagem das aberturas e captura de todos os verbos de escrita na API.
   [booking.spec.ts](../tests/browser/booking.spec.ts#L1649).
4. **Baixa — instrução indisponível e legibilidade mobile:** sem número configurado,
   o texto ainda mandava enviar confirmação pelo WhatsApp. Agora apresenta a
   orientação de aguardar a barbearia. O CTA aceita quebra de linha e mantém
   altura mínima de 44px.

## Gates funcionais e de segurança

| Gate | Resultado e evidência |
| --- | --- |
| CTA | Disponível apenas em AWAITING_PAYMENT + PENDING + Pix estático, com WhatsApp/referência e prazo válido. Matriz de 8 estados de agendamento × 5 estados de pagamento. PIX_MANUAL corresponde ao provider persistido static-pix nesta arquitetura. |
| STATE SAFETY | Consultas repetidas preservam estados, paidAt=null, updatedAt da reserva/cobrança e contagem de auditoria. Cliques reais só abrem WhatsApp; nenhum POST/PATCH/PUT/DELETE de API é emitido. |
| PUBLIC PAYMENT SECURITY | 60 tentativas com quatro verbos, três estados (PAID/CONFIRMED/RECEIVED) e cinco caminhos não obtêm sucesso nem alteram o banco. As rotas administrativas exigem sessão/papel; webhook exige configuração/assinatura do provedor. |
| MESSAGE | Cliente, serviço, data, início/fim, valor e referência pública vêm do backend/banco. O texto solicita conferência, sem afirmar pagamento ou agendamento confirmado. |
| VALUE | R$ 40,00 e R$ 120,50 verificados em integração. Alterar o catálogo depois da cobrança e enviar valor adulterado na query não muda o valor da mensagem. |
| WHATSAPP DESTINATION | Exclusivamente BARBERSHOP_WHATSAPP_NUMBER. +5571999990000 vira 5571999990000; o telefone do cliente não define o destino. |
| SECURITY | Testes excluem publicToken, contactHandle, appointmentId, paymentId, providerPaymentId, userId, JWT, refresh token, chave Pix, BR Code, DATABASE_URL, webhook/provider secrets e UUID interno. Também testada a exclusão de campos privados extras do objeto de entrada. |
| CLICK EXPLÍCITO / DUPLO CLIQUE | Carregamento: zero window.open. Cada clique: uma chamada com noopener,noreferrer; popup tem opener=null. Três cliques não escrevem na API. Sem lock financeiro. |
| COMPROVANTE | Nenhuma rota ou dependência de upload foi criada. Anexo manual fica dentro do WhatsApp. |
| DYNAMIC PROVIDER | CTA manual ausente com payload válido, inválido ou inexistente do provedor, mesmo com chave estática configurada. Frontend também oculta URL manual residual no Pix dinâmico. Texto de confirmação automática preservado. |
| EXPIRATION | QR, chave, Copia e Cola, checkout e CTAs somem ao zerar o contador. Backend considera prazo da cobrança e da reserva. ADMIN não reativa reserva vencida. |
| ADMIN CONFIRMATION | Sem sessão: 401; CUSTOMER: 403; ADMIN ativo, Pix manual e janela válida: PAID + CONFIRMED. A consulta atualizada remove todos os controles de pagamento e apresenta o WhatsApp final. |
| MOBILE | 360, 375, 390, 412 e 430px: sem overflow; QR, Copia e Cola e CTAs dentro da viewport; alvos >=44px. Captura de 360px também revisada visualmente. |
| SEM PAGAMENTO | Sem configuração Pix/provedor: PENDING → aprovação ADMIN → CONFIRMED, sem cobrança, Pix ou pixPaidUrl. |

## Validação executada

- Backend completo: **408/408**, zero falhas/pulos, incluindo integrações reais.
- Revalidação final dos três arquivos backend de teste alterados: **109/109**,
  incluindo três casos adicionais de valores/segredos. Não somar as duas execuções:
  há testes repetidos entre elas.
- Frontend: **28/28**.
- Browser: **107/107 executados**, zero falhas; 1 teste histórico de reprodução
  de bug anterior desabilitado por configuração (LEGACY_AGENDA_REF).
- Typecheck: frontend e backend aprovados.
- Build: frontend e backend aprovados. O Vite informa um aviso não bloqueante de
  import estático/dinâmico de admin-booking.ts, fora desta funcionalidade.
- pnpm audit --prod: frontend e backend sem vulnerabilidades conhecidas na consulta.
- git diff --check: aprovado. Varredura do diff sem credenciais detectadas, incluindo
  comparação com valores sensíveis locais sem imprimi-los.

As integrações usam PostgreSQL 18 descartável, banco erickcorttes_test,
exclusivamente em 127.0.0.1:55439. Nenhum banco remoto foi acessado. Browser usa
Chromium com API simulada; a integridade persistida é verificada separadamente
contra a API e o PostgreSQL reais. O destino WhatsApp é interceptado nos testes:
nenhuma mensagem foi enviada e nenhum dinheiro foi movimentado.

Os testes antigos de navegador tinham 11 falhas de textos/seletor/fixture
incompatíveis com a UI vigente. As expectativas foram atualizadas mantendo os
asserts de estado, ausência de confirmação pública e ausência de overflow.

Evidências locais: .tmp-pix-whatsapp-audit/ (logs e capturas; ignorada pelo Git).

## Publicação e pendências

Todos os gates críticos passaram; nenhum bloqueador conhecido permanece no escopo.
Commit e push normal para main autorizados pelo pedido e liberados pela auditoria.
O hash e o resultado do push serão informados na entrega, evitando um hash
circular dentro do próprio commit. Não haverá deploy manual nem alteração no
Railway. Os três documentos não rastreados preexistentes permanecem preservados
fora deste commit.
