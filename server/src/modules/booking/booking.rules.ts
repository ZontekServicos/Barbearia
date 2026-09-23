/**
 * Regras de agenda. Ficam centralizadas aqui para não se espalharem pelo
 * código — e para que virarem configuração administrativa no futuro seja uma
 * mudança localizada.
 */
export const BookingRules = {
  /** Grade de horários oferecida ao cliente. */
  slotIntervalMinutes: 15,
  /** Antecedência mínima entre agora e o início do atendimento. */
  minimumAdvanceMinutes: 60,
  /** Até quando o cliente pode agendar. */
  maximumAdvanceDays: 60,
  /** Prazo para o cliente cancelar sozinho. Depois disso, só a barbearia. */
  customerCancellationCutoffMinutes: 120,
} as const
