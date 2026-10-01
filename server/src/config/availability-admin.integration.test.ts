import { after, before, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import type { Server } from "node:http"

/**
 * Gestão administrativa de disponibilidade, contra PostgreSQL real.
 *
 * O que estas suítes protegem, em uma frase cada:
 *
 *  - a grade PÚBLICA mostra o dia inteiro e não conta de quem é o horário;
 *  - a grade ADMINISTRATIVA conta o motivo, porque a ação depende dele;
 *  - bloquear usa INTERVALO real, não índice visual de slot;
 *  - agendamento NUNCA se desfaz por esta ferramenta;
 *  - admin e cliente ao mesmo tempo produzem exatamente uma operação vencedora.
 *
 * Mesmo contrato de opt-in das outras integrações: sem TEST_DATABASE_URL a
 * suíte é pulada; com ela, só aceita o banco de teste local dedicado.
 */

const database = process.env.TEST_DATABASE_URL
const enabled = Boolean(database)
if (database) {
  const url = new URL(database)
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/erickcorttes_test"
  ) {
    throw new Error(
      "TEST_DATABASE_URL must point to local erickcorttes_test; refusing cleanup.",
    )
  }
}
Object.assign(process.env, {
  DATABASE_URL: database ?? "postgresql://unused@127.0.0.1:1/erickcorttes_test",
  NODE_ENV: "test",
  JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
  JWT_REFRESH_SECRET: randomBytes(48).toString("hex"),
  FRONTEND_URL: "http://localhost:8443",
  TRUST_PROXY_HOPS: "0",
})

let prisma: typeof import("../config/prisma.js").prisma
let tokens: typeof import("../modules/auth/token.service.js")
let limits: typeof import("../middlewares/rate-limit.js")
let server: Server
let base: string

let phoneCounter = 0
const phone = () => "+55719" + String(60000000 + phoneCounter++)

/** Próxima terça: dia aberto 09:00–19:00 no expediente padrão. */
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
  const text = await response.text()
  return { status: response.status, body: JSON.parse(text), raw: text }
}

async function login(
  role: "ADMIN" | "CUSTOMER" = "CUSTOMER",
  fullName = "Pessoa QA",
) {
  const user = await prisma.user.create({
    data: { phone: phone(), fullName, role, status: "ACTIVE" },
  })
  const session = await tokens.issueSession(user.id)
  return { user, access: session.accessToken }
}

async function makeService(durationMinutes = 40) {
  return prisma.service.create({
    data: {
      name: "Corte",
      description: "Corte masculino",
      priceCents: 3500,
      durationMinutes,
      active: true,
    },
  })
}

async function cleanup() {
  await prisma.adminAuditLog.deleteMany()
  await prisma.appointment.deleteMany()
  await prisma.scheduleBlock.deleteMany()
  await prisma.service.deleteMany()
  await prisma.businessHours.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.user.deleteMany()
}

/** Atalhos de leitura das duas grades. */
const publicGrid = async (date: string, serviceId: string) =>
  call("/booking/availability?date=" + date + "&serviceId=" + serviceId)
const adminGrid = async (date: string, serviceId: string, access: string) =>
  call("/admin/availability?date=" + date + "&serviceId=" + serviceId, { access })
const slotAt = (grid: Array<{ startsAtClock: string }>, clock: string) =>
  grid.find(entry => entry.startsAtClock === clock)

/**
 * Início REAL da grade na parte da tarde.
 *
 * A terça abre 09:00–19:00 numa janela só, e a grade anda de 40 em 40 desde as
 * 09:00: 09:00, 09:40, 10:20 … 13:40, **14:20**, 15:00. Ou seja, "14:00" NÃO é
 * um início da grade. Escrever 14:00 num teste faz `slotAt` devolver
 * `undefined` — e, no caminho de reserva, faz o pedido ser recusado por motivo
 * errado, de modo que o teste "passa" sem exercitar nada.
 */
const TARDE = "14:20"
/** Fim do bloqueio da tarde: cobre exatamente a reserva de `TARDE`. */
const TARDE_FIM = "15:00"

