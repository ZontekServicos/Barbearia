import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  /** Decorative leading adornment, e.g. a lucide icon. */
  icon?: React.ReactNode
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, ...props }, ref) => {
    const generatedId = React.useId()
    const inputId = props.id ?? generatedId
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-[var(--foreground)]">{label}</label>
        )}
        <div className="relative">
          {icon && (
            <span aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--primary)] pointer-events-none">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            className={cn(
              // Darker than any card surface, so the field reads as recessed on both bronze and charcoal.
              'w-full rounded-lg border border-[var(--input-border)] bg-[var(--background)] px-4 py-3 text-base text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] transition-all',
              'focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:text-[var(--muted-foreground)]',
              icon && 'pl-11',
              error && 'border-red-500 focus:border-red-500 focus:ring-red-500/20',
              className
            )}
            {...props}
            id={inputId}
            aria-invalid={error ? true : props['aria-invalid']}
            aria-describedby={[props['aria-describedby'], error ? `${inputId}-error` : undefined].filter(Boolean).join(' ') || undefined}
          />
        </div>
        {error && <p id={`${inputId}-error`} className="text-xs text-red-400">{error}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
