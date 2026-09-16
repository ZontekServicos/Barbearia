import * as React from 'react'
import { cn } from '@/lib/utils'

export type BadgeVariant = 'default' | 'confirmed' | 'completed' | 'cancelled' | 'missed' | 'blocked' | 'warning'

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-[var(--secondary)] text-[var(--foreground)]',
  confirmed: 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30',
  completed: 'bg-green-900/40 text-green-400 border border-green-800/40',
  cancelled: 'bg-red-900/40 text-red-400 border border-red-800/40',
  missed: 'bg-orange-900/40 text-orange-400 border border-orange-800/40',
  blocked: 'bg-red-900/60 text-red-300 border border-red-700/60',
  warning: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800/40',
}

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
}

import type { AppointmentStatus } from '@/data/mock'
export type { AppointmentStatus } from '@/data/mock'

export const statusConfig: Record<AppointmentStatus, { label: string; variant: BadgeVariant }> = {
  confirmed: { label: 'Confirmado', variant: 'confirmed' },
  completed: { label: 'Concluído', variant: 'completed' },
  cancelled: { label: 'Cancelado', variant: 'cancelled' },
  missed: { label: 'Não compareceu', variant: 'missed' },
}

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const config = statusConfig[status]
  return <Badge variant={config.variant}>{config.label}</Badge>
}
