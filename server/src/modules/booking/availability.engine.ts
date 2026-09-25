/**
 * Núcleo do cálculo de disponibilidade — função pura, sem banco e sem fuso.
 *
 * Tudo aqui é "minutos desde a meia-noite local do dia consultado". Quem
 * chama converte instantes para esse eixo e de volta (ver availability.service
 * e utils/time). Manter esta parte pura é o que permite testar a engine com
 * dezenas de cenários sem PostgreSQL nem relógio.
 *
 * Três conceitos que NÃO se misturam:
 *
 *   DURAÇÃO DO SERVIÇO — o que o cliente compra e vê (30, 40, 45, 50 min).
 *   RESERVA OPERACIONAL — o que a agenda bloqueia: max(grade, duração+buffers).
 *   GRADE DE INÍCIO     — de quanto em quanto tempo sugerimos um começo.
 *
 * A grade é regular (40 min por padrão). O que varia por serviço é o tamanho
 * do bloco reservado a partir dali — e é esse bloco, não a duração, que
 * decide se dois atendimentos cabem lado a lado.
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
  /**
   * Minutos efetivamente bloqueados a partir do início. Normalmente
   * `max(grade, duração + buffers)`. Quando ausente, cai na duração — o que
   * mantém o comportamento antigo para quem chama sem reserva operacional.
   */
  reservedMinutes?: number
  /** Grade de início. Não confundir com duração nem com reserva. */
  slotIntervalMinutes: number
  /** Preparação antes e limpeza depois. Reservas em produção exigem zero. */
  bufferBeforeMinutes?: number
  bufferAfterMinutes?: number
  /**
   * Menor minuto aceitável para começar, já considerando antecedência mínima
   * e o relógio. Quem chama resolve isso; a engine só compara.
   */
  earliestStartMinute?: number
  /**
   * Oferecer também início no fim de cada período ocupado, além da grade.
   * Ver BookingRules.adaptiveSchedulingEnabled.
   */
  adaptive?: boolean
  /** Teto de opções devolvidas. Reduz por amostragem, nunca truncando o fim. */
  maxOptions?: number
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

/**
 * Reduz a lista a no máximo `maxOptions` mantendo cobertura do dia inteiro.
 *
 * `slice(0, n)` esconderia o fim do expediente — quem procura horário à noite
 * não veria nenhum. A amostragem é espaçada e determinística, e preserva
 * sempre o primeiro e o último início.
 */
export function limitStartOptions(starts: number[], maxOptions: number): number[] {
  if (!Number.isFinite(maxOptions) || maxOptions <= 0) return starts
  if (starts.length <= maxOptions) return starts
  if (maxOptions === 1) return [starts[0]!]

  const kept: number[] = []
  const step = (starts.length - 1) / (maxOptions - 1)
  for (let index = 0; index < maxOptions; index++) {
    kept.push(starts[Math.round(index * step)]!)
  }
  // Arredondamentos podem repetir um índice; a ordem já é crescente.
  return [...new Set(kept)]
}

/**
 * Minutos de início oferecíveis, em ordem crescente.
 *
 * A grade é ancorada no início de CADA janela, não na abertura do dia. Se o
 * almoço termina às 14:10, a tarde começa exatamente em 14:10. Uma grade de
 * 40 minutos contada desde as 09:00 só voltaria a oferecer início às 14:20.
 *
 * Com a política adaptativa ligada, entram também os instantes em que um
 * atendimento já marcado termina — é o que permite oferecer 09:50 depois de
 * um serviço de 50 min iniciado às 09:00, em vez de pular para 10:20. São
 * candidatos adicionais, submetidos exatamente às mesmas checagens: nada é
 * oferecido sem que o bloco inteiro caiba livre.
 *
 * Determinístico: o conjunto de candidatos depende só da configuração, do
 * expediente e dos períodos ocupados. Duas chamadas com a mesma entrada
 * devolvem a mesma lista, então dois clientes simultâneos veem o mesmo.
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
    adaptive = false,
    maxOptions,
  } = input

  const reservedMinutes = input.reservedMinutes ?? durationMinutes

  if (
    !Number.isFinite(durationMinutes) || durationMinutes <= 0 ||
    !Number.isFinite(reservedMinutes) || reservedMinutes <= 0 ||
    !Number.isFinite(slotIntervalMinutes) || slotIntervalMinutes <= 0
  ) return []

  const ordered = [...windows].sort((a, b) => a.startMinute - b.startMinute)
  const starts: number[] = []

  for (const window of ordered) {
    const candidates: number[] = []

    for (
      let start = window.startMinute;
      // O SERVIÇO precisa terminar dentro da MESMA janela: um corte de 50 min
      // às 11:30 terminaria 12:20 e não vale, mesmo havendo expediente à
      // tarde. A agenda não é retomada depois do almoço.
      start + durationMinutes <= window.endMinute;
      start += slotIntervalMinutes
    ) {
      candidates.push(start)
    }

    if (adaptive) {
      // Reancoragem: o fim de cada período ocupado vira candidato, desde que
      // caia nesta janela e o serviço ainda caiba a partir dali.
      for (const entry of busy) {
        // Arredonda para cima: um bloqueio que termina 10:00:01 libera 10:01,
        // nunca 10:00,0166. Horário oferecido é sempre minuto cheio.
        const candidate = Math.ceil(entry.endMinute)
        if (
          candidate >= window.startMinute &&
          candidate + durationMinutes <= window.endMinute &&
          !candidates.includes(candidate)
        ) {
          candidates.push(candidate)
        }
      }
    }

    candidates.sort((a, b) => a - b)

    for (const start of candidates) {
      if (start < earliestStartMinute) continue

      // O bloco comparado é a RESERVA, não a duração: é ela que impede o
      // próximo atendimento de encostar cedo demais.
      const candidate = blockedRange(
        start,
        reservedMinutes,
        bufferBeforeMinutes,
        bufferAfterMinutes,
      )

      if (candidate.startMinute < window.startMinute || candidate.endMinute > window.endMinute) continue

      const conflict = busy.some(entry =>
        overlaps(candidate.startMinute, candidate.endMinute, entry.startMinute, entry.endMinute),
      )
      if (conflict) continue

      starts.push(start)
    }
  }

  starts.sort((a, b) => a - b)
  const unique = [...new Set(starts)]
  return maxOptions === undefined ? unique : limitStartOptions(unique, maxOptions)
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
