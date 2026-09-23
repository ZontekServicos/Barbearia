import { AppError, ErrorCodes } from "./errors.js"

/**
 * Estratégia de fuso horário — decisão única do projeto.
 *
 * ARMAZENAMENTO: todo instante vai para o banco como `timestamptz` (UTC por
 *   dentro). Nada de "hora local" solta em coluna sem fuso.
 * REGRA DE NEGÓCIO: horário de funcionamento é hora de parede da barbearia
 *   (minutos desde a meia-noite local). "Abre às 9h" continua sendo 9h
 *   independentemente de fuso, mudança de horário de verão ou do servidor.
 * API: sempre ISO-8601 com offset explícito (2026-09-22T09:00:00.000-03:00).
 *   Nunca uma string sem fuso, que o cliente interpretaria como local dele.
 * EXIBIÇÃO: frontend formata em America/Sao_Paulo via Intl.
 *
 * Toda conversão entre hora de parede e instante passa por este arquivo.
 * Se precisarmos operar em outro fuso um dia, muda aqui e só aqui.
 */
export const SHOP_TIMEZONE = "America/Sao_Paulo"

export const MINUTES_IN_DAY = 1440

/** Diferença, em ms, entre a hora local do fuso e o UTC naquele instante. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant)

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find(part => part.type === type)?.value
    return value === undefined ? 0 : Number(value)
  }

  const asIfUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    // Algumas versões do ICU devolvem "24" para meia-noite com hour12:false.
    read("hour") % 24,
    read("minute"),
    read("second"),
  )

  return asIfUtc - instant.getTime()
}

/** Aceita apenas AAAA-MM-DD e valida que a data existe de fato. */
export function parseShopDate(dateISO: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO)
  if (!match) {
    throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, "Data inválida. Use AAAA-MM-DD.")
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, "Data inexistente no calendário.")
  }

  return { year, month, day }
}

/**
 * Converte hora de parede da barbearia em instante absoluto.
 *
 * Resolve o offset em duas passadas porque ele depende do próprio instante
 * (transições de horário de verão). O Brasil não usa mais DST, mas a conta
 * continua correta se isso mudar ou se o fuso da loja for trocado.
 */
export function shopWallClockToInstant(dateISO: string, minutesFromMidnight: number): Date {
  const { year, month, day } = parseShopDate(dateISO)
  const naive = Date.UTC(year, month - 1, day) + minutesFromMidnight * 60_000

  const firstGuess = naive - zoneOffsetMs(new Date(naive), SHOP_TIMEZONE)
  const refinedOffset = zoneOffsetMs(new Date(firstGuess), SHOP_TIMEZONE)

  return new Date(naive - refinedOffset)
}

/** Data local da barbearia (AAAA-MM-DD) correspondente a um instante. */
export function instantToShopDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant)

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? "00"

  return `${read("year")}-${read("month")}-${read("day")}`
}

/** Minutos desde a meia-noite local da barbearia. */
export function instantToShopMinutes(instant: Date): number {
  const offset = zoneOffsetMs(instant, SHOP_TIMEZONE)
  const local = new Date(instant.getTime() + offset)
  return local.getUTCHours() * 60 + local.getUTCMinutes()
}

/** Dia da semana local (0 = domingo) de uma data AAAA-MM-DD. */
export function shopWeekday(dateISO: string): number {
  const { year, month, day } = parseShopDate(dateISO)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Minutos desde a meia-noite -> "HH:MM". */
export function minutesToClock(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
}

/** "HH:MM" -> minutos desde a meia-noite. Rejeita formato inválido. */
export function clockToMinutes(clock: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock)
  if (!match) {
    throw AppError.badRequest(ErrorCodes.VALIDATION_ERROR, "Horário inválido. Use HH:MM.")
  }
  return Number(match[1]) * 60 + Number(match[2])
}

/** Soma dias a uma data AAAA-MM-DD sem passar por fuso. */
export function addDaysToShopDate(dateISO: string, days: number): string {
  const { year, month, day } = parseShopDate(dateISO)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

/** Dois intervalos [início, fim) se sobrepõem? */
export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}
