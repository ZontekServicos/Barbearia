import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/Modal'
import { Logo } from '@/components/Logo'
import { APPOINTMENTS } from '@/data/mock'

const today = '2026-09-15'

const upcoming = APPOINTMENTS
  .filter(a => (a.date >= today) && (a.status === 'confirmed'))
  .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
  .filter(a => a.clientId === 'c1')

const history = APPOINTMENTS
  .filter(a => a.status !== 'confirmed' || a.date < today)
  .filter(a => a.clientId === 'c1')
  .sort((a, b) => b.date.localeCompare(a.date))

function formatDate(dateStr: string) {
  const [, m, d] = dateStr.split('-')
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${d} de ${months[parseInt(m) - 1]}`
}

export default function Appointments() {
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState<string[]>([])

  const filteredUpcoming = upcoming.filter(a => !cancelled.includes(a.id))
  const displayedHistory = [...history, ...upcoming.filter(a => cancelled.includes(a.id)).map(a => ({ ...a, status: 'cancelled' as const }))].sort((a, b) => b.date.localeCompare(a.date))

  function handleCancel(id: string) {
    setCancelled(prev => [...prev, id])
    setCancelId(null)
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight">Meus Horários</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">Seus agendamentos passados e futuros.</p>
      </div>

      {/* Upcoming */}
      <section className="mb-8">
        <h3 className="text-xs font-semibold tracking-widest text-[var(--primary)] uppercase mb-3">Próximos</h3>

        {filteredUpcoming.length === 0 ? (
          <div className="border border-dashed border-[var(--primary)]/25 bg-[var(--surface-bronze)] rounded-2xl p-8 text-center">
            <Logo className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
            <p className="text-[var(--muted-foreground)] text-sm mb-4">Você ainda não possui agendamentos futuros.</p>
            <Button asChild size="sm">
              <Link to="/client/schedule">Agendar agora</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredUpcoming.map(apt => (
              <div
                key={apt.id}
                className="border border-[var(--primary)]/30 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">{apt.serviceName}</p>
                    <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] mt-1">
                      <Clock className="h-3 w-3" />
                      <span>{formatDate(apt.date)} às {apt.time}</span>
                    </div>
                  </div>
                  <StatusBadge status={apt.status} />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--primary)] font-bold">R$ {apt.servicePrice}</span>
                  <button
                    onClick={() => setCancelId(apt.id)}
                    className="min-h-11 px-2 flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancelar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <h3 className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-3">Histórico</h3>

        {displayedHistory.length === 0 ? (
          <p className="text-[var(--muted-foreground)] text-sm">Nenhum atendimento anterior.</p>
        ) : (
          <div className="space-y-2">
            {displayedHistory.map(apt => (
              <div
                key={apt.id}
                className="border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl px-4 py-3 flex items-center justify-between"
              >
                <div>
                  <p className="font-medium text-sm text-[var(--foreground)]">{apt.serviceName}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{formatDate(apt.date)} às {apt.time}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-[var(--muted-foreground)]">R$ {apt.servicePrice}</span>
                  <StatusBadge status={apt.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Cancel modal */}
      {cancelId && (
        <Modal titleId="cancel-appointment-title" onClose={() => setCancelId(null)}>
            <h3 id="cancel-appointment-title" className="text-lg font-bold mb-2">Simular cancelamento?</h3>
            <p className="text-sm text-[var(--muted-foreground)] mb-6">
              Apenas esta demonstração será alterada. Nenhum agendamento real será cancelado.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setCancelId(null)}>
                Manter
              </Button>
              <Button variant="destructive" className="flex-1" onClick={() => handleCancel(cancelId)}>
                Cancelar agendamento
              </Button>
            </div>
        </Modal>
      )}
    </div>
  )
}
