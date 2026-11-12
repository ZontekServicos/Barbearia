import { existsSync } from "node:fs"
if (existsSync(".env")) process.loadEnvFile(".env")
const { disconnectPrisma, prisma } = await import("../config/prisma.js")
const { listWeeklyOpenings, replaceWeekdayOpenings } = await import(
  "../modules/booking/opening.service.js"
)

/**
 * Abre a semana UMA vez, para a agenda não nascer muda depois do deploy.
 *
 * A agenda é fechada por padrão de propósito — ninguém quer que ela reabra
 * sozinha num dia que a barbearia fechou. O efeito colateral é que, logo após
 * publicar, a página pública fica sem nenhum horário e isso é
 * indistinguível de defeito para quem olha de fora.
 *
 * Por que um comando e não semeadura na migration: migration roda em todo
 * deploy. Se ela semeasse, fechar a semana de propósito seria desfeito na
 * publicação seguinte — a agenda voltaria a abrir sozinha, que é exatamente o
 * comportamento que a abertura manual veio eliminar.
 *
 * IDEMPOTENTE: havendo qualquer faixa cadastrada, não toca em nada. Rodar duas
 * vezes é seguro; rodar depois de a barbearia ajustar os horários não
 * sobrescreve o ajuste.
 */

const DEFAULT_RANGES = [{ opensAt: "09:00", closesAt: "19:00" }]
/** Terça a sábado — segunda e domingo seguem fechados, como é usual. */
const DEFAULT_WEEKDAYS = [2, 3, 4, 5, 6]

const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"]

try {
  const existing = await prisma.scheduleOpening.count()

  if (existing > 0) {
    const week = await listWeeklyOpenings()
    const open = week.filter(day => !day.closed)
    console.log(`Agenda já configurada: ${existing} faixa(s) em ${open.length} dia(s).`)
    for (const day of open) {
      const ranges = day.ranges.map(range => `${range.opensAt}–${range.closesAt}`).join(", ")
      console.log(`  ${WEEKDAY_NAMES[day.weekday]}: ${ranges}`)
    }
    console.log("Nada a fazer — este comando nunca sobrescreve o que já existe.")
  } else {
    for (const weekday of DEFAULT_WEEKDAYS) {
      await replaceWeekdayOpenings({ weekday, ranges: DEFAULT_RANGES })
    }
    const names = DEFAULT_WEEKDAYS.map(weekday => WEEKDAY_NAMES[weekday]).join(", ")
    console.log(`Semana aberta: ${names}, ${DEFAULT_RANGES[0]!.opensAt}–${DEFAULT_RANGES[0]!.closesAt}.`)
    console.log("Ajuste os horários reais em Disponibilidade → Abertura da agenda.")
  }
} catch (error) {
  console.error(
    "Não foi possível abrir a semana:",
    error instanceof Error ? error.message : error,
  )
  process.exitCode = 1
} finally {
  await disconnectPrisma()
}
