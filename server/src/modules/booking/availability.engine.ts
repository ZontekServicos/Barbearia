/**
 * Núcleo do cálculo de disponibilidade — função pura, sem banco e sem fuso.
 *
 * Tudo aqui é "minutos desde a meia-noite local do dia consultado". Quem
 * chama converte instantes para esse eixo e de volta (ver availability.service
 * e utils/time). Manter esta parte pura é o que permite testar a engine com
 * dezenas de cenários sem PostgreSQL nem relógio.
 *
 * Dois conceitos que NÃO se misturam:
 *
 *   DURAÇÃO DO SERVIÇO — quanto tempo o atendimento ocupa a cadeira.
 *   INTERVALO DE INÍCIO — de quanto em quanto tempo sugerimos um começo.
 *
 * A grade de início é regular (de 15 em 15, por padrão); o que varia por
 * serviço é o tamanho do bloco que precisa caber a partir dali.
 */

/** Janela de expediente contínua. Um dia com almoço tem duas. */
export interface OpenWindow {
  startMinute: number
  endMinute: number
}

/**
 * Período ocupado. Pode vir de agendamento ou de bloqueio administrativo —
 * a engine trata os dois igual, porque para a agenda são a mesma coisa.
 *
 * `startMinute` pode ser negativo e `endMinute` pode passar de 1440 quando o
 * período atravessa a meia-noite. Não clampe: a matemática de sobreposição
 * funciona com o eixo estendido, e clampar criaria conflitos falsos.
 */
export interface BusyInterval {
  startMinute: number
  endMinute: number
}

export interface ComputeSlotsInput {
  windows: OpenWindow[]
  busy: BusyInterval[]
  /** Duração real do serviço escolhido, vinda do banco. */
  durationMinutes: number
  /** Grade de início. Não confundir com a duração. */
  slotIntervalMinutes: number
  /** Preparação antes e limpeza depois. Reservas em produção exigem zero. */
  bufferBeforeMinutes?: number
  bufferAfterMinutes?: number
  /**
   * Menor minuto aceitável para começar, já considerando antecedência mínima
   * e o relógio. Quem chama resolve isso; a engine só compara.
   */
  earliestStartMinute?: number
}

/** `true` se [aStart, aEnd) e [bStart, bEnd) se sobrepõem. */
export function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  // Intervalo semiaberto: terminar 09:30 e começar 09:30 não é conflito.
  return aStart < bEnd && bStart < aEnd
}

/**
 * O bloco que um atendimento realmente tira da agenda: a duração mais os
 * buffers dele.
 *
 * Quando A tem 5 min de limpeza depois e B tem 10 min de preparo antes, o
 * intervalo necessário entre eles é 15 — são duas atividades distintas, não a
 * mesma contada duas vezes. Por isso os dois lados são expandidos.
 */
export function blockedRange(
  startMinute: number,
  durationMinutes: number,
  bufferBeforeMinutes = 0,
  bufferAfterMinutes = 0,
): BusyInterval {
  return {
    startMinute: startMinute - bufferBeforeMinutes,
    endMinute: startMinute + durationMinutes + bufferAfterMinutes,
  }
}

/** A janela comporta o atendimento inteiro a partir deste início? */
export function fitsInWindow(
  window: OpenWindow,
  startMinute: number,
  durationMinutes: number,
): boolean {
  return (
    startMinute >= window.startMinute &&
    startMinute + durationMinutes <= window.endMinute
  )
}

/** Alguma janela comporta o atendimento inteiro? */
export function fitsInAnyWindow(
  windows: OpenWindow[],
  startMinute: number,
  durationMinutes: number,
): boolean {
  return windows.some(window => fitsInWindow(window, startMinute, durationMinutes))
}

/** A criação aceita os mesmos inícios de grade oferecidos pela consulta. */
export function isStartOnSlotGrid(
  windows: OpenWindow[],
  startMinute: number,
  slotIntervalMinutes: number,
): boolean {
  if (!Number.isInteger(slotIntervalMinutes) || slotIntervalMinutes <= 0) return false
  return windows.some(window =>
    startMinute >= window.startMinute &&
    startMinute < window.endMinute &&
    (startMinute - window.startMinute) % slotIntervalMinutes === 0,
  )
}

/**
 * Minutos de início oferecíveis, em ordem crescente.
 *
 * A grade é ancorada no início de CADA janela, não na abertura do dia. Se o
 * almoço termina às 14:10, a tarde começa exatamente em 14:10. Uma grade de
 * 15 minutos contada desde as 09:00 só voltaria a oferecer início às 14:15.
 */
export function computeSlotStarts(input: ComputeSlotsInput): number[] {
  const {
    windows,
    busy,
    durationMinutes,
    slotIntervalMinutes,
    bufferBeforeMinutes = 0,
    bufferAfterMinutes = 0,
    earliestStartMinute = Number.NEGATIVE_INFINITY,
  } = input

  if (
    !Number.isFinite(durationMinutes) || durationMinutes <= 0 ||
    !Number.isFinite(slotIntervalMinutes) || slotIntervalMinutes <= 0
  ) return []

  const starts: number[] = []

  for (const window of [...windows].sort((a, b) => a.startMinute - b.startMinute)) {
    for (
      let start = window.startMinute;
      // O atendimento precisa terminar dentro da MESMA janela: um corte de 50
      // min às 11:30 terminaria 12:20 e não vale, mesmo havendo expediente à
      // tarde. A agenda não é retomada depois do almoço.
      start + durationMinutes <= window.endMinute;
      start += slotIntervalMinutes
    ) {
      if (start < earliestStartMinute) continue

      const candidate = blockedRange(
        start,
        durationMinutes,
        bufferBeforeMinutes,
        bufferAfterMinutes,
      )

      const conflict = busy.some(entry =>
        overlaps(candidate.startMinute, candidate.endMinute, entry.startMinute, entry.endMinute),
      )
      if (conflict) continue

      starts.push(start)
    }
  }

  return starts
}

/**
 * Janelas de atendimento do dia a partir da configuração de expediente.
 *
 * O intervalo (almoço) parte o dia em duas janelas em vez de virar um período
 * "ocupado". A diferença importa: como janela, ele também reancora a grade de
 * início e impede que um atendimento o atravesse por construção, em vez de
 * depender de uma checagem extra que alguém pode esquecer de repetir.
 */
export function windowsFromBusinessHours(day: {
  openMinute: number
  closeMinute: number
  breakStartMinute: number | null
  breakEndMinute: number | null
}): OpenWindow[] {
  const { openMinute, closeMinute, breakStartMinute, breakEndMinute } = day

  if (closeMinute <= openMinute) return []

  if (
    breakStartMinute === null ||
    breakEndMinute === null ||
    breakEndMinute <= breakStartMinute ||
    breakEndMinute <= openMinute ||
    breakStartMinute >= closeMinute
  ) {
    return [{ startMinute: openMinute, endMinute: closeMinute }]
  }

  const windows: OpenWindow[] = []
  const morningEnd = Math.max(openMinute, Math.min(breakStartMinute, closeMinute))
  const afternoonStart = Math.min(closeMinute, Math.max(breakEndMinute, openMinute))

  if (morningEnd > openMinute) {
    windows.push({ startMinute: openMinute, endMinute: morningEnd })
  }
  if (closeMinute > afternoonStart) {
    windows.push({ startMinute: afternoonStart, endMinute: closeMinute })
  }

  return windows
}
