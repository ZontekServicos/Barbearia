import { useCallback, useEffect, useState } from 'react'
import { Clock, Save, AlertCircle, RefreshCw, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/Switch'
import { ApiError } from '@/services/api'
import { listAdminBusinessHours, saveBusinessHours } from '@/services/admin-booking'
import type { BusinessHoursDay } from '@/services/booking'
import { cn } from '@/lib/utils'

const WEEKDAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

/** Semana começando na segunda, como se lê no mundo real. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

export default function Settings() {
  const [days, setDays] = useState<BusinessHoursDay[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setDays(await listAdminBusinessHours())
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar o expediente.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function updateDay(weekday: number, patch: Partial<BusinessHoursDay>) {
    setDays(prev =>
      prev?.map(day => (day.weekday === weekday ? { ...day, ...patch } : day)) ?? prev,
    )
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    if (saving || !days) return

    const invalid = days.find(day => !day.closed && day.opensAt >= day.closesAt)
    if (invalid) {
      setError(`Em ${WEEKDAY_NAMES[invalid.weekday]}, o fechamento deve ser depois da abertura.`)
      setSaved(false)
      return
    }

    setError('')
    setSaving(true)
    try {
      // A semana inteira vai numa requisição: o backend grava em transação.
      setDays(await saveBusinessHours(days))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o expediente.')
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="max-w-2xl">
        <div role="alert" className="border border-red-500/40 bg-red-500/10 rounded-2xl p-6 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-200 mb-4">{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Tentar novamente
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className="max-w-2xl space-y-8">
      {saved && (
        <div role="status" className="fixed top-4 right-4 left-4 sm:left-auto z-50 bg-[var(--card)] border border-green-500/50 text-green-400 px-4 py-3 rounded-xl text-sm shadow-xl">
          Expediente salvo. A agenda já usa os novos horários.
        </div>
      )}

      <div>
        <h2 className="text-2xl font-bold tracking-tight">Configurações</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Defina quando a barbearia atende. A disponibilidade do cliente segue estes horários.
        </p>
      </div>

      {/* Horário de funcionamento */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-4.5 w-4.5 text-[var(--primary)]" />
          <h3 className="text-base font-semibold">Horários de Funcionamento</h3>
        </div>

        {!days ? (
          <p role="status" className="text-sm text-[var(--muted-foreground)]">Carregando expediente…</p>
        ) : (
          <div className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl overflow-hidden">
            {WEEK_ORDER.map((weekday, index) => {
              const day = days.find(entry => entry.weekday === weekday)
              if (!day) return null
              const name = WEEKDAY_NAMES[weekday]
              return (
                <div
                  key={weekday}
                  className={cn(
                    'flex flex-wrap items-center gap-3 px-5 py-3.5',
                    index < WEEK_ORDER.length - 1 && 'border-b border-[var(--primary)]/15',
                  )}
                >
                  <Switch
                    label={`Abrir ${name}`}
                    checked={!day.closed}
                    onChange={() => updateDay(weekday, { closed: !day.closed })}
                  />
                  <span className={cn('text-sm font-medium w-20 shrink-0', day.closed && 'text-[var(--muted-foreground)]')}>
                    {name}
                  </span>
                  {day.closed ? (
                    <span className="text-xs text-[var(--muted-foreground)] bg-[var(--secondary)] px-3 py-1 rounded-full">Fechado</span>
                  ) : (
                    <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1">
                      <input
                        type="time"
                        aria-label={`Abertura ${name}`}
                        value={day.opensAt}
                        onChange={e => updateDay(weekday, { opensAt: e.target.value })}
                        className="bg-[var(--background)] border border-[var(--primary)]/20 rounded-lg px-3 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)] w-28"
                      />
                      <span className="text-[var(--muted-foreground)] text-sm">–</span>
                      <input
                        type="time"
                        aria-label={`Fechamento ${name}`}
                        value={day.closesAt}
                        onChange={e => updateDay(weekday, { closesAt: e.target.value })}
                        className="bg-[var(--background)] border border-[var(--primary)]/20 rounded-lg px-3 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--primary)] w-28"
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/*
        Dados da barbearia e regras de antecedência ainda não têm persistência.
        Em vez de manter formulários que descartam o que é digitado, o estado
        real está declarado aqui.
      */}
      <section>
        <div className="flex items-start gap-2 border border-[var(--border)] bg-[var(--card)] rounded-2xl p-4">
          <Info className="h-4 w-4 text-[var(--primary)] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Ainda não configurável por aqui</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">
              Dados de contato da barbearia e regras de antecedência (mínima, máxima e prazo de
              cancelamento) são aplicados pelo backend, mas ainda não têm tela de edição. Bloqueios
              pontuais de agenda são feitos na própria agenda.
            </p>
          </div>
        </div>
      </section>

      {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}

      <Button type="submit" className="w-full h-12" disabled={saving || !days}>
        <Save className="h-4 w-4 mr-2" />
        {saving ? 'Salvando...' : 'Salvar horários'}
      </Button>
    </form>
  )
}
