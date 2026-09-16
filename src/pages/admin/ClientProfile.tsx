import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Phone, Scissors, Star, AlertTriangle, XCircle, Ban, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { CLIENTS, APPOINTMENTS } from '@/data/mock'

function formatDate(dateStr: string) {
  const [, m, d] = dateStr.split('-')
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${d} ${months[parseInt(m) - 1]}`
}

export default function ClientProfile() {
  const { id } = useParams<{ id: string }>()
  return <ClientProfileContent key={id} />
}

function ClientProfileContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const client = CLIENTS.find(c => c.id === id)
  const [blocked, setBlocked] = useState(client?.blocked ?? false)
  const [note, setNote] = useState(client?.notes ?? '')
  const [editingNote, setEditingNote] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  if (!client) {
    return (
      <div className="text-center py-20">
        <p className="text-[var(--muted-foreground)] mb-4">Cliente não encontrado.</p>
        <Button onClick={() => navigate('/admin/clients')}>Voltar</Button>
      </div>
    )
  }

  const history = APPOINTMENTS
    .filter(a => a.clientId === id)
    .sort((a, b) => b.date.localeCompare(a.date))

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function toggleBlock() {
    setBlocked(prev => !prev)
    showToast(blocked ? 'Cliente desbloqueado.' : 'Cliente bloqueado.')
  }

  const hasWarnings = client.missedAppointments >= 2 || client.cancelledAppointments >= 2

  return (
    <div className="max-w-2xl">
      {toast && (
        <div role="status" className="fixed top-4 right-4 left-4 sm:left-auto z-50 bg-[var(--card)] border border-[var(--primary)]/40 text-[var(--foreground)] px-4 py-3 rounded-xl text-sm shadow-xl">
          {toast}
        </div>
      )}

      {/* Back */}
      <button
        onClick={() => navigate('/admin/clients')}
        className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar aos clientes
      </button>

      {/* Client header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-2xl bg-[var(--primary)]/20 border border-[var(--primary)]/30 flex items-center justify-center">
          <span className="text-2xl font-bold text-[var(--primary)]">{client.name[0]}</span>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold">{client.name}</h2>
            {blocked && <Badge variant="blocked">Bloqueado</Badge>}
          </div>
          <div className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] mt-0.5">
            <Phone className="h-3.5 w-3.5" />
            {client.phone}
          </div>
        </div>
      </div>

      {/* Warnings */}
      {(hasWarnings || blocked) && (
        <div className="border border-orange-500/30 bg-orange-500/8 rounded-xl p-4 mb-6 space-y-1.5">
          <p className="text-xs font-semibold text-orange-400 uppercase tracking-widest mb-2">Alertas</p>
          {blocked && (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <Ban className="h-3.5 w-3.5" />
              Cliente bloqueado — não pode fazer novos agendamentos
            </div>
          )}
          {client.missedAppointments >= 2 && (
            <div className="flex items-center gap-2 text-sm text-orange-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {client.missedAppointments} faltas registradas
            </div>
          )}
          {client.cancelledAppointments >= 2 && (
            <div className="flex items-center gap-2 text-sm text-yellow-400">
              <XCircle className="h-3.5 w-3.5" />
              {client.cancelledAppointments} cancelamentos
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total', value: client.totalAppointments, icon: Scissors, color: 'text-[var(--primary)]' },
          { label: 'Concluídos', value: client.completedAppointments, icon: Star, color: 'text-green-400' },
          { label: 'Cancelamentos', value: client.cancelledAppointments, icon: XCircle, color: 'text-orange-400' },
          { label: 'Faltas', value: client.missedAppointments, icon: AlertTriangle, color: 'text-red-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="border border-[var(--border)] bg-[var(--card)] rounded-xl p-4 text-center">
            <div className={`text-2xl font-bold ${color} mb-1`}>{value}</div>
            <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
          </div>
        ))}
      </div>

      {/* Notes */}
      <div className="border border-[var(--border)] bg-[var(--card)] rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquare className="h-4 w-4 text-[var(--primary)]" />
            Observações
          </div>
          <button
            onClick={() => setEditingNote(e => !e)}
            className="text-xs text-[var(--primary)] hover:underline"
          >
            {editingNote ? 'Salvar' : 'Editar'}
          </button>
        </div>
        {editingNote ? (
          <textarea
            aria-label="Observações do cliente"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            placeholder="Adicione uma observação sobre este cliente..."
            className="w-full bg-[var(--secondary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:border-[var(--primary)] resize-none"
          />
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">
            {note || 'Nenhuma observação registrada.'}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mb-8">
        <Button size="sm" asChild>
          <Link to="/admin/agenda">Ver agenda</Link>
        </Button>
        <Button
          size="sm"
          variant={blocked ? 'outline' : 'destructive'}
          onClick={toggleBlock}
        >
          <Ban className="h-3.5 w-3.5 mr-1.5" />
          {blocked ? 'Desbloquear cliente' : 'Bloquear cliente'}
        </Button>
      </div>

      {/* Timeline */}
      <div>
        <h3 className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-4">Histórico</h3>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">Nenhum histórico encontrado.</p>
        ) : (
          <div className="relative space-y-0">
            {history.map((apt, i) => (
              <Link key={apt.id} to={`/admin/agenda/${apt.id}`} className="flex gap-4 group">
                {/* Timeline line */}
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-3 h-3 rounded-full bg-[var(--primary)] border-2 border-[var(--background)] mt-1 shrink-0 z-10" />
                  {i < history.length - 1 && (
                    <div className="w-px flex-1 bg-[var(--border)] mt-1 mb-1" style={{ minHeight: '2rem' }} />
                  )}
                </div>
                {/* Content */}
                <div className="pb-6 flex-1 flex items-start justify-between hover:bg-[var(--secondary)]/20 rounded-lg px-3 py-1 transition-colors -ml-3">
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)] mb-0.5">{formatDate(apt.date)}</p>
                    <p className="text-sm font-semibold text-[var(--foreground)]">{apt.serviceName}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">R$ {apt.servicePrice} · {apt.time}</p>
                  </div>
                  <StatusBadge status={apt.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
