import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, ...props }, ref) => {
    const generatedId = React.useId()
    const inputId = props.id ?? generatedId
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-[var(--foreground)]">{label}</label>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-base text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none transition-all',
            'focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30',
            error && 'border-red-500 focus:border-red-500 focus:ring-red-500/20',
            className
          )}
          {...props}
          id={inputId}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={[props['aria-describedby'], error ? `${inputId}-error` : undefined].filter(Boolean).join(' ') || undefined}
        />
        {error && <p id={`${inputId}-error`} className="text-xs text-red-400">{error}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
