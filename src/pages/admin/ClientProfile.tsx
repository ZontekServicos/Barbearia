import { generateTemporaryPassword } from "@/lib/password"
import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Phone, Scissors, Star, AlertTriangle, XCircle, Ban,
  AlertCircle, RefreshCw, CalendarCheck, KeyRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { ApiError } from '@/services/api'
import { getUser, resetUserPassword, updateUserStatus } from '@/services/admin'
import { getCustomerDossier, type CustomerSummary } from '@/services/admin-booking'
import type { AuthUser } from '@/services/auth'
import type { Appointment } from '@/services/booking'

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function formatDate(dateISO: string) {
  const [, month, day] = dateISO.split('-')
  return `${day} ${MONTHS[Number(month) - 1]}`
}

export default function ClientProfile() {
  const { id } = useParams<{ id: string }>()
  return <ClientProfileContent key={id} />
}

function ClientProfileContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [client, setClient] = useState<AuthUser | null>(null)
  const [summary, setSummary] = useState<CustomerSummary | null>(null)
  const [history, setHistory] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // Senha temporária só existe nesta tela, em memória, até a página sair.
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      // Dados do usuário e do histórico vêm do banco, não de fixtures.
      const [user, dossier] = await Promise.all([getUser(id), getCustomerDossier(id)])
      setClient(user)
      setSummary(dossier.summary)
      setHistory(dossier.appointments)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar o cliente.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleBlock() {
    if (!client) return
    const nextStatus = client.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED'
    setUpdating(true)
    setActionError(null)
    try {
      setClient(await updateUserStatus(client.id, nextStatus))
      setToast(nextStatus === 'BLOCKED' ? 'Cliente bloqueado.' : 'Cliente desbloqueado.')
      setTimeout(() => setToast(null), 3000)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível alterar o cliente.')
    } finally {
      setUpdating(false)
    }
  }

  /**
   * Redefinição assistida: sem SMS e sem e-mail, não há canal automático
   * capaz de provar posse do telefone. Confirme a identidade presencialmente
   * antes de gerar — a ação derruba as sessões do cliente e fica na
   * auditoria. A senha antiga não é revelada: ela não existe em texto puro.
   */
  async function handleResetPassword() {
    if (!client) return
    const confirmed = window.confirm(
      `Gerar uma nova senha temporária para ${client.fullName ?? 'este cliente'}?\n\n` +
        'Confirme a identidade da pessoa antes de continuar. As sessões abertas ' +
        'serão encerradas e a senha atual deixará de funcionar.',
    )
    if (!confirmed) return

    setResetting(true)
    setActionError(null)
    try {
      const temporary = generateTemporaryPassword()
      const result = await resetUserPassword(client.id, temporary)
      setClient(result.user)
      setTemporaryPassword(temporary)
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : 'Não foi possível redefinir a senha.',
      )
    } finally {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <p role="status" className="text-sm text-[var(--muted-foreground)] py-10">
        Carregando cliente…
      </p>
    )
  }

  if (error || !client || !summary) {
    return (
      <div className="max-w-2xl">
        <div role="alert" className="border border-red-500/40 bg-red-500/10 rounded-2xl p-6 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-200 mb-4">{error ?? 'Cliente não encontrado.'}</p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Tentar novamente
            </Button>
            <Button size="sm" onClick={() => navigate('/admin/clients')}>Voltar</Button>
          </div>
        </div>
      </div>
    )
  }

  const blocked = client.status === 'BLOCKED'
  const hasWarnings = summary.noShow >= 2 || summary.cancelled >= 2

  const stats = [
    { label: 'Total', value: summary.totalAppointments, icon: Scissors, color: 'text-[var(--primary)]' },
    { label: 'Concluídos', value: summary.completed, icon: Star, color: 'text-green-400' },
    { label: 'Cancelamentos', value: summary.cancelled, icon: XCircle, color: 'text-orange-400' },
    { label: 'Faltas', value: summary.noShow, icon: AlertTriangle, color: 'text-red-400' },
  ]

  return (
    <div className="max-w-2xl">
      {toast && (
        <div role="status" className="fixed top-4 right-4 left-4 sm:left-auto z-50 bg-[var(--card)] border border-[var(--primary)]/40 text-[var(--foreground)] px-4 py-3 rounded-xl text-sm shadow-xl">
          {toast}
        </div>
      )}

      <button
        onClick={() => navigate('/admin/clients')}
        className="flex items-center gap-1.5 min-h-11 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar aos clientes
      </button>

      {/* Identidade */}
      <div className="flex items-center gap-4 border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-4 mb-6">
        <div className="w-16 h-16 rounded-2xl bg-[var(--primary)]/20 border border-[var(--primary)]/30 flex items-center justify-center shrink-0">
          <span className="text-2xl font-bold text-[var(--primary)]">
            {(client.fullName ?? '?').charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold truncate">{client.fullName ?? 'Sem nome'}</h2>
            {blocked && <Badge variant="blocked">Bloqueado</Badge>}
            {client.status === 'PENDING' && <Badge variant="warning">Pendente</Badge>}
          </div>
          <div className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] mt-0.5">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span className="tabular-nums">{client.phoneFormatted}</span>
          </div>
        </div>
      </div>

      {/* Alertas */}
      {(hasWarnings || blocked) && (
        <div className="border border-orange-500/30 bg-orange-500/8 rounded-xl p-4 mb-6 space-y-1.5">
          <p className="text-xs font-semibold text-orange-400 uppercase tracking-widest mb-2">Alertas</p>
          {blocked && (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <Ban className="h-3.5 w-3.5" />
              Cliente bloqueado — não pode fazer novos agendamentos
            </div>
          )}
          {summary.noShow >= 2 && (
            <div className="flex items-center gap-2 text-sm text-orange-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {summary.noShow} faltas registradas
            </div>
          )}
          {summary.cancelled >= 2 && (
            <div className="flex items-center gap-2 text-sm text-yellow-400">
              <XCircle className="h-3.5 w-3.5" />
              {summary.cancelled} cancelamentos
            </div>
          )}
        </div>
      )}

      {/* Números reais */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl p-4 text-center">
            <div className={`text-2xl font-bold ${color} mb-1`}>{value}</div>
            <div className="flex items-center justify-center gap-1.5">
              <Icon className={`h-3 w-3 ${color}`} />
              <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {actionError && (
        <p role="alert" className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {actionError}
        </p>
      )}

      {/* Ações */}
      <div className="flex flex-wrap gap-2 mb-8">
        <Button size="sm" asChild>
          <Link to="/admin/agenda">Ver agenda</Link>
        </Button>
        <Button
          size="sm"
          variant={blocked ? 'outline' : 'destructive'}
          onClick={() => void toggleBlock()}
          disabled={updating}
        >
          <Ban className="h-3.5 w-3.5 mr-1.5" />
          {updating ? 'Atualizando...' : blocked ? 'Desbloquear cliente' : 'Bloquear cliente'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleResetPassword()}
          disabled={resetting}
        >
          <KeyRound className="h-3.5 w-3.5 mr-1.5" />
          {resetting ? 'Gerando...' : 'Redefinir senha'}
        </Button>
      </div>

      {!client.hasPassword && (
        <div className="mb-8 border border-[var(--primary)]/35 bg-[var(--primary)]/8 rounded-xl p-4">
          <p className="text-sm font-medium text-[var(--foreground)] mb-1">
            Cadastro sem senha definida
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            Conta criada no fluxo antigo por SMS. Ela não consegue entrar e não
            pode ser reivindicada por ninguém que apenas saiba o telefone.
            Confirme a identidade presencialmente e use “Redefinir senha”.
          </p>
        </div>
      )}

      {temporaryPassword && (
        <div
          role="status"
          className="mb-8 border border-[var(--primary)]/45 bg-[var(--primary)]/10 rounded-xl p-4"
        >
          <p className="text-sm font-medium text-[var(--foreground)] mb-2">
            Senha temporária — anote agora
          </p>
          <p className="font-mono text-lg tracking-wide text-[var(--primary)] break-all select-all mb-2">
            {temporaryPassword}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            Ela aparece uma única vez e não pode ser consultada depois. Entregue
            em mãos e peça para o cliente trocá-la no primeiro acesso.
          </p>
        </div>
      )}

      {/* Histórico real */}
      <div>
        <h3 className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-4">
          Histórico
        </h3>
        {history.length === 0 ? (
          <div className="border border-dashed border-[var(--primary)]/25 bg-[var(--surface-bronze)] rounded-2xl p-8 text-center">
            <CalendarCheck className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
            <p className="text-sm text-[var(--muted-foreground)]">
              Este cliente ainda não possui agendamentos.
            </p>
          </div>
        ) : (
          <div className="relative space-y-0">
            {history.map((appointment, index) => (
              <Link
                key={appointment.id}
                to={`/admin/agenda/${appointment.id}`}
                className="flex gap-4 group"
              >
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-3 h-3 rounded-full bg-[var(--primary)] border-2 border-[var(--background)] mt-1 shrink-0 z-10" />
                  {index < history.length - 1 && (
                    <div className="w-px flex-1 bg-[var(--border)] mt-1 mb-1" style={{ minHeight: '2rem' }} />
                  )}
                </div>
                <div className="pb-6 flex-1 flex items-start justify-between hover:bg-[var(--primary)]/5 rounded-lg px-3 py-1 transition-colors -ml-3">
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)] mb-0.5">
                      {formatDate(appointment.date)}
                    </p>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {appointment.serviceName}
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      R$ {appointment.servicePriceFormatted} · {appointment.startsAtClock}
                    </p>
                  </div>
                  <StatusBadge status={appointment.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
