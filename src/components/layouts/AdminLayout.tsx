import { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Calendar, Users, UserCheck, Scissors,
  Settings, Menu, X, ChevronRight
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { containDialogFocus } from '@/components/ui/Modal'

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/admin/users', label: 'Usuários', icon: UserCheck },
  { to: '/admin/agenda', label: 'Agenda', icon: Calendar },
  { to: '/admin/clients', label: 'Clientes', icon: Users },
  { to: '/admin/services', label: 'Serviços', icon: Scissors },
  { to: '/admin/settings', label: 'Configurações', icon: Settings },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const dialog = menuRef.current!
    if (mobileOpen) dialog.showModal()
    else if (dialog.open) { dialog.close(); triggerRef.current?.focus() }
  }, [mobileOpen])
  useEffect(() => {
    const desktop = matchMedia('(min-width: 768px)')
    const closeOnDesktop = () => { if (desktop.matches) setMobileOpen(false) }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  const isActive = (to: string, exact?: boolean) =>
    exact ? location.pathname === to : location.pathname.startsWith(to)

  return (
    <div className="relative isolate min-h-screen flex">
      <div aria-hidden="true" className="fixed inset-0 -z-10 pointer-events-none">
        <img src="/brand/interior.jpg" alt="" width="1536" height="1024" className="h-full w-full object-cover object-[68%_center] md:object-center" />
        <div className="absolute inset-0 bg-black/80" />
      </div>
      {/* Sidebar desktop */}
      <aside className="hidden md:flex w-60 flex-col border-r border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] flex-shrink-0">
        <div className="p-6 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <img src="/brand/app-icon.png" alt="" width="256" height="256" className="h-10 w-10 object-contain shrink-0" />
            <span className="font-display font-bold tracking-tight text-[var(--primary)] text-lg">ErickCorttes</span>
          </div>
          <p className="text-xs text-[var(--muted-foreground)] mt-1 ml-12">Painel do Barbeiro</p>
        </div>

        <nav className="flex-1 p-3 flex flex-col gap-1">
          {navItems.map(({ to, label, icon: Icon, exact }) => {
            const active = isActive(to, exact)
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? 'page' : undefined}
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

      {/* Mobile sidebar */}
      <dialog onClick={event => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setMobileOpen(false)
      }} onKeyDown={containDialogFocus} ref={menuRef} aria-label="Navegação administrativa" onCancel={event => { event.preventDefault(); setMobileOpen(false) }}
        className="fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-dvh w-72 max-w-[calc(100%-2rem)] border-r border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] text-[var(--foreground)] p-0 backdrop:bg-black/70">

        <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/brand/app-icon.png" alt="" width="256" height="256" className="h-10 w-10 object-contain shrink-0" />
            <span className="font-display font-bold tracking-tight text-[var(--primary)]">ErickCorttes</span>
          </div>
          <button aria-label="Fechar menu" onClick={() => setMobileOpen(false)} className="w-11 h-11 inline-flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
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
                aria-current={active ? 'page' : undefined}
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
      </dialog>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="md:hidden sticky top-0 z-20 bg-[var(--card)]/90 backdrop-blur border-b border-[var(--border)] px-4 py-3 flex items-center gap-3">
          <button
            ref={triggerRef}
            aria-label="Abrir menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
            className="w-11 h-11 inline-flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <img src="/brand/app-icon.png" alt="" width="256" height="256" className="h-9 w-9 object-contain shrink-0" />
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
