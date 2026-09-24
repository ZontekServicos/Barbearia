/**
 * Semana da agenda, calculada só com strings `AAAA-MM-DD`.
 *
 * Por que não `date-fns` com objetos `Date` aqui: `startOfWeek()` devolve uma
 * instância nova a cada chamada. Usada direto no corpo de um componente, ela
 * vira uma dependência que muda em todo render — `useCallback` e `useEffect`
 * comparam por identidade (`Object.is`), então o efeito dispara de novo,
 * re-renderiza, gera outra `Date`, e o ciclo não fecha. Foi exatamente essa a
 * causa do loop de requisições na Agenda.
 *
 * Uma chave em string é estável por valor: a mesma semana produz a mesma
 * string, e o efeito só roda de novo quando a semana realmente muda.
 */

/** Dias sem fuso: a aritmética acontece em UTC e só o calendário importa. */
function toUTC(dateISO: string): Date {
  const [year, month, day] = dateISO.split("-").map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!))
}

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDaysISO(dateISO: string, days: number): string {
  const date = toUTC(dateISO)
  date.setUTCDate(date.getUTCDate() + days)
  return toISO(date)
}

/** Segunda-feira da semana que contém a data. */
export function mondayOf(dateISO: string): string {
  const date = toUTC(dateISO)
  // getUTCDay(): 0 = domingo. Domingo pertence à semana que começou na segunda
  // anterior, por isso o recuo de 6 dias em vez de 1.
  const weekday = date.getUTCDay()
  const offset = weekday === 0 ? -6 : 1 - weekday
  return addDaysISO(dateISO, offset)
}

export interface WeekRange {
  /** Segunda-feira, usada como chave estável de cache e de efeito. */
  from: string
  /** Sábado. A barbearia não abre domingo, então a faixa mostra 6 dias. */
  to: string
  days: string[]
}

const VISIBLE_DAYS = 6

export function weekRangeFor(dateISO: string): WeekRange {
  const from = mondayOf(dateISO)
  return {
    from,
    to: addDaysISO(from, VISIBLE_DAYS - 1),
    days: Array.from({ length: VISIBLE_DAYS }, (_, index) => addDaysISO(from, index)),
  }
}

/** Duas datas caem na mesma semana da agenda? */
export function sameWeek(a: string, b: string): boolean {
  return mondayOf(a) === mondayOf(b)
}
