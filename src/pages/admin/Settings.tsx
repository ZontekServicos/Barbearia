import { useState } from 'react'
import { Building, Clock, Shield, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BUSINESS_HOURS } from '@/data/mock'
import { Switch } from '@/components/ui/Switch'
import { cn } from '@/lib/utils'

export default function Settings() {
  const [allowCancellation, setAllowCancellation] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [hours, setHours] = useState(BUSINESS_HOURS)

  function toggleDay(index: number) {
    setHours(prev => prev.map((h, i) => i === index ? { ...h, open: !h.open } : h))
  }

  function updateHour(index: number, field: 'start' | 'end', value: string) {
    setHours(prev => prev.map((h, i) => i === index ? { ...h, [field]: value } : h))
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    if (hours.some(hour => hour.open && (!hour.start || !hour.end || hour.start >= hour.end))) {
      setError('O horário de fechamento deve ser posterior à abertura em todos os dias abertos.')
      setSaved(false)
      return
    }
    setError('')
    setSaving(true)
    await new Promise(r => setTimeout(r, 500))
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <form onSubmit={handleSave} className="max-w-2xl space-y-8">
      {saved && (
        <div role="status" className="fixed top-4 right-4 left-4 sm:left-auto z-50 bg-[var(--card)] border border-green-500/50 text-green-400 px-4 py-3 rounded-xl text-sm shadow-xl">
          Simulação concluída. As configurações não foram gravadas.
        </div>
      )}

      <div>
        <h2 className="text-2xl font-bold tracking-tight">Configurações</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">Gerencie os dados e preferências da barbearia.</p>
      </div>

      {/* Business info */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Building className="h-4.5 w-4.5 text-[var(--primary)]" />
          <h3 className="text-base font-semibold">Dados da Barbearia</h3>
        </div>
        <div className="border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-5 space-y-4">
          <Input label="Nome" required defaultValue="ErickCorttes Barbearia" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="WhatsApp" defaultValue="(71) 99999-0000" />
            <Input label="Instagram" defaultValue="@erickcorttes" />
          </div>
          <Input label="Endereço" defaultValue="Rua das Palmeiras, 142 — Salvador, BA" />
        </div>
      </section>

      {/* Business hours */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-4.5 w-4.5 text-[var(--primary)]" />
          <h3 className="text-base font-semibold">Horários de Funcionamento</h3>
        </div>
        <div className="border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl overflow-hidden">
          {hours.map((h, i) => (
            <div key={h.day} className={cn('flex flex-wrap items-center gap-3 px-5 py-3.5', i < hours.length - 1 && 'border-b border-[var(--border)]')}>
              <Switch label={`Abrir ${h.day}`} checked={h.open} onChange={() => toggleDay(i)} />
              <span className={cn('text-sm font-medium w-20 shrink-0', !h.open && 'text-[var(--muted-foreground)]')}>
                {h.day}
              </span>
              {h.open ? (
                <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1">
                  <input
                    type="time"
                    aria-label={`Abertura ${h.day}`}
                    value={h.start}
                    onChange={e => updateHour(i, 'start', e.target.value)}
                    className="bg-[var(--secondary)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)] w-28"
                  />
                  <span className="text-[var(--muted-foreground)] text-sm">–</span>
                  <input
                    type="time"
                    aria-label={`Fechamento ${h.day}`}
                    value={h.end}
                    onChange={e => updateHour(i, 'end', e.target.value)}
                    className="bg-[var(--secondary)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)] w-28"
                  />
                </div>
              ) : (
                <span className="text-xs text-[var(--muted-foreground)] bg-[var(--secondary)] px-3 py-1 rounded-full">Fechado</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Booking rules */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-4.5 w-4.5 text-[var(--primary)]" />
          <h3 className="text-base font-semibold">Regras de Agendamento</h3>
        </div>
        <div className="border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Antecedência mínima (horas)" type="number" min="0" required defaultValue="1" />
            <Input label="Antecedência máxima (dias)" type="number" min="0" required defaultValue="30" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Limite de agendamentos ativos por cliente" type="number" min="1" required defaultValue="2" />
            <Input label="Tempo mínimo para cancelamento (horas)" type="number" min="0" required defaultValue="2" />
          </div>
          <div className="flex items-center justify-between py-2 border-t border-[var(--border)]">
            <div>
              <p className="text-sm font-medium">Permitir cancelamento pelo cliente</p>
              <p className="text-xs text-[var(--muted-foreground)]">Clientes podem cancelar pelo app</p>
            </div>
            <Switch label="Permitir cancelamento pelo cliente" checked={allowCancellation} onChange={() => setAllowCancellation(value => !value)} />
          </div>
        </div>
      </section>

      {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
      {/* Save */}
      <Button type="submit" className="w-full h-12" disabled={saving}>
        <Save className="h-4 w-4 mr-2" />
        Simular salvamento
      </Button>
    </form>
  )
}
