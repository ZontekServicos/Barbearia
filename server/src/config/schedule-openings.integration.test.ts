import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import type { Server } from "node:http"
import { addDaysToShopDate, instantToShopDate, shopWallClockToInstant } from "../utils/time.js"

/**
 * ABERTURA MANUAL DA AGENDA, contra PostgreSQL real.
 *
 * O que estas suítes protegem, em uma frase cada:
 *
 *  - a agenda é FECHADA por padrão: sem faixa, nenhum horário existe;
 *  - várias faixas por dia, e a exceção da data vence a regra semanal;
 *  - faixa inválida e sobreposta não entram, nem pela API nem pelo banco;
 *  - fechar horário NUNCA cancela agendamento — só proíbe novos;
 *  - reservar depois de fechar é recusado, e fechar depois de reservar não é.
 */

const database = process.env.TEST_DATABASE_URL
const enabled = Boolean(database)
if (database) {
  const url = new URL(database)
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/erickcorttes_test"
  ) {
    throw new Error("TEST_DATABASE_URL must point to local erickcorttes_test; refusing cleanup.")
  }
}
Object.assign(process.env, {
  DATABASE_URL: database ?? "postgresql://unused@127.0.0.1:1/erickcorttes_test",
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
  FRONTEND_URL: "http://localhost:8443",
  TRUST_PROXY_HOPS: "0",
})

let prisma: typeof import("./prisma.js").prisma
let tokens: typeof import("../modules/auth/token.service.js")
let limits: typeof import("../middlewares/rate-limit.js")
let availability: typeof import("../modules/booking/availability.service.js")
let openings: typeof import("../modules/booking/opening.service.js")
let locks: typeof import("../utils/locks.js")
let server: Server
let base: string

let counter = 0
const phone = () => "+55719" + String(80000000 + counter++)

/** Próxima terça — e a semana começa FECHADA, então cada teste abre o que precisa. */
function nextTuesday(): string {
  const now = new Date()
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  do {
    date.setUTCDate(date.getUTCDate() + 1)
  } while (date.getUTCDay() !== 2)
  return date.toISOString().slice(0, 10)
}

async function call(
  path: string,
  opts: { method?: string; body?: unknown; access?: string } = {},
) {
  const response = await fetch(base + path, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:8443",
      ...(opts.access ? { Authorization: "Bearer " + opts.access } : {}),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  })
  const raw = await response.text()
  let body: any = null
  try {
    body = JSON.parse(raw)
  } catch {
    /* resposta não-JSON */
  }
  return { status: response.status, body, raw }
}

async function makeAdmin() {
  const admin = await prisma.user.create({
    data: { phone: phone(), fullName: "Dono QA", role: "ADMIN", status: "ACTIVE" },
  })
  return { id: admin.id, access: (await tokens.issueSession(admin.id)).accessToken }
}
async function makeCustomer() {
  const user = await prisma.user.create({
    data: { phone: phone(), fullName: "Cliente QA", role: "CUSTOMER", status: "ACTIVE" },
  })
  return { id: user.id, access: (await tokens.issueSession(user.id)).accessToken }
}
async function makeService(durationMinutes = 40) {
  return prisma.service.create({
    data: { name: "Corte " + durationMinutes, description: "", priceCents: 4000, durationMinutes, active: true },
  })
}
/** Abre faixas na terça, direto no banco — atalho de setup. */
async function openTuesday(...ranges: Array<[string, string]>) {
  const toMinutes = (clock: string) =>
    Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))
  await prisma.scheduleOpening.createMany({
    data: ranges.map(([opensAt, closesAt]) => ({
      weekday: 2,
      startMinute: toMinutes(opensAt),
      endMinute: toMinutes(closesAt),
    })),
  })
}

async function cleanup() {
  await prisma.payment.deleteMany()
  await prisma.appointment.deleteMany()
  await prisma.scheduleOpening.deleteMany()
  await prisma.scheduleDateOverride.deleteMany()
  await prisma.scheduleBlock.deleteMany()
  await prisma.service.deleteMany()
  await prisma.businessHours.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.adminAuditLog.deleteMany()
  await prisma.user.deleteMany()
}

