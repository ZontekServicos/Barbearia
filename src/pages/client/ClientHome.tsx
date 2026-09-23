import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { Link } from "react-router-dom"
import { CalendarPlus, Clock, Scissors, AlertCircle, RefreshCw } from "lucide-react"
import { StatusBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/Logo"
import { ApiError } from "@/services/api"
import {
  listMyAppointments,
  listServices,
  type Appointment,
  type Service,
} from "@/services/booking"

function formatDate(dateISO: string) {
  const [, month, day] = dateISO.split("-")
  return `${day}/${month}`
}

export default function ClientHome() {
  const { user } = useAuth()
  const [upcoming, setUpcoming] = useState<Appointment[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [appointments, catalog] = await Promise.all([
        listMyAppointments("upcoming"),
        listServices(),
      ])
      setUpcoming(appointments.slice(0, 2))
      setServices(catalog.slice(0, 4))
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Não foi possível carregar seus dados.",
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div>
      {/* Greeting */}
      <div className="mb-8">
        <p className="text-[var(--muted-foreground)] text-sm">Bem-vindo de volta,</p>
        <h2 className="text-2xl font-bold tracking-tight">
          {user?.fullName ?? "Cliente"} 👋
        </h2>
      </div>

      {/* Ação prioritária */}
      <Link
        to="/client/schedule"
        className="block border border-[var(--primary)]/35 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-2xl p-5 mb-6 hover:border-[var(--primary)]/60 transition-all group"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-lg">Fazer novo agendamento</p>
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
              Escolha serviço, data e horário
            </p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-[var(--primary)] flex items-center justify-center group-hover:scale-105 transition-transform">
            <CalendarPlus className="h-6 w-6 text-black" />
          </div>
        </div>
      </Link>

      {error && (
        <div role="alert" className="border border-red-500/40 bg-red-500/10 rounded-2xl p-5 text-center mb-6">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-200 mb-4">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Próximos */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold tracking-widest text-[var(--primary)] uppercase">
            Próximos
          </h3>
          <Link
            to="/client/appointments"
            className="min-h-11 inline-flex items-center text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Ver todos →
          </Link>
        </div>

        {loading ? (
          <p role="status" className="text-sm text-[var(--muted-foreground)] py-4">
            Carregando…
          </p>
        ) : upcoming.length === 0 ? (
          <div className="border border-dashed border-[var(--primary)]/25 bg-[var(--surface-bronze)] rounded-xl p-6 text-center">
            <Logo className="h-8 w-8 text-[var(--muted-foreground)]/40 mx-auto mb-2" />
            <p className="text-sm text-[var(--muted-foreground)]">Nenhum agendamento futuro.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map(appointment => (
              <div
                key={appointment.id}
                className="border border-[var(--primary)]/20 bg-[var(--surface-bronze)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl p-4 flex items-center justify-between"
              >
                <div>
                  <p className="font-semibold text-sm">{appointment.serviceName}</p>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] mt-0.5">
                    <Clock className="h-3 w-3" />
                    <span>
                      {formatDate(appointment.date)} às {appointment.startsAtClock}
                    </span>
                  </div>
                </div>
                <StatusBadge status={appointment.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Serviços */}
      <div>
        <h3 className="text-xs font-semibold tracking-widest text-[var(--muted-foreground)] uppercase mb-3">
          Serviços
        </h3>
        {loading ? (
          <p role="status" className="text-sm text-[var(--muted-foreground)]">
            Carregando serviços…
          </p>
        ) : services.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            Nenhum serviço disponível no momento.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {services.map(service => (
              <Link
                key={service.id}
                to="/client/schedule"
                className="border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_14px_rgba(0,0,0,0.35)] rounded-xl p-3 hover:border-[var(--primary)]/40 transition-all"
              >
                <div className="w-8 h-8 rounded-lg bg-[var(--secondary)] flex items-center justify-center mb-2">
                  <Scissors className="h-4 w-4 text-[var(--primary)]" />
                </div>
                <p className="text-sm font-semibold">{service.name}</p>
                <p className="text-xs text-[var(--primary)] font-medium mt-0.5">
                  R$ {service.priceFormatted}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
