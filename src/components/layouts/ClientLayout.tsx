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
      <header className="sticky top-0 z-20 bg-[var(--background)]/90 backdrop-blur border-b border-[var(--border)] px-4 py-3 flex items-center justify-center">
        <div className="flex items-center gap-2">
          <Logo className="h-6 w-6 text-[var(--primary)]" />
          <span className="font-bold tracking-tight text-[var(--foreground)]">ErickCorttes</span>
        </div>
      </header>

      <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        <DemoNotice />
        {children}
      </main>

      <nav aria-label="Navegação do cliente" className="pb-[env(safe-area-inset-bottom)] fixed bottom-0 left-0 right-0 z-20 bg-[var(--card)]/95 backdrop-blur border-t border-[var(--border)]">
        <div className="max-w-md mx-auto flex">
          {navItems.map(({ to, label, icon: Icon, exact }) => {
            const active = isActive(to, exact)
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors',
                  active
                    ? 'text-[var(--primary)]'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                )}
              >
                <Icon className={cn('h-5 w-5 transition-transform', active && 'scale-110')} />
                <span className="leading-none">{label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
