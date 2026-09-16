import { Link } from 'react-router-dom'
import { CalendarPlus, Clock, Scissors } from 'lucide-react'
import { StatusBadge } from '@/components/ui/badge'
import { Logo } from '@/components/Logo'
import { APPOINTMENTS, SERVICES } from '@/data/mock'

const upcoming = APPOINTMENTS
  .filter(a => a.clientId === 'c1' && a.status === 'confirmed')
  .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
  .slice(0, 2)

function formatDate(dateStr: string) {
  const [, m, d] = dateStr.split('-')
  return `${d}/${m}`
}

export default function ClientHome() {
  return (
    <div>
      {/* Greeting */}
      <div className="mb-8">
        <p className="text-[var(--muted-foreground)] text-sm">Bem-vindo de volta,</p>
        <h2 className="text-2xl font-bold tracking-tight">João Silva 👋</h2>
      </div>

      {/* Quick action */}
      <Link
        to="/client/schedule"
        className="block border border-[var(--primary)]/40 bg-gradient-to-r from-[var(--primary)]/10 to-transparent rounded-2xl p-5 mb-6 hover:border-[var(--primary)]/60 transition-all group"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-lg">Fazer novo agendamento</p>
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">Escolha serviço, data e horário</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[var(--primary)] flex items-center justify-center group-hover:scale-105 transition-transform">
            <CalendarPlus className="h-6 w-6 text-black" />
          </div>
        </div>
      </Link>

      {/* Upcoming appointments */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold tracking-widest text-[var(--primary)] uppercase">Próximos</h3>
          <Link to="/client/appointments" className="min-h-11 inline-flex items-center text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            Ver todos →
          </Link>
        </div>

        {upcoming.length === 0 ? (
          <div className="border border-dashed border-[var(--border)] rounded-xl p-6 text-center">
            <Logo className="h-8 w-8 text-[var(--muted-foreground)]/40 mx-auto mb-2" />
            <p className="text-sm text-[var(--muted-foreground)]">Nenhum agendamento futuro.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map(apt => (
              <div key={apt.id} className="border border-[var(--border)] bg-[var(--card)] rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">{apt.serviceName}</p>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] mt-0.5">
                    <Clock className="h-3 w-3" />
                    <span>{formatDate(apt.date)} às {apt.time}</span>
                  </div>
                </div>
                <StatusBadge status={apt.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Services quick view */}
      <div>
        <h3 className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-3">Serviços</h3>
        <div className="grid grid-cols-2 gap-2">
          {SERVICES.filter(s => s.active).slice(0, 4).map(service => (
            <Link
              key={service.id}
              to="/client/schedule"
              className="border border-[var(--border)] bg-[var(--card)] rounded-xl p-3 hover:border-[var(--primary)]/40 transition-all"
            >
              <div className="w-8 h-8 rounded-lg bg-[var(--secondary)] flex items-center justify-center mb-2">
                <Scissors className="h-4 w-4 text-[var(--primary)]" />
              </div>
              <p className="text-sm font-semibold">{service.name}</p>
              <p className="text-xs text-[var(--primary)] font-medium mt-0.5">R$ {service.price}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
