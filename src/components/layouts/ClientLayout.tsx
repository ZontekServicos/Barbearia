import { Link, useLocation } from 'react-router-dom'
import { Home, CalendarPlus, Clock, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DemoNotice } from '@/components/DemoNotice'
import { Logo } from '@/components/Logo'

const navItems = [
  { to: '/client', label: 'Início', icon: Home, exact: true },
  { to: '/client/schedule', label: 'Agendar', icon: CalendarPlus },
  { to: '/client/appointments', label: 'Meus horários', icon: Clock },
  { to: '/client/profile', label: 'Perfil', icon: User },
]

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()

  const isActive = (to: string, exact?: boolean) =>
    exact ? location.pathname === to : location.pathname.startsWith(to)

  return (
    <div className="min-h-screen bg-[var(--background)] flex flex-col">
      <header className="sticky top-0 z-20 bg-[var(--background)]/90 backdrop-blur px-4 py-3 flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 flex items-center justify-center shrink-0">
            <Logo className="h-5 w-5 text-[var(--primary)]" />
          </div>
          <span className="font-display font-bold tracking-tight text-[var(--foreground)]">ErickCorttes</span>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent" />
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        <DemoNotice />
        {children}
      </main>

      <nav aria-label="Navegação do cliente" className="pb-[env(safe-area-inset-bottom)] fixed bottom-0 left-0 right-0 z-20 bg-[var(--card)]/95 backdrop-blur">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent" />
        <div className="max-w-md mx-auto flex items-end px-1">
          {navItems.map(({ to, label, icon: Icon, exact }) => {
            const active = isActive(to, exact)
            const isPrimary = to === '/client/schedule'

            if (isPrimary) {
              return (
                <Link
                  key={to}
                  to={to}
                  aria-current={active ? 'page' : undefined}
                  className="flex-1 flex flex-col items-center gap-1 pb-2.5 pt-1 text-xs font-medium"
                >
                  <span className={cn(
                    '-mt-6 w-12 h-12 rounded-full flex items-center justify-center transition-all',
                    'bg-[var(--primary)] shadow-sm',
                    active ? 'scale-105' : 'hover:scale-105'
                  )}>
                    <Icon className="h-5.5 w-5.5 text-[var(--primary-foreground)]" />
                  </span>
                  <span className={cn(active ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]')}>{label}</span>
                </Link>
              )
            }

            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? 'page' : undefined}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors"
              >
                <span className={cn(
                  'flex items-center justify-center w-11 h-8 rounded-full transition-colors',
                  active ? 'bg-[var(--primary)]/15' : ''
                )}>
                  <Icon className={cn('h-5 w-5 transition-transform', active ? 'text-[var(--primary)] scale-110' : 'text-[var(--muted-foreground)]')} />
                </span>
                <span className={cn(active ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]')}>{label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