describe("Disponibilidade administrativa — PostgreSQL real", { skip: !enabled }, () => {
  before(async () => {
    ;({ prisma } = await import("../config/prisma.js"))
    tokens = await import("../modules/auth/token.service.js")
    limits = await import("../middlewares/rate-limit.js")

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
  // Grade pública: mostra tudo, conta nada
  // -------------------------------------------------------------------------

  it("grade pública mostra o dia inteiro e deixa o ocupado cinza em vez de sumir", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const customer = await login()

    const vazio = await publicGrid(date, service.id)
    assert.equal(vazio.status, 200)
    const livre = vazio.body.data.grid as Array<{ startsAtClock: string; available: boolean }>
    // 09:00–19:00, grade de 40: 15 inícios, todos cabendo até 19:00.
    assert.equal(livre.length, 15)
    assert.ok(livre.every(entry => entry.available), "dia vazio deveria estar todo livre")

    const placed = await call("/booking/appointments", {
      body: { serviceId: service.id, date, startsAt: "10:20" },
      access: customer.access,
    })
    assert.equal(placed.status, 201)

    const depois = await publicGrid(date, service.id)
    const grid = depois.body.data.grid as Array<{ startsAtClock: string; available: boolean }>
    // O ponto do requisito: a grade NÃO encurta. O horário continua visível.
    assert.equal(grid.length, 15, "a grade encurtou — o horário ocupado desapareceu")
    assert.equal(slotAt(grid, "10:20")!.available, false)
    assert.equal(grid.filter(entry => !entry.available).length, 1)
  })

  it("grade pública não revela motivo, nome nem telefone de quem reservou", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const customer = await login("CUSTOMER", "Fulano Da Silva Reservou")

    await call("/booking/appointments", {
      body: { serviceId: service.id, date, startsAt: "10:20" },
      access: customer.access,
    })

    const response = await publicGrid(date, service.id)
    const grid = response.body.data.grid as Array<Record<string, unknown>>

    // Nenhum campo além do contrato mínimo mais os rótulos de hora.
    for (const entry of grid) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ["available", "endsAtClock", "startsAt", "startsAtClock"],
        "campo inesperado na grade pública: " + JSON.stringify(entry),
      )
    }
    // PII não aparece em lugar NENHUM do corpo.
    assert.ok(!response.raw.includes("Fulano"), "nome do cliente vazou na grade pública")
    assert.ok(!response.raw.includes(customer.user.phone), "telefone vazou na grade pública")

    /**
     * Motivo por horário não existe na versão pública.
     *
     * A varredura é na GRADE, não no corpo inteiro: a resposta tem um `reason`
     * de topo que diz por que o dia não tem horário nenhum ("CLOSED",
     * "FULLY_BOOKED"). Esse é um fato sobre o dia, não sobre uma pessoa, e é
     * parte do contrato público de antes desta mudança.
     */
    const gridJson = JSON.stringify(grid)
    for (const leak of ["APPOINTMENT", "BLOCK", "OUTSIDE_HOURS", "PAST", "reason", "appointmentId", "blockId"]) {
      assert.ok(!gridJson.includes(leak), "grade pública expôs " + leak)
    }
  })

  it("o que a grade pública marca disponível é exatamente o que a reserva aceita", async () => {
    // Invariante central contra banco real: se divergir, a tela oferece botão
    // que a criação recusa — ou esconde horário vendável.
    const service = await makeService()
    const date = nextTuesday()
    const customer = await login()
    const admin = await login("ADMIN")

    await call("/booking/appointments", {
      body: { serviceId: service.id, date, startsAt: "10:20" },
      access: customer.access,
    })
    await call("/admin/blocks", {
      body: { date, startsAt: "15:00", endsAt: "16:30", reason: "Dentista" },
      access: admin.access,
    })

    const response = await publicGrid(date, service.id)
    const grid = response.body.data.grid as Array<{ startsAtClock: string; available: boolean }>
    const slots = response.body.data.slots as Array<{ startsAtClock: string }>
    const reservaveis = new Set(slots.map(slot => slot.startsAtClock))

    for (const entry of grid) {
      assert.equal(
        entry.available,
        reservaveis.has(entry.startsAtClock),
        entry.startsAtClock + ": grade e lista de reserva discordam",
      )
    }
    for (const clock of reservaveis) {
      assert.ok(
        grid.some(entry => entry.startsAtClock === clock),
        clock + " é reservável mas não aparece na grade",
      )
    }
  })

  // -------------------------------------------------------------------------
  // Grade administrativa: o motivo, porque a ação depende dele
  // -------------------------------------------------------------------------

  it("grade administrativa diz o motivo e aponta o agendamento", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const customer = await login()
    const admin = await login("ADMIN")

    const placed = await call("/booking/appointments", {
      body: { serviceId: service.id, date, startsAt: "10:20" },
      access: customer.access,
    })
    const appointmentId = placed.body.data.appointment.id

    const response = await adminGrid(date, service.id, admin.access)
    assert.equal(response.status, 200)
    const slot = slotAt(response.body.data.grid, "10:20") as {
      available: boolean
      reason: string
      appointmentId: string | null
      blockId: string | null
    }
    assert.equal(slot.available, false)
    assert.equal(slot.reason, "APPOINTMENT")
    assert.equal(slot.appointmentId, appointmentId)
    // Sem blockId: não há bloqueio para liberar aqui, e a tela não pode oferecer.
    assert.equal(slot.blockId, null)
  })

  it("bloqueio manual vem com blockId — o único que a tela pode liberar", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const admin = await login("ADMIN")

    const created = await call("/admin/blocks", {
      body: { date, startsAt: TARDE, endsAt: TARDE_FIM, reason: "Consulta médica" },
      access: admin.access,
    })
    assert.equal(created.status, 201)
    const blockId = created.body.data.block.id

    const response = await adminGrid(date, service.id, admin.access)
    const slot = slotAt(response.body.data.grid, TARDE) as {
      available: boolean
      reason: string
      blockId: string | null
      blockReason: string | null
      appointmentId: string | null
    }
    assert.equal(slot.available, false)
    assert.equal(slot.reason, "BLOCK")
    assert.equal(slot.blockId, blockId)
    assert.equal(slot.blockReason, "Consulta médica")
    assert.equal(slot.appointmentId, null)

    // Liberar devolve o horário.
    const released = await call("/admin/blocks/" + blockId, {
      method: "DELETE",
      access: admin.access,
    })
    assert.equal(released.status, 200)
    const depois = await adminGrid(date, service.id, admin.access)
    assert.equal(slotAt(depois.body.data.grid, TARDE)!.available, true)
  })

  it("grade administrativa exige ADMIN", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const customer = await login()

    const anonima = await call("/admin/availability?date=" + date + "&serviceId=" + service.id)
    assert.equal(anonima.status, 401)

    const comoCliente = await adminGrid(date, service.id, customer.access)
    assert.equal(comoCliente.status, 403)
  })

  // -------------------------------------------------------------------------
  // Bloquear por intervalo real, não por índice visual
  // -------------------------------------------------------------------------

  it("bloqueio de 09:30–11:00 derruba todo início que intercepta, não um índice", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const admin = await login("ADMIN")

    // O intervalo não coincide com nenhum início da grade, de propósito.
    const created = await call("/admin/blocks", {
      body: { date, startsAt: "09:30", endsAt: "11:00", reason: "Entrega de material" },
      access: admin.access,
    })
    assert.equal(created.status, 201)

    const response = await adminGrid(date, service.id, admin.access)
    const grid = response.body.data.grid as Array<{
      startsAtClock: string
      available: boolean
      reason: string | null
    }>

    // 09:00 reserva até 09:40 e encosta no bloqueio; 09:40 e 10:20 idem.
    for (const clock of ["09:00", "09:40", "10:20"]) {
      const slot = slotAt(grid, clock)!
      assert.equal(slot.available, false, clock + " deveria estar indisponível")
      assert.equal(slot.reason, "BLOCK", clock)
    }
    // 11:00 é o fim do bloqueio: intervalo meio-aberto, já está livre.
    assert.equal(slotAt(grid, "11:00")!.available, true, "11:00 deveria estar livre")

    // E a reserva real concorda com a grade.
    const customer = await login()
    const recusado = await call("/booking/appointments", {
      body: { serviceId: service.id, date, startsAt: "10:20" },
      access: customer.access,
    })
    assert.equal(recusado.status, 409)
    const aceito = await call("/booking/appointments", {
      body: { serviceId: service.id, date, startsAt: "11:00" },
      access: customer.access,
    })
    assert.equal(aceito.status, 201)
  })

  it("dia inteiro é um bloqueio só: grade visível, tudo indisponível, liberar devolve o dia", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const admin = await login("ADMIN")

    const created = await call("/admin/blocks/whole-day", {
      body: { date, reason: "Feriado da barbearia" },
      access: admin.access,
    })
    assert.equal(created.status, 201)
    const blockId = created.body.data.block.id

    const response = await adminGrid(date, service.id, admin.access)
    const grid = response.body.data.grid as Array<{ available: boolean; reason: string | null }>
    assert.ok(grid.length > 0, "a grade não pode esvaziar: buraco parece defeito")
    assert.ok(grid.every(entry => !entry.available), "sobrou horário disponível no dia bloqueado")
    assert.ok(grid.some(entry => entry.reason === "BLOCK"), "o bloqueio precisa aparecer")

    // A grade pública também mostra o dia inteiro, cinza.
    const publica = await publicGrid(date, service.id)
    const visivel = publica.body.data.grid as Array<{ available: boolean }>
    assert.equal(visivel.length, grid.length)
    assert.ok(visivel.every(entry => !entry.available))

    // Um clique devolve o dia — não quinze.
    const released = await call("/admin/blocks/" + blockId, {
      method: "DELETE",
      access: admin.access,
    })
    assert.equal(released.status, 200)
    const depois = await adminGrid(date, service.id, admin.access)
    const restaurada = depois.body.data.grid as Array<{ available: boolean }>
    assert.ok(restaurada.every(entry => entry.available), "liberar o dia não devolveu todos")
  })

  it("bloquear não cancela nem encobre agendamento existente", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const customer = await login()
    const admin = await login("ADMIN")

    const placed = await call("/booking/appointments", {
      body: { serviceId: service.id, date, startsAt: "10:20" },
      access: customer.access,
    })
    const appointmentId = placed.body.data.appointment.id
    const antes = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })

    const blocked = await call("/admin/blocks/whole-day", {
      body: { date, reason: "Fechado" },
      access: admin.access,
    })
    assert.equal(blocked.status, 409)

    // O agendamento continua existindo, com o MESMO status.
    const depois = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    assert.equal(depois.status, antes.status)
    assert.equal(depois.startsAt.getTime(), antes.startsAt.getTime())
    assert.equal(await prisma.scheduleBlock.count(), 0)

    // A grade administrativa continua mostrando APPOINTMENT e nunca oferece
    // "liberar" sobre a reserva de alguém.
    const response = await adminGrid(date, service.id, admin.access)
    const slot = slotAt(response.body.data.grid, "10:20") as {
      reason: string
      blockId: string | null
      appointmentId: string | null
    }
    assert.equal(slot.reason, "APPOINTMENT")
    assert.equal(slot.appointmentId, appointmentId)
    assert.equal(slot.blockId, null, "ofereceria liberar um horário que tem cliente")
  })

  it("autor do bloqueio vem da sessão, nunca do corpo", async () => {
    const date = nextTuesday()
    const admin = await login("ADMIN")
    const outro = await login("ADMIN")

    const injected = await call("/admin/blocks", {
      body: {
        date,
        startsAt: "14:00",
        endsAt: "15:00",
        reason: "Teste de autoria",
        // Tentativa de atribuir a outra pessoa:
        createdById: outro.user.id,
      },
      access: admin.access,
    })
    assert.equal(injected.status, 400)

    const created = await call("/admin/blocks", {
      body: {
        date,
        startsAt: "14:00",
        endsAt: "15:00",
        reason: "Teste de autoria",
      },
      access: admin.access,
    })
    assert.equal(created.status, 201)

    const stored = await prisma.scheduleBlock.findUniqueOrThrow({
      where: { id: created.body.data.block.id },
    })
    assert.equal(stored.createdById, admin.user.id, "autoria veio do corpo")

    // Dia inteiro usa strictObject: campo desconhecido é recusado de frente.
    const recusado = await call("/admin/blocks/whole-day", {
      body: { date, reason: "Qualquer", createdById: outro.user.id },
      access: admin.access,
    })
    assert.equal(recusado.status, 400)
  })

  it("remover o admin que bloqueou não apaga o bloqueio", async () => {
    // `onDelete: SetNull`: a decisão sobrevive a quem a tomou.
    const service = await makeService()
    const date = nextTuesday()
    const admin = await login("ADMIN")

    const created = await call("/admin/blocks", {
      body: { date, startsAt: TARDE, endsAt: TARDE_FIM, reason: "Vai sair da equipe" },
      access: admin.access,
    })
    const blockId = created.body.data.block.id

    await prisma.refreshToken.deleteMany({ where: { userId: admin.user.id } })
    await prisma.user.delete({ where: { id: admin.user.id } })

    const stored = await prisma.scheduleBlock.findUnique({ where: { id: blockId } })
    assert.ok(stored, "o bloqueio desapareceu com o admin")
    assert.equal(stored.createdById, null)

    // E o horário continua bloqueado na grade.
    const outro = await login("ADMIN")
    const response = await adminGrid(date, service.id, outro.access)
    assert.equal(slotAt(response.body.data.grid, TARDE)!.available, false)
  })

  // -------------------------------------------------------------------------
  // Agendamento nunca se desfaz por esta ferramenta
  // -------------------------------------------------------------------------

  it("DELETE /admin/blocks com id de agendamento não apaga nada", async () => {
    // A garantia é estrutural: bloqueio e agendamento são tabelas diferentes,
    // então nem existe caminho para liberar a reserva de alguém por aqui.
    const service = await makeService()
    const date = nextTuesday()
    const customer = await login()
    const admin = await login("ADMIN")

    const placed = await call("/booking/appointments", {
      body: { serviceId: service.id, date, startsAt: "10:20" },
      access: customer.access,
    })
    const appointmentId = placed.body.data.appointment.id

    const attempt = await call("/admin/blocks/" + appointmentId, {
      method: "DELETE",
      access: admin.access,
    })
    assert.equal(attempt.status, 404)
    assert.equal(attempt.body.error.code, "NOT_FOUND")

    const ainda = await prisma.appointment.findUnique({ where: { id: appointmentId } })
    assert.ok(ainda, "o agendamento foi apagado por uma rota de bloqueio")

    // Um uuid que não é de nada também é 404, nunca 500.
    const fantasma = await call("/admin/blocks/" + randomUUID(), {
      method: "DELETE",
      access: admin.access,
    })
    assert.equal(fantasma.status, 404)
  })

  // -------------------------------------------------------------------------
  // Concorrência
  // -------------------------------------------------------------------------

  it("dois clientes no mesmo horário: exatamente um vence", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const um = await login()
    const dois = await login()

    const [a, b] = await Promise.all([
      call("/booking/appointments", {
        body: { serviceId: service.id, date, startsAt: "10:20" },
        access: um.access,
      }),
      call("/booking/appointments", {
        body: { serviceId: service.id, date, startsAt: "10:20" },
        access: dois.access,
      }),
    ])

    const criados = [a, b].filter(response => response.status === 201)
    assert.equal(criados.length, 1, "esperado 1 vencedor, veio " + criados.length)
    const count = await prisma.appointment.count()
    assert.equal(count, 1, "o banco aceitou dois agendamentos no mesmo horário")
  })

  it("admin bloqueando enquanto cliente reserva: exatamente uma operação prevalece", async () => {
    const service = await makeService()
    const date = nextTuesday()
    const customer = await login()
    const admin = await login("ADMIN")

    const [reserva, bloqueio] = await Promise.all([
      call("/booking/appointments", {
        body: { serviceId: service.id, date, startsAt: TARDE },
        access: customer.access,
      }),
      call("/admin/blocks", {
        body: { date, startsAt: TARDE, endsAt: TARDE_FIM, reason: "Imprevisto" },
        access: admin.access,
      }),
    ])

    const sucessos = [reserva, bloqueio].filter(response => response.status === 201)
    assert.equal(sucessos.length, 1, "reserva e bloqueio não podem coexistir")

    const agendamentos = await prisma.appointment.count()
    const bloqueios = await prisma.scheduleBlock.count()
    assert.equal(agendamentos + bloqueios, 1, "estado híbrido entre tabelas")

    if (reserva.status === 201) {
      const response = await adminGrid(date, service.id, admin.access)
      const slot = slotAt(response.body.data.grid, TARDE) as {
        reason: string
        blockId: string | null
      }
      assert.equal(
        slot.reason,
        "APPOINTMENT",
        "com cliente marcado, a grade precisa dizer APPOINTMENT",
      )
      assert.equal(slot.blockId, null, "não pode oferecer liberar onde há cliente")
      assert.equal(bloqueio.status, 409)
    } else {
      // Se a reserva perdeu, foi por conflito — nunca por erro interno.
      assert.ok(
        [409, 422].includes(reserva.status),
        "reserva falhou com status inesperado " + reserva.status,
      )
      // E o estado resultante é coerente: sem cliente ali, o bloqueio é
      // justamente o que a barbearia pode desfazer.
      const response = await adminGrid(date, service.id, admin.access)
      const slot = slotAt(response.body.data.grid, TARDE) as {
        reason: string
        blockId: string | null
      }
      assert.equal(slot.reason, "BLOCK")
      assert.ok(slot.blockId, "bloqueio sem cliente precisa ser liberável")
      assert.equal(bloqueio.status, 201)
    }
  })
})