describe("Abertura manual da agenda — PostgreSQL real", { skip: !enabled }, () => {
  before(async () => {
    ;({ prisma } = await import("./prisma.js"))
    tokens = await import("../modules/auth/token.service.js")
    limits = await import("../middlewares/rate-limit.js")
    availability = await import("../modules/booking/availability.service.js")
    openings = await import("../modules/booking/opening.service.js")
    locks = await import("../utils/locks.js")

    const { createApp } = await import("../app.js")
    server = createApp().listen(0, "127.0.0.1")
    await new Promise<void>(resolve => server.once("listening", resolve))
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    base = "http://127.0.0.1:" + address.port
  })

  after(async () => {
    await cleanup()
    server?.close()
    await prisma?.$disconnect()
  })

  beforeEach(async () => {
    await cleanup()
    limits.globalRateLimit.resetKey("127.0.0.1")
  })

  // -------------------------------------------------------------------------
  // Fechada por padrão, aberta por decisão
  // -------------------------------------------------------------------------

  it("sem nenhuma faixa, todos os dias estão fechados", async () => {
    const service = await makeService()
    const today = instantToShopDate(new Date())
    for (let offset = 1; offset <= 7; offset++) {
      const dateISO = addDaysToShopDate(today, offset)
      const result = await availability.getAvailability(dateISO, service.id)
      assert.equal(result.open, false, dateISO)
      assert.equal(result.reason, "CLOSED", dateISO)
      assert.deepEqual(result.slots, [], dateISO)
      assert.deepEqual(result.grid, [], dateISO)
    }
  })

  it("uma faixa abre o dia e a grade respeita a janela", async () => {
    const service = await makeService(40)
    await openTuesday(["09:00", "12:00"])
    const result = await availability.getAvailability(nextTuesday(), service.id)

    assert.equal(result.open, true)
    assert.deepEqual(result.windows, [{ opensAt: "09:00", closesAt: "12:00" }])
    assert.equal(result.slots[0]?.startsAtClock, "09:00")
    // Grade de 40 a partir de 09:00: 09:00, 09:40, 10:20, 11:00. 11:40+40 passaria.
    assert.equal(result.slots.at(-1)?.startsAtClock, "11:00")
    assert.ok(result.slots.every(slot => slot.startsAtClock < "12:00"))
  })

  it("duas faixas no mesmo dia produzem duas janelas, e nada entre elas", async () => {
    const service = await makeService(40)
    await openTuesday(["09:00", "12:00"], ["14:00", "18:00"])
    const result = await availability.getAvailability(nextTuesday(), service.id)

    assert.deepEqual(result.windows, [
      { opensAt: "09:00", closesAt: "12:00" },
      { opensAt: "14:00", closesAt: "18:00" },
    ])
    const clocks = result.slots.map(slot => slot.startsAtClock)
    assert.ok(clocks.includes("14:00"), "a tarde começa exatamente no início da faixa")
    // Nada no vão: 12:00–14:00 não é expediente.
    assert.ok(!clocks.some(clock => clock >= "12:00" && clock < "14:00"), clocks.join(","))
  })

  it("dia da semana aberto não abre os outros dias", async () => {
    const service = await makeService()
    await openTuesday(["09:00", "18:00"])
    const wednesday = addDaysToShopDate(nextTuesday(), 1)
    assert.equal((await availability.getAvailability(wednesday, service.id)).reason, "CLOSED")
  })

  // -------------------------------------------------------------------------
  // Durações reais dentro da faixa (§6)
  // -------------------------------------------------------------------------

  for (const durationMinutes of [30, 40, 45, 50]) {
    it(`duração ${durationMinutes}min nunca passa do fim da faixa`, async () => {
      const service = await makeService(durationMinutes)
      await openTuesday(["09:00", "12:00"])
      const date = nextTuesday()
      const result = await availability.getAvailability(date, service.id)

      assert.equal(result.slotIntervalMinutes, 40, "baseSlotMinutes preservado")
      assert.equal(result.adaptive, true, "adaptiveSchedulingEnabled preservado")
      const reserved = Math.max(40, durationMinutes)
      assert.equal(result.reservedMinutes, reserved)

      for (const slot of result.slots) {
        const startMinute =
          Number(slot.startsAtClock.slice(0, 2)) * 60 + Number(slot.startsAtClock.slice(3))
        assert.ok(
          startMinute + reserved <= 12 * 60,
          `${slot.startsAtClock} + ${reserved}min passaria das 12:00`,
        )
      }

      // E a reserva real concorda com o que foi oferecido.
      const customer = await makeCustomer()
      const last = result.slots.at(-1)!
      const created = await call("/booking/appointments", {
        access: customer.access,
        body: { serviceId: service.id, date, startsAt: last.startsAtClock },
      })
      assert.equal(created.status, 201, "o último horário oferecido foi recusado pela criação")
    })
  }

  // -------------------------------------------------------------------------
  // Validação (§8)
  // -------------------------------------------------------------------------

  it("recusa fim <= início", async () => {
    const admin = await makeAdmin()
    for (const ranges of [
      [{ opensAt: "12:00", closesAt: "09:00" }],
      [{ opensAt: "10:00", closesAt: "10:00" }],
    ]) {
      const response = await call("/admin/openings/2", { method: "PUT", access: admin.access, body: { ranges } })
      assert.equal(response.status, 400, JSON.stringify(ranges))
    }
    assert.equal(await prisma.scheduleOpening.count(), 0, "gravou apesar do 400")
  })

  it("recusa faixas sobrepostas e repetidas, aceita adjacentes", async () => {
    const admin = await makeAdmin()
    const put = (ranges: unknown) =>
      call("/admin/openings/2", { method: "PUT", access: admin.access, body: { ranges } })

    const overlap = await put([
      { opensAt: "09:00", closesAt: "13:00" },
      { opensAt: "12:00", closesAt: "18:00" },
    ])
    assert.equal(overlap.status, 400)
    assert.match(overlap.body.error.message, /sobrep/i)

    const duplicated = await put([
      { opensAt: "09:00", closesAt: "12:00" },
      { opensAt: "09:00", closesAt: "12:00" },
    ])
    assert.equal(duplicated.status, 400)
    assert.match(duplicated.body.error.message, /repetida/i)

    assert.equal(await prisma.scheduleOpening.count(), 0, "gravou alguma faixa inválida")

    // Meio-aberto: 09:00–12:00 e 12:00–18:00 não se sobrepõem — é o almoço comum.
    const adjacent = await put([
      { opensAt: "09:00", closesAt: "12:00" },
      { opensAt: "12:00", closesAt: "18:00" },
    ])
    assert.equal(adjacent.status, 200)
    assert.equal(await prisma.scheduleOpening.count(), 2)
  })

  it("o banco recusa sobreposição mesmo sem passar pela validação do serviço", async () => {
    // A validação da aplicação dá a mensagem; esta constraint é o que resiste a
    // dois administradores gravando no mesmo instante.
    await openTuesday(["09:00", "12:00"])
    await assert.rejects(
      prisma.scheduleOpening.create({
        data: { weekday: 2, startMinute: 11 * 60, endMinute: 13 * 60 },
      }),
      /exclusion|constraint/i,
    )
  })

  it("o banco recusa escopo ambíguo, weekday inválido e override duplicado", async () => {
    const date = new Date(`${nextTuesday()}T00:00:00.000Z`)

    await assert.rejects(
      prisma.scheduleOpening.create({
        data: { weekday: 2, date, startMinute: 9 * 60, endMinute: 12 * 60 },
      }),
      /constraint/i,
    )
    await assert.rejects(
      prisma.scheduleOpening.create({
        data: { weekday: 7, startMinute: 9 * 60, endMinute: 12 * 60 },
      }),
      /constraint/i,
    )
    await assert.rejects(
      prisma.scheduleOpening.create({
        data: { startMinute: 9 * 60, endMinute: 12 * 60 },
      }),
      /constraint/i,
    )

    await prisma.scheduleDateOverride.create({ data: { date } })
    await assert.rejects(
      prisma.scheduleDateOverride.create({ data: { date } }),
      /unique|constraint/i,
    )
  })

  // -------------------------------------------------------------------------
  // Exceções por data (§3, §4)
  // -------------------------------------------------------------------------

  it("exceção CLOSED fecha a data e não afeta as outras terças", async () => {
    const service = await makeService()
    const admin = await makeAdmin()
    await openTuesday(["09:00", "18:00"])
    const date = nextTuesday()
    const nextWeek = addDaysToShopDate(date, 7)

    const response = await call("/admin/openings/overrides", {
      method: "PUT",
      access: admin.access,
      body: { date, ranges: [], note: "Feriado" },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.data.override.ranges, [])

    assert.equal((await availability.getAvailability(date, service.id)).reason, "CLOSED")
    // A regra semanal continua valendo nas outras datas.
    assert.equal((await availability.getAvailability(nextWeek, service.id)).open, true)
  })

  it("exceção OPEN substitui a janela semanal naquela data", async () => {
    const service = await makeService(40)
    const admin = await makeAdmin()
    await openTuesday(["09:00", "18:00"])
    const date = nextTuesday()

    const response = await call("/admin/openings/overrides", {
      method: "PUT",
      access: admin.access,
      body: { date, ranges: [{ opensAt: "09:00", closesAt: "13:00" }] },
    })
    assert.equal(response.status, 200)

    const result = await availability.getAvailability(date, service.id)
    assert.deepEqual(result.windows, [{ opensAt: "09:00", closesAt: "13:00" }])
    assert.ok(
      result.slots.every(slot => slot.startsAtClock < "13:00"),
      "a exceção não pode herdar o fim da regra semanal",
    )
    // Outra terça segue com a janela da semana.
    const nextWeek = addDaysToShopDate(date, 7)
    assert.deepEqual(
      (await availability.getAvailability(nextWeek, service.id)).windows,
      [{ opensAt: "09:00", closesAt: "18:00" }],
    )
  })

  it("exceção abre uma data em dia da semana fechado", async () => {
    const service = await makeService()
    const admin = await makeAdmin()
    // Nenhuma regra semanal: a semana toda está fechada.
    const monday = addDaysToShopDate(nextTuesday(), -1)

    await call("/admin/openings/overrides", {
      method: "PUT",
      access: admin.access,
      body: { date: monday, ranges: [{ opensAt: "10:00", closesAt: "14:00" }] },
    })
    const result = await availability.getAvailability(monday, service.id)
    assert.equal(result.open, true)
    assert.deepEqual(result.windows, [{ opensAt: "10:00", closesAt: "14:00" }])
  })

  it("remover a exceção devolve a data à regra semanal", async () => {
    const service = await makeService()
    const admin = await makeAdmin()
    await openTuesday(["09:00", "18:00"])
    const date = nextTuesday()

    await call("/admin/openings/overrides", {
      method: "PUT", access: admin.access, body: { date, ranges: [] },
    })
    assert.equal((await availability.getAvailability(date, service.id)).reason, "CLOSED")

    const removed = await call(`/admin/openings/overrides/${date}`, {
      method: "DELETE", access: admin.access,
    })
    assert.equal(removed.status, 200)
    assert.equal(await prisma.scheduleDateOverride.count(), 0)
    assert.equal(await prisma.scheduleOpening.count({ where: { date: { not: null } } }), 0,
      "as faixas da exceção precisam sair junto")

    const back = await availability.getAvailability(date, service.id)
    assert.equal(back.open, true, "a data deveria voltar à regra semanal")
    assert.deepEqual(back.windows, [{ opensAt: "09:00", closesAt: "18:00" }])
  })

  it("remover exceção inexistente é 404", async () => {
    const admin = await makeAdmin()
    const response = await call(`/admin/openings/overrides/${nextTuesday()}`, {
      method: "DELETE", access: admin.access,
    })
    assert.equal(response.status, 404)
  })

  it("lista as exceções do período em ordem de data", async () => {
    const admin = await makeAdmin()
    const first = nextTuesday()
    const second = addDaysToShopDate(first, 7)
    for (const date of [second, first]) {
      await call("/admin/openings/overrides", {
        method: "PUT", access: admin.access, body: { date, ranges: [] },
      })
    }
    const response = await call(
      `/admin/openings/overrides?from=${first}&to=${second}`,
      { access: admin.access },
    )
    assert.equal(response.status, 200)
    assert.deepEqual(
      response.body.data.overrides.map((entry: { date: string }) => entry.date),
      [first, second],
    )
  })

  it("override recusa data, faixa e sobreposição inválidas sem persistência parcial", async () => {
    const admin = await makeAdmin()
    const date = nextTuesday()
    const bodies = [
      { date: "2026-02-30", ranges: [] },
      { date, ranges: [{ opensAt: "12:00", closesAt: "09:00" }] },
      {
        date,
        ranges: [
          { opensAt: "09:00", closesAt: "13:00" },
          { opensAt: "12:00", closesAt: "18:00" },
        ],
      },
    ]
    for (const body of bodies) {
      const response = await call("/admin/openings/overrides", {
        method: "PUT", access: admin.access, body,
      })
      assert.equal(response.status, 400, JSON.stringify(body))
    }
    assert.equal(await prisma.scheduleDateOverride.count(), 0)
    assert.equal(await prisma.scheduleOpening.count(), 0)
  })

  it("rotas estáticas copy e overrides não são capturadas por /openings/:weekday", async () => {
    const admin = await makeAdmin()
    const date = nextTuesday()
    await openTuesday(["09:00", "12:00"])

    const copied = await call("/admin/openings/copy", {
      method: "POST", access: admin.access, body: { from: 2, to: [3] },
    })
    assert.equal(copied.status, 200)
    assert.deepEqual(
      copied.body.data.days.find((day: { weekday: number }) => day.weekday === 3).ranges,
      [{ opensAt: "09:00", closesAt: "12:00" }],
    )

    const overrides = await call(`/admin/openings/overrides?from=${date}&to=${date}`, {
      method: "GET", access: admin.access,
    })
    assert.equal(overrides.status, 200)
    assert.deepEqual(overrides.body.data.overrides, [])
  })

  // -------------------------------------------------------------------------
  // Copiar horários (§9)
  // -------------------------------------------------------------------------

  it("copiar substitui as faixas dos dias escolhidos", async () => {
    const admin = await makeAdmin()
    await openTuesday(["09:00", "12:00"], ["14:00", "18:00"])
    // Quarta tinha outra coisa: copiar precisa SUBSTITUIR, não somar.
    await prisma.scheduleOpening.create({
      data: { weekday: 3, startMinute: 8 * 60, endMinute: 9 * 60 },
    })

    const response = await call("/admin/openings/copy", {
      access: admin.access,
      body: { from: 2, to: [3, 4, 5] },
    })
    assert.equal(response.status, 200)

    const days = response.body.data.days as Array<{ weekday: number; ranges: unknown[] }>
    for (const weekday of [3, 4, 5]) {
      assert.deepEqual(
        days.find(day => day.weekday === weekday)!.ranges,
        [{ opensAt: "09:00", closesAt: "12:00" }, { opensAt: "14:00", closesAt: "18:00" }],
        "dia " + weekday,
      )
    }
    // Segunda e domingo seguem fechados: copiar não vaza para quem não foi escolhido.
    for (const weekday of [0, 1, 6]) {
      assert.deepEqual(days.find(day => day.weekday === weekday)!.ranges, [], "dia " + weekday)
    }
  })

  it("copiar um dia fechado fecha os destinos", async () => {
    const admin = await makeAdmin()
    await prisma.scheduleOpening.create({
      data: { weekday: 3, startMinute: 9 * 60, endMinute: 18 * 60 },
    })
    const response = await call("/admin/openings/copy", {
      access: admin.access,
      body: { from: 1, to: [3] },
    })
    assert.equal(response.status, 200)
    assert.equal(await prisma.scheduleOpening.count({ where: { weekday: 3 } }), 0)
  })

  it("copiar sem destino válido é recusado", async () => {
    const admin = await makeAdmin()
    assert.equal(
      (await call("/admin/openings/copy", { access: admin.access, body: { from: 2, to: [] } })).status,
      400,
    )
    // Só o próprio dia como destino não é operação nenhuma.
    assert.equal(
      (await call("/admin/openings/copy", { access: admin.access, body: { from: 2, to: [2] } })).status,
      400,
    )
  })

  // -------------------------------------------------------------------------
  // Bloqueio e agendamento DENTRO da janela aberta (§4)
  // -------------------------------------------------------------------------

  it("ScheduleBlock dentro da janela aberta remove só os horários que toca", async () => {
    const service = await makeService(40)
    const admin = await makeAdmin()
    await openTuesday(["09:00", "18:00"])
    const date = nextTuesday()

    assert.equal(
      (await call("/admin/blocks", {
        access: admin.access,
        body: { date, startsAt: "09:40", endsAt: "10:20", reason: "Dentista" },
      })).status,
      201,
    )

    const result = await availability.getAvailability(date, service.id)
    const clocks = result.slots.map(slot => slot.startsAtClock)
    assert.ok(!clocks.includes("09:40"), "o horário bloqueado continua sendo oferecido")
    assert.ok(clocks.includes("09:00"), "o resto da janela precisa continuar aberto")
    assert.ok(clocks.includes("10:20"))
    // A janela aberta não muda: bloqueio é subtração, não redefinição.
    assert.deepEqual(result.windows, [{ opensAt: "09:00", closesAt: "18:00" }])
  })

  it("Appointment dentro da janela aberta remove o horário sem fechar o dia", async () => {
    const service = await makeService(40)
    const customer = await makeCustomer()
    await openTuesday(["09:00", "18:00"])
    const date = nextTuesday()

    assert.equal(
      (await call("/booking/appointments", {
        access: customer.access,
        body: { serviceId: service.id, date, startsAt: "09:40" },
      })).status,
      201,
    )

    const result = await availability.getAvailability(date, service.id)
    assert.equal(result.open, true)
    assert.ok(!result.slots.some(slot => slot.startsAtClock === "09:40"))
    assert.equal(result.grid.find(entry => entry.startsAtClock === "09:40")?.available, false)
  })

  // -------------------------------------------------------------------------
  // Segurança dos agendamentos (§11, §12)
  // -------------------------------------------------------------------------

  it("fechar uma faixa com agendamento dentro NÃO cancela o agendamento", async () => {
    const service = await makeService(40)
    const admin = await makeAdmin()
    const customer = await makeCustomer()
    await openTuesday(["09:00", "18:00"])
    const date = nextTuesday()

    const created = await call("/booking/appointments", {
      access: customer.access,
      body: { serviceId: service.id, date, startsAt: "14:20" },
    })
    assert.equal(created.status, 201)
    const appointmentId = created.body.data.appointment.id
    const before = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    await prisma.payment.create({
      data: {
        appointmentId,
        provider: "manual",
        providerPaymentId: "schedule-safety-payment",
        mode: "FULL",
        amountCents: before.servicePriceCents,
        status: "PENDING",
        expiresAt: new Date(before.startsAt.getTime() - 60 * 60_000),
        paymentReportedAt: new Date(before.startsAt.getTime() - 2 * 60 * 60_000),
        reviewExpiresAt: new Date(before.startsAt.getTime() - 30 * 60_000),
      },
    })
    const paymentBefore = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })

    // Fecha a tarde inteira.
    const saved = await call("/admin/openings/2", {
      method: "PUT",
      access: admin.access,
      body: { ranges: [{ opensAt: "09:00", closesAt: "12:00" }] },
    })
    assert.equal(saved.status, 200, "fechar precisa ser permitido mesmo com agendamento dentro")
    // E avisa quantos ficaram de fora — é o número do aviso na tela.
    assert.equal(saved.body.data.appointmentsOutside, 1)

    const afterChange = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.equal(afterChange.status, before.status, "o status mudou")
    assert.equal(afterChange.cancelledAt, null, "foi cancelado")
    assert.equal(afterChange.startsAt.getTime(), before.startsAt.getTime())
    assert.equal(await prisma.appointment.count(), 1, "o agendamento foi apagado")
    const paymentAfter = await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })
    assert.deepEqual(paymentAfter, paymentBefore, "fechar a faixa alterou o pagamento")

    // Mas ninguém novo entra na faixa fechada.
    const other = await makeCustomer()
    const refused = await call("/booking/appointments", {
      access: other.access,
      body: { serviceId: service.id, date, startsAt: "15:00" },
    })
    assert.ok([400, 409].includes(refused.status), "status " + refused.status)
    assert.equal(await prisma.appointment.count(), 1)
  })

  it("fechar a data por exceção também preserva o agendamento e avisa", async () => {
    const service = await makeService(40)
    const admin = await makeAdmin()
    const customer = await makeCustomer()
    await openTuesday(["09:00", "18:00"])
    const date = nextTuesday()

    await call("/booking/appointments", {
      access: customer.access,
      body: { serviceId: service.id, date, startsAt: "09:00" },
    })

    const response = await call("/admin/openings/overrides", {
      method: "PUT",
      access: admin.access,
      body: { date, ranges: [], note: "Imprevisto" },
    })
    assert.equal(response.status, 200)
    assert.equal(response.body.data.appointmentsOutside, 1)
    assert.equal(await prisma.appointment.count(), 1)
    assert.equal(
      (await prisma.appointment.findFirstOrThrow({})).cancelledAt,
      null,
      "a exceção cancelou um agendamento",
    )
  })

  it("não avisa quando as novas faixas ainda cobrem os agendamentos", async () => {
    const service = await makeService(40)
    const admin = await makeAdmin()
    const customer = await makeCustomer()
    await openTuesday(["09:00", "18:00"])
    const date = nextTuesday()
    await call("/booking/appointments", {
      access: customer.access,
      body: { serviceId: service.id, date, startsAt: "09:00" },
    })

    const saved = await call("/admin/openings/2", {
      method: "PUT",
      access: admin.access,
      body: { ranges: [{ opensAt: "09:00", closesAt: "13:00" }] },
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.data.appointmentsOutside, 0)
  })

  // -------------------------------------------------------------------------
  // Concorrência (§16)
  // -------------------------------------------------------------------------

  it("reservar depois de a faixa fechar é recusado", async () => {
    const service = await makeService(40)
    const admin = await makeAdmin()
    const customer = await makeCustomer()
    await openTuesday(["09:00", "18:00"])
    const date = nextTuesday()

    await call("/admin/openings/2", {
      method: "PUT", access: admin.access, body: { ranges: [{ opensAt: "09:00", closesAt: "12:00" }] },
    })
    const refused = await call("/booking/appointments", {
      access: customer.access,
      body: { serviceId: service.id, date, startsAt: "14:20" },
    })
    assert.ok([400, 409].includes(refused.status), "status " + refused.status)
    assert.equal(await prisma.appointment.count(), 0)
  })

  it("ADMIN fechando e cliente reservando ao mesmo tempo nunca deixa estado híbrido", async () => {
    const date = nextTuesday()
    for (let round = 1; round <= 4; round++) {
      await cleanup()
      limits.globalRateLimit.resetKey("127.0.0.1")
      const service = await makeService(40)
      const admin = await makeAdmin()
      const customer = await makeCustomer()
      await openTuesday(["09:00", "18:00"])

      const [booking, closing] = await Promise.all([
        call("/booking/appointments", {
          access: customer.access,
          body: { serviceId: service.id, date, startsAt: "14:20" },
        }),
        call("/admin/openings/2", {
          method: "PUT",
          access: admin.access,
          body: { ranges: [{ opensAt: "09:00", closesAt: "12:00" }] },
        }),
      ])

      assert.ok(booking.status < 500, `rodada ${round}: 500 na reserva ${booking.raw.slice(0, 120)}`)
      assert.equal(closing.status, 200, `rodada ${round}: fechar precisa ser aceito`)

      const total = await prisma.appointment.count()
      assert.ok(total <= 1, `rodada ${round}: ${total} agendamentos`)
      if (booking.status === 201) {
        // Venceu a corrida: continua valendo, porque fechar não cancela.
        assert.equal(total, 1, `rodada ${round}`)
        assert.equal((await prisma.appointment.findFirstOrThrow({})).cancelledAt, null)
      } else {
        assert.equal(total, 0, `rodada ${round}: recusou mas gravou`)
      }

      // Depois da poeira baixar, a faixa está fechada e ninguém mais entra.
      const after = await call("/booking/appointments", {
        access: (await makeCustomer()).access,
        body: { serviceId: service.id, date, startsAt: "15:00" },
      })
      assert.ok([400, 409].includes(after.status), `rodada ${round}: status ${after.status}`)
    }
  })

  it("duas transações mantêm o lock compartilhado das regras ao mesmo tempo", async () => {
    let releaseFirst!: () => void
    let firstAcquired!: () => void
    let secondAcquired!: () => void
    const release = new Promise<void>(resolve => { releaseFirst = resolve })
    const firstReady = new Promise<void>(resolve => { firstAcquired = resolve })
    const secondReady = new Promise<void>(resolve => { secondAcquired = resolve })

    const first = prisma.$transaction(async tx => {
      await locks.lockKeyShared(tx, openings.SCHEDULE_RULES_LOCK)
      firstAcquired()
      await release
    })
    await firstReady

    const second = prisma.$transaction(async tx => {
      await locks.lockKeyShared(tx, openings.SCHEDULE_RULES_LOCK)
      secondAcquired()
    })

    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        secondReady,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("o segundo lock compartilhado foi serializado")),
            1_000,
          )
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
      releaseFirst()
    }
    await Promise.all([first, second])
  })

  // -------------------------------------------------------------------------
  // Timezone (§17)
  // -------------------------------------------------------------------------

  it("a faixa é interpretada em hora local da barbearia, na virada do dia", async () => {
    const service = await makeService(40)
    await openTuesday(["00:00", "02:00"], ["22:00", "24:00"])
    const date = nextTuesday()
    const result = await availability.getAvailability(date, service.id)

    assert.deepEqual(result.windows, [
      { opensAt: "00:00", closesAt: "02:00" },
      { opensAt: "22:00", closesAt: "24:00" },
    ])
    // 00:00 local é 03:00Z no nosso fuso — é o que prova que a conversão é local.
    const first = result.slots[0]!
    assert.equal(first.startsAtClock, "00:00")
    assert.equal(
      new Date(first.startsAt).getTime(),
      shopWallClockToInstant(date, 0).getTime(),
    )
    // Nenhuma reserva atravessa a meia-noite para o dia seguinte.
    for (const slot of result.slots) {
      assert.ok(new Date(slot.startsAt).getTime() >= shopWallClockToInstant(date, 0).getTime())
      assert.ok(
        new Date(slot.startsAt).getTime() < shopWallClockToInstant(addDaysToShopDate(date, 1), 0).getTime(),
      )
    }
  })

  it("a exceção guarda a data escrita, sem deslocar um dia pelo fuso", async () => {
    const admin = await makeAdmin()
    const date = nextTuesday()
    await call("/admin/openings/overrides", {
      method: "PUT", access: admin.access, body: { date, ranges: [] },
    })
    const stored = await prisma.scheduleDateOverride.findFirstOrThrow({})
    assert.equal(stored.date.toISOString().slice(0, 10), date)
    const [listed] = await openings.listDateOverrides(date, date)
    assert.equal(listed?.date, date)
  })

  // -------------------------------------------------------------------------
  // Grade pública não revela nada a mais (§13)
  // -------------------------------------------------------------------------

  it("a grade pública mostra o dia aberto sem motivo nem PII", async () => {
    const service = await makeService(40)
    const admin = await makeAdmin()
    const customer = await prisma.user.create({
      data: { phone: "+5571988887766", fullName: "Fulano Da Silva Vazou", status: "ACTIVE" },
    })
    await openTuesday(["09:00", "12:00"])
    const date = nextTuesday()
    await call("/booking/appointments", {
      access: (await tokens.issueSession(customer.id)).accessToken,
      body: { serviceId: service.id, date, startsAt: "09:00" },
    })
    await call("/admin/blocks", {
      access: admin.access,
      body: { date, startsAt: "10:20", endsAt: "11:00", reason: "Dentista" },
    })

    const response = await call(`/booking/availability?date=${date}&serviceId=${service.id}`)
    const grid = response.body.data.grid as Array<Record<string, unknown>>
    assert.ok(grid.length > 0)
    for (const entry of grid) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ["available", "endsAtClock", "startsAt", "startsAtClock"],
        JSON.stringify(entry),
      )
    }
    for (const leak of ["Fulano", "988887766", "Dentista", "APPOINTMENT", "BLOCK", "blockId"]) {
      assert.ok(!response.raw.includes(leak), "grade pública expôs " + leak)
    }
  })

  it("o expediente público vem da MESMA fonte da disponibilidade", async () => {
    await openTuesday(["09:00", "12:00"], ["14:00", "18:00"])
    const response = await call("/booking/business-hours")
    assert.equal(response.status, 200)
    const days = response.body.data.days as Array<{ weekday: number; closed: boolean; ranges: unknown[] }>
    assert.equal(days.length, 7, "os sete dias sempre aparecem")
    assert.deepEqual(days.find(day => day.weekday === 2)!.ranges, [
      { opensAt: "09:00", closesAt: "12:00" },
      { opensAt: "14:00", closesAt: "18:00" },
    ])
    assert.equal(days.find(day => day.weekday === 2)!.closed, false)
    // Dia sem faixa aparece fechado, não desaparece.
    assert.equal(days.find(day => day.weekday === 1)!.closed, true)
    assert.deepEqual(days.find(day => day.weekday === 1)!.ranges, [])
  })

  // -------------------------------------------------------------------------
  // Autorização e mass assignment (§18)
  // -------------------------------------------------------------------------

  it("as rotas de abertura exigem ADMIN", async () => {
    const customer = await makeCustomer()
    const date = nextTuesday()
    const routes: Array<[string, string, unknown?]> = [
      ["GET", "/admin/openings"],
      ["PUT", "/admin/openings/2", { ranges: [] }],
      ["POST", "/admin/openings/copy", { from: 2, to: [3] }],
      ["GET", `/admin/openings/overrides?from=${date}&to=${date}`],
      ["PUT", "/admin/openings/overrides", { date, ranges: [] }],
      ["DELETE", `/admin/openings/overrides/${date}`],
    ]
    for (const [method, path, body] of routes) {
      const anonymous = await call(path, { method, ...(body === undefined ? {} : { body }) })
      assert.equal(anonymous.status, 401, `anônimo em ${method} ${path}`)
      const asCustomer = await call(path, {
        method, access: customer.access, ...(body === undefined ? {} : { body }),
      })
      assert.equal(asCustomer.status, 403, `CUSTOMER em ${method} ${path}`)
    }
    assert.equal(await prisma.scheduleOpening.count(), 0)
  })

  it("recusa campos desconhecidos no corpo (mass assignment)", async () => {
    const admin = await makeAdmin()
    const date = nextTuesday()
    const forbidden = {
      id: "00000000-0000-4000-8000-000000000000",
      weekday: 5,
      date,
      createdById: admin.id,
      updatedAt: "2026-10-15T00:00:00.000Z",
      createdAt: "2026-10-15T00:00:00.000Z",
      role: "ADMIN",
      status: "CONFIRMED",
      appointmentId: "00000000-0000-4000-8000-000000000001",
      userId: admin.id,
    }
    const hostile: Array<[string, string, unknown]> = []
    for (const [field, value] of Object.entries(forbidden)) {
      hostile.push(
        ["PUT", "/admin/openings/2", { ranges: [], [field]: value }],
        [
          "PUT",
          "/admin/openings/2",
          { ranges: [{ opensAt: "09:00", closesAt: "12:00", [field]: value }] },
        ],
      )
    }
    hostile.push(
      ["POST", "/admin/openings/copy", { from: 2, to: [3], createdById: admin.id }],
      ["PUT", "/admin/openings/overrides", { date, ranges: [], id: "x" }],
      ["PUT", "/admin/openings/overrides", { date, ranges: [], createdById: admin.id }],
      ["PUT", "/admin/openings/overrides", { date, ranges: [{ opensAt: "09:00", closesAt: "12:00", userId: admin.id }] }],
    )
    for (const [method, path, body] of hostile) {
      const response = await call(path, { method, access: admin.access, body })
      assert.equal(response.status, 400, `${method} ${path} ${JSON.stringify(body)}`)
    }
    assert.equal(await prisma.scheduleOpening.count(), 0, "gravou apesar do 400")
  })

  it("weekday fora de 0..6 é recusado", async () => {
    const admin = await makeAdmin()
    for (const weekday of ["7", "-1", "abc"]) {
      const response = await call(`/admin/openings/${weekday}`, {
        method: "PUT", access: admin.access, body: { ranges: [] },
      })
      assert.equal(response.status, 400, "weekday " + weekday)
    }
  })

  it("a autoria da faixa vem da sessão", async () => {
    const admin = await makeAdmin()
    await call("/admin/openings/2", {
      method: "PUT", access: admin.access, body: { ranges: [{ opensAt: "09:00", closesAt: "12:00" }] },
    })
    const stored = await prisma.scheduleOpening.findFirstOrThrow({})
    assert.equal(stored.createdById, admin.id)
  })

  it("remover o admin que abriu não apaga a faixa", async () => {
    const admin = await makeAdmin()
    await call("/admin/openings/2", {
      method: "PUT", access: admin.access, body: { ranges: [{ opensAt: "09:00", closesAt: "12:00" }] },
    })
    await prisma.refreshToken.deleteMany({ where: { userId: admin.id } })
    await prisma.user.delete({ where: { id: admin.id } })
    const stored = await prisma.scheduleOpening.findFirst({})
    assert.ok(stored, "a faixa desapareceu com o autor")
    assert.equal(stored.createdById, null)
  })
})
