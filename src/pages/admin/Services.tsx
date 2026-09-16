import { useState } from 'react'
import { Scissors, Plus, Edit2, Trash2, Clock, DollarSign, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/badge'
import { SERVICES } from '@/data/mock'
import type { Service } from '@/data/mock'

function ServiceForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Service>
  onSave: (s: Partial<Service>) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [price, setPrice] = useState(initial?.price?.toString() ?? '')
  const [duration, setDuration] = useState(initial?.duration?.toString() ?? '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onSave({ name: name.trim(), description, price: Number(price), duration: Number(duration), active: initial?.active ?? true })
  }

  return (
    <form onSubmit={handleSubmit} className="border border-[var(--primary)]/30 bg-[var(--card)] rounded-2xl p-5 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Input label="Nome do serviço" pattern=".*\S.*" title="Informe um nome com pelo menos um caractere que não seja espaço" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Corte" required />
        </div>
        <div className="col-span-2">
          <Input label="Descrição" value={description} onChange={e => setDescription(e.target.value)} placeholder="Breve descrição" />
        </div>
        <Input label="Preço (R$)" type="number" min="1" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="35" required />
        <Input label="Duração (min)" type="number" min="5" value={duration} onChange={e => setDuration(e.target.value)} placeholder="40" required />
      </div>
      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" className="flex-1">
          <Check className="h-4 w-4 mr-1.5" />
          {initial?.id ? 'Salvar alterações' : 'Criar serviço'}
        </Button>
        <Button type="button" size="sm" variant="outline" aria-label="Cancelar edição" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </form>
  )
}

export default function Services() {
  const [services, setServices] = useState(SERVICES)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  function handleCreate(data: Partial<Service>) {
    const newService: Service = {
      id: `s${Date.now()}`,
      name: data.name!,
      description: data.description ?? '',
      price: data.price!,
      duration: data.duration!,
      active: true,
    }
    setServices(prev => [...prev, newService])
    setCreating(false)
  }

  function handleEdit(id: string, data: Partial<Service>) {
    setServices(prev => prev.map(s => s.id === id ? { ...s, ...data } : s))
    setEditingId(null)
  }

  function handleToggleActive(id: string) {
    setServices(prev => prev.map(s => s.id === id ? { ...s, active: !s.active } : s))
  }

  function handleDelete(id: string) {
    setServices(prev => prev.filter(s => s.id !== id))
    setDeleteId(null)
  }

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Serviços</h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">{services.filter(s => s.active).length} serviços ativos.</p>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Adicionar serviço
          </Button>
        )}
      </div>

      {/* Create form */}
      {creating && (
        <div className="mb-4">
          <ServiceForm onSave={handleCreate} onCancel={() => setCreating(false)} />
        </div>
      )}

      {/* Services list */}
      <div className="space-y-3">
        {services.map(service => (
          <div key={service.id}>
            {editingId === service.id ? (
              <ServiceForm
                initial={service}
                onSave={data => handleEdit(service.id, data)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div className={`border rounded-2xl p-5 transition-all ${service.active ? 'border-[var(--border)] bg-[var(--card)]' : 'border-[var(--border)]/50 bg-[var(--card)]/50'}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[var(--primary)]/10 flex items-center justify-center">
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
                      className="p-1.5 rounded-lg hover:bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      aria-label={`Excluir ${service.name}`}
                      onClick={() => setDeleteId(service.id)}
                      className="p-1.5 rounded-lg hover:bg-red-900/30 text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5 text-[var(--primary)] font-bold">
                      <DollarSign className="h-3.5 w-3.5" />
                      R$ {service.price}
                    </div>
                    <div className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                      <Clock className="h-3.5 w-3.5" />
                      {service.duration} min
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleActive(service.id)}
                    className={`text-xs font-medium px-3 py-1 rounded-full border transition-all ${service.active ? 'border-green-500/40 bg-green-500/10 text-green-400 hover:bg-green-500/20' : 'border-[var(--border)] bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
                  >
                    {service.active ? 'Ativo' : 'Inativo'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Delete confirmation */}
      {deleteId && (
        <Modal titleId="delete-service-title" onClose={() => setDeleteId(null)}>
            <h3 id="delete-service-title" className="text-lg font-bold mb-2">Excluir serviço?</h3>
            <p className="text-sm text-[var(--muted-foreground)] mb-6">Esta ação não pode ser desfeita.</p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteId(null)}>Cancelar</Button>
              <Button variant="destructive" className="flex-1" onClick={() => handleDelete(deleteId)}>Excluir</Button>
            </div>
        </Modal>
      )}
    </div>
  )
}
