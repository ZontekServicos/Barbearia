import { useState } from 'react'
import { Building, Clock, Shield, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BUSINESS_HOURS } from '@/data/mock'
import { cn } from '@/lib/utils'

export default function Settings() {
  const [saved, setSaved] = useState(false)
  const [hours, setHours] = useState(BUSINESS_HOURS)

  function toggleDay(index: number) {
    setHours(prev => prev.map((h, i) => i === index ? { ...h, open: !h.open } : h))
  }

  function updateHour(index: number, field: 'start' | 'end', value: string) {
    setHours(prev => prev.map((h, i) => i === index ? { ...h, [field]: value } : h))
  }

  async function handleSave() {
    await new Promise(r => setTimeout(r, 500))
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="max-w-2xl space-y-8">
      {saved && (
        <div className="fixed top-4 right-4 z-50 bg-[var(--card)] border border-green-500/50 text-green-400 px-4 py-3 rounded-xl text-sm shadow-xl">
          Configurações salvas com sucesso.
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
        <div className="border border-[var(--border)] bg-[var(--card)] rounded-2xl p-5 space-y-4">
          <Input label="Nome" defaultValue="Cuts & Co." />
          <div className="grid grid-cols-2 gap-4">
            <Input label="WhatsApp" defaultValue="(71) 99999-0000" />
            <Input label="Instagram" defaultValue="@cutsandco" />
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
        <div className="border border-[var(--border)] bg-[var(--card)] rounded-2xl overflow-hidden">
          {hours.map((h, i) => (
            <div key={h.day} className={cn('flex items-center gap-3 px-5 py-3.5', i < hours.length - 1 && 'border-b border-[var(--border)]')}>
              <button
                onClick={() => toggleDay(i)}
                className={cn(
                  'w-10 h-5 rounded-full transition-colors shrink-0 relative',
                  h.open ? 'bg-[var(--primary)]' : 'bg-[var(--secondary)]'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                  h.open ? 'translate-x-5' : 'translate-x-0.5'
                )} />
              </button>
              <span className={cn('text-sm font-medium w-20 shrink-0', !h.open && 'text-[var(--muted-foreground)]')}>
                {h.day}
              </span>
              {h.open ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="time"
                    value={h.start}
                    onChange={e => updateHour(i, 'start', e.target.value)}
                    className="bg-[var(--secondary)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)] w-28"
                  />
                  <span className="text-[var(--muted-foreground)] text-sm">–</span>
                  <input
                    type="time"
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
        <div className="border border-[var(--border)] bg-[var(--card)] rounded-2xl p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Antecedência mínima (horas)" type="number" defaultValue="1" />
            <Input label="Antecedência máxima (dias)" type="number" defaultValue="30" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Limite de agendamentos ativos por cliente" type="number" defaultValue="2" />
            <Input label="Tempo mínimo para cancelamento (horas)" type="number" defaultValue="2" />
          </div>
          <div className="flex items-center justify-between py-2 border-t border-[var(--border)]">
            <div>
              <p className="text-sm font-medium">Permitir cancelamento pelo cliente</p>
              <p className="text-xs text-[var(--muted-foreground)]">Clientes podem cancelar pelo app</p>
            </div>
            <button className="w-10 h-5 rounded-full bg-[var(--primary)] relative shrink-0">
              <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-white shadow" />
            </button>
          </div>
        </div>
      </section>

      {/* Save */}
      <Button className="w-full h-12" onClick={handleSave}>
        <Save className="h-4 w-4 mr-2" />
        Salvar configurações
      </Button>
    </div>
  )
}
