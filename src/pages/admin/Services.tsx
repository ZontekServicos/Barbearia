import { useCallback, useEffect, useState } from 'react'
import { Scissors, Plus, Edit2, Clock, DollarSign, X, Check, Power, AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ApiError } from '@/services/api'
import {
  createAdminService,
  listAdminServices,
  setAdminServiceActive,
  updateAdminService,
  type ServicePayload,
} from '@/services/admin-booking'
import type { Service } from '@/services/booking'

/** "35,00" ou "35.00" -> 3500. Dinheiro só circula em centavos. */
function toCents(input: string): number | null {
  const normalized = input.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  return Math.round(Number(normalized) * 100)
}

function ServiceForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Service
  onSave: (payload: ServicePayload) => void
  onCancel: () => void
  saving: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [price, setPrice] = useState(
    initial ? (initial.priceCents / 100).toFixed(2).replace('.', ',') : '',
  )
  const [duration, setDuration] = useState(initial?.durationMinutes?.toString() ?? '')
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const priceCents = toCents(price)
    if (priceCents === null) {
      setFormError('Informe o preço no formato 35,00.')
      return
    }

    const durationMinutes = Number(duration)
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      setFormError('A duração deve ser um número de minutos maior que zero.')
      return
    }

    setFormError(null)
    onSave({ name: name.trim(), description: description.trim(), priceCents, durationMinutes })
  }

  return (
    <form onSubmit={handleSubmit} className="border border-[var(--primary)]/30 bg-[var(--surface-bronze)] rounded-2xl p-5 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Input
            label="Nome do serviço"
            pattern=".*\S.*"
            title="Informe um nome com pelo menos um caractere que não seja espaço"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Corte"
            required
          />
        </div>
        <div className="col-span-2">
          <Input label="Descrição" value={description} onChange={e => setDescription(e.target.value)} placeholder="Breve descrição" />
        </div>
        <Input label="Preço (R$)" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="35,00" required />
        <Input label="Duração (min)" type="number" min="5" value={duration} onChange={e => setDuration(e.target.value)} placeholder="40" required />
      </div>

      {formError && (
        <p role="alert" className="text-sm text-red-400">{formError}</p>
      )}

      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" className="flex-1" disabled={saving}>
          <Check className="h-4 w-4 mr-1.5" />
          {saving ? 'Salvando...' : initial ? 'Salvar alterações' : 'Criar serviço'}
        </Button>
        <Button type="button" size="sm" variant="outline" aria-label="Cancelar edição" onClick={onCancel} disabled={saving}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </form>
  )
}

export default function Services() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setServices(await listAdminServices(true))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar os serviços.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleCreate(payload: ServicePayload) {
    setSaving(true)
    setActionError(null)
    try {
      await createAdminService(payload)
      setCreating(false)
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível criar o serviço.')
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(id: string, payload: ServicePayload) {
    setSaving(true)
    setActionError(null)
    try {
      await updateAdminService(id, payload)
      setEditingId(null)
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível salvar o serviço.')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(service: Service) {
    setActionError(null)
    try {
      await setAdminServiceActive(service.id, !service.active)
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Não foi possível alterar o serviço.')
    }
  }

  const activeCount = services.filter(service => service.active).length

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Serviços</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {loading ? 'Carregando…' : `${activeCount} serviços ativos.`}
          </p>
        </div>
        {!creating && !loading && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Adicionar serviço
          </Button>
        )}
      </div>

      {actionError && (
        <p role="alert" className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {actionError}
        </p>
      )}

      {creating && (
        <div className="mb-4">
          <ServiceForm onSave={handleCreate} onCancel={() => setCreating(false)} saving={saving} />
        </div>
      )}

      {loading ? (
        <p role="status" className="text-sm text-[var(--muted-foreground)]">Carregando serviços…</p>
      ) : error ? (
        <div role="alert" className="border border-red-500/40 bg-red-500/10 rounded-2xl p-5 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-200 mb-4">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Tentar novamente
          </Button>
        </div>
      ) : services.length === 0 ? (
        <div className="border border-dashed border-[var(--primary)]/25 bg-[var(--surface-bronze)] rounded-2xl p-8 text-center">
          <Scissors className="h-10 w-10 text-[var(--muted-foreground)]/40 mx-auto mb-3" />
          <p className="text-sm text-[var(--muted-foreground)]">
            Nenhum serviço cadastrado ainda.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map(service => (
            <div key={service.id}>
              {editingId === service.id ? (
                <ServiceForm
                  initial={service}
                  onSave={payload => handleEdit(service.id, payload)}
                  onCancel={() => setEditingId(null)}
                  saving={saving}
                />
              ) : (
                <div className={`border rounded-2xl p-5 transition-all ${service.active ? 'border-[var(--primary)]/20 bg-[var(--surface-bronze)]' : 'border-[var(--border)]/50 bg-[var(--card)]/50'}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 flex items-center justify-center">
                        <Scissors className="h-5 w-5 text-[var(--primary)]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{service.name}</h3>
                          {!service.active && <Badge>Inativo</Badge>}
                        </div>
                        <p className="text-xs text-[var(--muted-foreground)]">{service.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        aria-label={`Editar ${service.name}`}
                        onClick={() => setEditingId(service.id)}
                        className="p-1.5 rounded-lg hover:bg-[var(--primary)]/10 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1.5 text-[var(--primary)] font-bold">
                        <DollarSign className="h-3.5 w-3.5" />
                        R$ {service.priceFormatted}
                      </div>
                      <div className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                        <Clock className="h-3.5 w-3.5" />
                        {service.durationMinutes} min
                      </div>
                    </div>
                    <button
                      onClick={() => void handleToggleActive(service)}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full border transition-all ${service.active ? 'border-green-500/40 bg-green-500/10 text-green-400 hover:bg-green-500/20' : 'border-[var(--border)] bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
                    >
                      <Power className="h-3 w-3" />
                      {service.active ? 'Ativo' : 'Inativo'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-[var(--muted-foreground)] mt-6">
        Serviços não são excluídos: desativar remove do catálogo do cliente e preserva o histórico
        de quem já agendou.
      </p>
    </div>
  )
}
