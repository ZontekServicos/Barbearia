import { useState } from 'react'
import { Copy, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PixView } from '@/services/public-booking'

/**
 * Seção de pagamento via Pix.
 *
 * Tudo vem pronto do backend: payload, QR e valor. Esta tela não calcula
 * dinheiro nem monta BR Code — só desenha e copia.
 *
 * O que ela deliberadamente NÃO tem: botão "já paguei". Nada aqui muda o estado
 * do pagamento, porque nada no navegador pode. No Pix estático quem confirma é
 * a barbearia conferindo o extrato; no dinâmico, a notificação do provedor.
 */

/**
 * Copia para a área de transferência com alternativa quando a API não está
 * disponível.
 *
 * `navigator.clipboard` exige contexto seguro e pode ser bloqueado; em HTTP
 * local ou WebView antiga ela simplesmente não existe. A alternativa é um
 * `textarea` fora da tela com `execCommand`, que ainda funciona nesses casos.
 * Falhando os dois, o valor continua visível para copiar à mão — e a tela diz
 * isso em vez de mentir que copiou.
 */
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Bloqueada: cai na alternativa abaixo.
  }
  try {
    const field = document.createElement('textarea')
    field.value = value
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(field)
    return copied
  } catch {
    return false
  }
}

/** Botão que confirma o que aconteceu, inclusive quando não deu. */
function CopyButton({
  label,
  copiedLabel,
  value,
  variant = 'outline',
}: {
  label: string
  copiedLabel: string
  value: string
  variant?: 'default' | 'outline'
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function handle() {
    const copied = await copyText(value)
    setState(copied ? 'copied' : 'failed')
    setTimeout(() => setState('idle'), 2500)
  }

  return (
    <div>
      <Button variant={variant} className="w-full h-11" onClick={() => void handle()}>
        <Copy className="h-4 w-4 mr-2" />
        {state === 'copied' ? copiedLabel : label}
      </Button>
      {state === 'failed' && (
        <p role="status" className="mt-2 text-xs text-[var(--muted-foreground)]">
          Não foi possível copiar automaticamente. Selecione o texto acima e copie.
        </p>
      )}
      {state === 'copied' && (
        <p role="status" className="sr-only">
          {copiedLabel}
        </p>
      )}
    </div>
  )
}

export default function PixPayment({
  pix,
  amountFormatted,
}: {
  pix: PixView
  amountFormatted: string
}) {
  return (
    <section
      aria-labelledby="pix-heading"
      className="rounded-2xl border border-[var(--primary)]/30 bg-[var(--surface-bronze)] p-4 space-y-4"
    >
      <header className="text-center">
        <h2
          id="pix-heading"
          className="font-display text-sm font-semibold tracking-[0.18em] uppercase text-[var(--primary)]"
        >
          Pague via Pix
        </h2>
        <p className="mt-1 font-display text-2xl font-bold tracking-tight">
          R$ {amountFormatted}
        </p>
      </header>

      {/*
        QR gerado no backend a partir do BR Code. Vem como SVG e escala pelo
        CSS, então fica nítido de 360px ao desktop sem imagem rasterizada.

        `dangerouslySetInnerHTML` com SVG da nossa própria API: o conteúdo é
        gerado pelo servidor a partir de dados do banco, não de entrada de
        usuário — não há caminho por onde alguém injetar markup aqui.
      */}
      <figure className="mx-auto w-full max-w-[220px]">
        <div
          role="img"
          aria-label="QR Code para pagamento via Pix"
          className="rounded-xl bg-white p-3 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: pix.qrCodeSvg }}
        />
        <figcaption className="mt-2 flex items-center justify-center gap-1.5 text-xs text-[var(--muted-foreground)]">
          <QrCode className="h-3.5 w-3.5" />
          Escaneie no aplicativo do seu banco
        </figcaption>
      </figure>

      {/* Chave só existe no Pix estático da barbearia. */}
      {pix.key && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--muted-foreground)]">
            Chave Pix
            {pix.receiverName && (
              <>
                {' · '}
                <span className="text-[var(--foreground)]">{pix.receiverName}</span>
              </>
            )}
          </p>
          <p className="font-mono text-sm break-all rounded-lg bg-black/30 px-3 py-2 text-[var(--foreground)]">
            {pix.keyMasked ?? pix.key}
          </p>
          <CopyButton
            label="Copiar chave Pix"
            copiedLabel="Chave Pix copiada"
            value={pix.key}
            variant="default"
          />
        </div>
      )}

      {/* Copia e Cola: o BR Code inteiro, sempre disponível. */}
      <div className="space-y-2">
        <p className="text-xs text-[var(--muted-foreground)]">Pix Copia e Cola</p>
        <p className="font-mono text-[11px] leading-relaxed break-all rounded-lg bg-black/30 px-3 py-2 text-[var(--muted-foreground)] max-h-24 overflow-y-auto">
          {pix.copyPaste}
        </p>
        <CopyButton
          label="Copiar código Pix"
          copiedLabel="Código Pix copiado"
          value={pix.copyPaste}
          variant={pix.key ? 'outline' : 'default'}
        />
      </div>

      {/*
        A promessa muda conforme quem confirma. Dizer "é automático" num Pix
        estático seria mentira, e é o tipo de mentira que faz a pessoa não
        avisar a barbearia e perder o horário.
      */}
      <p className="text-sm text-[var(--foreground)] border-t border-[var(--border)]/60 pt-3">
        {pix.requiresManualConfirmation
          ? 'Após o pagamento, aguarde a confirmação da barbearia.'
          : 'A confirmação é automática assim que o pagamento é processado. Você não precisa avisar ninguém.'}
      </p>
    </section>
  )
}
