import { Link } from 'react-router-dom'
import { Phone, Scissors, Star, AlertTriangle, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { APPOINTMENTS } from '@/data/mock'

const clientAppointments = APPOINTMENTS.filter(a => a.clientId === 'c1')
const stats = {
  total: clientAppointments.length,
  completed: clientAppointments.filter(a => a.status === 'completed').length,
  cancelled: clientAppointments.filter(a => a.status === 'cancelled').length,
  missed: clientAppointments.filter(a => a.status === 'missed').length,
}

export default function Profile() {
  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 rounded-2xl bg-[var(--primary)]/20 border border-[var(--primary)]/30 flex items-center justify-center">
          <span className="text-2xl font-bold text-[var(--primary)]">J</span>
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight">João Silva</h2>
          <div className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] mt-0.5">
            <Phone className="h-3.5 w-3.5" />
            <span>(71) 99999-1111</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        {[
          { label: 'Agendamentos', value: stats.total, icon: Scissors, color: 'text-[var(--primary)]' },
          { label: 'Concluídos', value: stats.completed, icon: Star, color: 'text-green-400' },
          { label: 'Cancelamentos', value: stats.cancelled, icon: AlertTriangle, color: 'text-orange-400' },
          { label: 'Faltas', value: stats.missed, icon: AlertTriangle, color: 'text-red-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl p-4">
            <div className={`text-2xl font-bold ${color} mb-1`}>{value}</div>
            <div className="flex items-center gap-1.5">
              <Icon className={`h-3.5 w-3.5 ${color}`} />
              <span className="text-xs text-[var(--muted-foreground)]">{label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="space-y-2 mb-8">
        <h3 className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-3">Conta</h3>
        {[
          { label: 'Meus agendamentos', to: '/client/appointments' },
          { label: 'Fazer agendamento', to: '/client/schedule' },
        ].map(item => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center justify-between p-4 border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl hover:border-[var(--primary)]/40 transition-all"
          >
            <span className="text-sm font-medium">{item.label}</span>
            <span className="text-[var(--muted-foreground)]">→</span>
          </Link>
        ))}
      </div>

      {/* Logout */}
      <Button variant="outline" className="w-full h-11 text-[var(--muted-foreground)]" asChild>
        <Link to="/">
          <LogOut className="h-4 w-4 mr-2" />
          Sair da conta
        </Link>
      </Button>
    </div>
  )
}
