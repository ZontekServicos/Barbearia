import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-semibold tracking-tight transition-all focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary-light)] active:bg-[var(--primary-dark)]': variant === 'default',
            'bg-[var(--secondary)] text-[var(--secondary-foreground)] shadow-sm hover:bg-[var(--secondary)]/80': variant === 'secondary',
            'border border-[var(--primary)]/35 bg-[var(--primary)]/5 text-[var(--foreground)] shadow-sm hover:bg-[var(--primary)]/10 hover:border-[var(--primary)]/60': variant === 'outline',
            'hover:bg-[var(--secondary)] hover:text-[var(--secondary-foreground)]': variant === 'ghost',
            'bg-[var(--destructive)] text-[var(--destructive-foreground)] shadow-sm hover:bg-[var(--destructive)]/90': variant === 'destructive',
            'min-h-11 px-4 py-2': size === 'default',
            'min-h-11 rounded-md px-3 py-2 text-xs': size === 'sm',
            'min-h-11 rounded-md px-8 py-2': size === 'lg',
            'h-11 w-11': size === 'icon',
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button }
