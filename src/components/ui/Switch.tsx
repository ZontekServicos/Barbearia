import { cn } from '@/lib/utils'
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-lg">
      <span className={cn('relative w-10 h-6 rounded-full', checked ? 'bg-[var(--primary)]' : 'bg-[var(--secondary)] border border-[var(--muted-foreground)]')}>
        <span className={cn('absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white', checked ? 'right-1' : 'left-1')} />
      </span>
    </button>
  )
}
