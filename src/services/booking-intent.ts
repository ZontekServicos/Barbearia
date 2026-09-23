/**
 * Intenção de agendamento guardada entre a escolha do horário e o login.
 *
 * Vive em `sessionStorage`: morre ao fechar a aba e não atravessa sessões de
 * navegador. Guarda apenas identificadores e rótulos que já são públicos
 * (serviço, data, horário) — nada de dado pessoal ou credencial.
 *
 * IMPORTANTE: isto preserva a *seleção visual*, não reserva nada. Ao voltar,
 * o fluxo revalida a disponibilidade no backend antes de confirmar.
 */
const KEY = "ec.booking.intent"

export interface BookingIntent {
  serviceId: string
  /** yyyy-MM-dd na hora local da barbearia. */
  date: string
  /** HH:mm do início escolhido. */
  startsAt: string
  savedAt: number
}

/** Intenção velha não deve ressuscitar dias depois; 2h cobre o fluxo real. */
const MAX_AGE_MS = 2 * 60 * 60 * 1000

export function saveBookingIntent(
  intent: Omit<BookingIntent, "savedAt">,
): void {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...intent, savedAt: Date.now() }),
    )
  } catch {
    // Navegação privada ou armazenamento bloqueado: o fluxo segue sem
    // preservar a seleção, que é degradação aceitável.
  }
}

export function readBookingIntent(): BookingIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null

    const intent = parsed as Partial<BookingIntent>
    if (
      typeof intent.serviceId !== "string" ||
      typeof intent.date !== "string" ||
      typeof intent.startsAt !== "string" ||
      typeof intent.savedAt !== "number"
    )
      return null

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent.serviceId)) return null
    if (!Number.isFinite(intent.savedAt) || intent.savedAt > Date.now()) return null

    // Formatos conferidos antes de virarem requisição.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(intent.date)) return null
    if (!/^\d{2}:\d{2}$/.test(intent.startsAt)) return null
    if (Date.now() - intent.savedAt > MAX_AGE_MS) {
      clearBookingIntent()
      return null
    }
    return intent as BookingIntent
  } catch {
    return null
  }
}

export function clearBookingIntent(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Nada a fazer.
  }
}
