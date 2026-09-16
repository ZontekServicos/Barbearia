import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Phone, User, Scissors, Clock, Calendar, DollarSign, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { APPOINTMENTS } from '@/data/mock'
import type { AppointmentStatus } from '@/data/mock'

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-')
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  return `${d} de ${months[parseInt(m) - 1]} de ${y}`
}

export default function AppointmentDetail() {
  const { id } = useParams<{ id: string }>()
  return <AppointmentDetailContent key={id} />
}

function AppointmentDetailContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const apt = APPOINTMENTS.find(a => a.id === id)

  const [status, setStatus] = useState<AppointmentStatus>(apt?.status ?? 'confirmed')
  const [loading, setLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  if (!apt) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-[var(--muted-foreground)] mb-4">Agendamento não encontrado.</p>
        <Button onClick={() => navigate('/admin/agenda')}>Voltar à agenda</Button>
      </div>
    )
  }

  async function handleAction(newStatus: AppointmentStatus, label: string) {
    setLoading(label)
    await new Promise(r => setTimeout(r, 700))
    setStatus(newStatus)
    setLoading(null)
    setToast(`${label} com sucesso.`)
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="max-w-xl">
      {/* Toast */}
      {toast && (
        <div role="status" className="fixed top-4 right-4 left-4 sm:left-auto z-50 bg-[var(--card)] border border-green-500/50 text-green-400 px-4 py-3 rounded-xl text-sm shadow-xl">
          {toast}
        </div>
      )}

      {/* Back */}
      <button
        onClick={() => navigate('/admin/agenda')}
        className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar à agenda
      </button>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold tracking-tight">Agendamento</h2>
        <StatusBadge status={status} />
      </div>

      {/* Details card */}
      <div className="border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl overflow-hidden mb-6">
        <div className="p-5 border-b border-[var(--border)] bg-[var(--primary)]/5">
          <p className="text-xs text-[var(--primary)] font-semibold tracking-widest uppercase">Detalhes</p>
        </div>
        <div className="p-5 space-y-4">
          {[
            { icon: User, label: 'Cliente', value: apt.clientName },
            { icon: Phone, label: 'Telefone', value: apt.clientPhone },
            { icon: Scissors, label: 'Serviço', value: apt.serviceName },
            { icon: Calendar, label: 'Data', value: formatDate(apt.date) },
            { icon: Clock, label: 'Horário', value: `${apt.time} · ${apt.serviceDuration} min` },
            { icon: DollarSign, label: 'Valor', value: `R$ ${apt.servicePrice}` },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--secondary)] flex items-center justify-center shrink-0">
                <Icon className="h-4 w-4 text-[var(--primary)]" />
              </div>
              <div>
                <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
                <p className="text-sm font-semibold text-[var(--foreground)]">{value}</p>
              </div>
            </div>
          ))}
          {apt.notes && (
            <div className="pt-3 border-t border-[var(--border)]">
              <p className="text-xs text-[var(--muted-foreground)] mb-1">Observações</p>
              <p className="text-sm text-[var(--foreground)]">{apt.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-5 space-y-2">
        <p className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-3">Ações</p>

        {status === 'confirmed' && (
          <>
            <Button
              className="w-full h-11"
              onClick={() => handleAction('completed', 'Atendimento concluído')}
              disabled={!!loading}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {loading === 'Atendimento concluído' ? 'Processando...' : 'Concluir atendimento'}
            </Button>
            <Button
              variant="outline"
              className="w-full h-11"
              onClick={() => handleAction('missed', 'Marcado como falta')}
              disabled={!!loading}
            >
              <AlertCircle className="h-4 w-4 mr-2" />
              {loading === 'Marcado como falta' ? 'Processando...' : 'Marcar como falta'}
            </Button>
            <Button
              variant="destructive"
              className="w-full h-11"
              onClick={() => handleAction('cancelled', 'Agendamento cancelado')}
              disabled={!!loading}
            >
              <XCircle className="h-4 w-4 mr-2" />
              {loading === 'Agendamento cancelado' ? 'Processando...' : 'Cancelar agendamento'}
            </Button>
          </>
        )}

        {status !== 'confirmed' && (
          <div className="text-center py-4">
            <p className="text-sm text-[var(--muted-foreground)]">Este agendamento já foi encerrado.</p>
          </div>
        )}

        <div className="pt-2 border-t border-[var(--border)]">
          <Link
            to={`/admin/clients/${apt.clientId}`}
            className="flex items-center justify-center gap-2 py-2.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <User className="h-4 w-4" />
            Ver perfil do cliente
          </Link>
        </div>
      </div>
    </div>
  )
}
