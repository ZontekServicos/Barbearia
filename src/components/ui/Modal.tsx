import { useEffect, useRef, type KeyboardEvent } from 'react'

// Keep Tab inside the dialog, including browsers that otherwise focus browser chrome.
export function containDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
  )).filter(element => element.getClientRects().length > 0)
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (!first) { event.preventDefault(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
    event.preventDefault(); last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus()
  }
}

// Native modal supplies Escape handling and background inertness.
export function Modal({ titleId, onClose, children }: {
  titleId: string
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => { dialog.close(); previous?.focus() }
  }, [])
  return (
    <dialog onKeyDown={containDialogFocus} ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] p-6 backdrop:bg-black/70">
      {children}
    </dialog>
  )
}
