import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Calendar, Users, Scissors,
  Settings, Menu, X, ChevronRight
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/admin/agenda', label: 'Agenda', icon: Calendar },
  { to: '/admin/clients', label: 'Clientes', icon: Users },
  { to: '/admin/services', label: 'Serviços', icon: Scissors },
  { to: '/admin/settings', label: 'Configurações', icon: Settings },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isActive = (to: string, exact?: boolean) =>
    exact ? location.pathname === to : location.pathname.startsWith(to)

  return (
    <div className="min-h-screen bg-[var(--background)] flex">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex w-60 flex-col border-r border-[var(--border)] bg-[var(--card)] flex-shrink-0">
        <div className="p-6 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[var(--primary)] flex items-center justify-center">
              <Scissors className="w-3.5 h-3.5 text-black" />
            </div>
            <span className="font-bold tracking-tight text-[var(--primary)] text-lg">Cuts & Co.</span>
          </div>
          <p className="text-xs text-[var(--muted-foreground)] mt-1 ml-9">Painel do Barbeiro</p>
        </div>

        <nav className="flex-1 p-3 flex flex-col gap-1">
          {navItems.map(({ to, label, icon: Icon, exact }) => {
            const active = isActive(to, exact)
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                  active
                    ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                    : 'text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]'
                )}
              >
                <Icon className="h-4.5 w-4.5 shrink-0" />
                {label}
                {active && <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-60" />}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-[var(--border)]">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-[var(--secondary)] flex items-center justify-center text-[var(--primary)] font-bold text-sm">
              B
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--foreground)]">Barbeiro</p>
              <p className="text-xs text-[var(--muted-foreground)]">Admin</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/70 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 bg-[var(--card)] border-r border-[var(--border)] flex flex-col transition-transform duration-300 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[var(--primary)] flex items-center justify-center">
              <Scissors className="w-3.5 h-3.5 text-black" />
            </div>
            <span className="font-bold tracking-tight text-[var(--primary)]">Cuts & Co.</span>
          </div>
          <button onClick={() => setMobileOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 p-3 flex flex-col gap-1">
          {navItems.map(({ to, label, icon: Icon, exact }) => {
            const active = isActive(to, exact)
            return (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                  active
                    ? 'bg-[var(--primary)]/15 text-[var(--primary)]'
                    : 'text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]'
                )}
              >
                <Icon className="h-4.5 w-4.5 shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="md:hidden sticky top-0 z-20 bg-[var(--card)]/90 backdrop-blur border-b border-[var(--border)] px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Scissors className="h-4 w-4 text-[var(--primary)]" />
            <span className="font-bold tracking-tight text-sm">Painel Admin</span>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
