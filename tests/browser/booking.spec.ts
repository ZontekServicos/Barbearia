import { test, expect, type Page, type Route } from '@playwright/test'

const legacy = Boolean(process.env.LEGACY_AGENDA_REF)
const service30 = { id: '11111111-1111-4111-8111-111111111111', name: 'Corte', description: 'Corte simples', priceCents: 3500, priceFormatted: '35,00', durationMinutes: 30, active: true }
const service50 = { ...service30, id: '22222222-2222-4222-8222-222222222222', name: 'Cabelo + Barba + Pigmentação', durationMinutes: 50, priceCents: 10000, priceFormatted: '100,00' }
const slot = (clock: string, duration = 30, reservedMinutes = Math.max(40, duration)) => {
  const startsAt = '2026-09-25T' + clock + ':00-03:00'
  const end = new Date(new Date(startsAt).getTime() + duration * 60_000)
  return { startsAtClock: clock, endsAtClock: new Date(end.getTime() - 3 * 60 * 60_000).toISOString().slice(11, 16), startsAt, endsAt: end.toISOString(), reservedMinutes }
}
const appointment = (id: string, clock: string, date = '2026-09-24') => ({
  id, ...slot(clock), startsAt: date + 'T' + clock + ':00-03:00', date,
  serviceId: '11111111-1111-4111-8111-111111111111', serviceName: 'Corte', servicePriceCents: 3500,
  servicePriceFormatted: '35,00', durationMinutes: 30, status: 'CONFIRMED',
  notes: null, createdAt: '2026-09-20T00:00:00Z', cancelledAt: null,
  customer: { id, fullName: 'Cliente ' + id, phone: '11999999999', phoneFormatted: '(11) 99999-9999' },
})
const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } })

async function setup(page: Page) {
  await page.clock.setFixedTime(new Date('2026-09-24T15:00:00Z'))
  await page.addInitScript(() => {
    const requests: Array<{ url: string; aborted: boolean }> = []
    Object.assign(window, { auditRequests: requests })
    const original = window.fetch
    window.fetch = (input, init) => {
      const item = { url: String(input), aborted: false }
      requests.push(item)
      init?.signal?.addEventListener('abort', () => { item.aborted = true })
      return original(input, init)
    }
  })
  await page.route('**/api/auth/refresh', route => ok(route, { accessToken: 'browser-test-only' }))
  await page.route('**/api/auth/me', route => ok(route, { user: { id: 'test', role: 'ADMIN', status: 'ACTIVE', fullName: 'Teste', phone: '11999999999' } }))
  await page.route('**/api/booking/contacts', route => {
    const body = route.request().postDataJSON()
    const digits = String(body.phone).replace(/[^0-9]/g, '')
    return route.fulfill({ status: 201, json: { success: true, data: {
      contactHandle: 'v1.contact.9999999999999.sig',
      fullName: body.fullName,
      phoneMasked: '(' + digits.slice(0, 2) + ') *****-' + digits.slice(-4),
    } } })
  })
  await page.route('**/api/booking/policy', route => ok(route, { requiresApproval: true, baseSlotMinutes: 40, pendingTtlMinutes: 120, minimumAdvanceMinutes: 60 }))
  await page.route('**/api/booking/services', route => ok(route, { services: [service30, service50] }))
  await page.route('**/api/booking/business-hours', route => ok(route, { days: Array.from({ length: 7 }, (_, weekday) => ({ weekday, closed: false, opensAt: '09:00', closesAt: '20:00', breakStartsAt: '12:00', breakEndsAt: '14:00' })) }))
}
async function open(page: Page, screen: string) {
  await page.goto('/tests/browser/fixture.html?page=' + screen)
}
async function fillContact(page: Page) {
  await page.getByLabel('Nome completo').fill('Cliente QA')
  await page.getByLabel('WhatsApp').fill('71988881234')
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
}
async function chooseService(page: Page, name = 'Corte') {
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
}
async function chooseDate(page: Page) {
  await page.getByRole('button', { name: '25 de setembro de 2026', exact: true }).click()
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const outside = await page.locator('main button, main a, main h2, main p').evaluateAll(nodes => nodes
    .filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1) })
    .map(node => node.textContent))
  expect(outside).toEqual([])
}
async function touchTargets(page: Page) {
  const tooSmall = await page.locator('main button:visible').evaluateAll(nodes => nodes
    .filter(node => { const r = node.getBoundingClientRect(); return r.width < 43.9 || r.height < 43.9 })
    .map(node => ({ label: node.getAttribute('aria-label') ?? node.textContent, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })))
  expect(tooSmall).toEqual([])
}

test('historical real Agenda reproduces request loop', async ({ page }) => {
  test.skip(!legacy, 'Run separately with LEGACY_AGENDA_REF pointing at the pre-fix commit.')
  await setup(page)
  let requests = 0
  await page.route('**/api/admin/agenda?**', route => { requests++; return ok(route, { appointments: [] }) })
  await open(page, 'agenda')
  await expect.poll(() => requests).toBeGreaterThanOrEqual(5)
  await page.evaluate(() => (window as any).auditUnmount())
  console.log('Historical Agenda issued ' + requests + ' requests with no user interaction.')
})

test.describe('current booking components in Chromium', () => {
  test.skip(legacy, 'Current-component gates run without the historical override.')
  test.beforeEach(async ({ page }) => { await setup(page) })

  test('Agenda requests once, filters days, sorts adjacent appointments, survives rerenders and changes weeks', async ({ page }) => {
    const queries: string[] = []
    await page.route('**/api/admin/agenda?**', route => {
      queries.push(route.request().url())
      return ok(route, { appointments: [appointment('late', '09:30'), appointment('early', '09:00'), appointment('other', '11:00', '2026-09-25')] })
    })
    await open(page, 'agenda')
    await expect(page.getByRole('link', { name: /Cliente/ })).toHaveCount(2)
    expect(queries).toHaveLength(1)
    await expect(page.getByRole('link', { name: /Cliente/ }).first()).toContainText('Cliente early')
    await expect(page.getByRole('link', { name: /Cliente early/ })).toContainText('09:30')
    await expect(page.getByRole('link', { name: /Cliente early/ })).toContainText('30 min')
    await page.getByRole('button', { name: /^sex/ }).click()
    await expect(page.getByRole('link', { name: /Cliente other/ })).toBeVisible()
    await page.getByRole('button', { name: /^sáb/ }).click()
    await expect(page.getByText('Nenhum atendimento neste dia.')).toBeVisible()
    for (let count = 0; count < 10; count++) await page.evaluate(() => (window as any).auditRender())
    await page.waitForTimeout(250)
    expect(queries).toHaveLength(1)
    await page.getByRole('button', { name: 'Próxima semana' }).click()
    await expect(page.getByText('Nenhum atendimento neste dia.')).toBeVisible()
    expect(queries).toHaveLength(2)
    expect(queries[1]).toContain('from=2026-09-28')
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Atualizar', exact: true })).toBeEnabled()
    expect(queries).toHaveLength(3)
  })

  test('Agenda aborts rapid week changes and unmount without stale updates', async ({ page }) => {
    const pending: Route[] = []
    await page.route('**/api/admin/agenda?**', route => { pending.push(route) })
    await open(page, 'agenda')
    await expect.poll(() => pending.length).toBe(1)
    await page.getByRole('button', { name: 'Próxima semana' }).click()
    await expect.poll(() => pending.length).toBe(2)
    await page.getByRole('button', { name: 'Próxima semana' }).click()
    await expect.poll(() => pending.length).toBe(3)
    const flags = () => page.evaluate(() => (window as any).auditRequests.filter((r: any) => r.url.includes('/admin/agenda')).map((r: any) => r.aborted))
    expect(await flags()).toEqual([true, true, false])
    await ok(pending[2], { appointments: [] })
    await expect(page.getByText('Nenhum atendimento neste dia.')).toBeVisible()
    await ok(pending[0], { appointments: [appointment('stale', '09:00')] })
    await expect(page.getByText('Cliente stale')).toHaveCount(0)
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
    await expect.poll(() => pending.length).toBe(4)
    await page.evaluate(() => (window as any).auditUnmount())
    expect((await flags())[3]).toBe(true)
    await ok(pending[3], { appointments: [appointment('unmounted', '09:00')] })
    await expect(page.locator('#root')).toBeEmpty()
    await ok(pending[1], { appointments: [] })
  })

  test('Agenda API failure exits loading and retries successfully', async ({ page }) => {
    let calls = 0
    await page.route('**/api/admin/agenda?**', route => ++calls === 1
      ? route.fulfill({ status: 503, json: { success: false, error: { code: 'UNAVAILABLE', message: 'Falha temporária' } } })
      : ok(route, { appointments: [] }))
    await open(page, 'agenda')
    await expect(page.getByRole('alert')).toContainText('Falha temporária')
    await expect(page.getByText('Carregando agenda…')).toHaveCount(0)
    await page.getByRole('button', { name: 'Tentar novamente' }).click()
    await expect(page.getByText('Nenhum atendimento neste dia.')).toBeVisible()
    expect(calls).toBe(2)
  })

  test('Agenda network timeout ends loading and allows retry', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-24T15:00:00Z') })
    await page.route('**/api/admin/agenda?**', () => {})
    await open(page, 'agenda')
    await expect(page.getByText('Carregando agenda…')).toBeVisible()
    await page.clock.fastForward(16_000)
    await expect(page.getByRole('alert')).toContainText('Não foi possível falar com o servidor')
    await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled()
  })

  test('changing 30-minute service to 50 minutes clears slot and reloads availability', async ({ page }) => {
    const ids: string[] = []
    await page.route('**/api/booking/availability?**', route => {
      const serviceId = new URL(route.request().url()).searchParams.get('serviceId')!
      ids.push(serviceId)
      return ok(route, { slots: serviceId === '11111111-1111-4111-8111-111111111111' ? [slot('11:30')] : [slot('11:00', 50)], reason: null })
    })
    await open(page, 'schedule'); await fillContact(page); await chooseService(page); await chooseDate(page)
    await page.getByRole('button', { name: '11:30', exact: true }).click()
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Revisar solicitação', exact: true })).toBeVisible()
    for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Voltar à etapa anterior' }).click()
    await expect(page.getByRole('heading', { name: 'Escolha o serviço' })).toBeVisible()
    await chooseService(page, 'Cabelo')
    await expect(page.getByRole('status').filter({ hasText: 'horário foi limpo' })).toBeVisible()
    await chooseDate(page)
    await expect(page.getByRole('button', { name: '11:00', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '11:30', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled()
    expect(ids.at(-1)).toBe('22222222-2222-4222-8222-222222222222')
  })

  for (const width of [360, 375, 390, 412, 430]) {
    test('Schedule mobile ' + width + ': service, calendar, grouped slots and confirmation fit; targets >=44px', async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.route('**/api/booking/availability?**', route => ok(route, { slots: [slot('09:00', 50), slot('14:00', 50), slot('18:00', 50)], reason: null }))
      await open(page, 'schedule')
      await expect(page.getByRole('heading', { name: 'Vamos começar?' })).toBeVisible()
      await noOverflow(page); await touchTargets(page)
      await fillContact(page)
      await expect(page.getByRole('button', { name: /Cabelo/ })).toBeVisible()
      await noOverflow(page); await touchTargets(page)
      await chooseService(page, 'Cabelo')
      await expect(page.getByRole('button', { name: '25 de setembro de 2026', exact: true })).toBeVisible()
      await noOverflow(page); await touchTargets(page)
      await chooseDate(page)
      for (const period of ['Manhã', 'Tarde', 'Noite']) await expect(page.getByRole('heading', { name: period, exact: true })).toBeVisible()
      await noOverflow(page); await touchTargets(page)
      await page.getByRole('button', { name: '18:00', exact: true }).click()
      await page.getByRole('button', { name: 'Continuar', exact: true }).click()
      await expect(page.getByText('18:00 – 18:50')).toBeVisible()
      await noOverflow(page); await touchTargets(page)
    })
  }

  test('Schedule omits empty periods and handles API error, retry and closed day', async ({ page }) => {
    let calls = 0
    await page.route('**/api/booking/availability?**', route => ++calls === 1
      ? route.fulfill({ status: 500, json: { success: false, error: { code: 'FAILURE', message: 'Erro de disponibilidade' } } })
      : ok(route, { slots: [slot('18:00')], reason: null }))
    await open(page, 'schedule'); await fillContact(page); await chooseService(page); await chooseDate(page)
    await expect(page.getByRole('alert')).toContainText('Erro de disponibilidade')
    await page.getByRole('button', { name: 'Tentar novamente' }).click()
    await expect(page.getByRole('heading', { name: 'Noite', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^(Manhã|Tarde)$/ })).toHaveCount(0)
    await page.route('**/api/booking/availability?**', route => ok(route, { slots: [], reason: 'CLOSED' }))
    await page.getByRole('button', { name: 'Voltar à etapa anterior' }).click()
    await chooseDate(page)
    await expect(page.getByText('A barbearia está fechada nesta data.')).toBeVisible()
    await expect(page.getByRole('heading', { name: /^(Manhã|Tarde|Noite)$/ })).toHaveCount(0)
  })

  test('Services creates, edits price/duration/description, deactivates and activates using real UI/API client', async ({ page }) => {
    const services = [structuredClone(service30)]
    const writes: Array<{ method: string; path: string; data: any }> = []
    await page.route('**/api/admin/services**', async route => {
      const request = route.request(); const method = request.method(); const path = new URL(request.url()).pathname
      const data = request.postDataJSON()
      if (method === 'GET') return ok(route, { services })
      writes.push({ method, path, data })
      if (method === 'POST' && path.endsWith('/services')) {
        const created = { ...service30, ...data, id: 'new' }; services.push(created); return ok(route, { service: created })
      }
      const entry = services.find(s => path.includes('/' + s.id))!
      if (method === 'PATCH') Object.assign(entry, data, { priceFormatted: (data.priceCents / 100).toFixed(2).replace('.', ',') })
      else entry.active = path.endsWith('/activate')
      return ok(route, { service: entry })
    })
    await open(page, 'services')
    await page.getByRole('button', { name: 'Adicionar serviço' }).click()
    await page.getByLabel('Nome do serviço').fill('Novo corte')
    await page.getByLabel('Descrição', { exact: true }).fill('Descrição de teste')
    await page.getByLabel('Preço (R$)').fill('42,75')
    await page.getByLabel('Duração (min)').fill('40')
    await page.getByRole('button', { name: 'Criar serviço' }).click()
    await expect(page.getByText('Novo corte', { exact: true })).toBeVisible()
    expect(writes[0].data).toEqual({ name: 'Novo corte', description: 'Descrição de teste', priceCents: 4275, durationMinutes: 40 })
    await page.getByRole('button', { name: 'Editar Corte', exact: true }).click()
    await page.getByLabel('Descrição', { exact: true }).fill('Descrição editada')
    await page.getByLabel('Preço (R$)').fill('50,25')
    await page.getByLabel('Duração (min)').fill('45')
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(page.getByText('Descrição editada', { exact: true })).toBeVisible()
    await expect(page.getByText('45 min', { exact: true })).toBeVisible()
    expect(writes[1].data).toEqual({ name: 'Corte', description: 'Descrição editada', priceCents: 5025, durationMinutes: 45 })
    await page.getByRole('button', { name: 'Ativo', exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Inativo', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Inativo', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Ativo', exact: true })).toHaveCount(2)
    expect(writes.slice(2).map(write => write.path)).toEqual(['/api/admin/services/11111111-1111-4111-8111-111111111111/deactivate', '/api/admin/services/11111111-1111-4111-8111-111111111111/activate'])
    expect(await page.getByLabel(/buffer/i).count()).toBe(0)
  })
})


test.describe('fluxo público de agendamento', () => {
  test.skip(legacy, 'Current-component gates run without the historical override.')
  test.beforeEach(async ({ page }) => { await setup(page) })

  test('solicita agendamento sem senha, sem código e sem login', async ({ page }) => {
    let sent: any = null
    await page.route('**/api/booking/availability?**', route => ok(route, { slots: [slot('09:00')], reason: null }))
    await page.route('**/api/booking/requests', route => {
      sent = route.request().postDataJSON()
      return route.fulfill({
        status: 201,
        json: { success: true, data: {
          appointment: { ...slot('09:00'), id: 'req-1', date: '2026-09-25', serviceName: 'Corte', servicePriceFormatted: '35,00', servicePriceCents: 3500, durationMinutes: 30, status: 'PENDING', notes: null, createdAt: '2026-09-24T00:00:00Z', cancelledAt: null },
          publicToken: 'a'.repeat(43),
          awaitingApproval: true,
          pendingTtlMinutes: 120,
        } },
      })
    })

    await open(page, 'schedule')
    await expect(page.getByRole('heading', { name: 'Vamos começar?' })).toBeVisible()
    // Nenhum campo de senha em lugar nenhum do fluxo.
    expect(await page.locator('input[type=password]').count()).toBe(0)

    await fillContact(page)
    await chooseService(page)
    await chooseDate(page)
    await page.getByRole('button', { name: '09:00', exact: true }).click()
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Revisar solicitação' })).toBeVisible()
    await expect(page.getByText('30 minutos').first()).toBeVisible()
    // A reserva operacional é explicada, nunca apresentada como duração.
    await expect(page.getByText(/reserva 40 minutos na agenda/)).toBeVisible()
    await expect(page.getByText('Cliente QA')).toBeVisible()
    await page.getByRole('button', { name: 'Solicitar agendamento' }).click()

    // Enviou só o necessário — nada de duração, preço ou status.
    await expect(page.getByRole('heading', { name: 'Solicitação enviada!' })).toBeVisible()
    expect(Object.keys(sent).sort()).toEqual(['contactHandle', 'date', 'serviceId', 'startsAt'])
    // Dado pessoal não trafega de novo: o handle identifica o contato.
    expect(JSON.stringify(sent)).not.toContain('98888')
    expect(JSON.stringify(sent)).not.toContain('Cliente QA')
    // Não diz "confirmado" enquanto depende do barbeiro.
    await expect(page.getByText('Agendamento confirmado!')).toHaveCount(0)
    await expect(page.getByText('Ainda não está confirmado')).toBeVisible()
  })

  test('seleção salva não prende na confirmação: dá para retomar ou recomeçar', async ({ page }) => {
    await page.route('**/api/booking/availability?**', route => ok(route, { slots: [slot('09:00'), slot('09:40')], reason: null }))
    await page.addInitScript(() => {
      sessionStorage.setItem('ec.booking.intent', JSON.stringify({
        serviceId: '11111111-1111-4111-8111-111111111111', date: '2026-09-25', startsAt: '09:00', savedAt: Date.now(),
      }))
    })

    await open(page, 'schedule')
    // Não pula direto para a confirmação: oferece escolha.
    await expect(page.getByRole('heading', { name: 'Você tem um agendamento em andamento' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Revisar solicitação' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Começar novo agendamento' }).click()
    await expect(page.getByRole('heading', { name: 'Vamos começar?' })).toBeVisible()
    expect(await page.evaluate(() => sessionStorage.getItem('ec.booking.intent'))).toBeNull()

    // E o fluxo novo anda normalmente: serviço, data e horário livres.
    await fillContact(page)
    await chooseService(page)
    await chooseDate(page)
    await expect(page.getByRole('button', { name: '09:40', exact: true })).toBeVisible()
  })

  test('retomar traz a seleção de volta e ainda permite trocar tudo', async ({ page }) => {
    await page.route('**/api/booking/availability?**', route => ok(route, { slots: [slot('09:00'), slot('09:40')], reason: null }))
    await page.addInitScript(() => {
      sessionStorage.setItem('ec.booking.intent', JSON.stringify({
        serviceId: '11111111-1111-4111-8111-111111111111', date: '2026-09-25', startsAt: '09:00', savedAt: Date.now(),
      }))
    })

    await open(page, 'schedule')
    await page.getByRole('button', { name: 'Continuar agendamento' }).click()
    // Volta pelo contato — o telefone nunca é guardado no navegador.
    await expect(page.getByRole('heading', { name: 'Vamos começar?' })).toBeVisible()
    await fillContact(page)
    await expect(page.getByRole('heading', { name: 'Revisar solicitação' })).toBeVisible()

    // E dá para voltar e trocar de serviço normalmente.
    await page.getByRole('button', { name: 'Voltar à etapa anterior' }).click()
    await page.getByRole('button', { name: 'Voltar à etapa anterior' }).click()
    await page.getByRole('button', { name: 'Voltar à etapa anterior' }).click()
    await expect(page.getByRole('heading', { name: 'Escolha o serviço' })).toBeVisible()
    await chooseService(page, 'Cabelo')
    await expect(page.getByRole('heading', { name: 'Escolha a data' })).toBeVisible()
  })

  test('nenhum dado pessoal vai para o armazenamento do navegador', async ({ page }) => {
    await page.route('**/api/booking/availability?**', route => ok(route, { slots: [slot('09:00')], reason: null }))
    await open(page, 'schedule')
    await fillContact(page)
    await chooseService(page)
    await chooseDate(page)
    await page.getByRole('button', { name: '09:00', exact: true }).click()
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()

    const stored = await page.evaluate(() => ({
      session: JSON.stringify(sessionStorage),
      local: JSON.stringify(localStorage),
    }))
    expect(stored.session).not.toContain('98888')
    expect(stored.session).not.toContain('Cliente QA')
    expect(stored.local).not.toContain('98888')
    expect(stored.local).not.toContain('Cliente QA')
  })
})

test.describe('public submission recovery', () => {
  test.skip(legacy, 'Current-component gates only.')
  for (const failure of [409, 429, 500, 'abort', 'timeout'] as const) {
    test(`recovers from ${failure} and guards double submit`, async ({ page }) => {
      await setup(page)
      await page.route('**/api/booking/availability?**', route => ok(route, { slots: [slot('09:00'), slot('09:40')], reason: null }))
      let attempts = 0
      await page.route('**/api/booking/requests', async route => {
        attempts++
        if (attempts === 1) {
          if (failure === 'abort') return route.abort('failed')
          if (failure === 'timeout') return
          return route.fulfill({ status: failure, json: { success: false, error: { code: failure === 409 ? 'CONFLICT' : failure === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR', message: 'Falha temporária de teste.' } } })
        }
        await new Promise(resolve => setTimeout(resolve, 200))
        return route.fulfill({ status: 201, json: { success: true, data: {
          appointment: { ...appointment('recovered', '09:00', '2026-09-25'), status: 'PENDING' },
          publicToken: 'a'.repeat(43), awaitingApproval: true, pendingTtlMinutes: 120,
        } } })
      })
      await open(page, 'schedule')
      await fillContact(page)
      await chooseService(page)
      await chooseDate(page)
      await page.getByRole('button', { name: '09:00', exact: true }).click()
      await page.getByRole('button', { name: 'Continuar', exact: true }).click()
      await page.getByRole('button', { name: 'Solicitar agendamento', exact: true }).click()
      if (failure === 409) {
        await expect(page.getByRole('heading', { name: 'Escolha o horário' })).toBeVisible()
        await page.getByRole('button', { name: '09:40', exact: true }).click()
        await page.getByRole('button', { name: 'Continuar', exact: true }).click()
      }
      const submit = page.getByRole('button', { name: 'Solicitar agendamento', exact: true })
      await expect(submit).toBeEnabled({ timeout: 18000 })
      expect(attempts).toBe(1)
      await submit.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
      await expect(page.getByRole('heading', { name: 'Solicitação enviada!' })).toBeVisible()
      expect(attempts).toBe(2)
    })
  }
})

test('back navigation changes contact, service, date and time without stale submission', async ({ page }) => {
  test.skip(legacy, 'Current-component gate only.')
  await setup(page)
  await page.route('**/api/booking/availability?**', route => ok(route, { slots: [slot('09:00'), slot('09:40')], reason: null }))
  await open(page, 'schedule')
  await fillContact(page)
  await chooseService(page)
  await chooseDate(page)
  await page.getByRole('button', { name: '09:00', exact: true }).click()
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Voltar à etapa anterior' }).click()
  await page.getByLabel('WhatsApp').fill('71977771234')
  await page.getByLabel('Nome completo').fill('Novo contato QA')
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Revisar solicitação' })).toBeVisible()
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Voltar à etapa anterior' }).click()
  await chooseService(page, 'Cabelo')
  await page.getByRole('button', { name: '26 de setembro de 2026', exact: true }).click()
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await page.getByRole('button', { name: '09:40', exact: true }).click()
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await expect(page.getByText('Novo contato QA', { exact: true })).toBeVisible()
  await expect(page.getByText('(71) *****-1234', { exact: true })).toBeVisible()
  await expect(page.getByText('Cabelo + Barba + Pigmentação', { exact: true })).toBeVisible()
  await expect(page.getByText('50 minutos', { exact: true })).toBeVisible()
})

// ---------------------------------------------------------------------------
// Acompanhamento do pedido: aprovação, pagamento e confirmação
// ---------------------------------------------------------------------------

const TOKEN = 'A'.repeat(43)

const statusAppointment = (status: string) => ({
  id: '33333333-3333-4333-8333-333333333333',
  ...slot('18:20', 30),
  date: '2026-09-29',
  startsAt: '2026-09-29T18:20:00-03:00',
  serviceId: service30.id,
  serviceName: 'Corte',
  servicePriceCents: 3500,
  servicePriceFormatted: '35,00',
  durationMinutes: 30,
  status,
  notes: null,
  createdAt: '2026-09-24T00:00:00Z',
  cancelledAt: null,
})

const payment = (status: string, expiresInSeconds = 840) => ({
  status,
  amountCents: 3500,
  amountFormatted: '35,00',
  currency: 'BRL',
  mode: 'FULL',
  expiresInSeconds,
  expiresAt: '2026-09-24T15:15:00Z',
  checkoutUrl: 'https://pagamento.invalido/manual/abc',
  pixQrCode: '00020126MANUALabc123',
})

/** Serve uma resposta de /booking/requests/:token e semeia o comprovante. */
async function openStatus(page: Page, data: Record<string, unknown>) {
  await page.route('**/api/booking/requests/**', route => ok(route, data))
  await page.addInitScript(token => {
    localStorage.setItem('ec.booking.lastRequest', token as string)
  }, TOKEN)
  await open(page, 'status')
}

test('acompanhamento PENDING: aguarda o barbeiro, sem cobranca e sem WhatsApp', async ({ page }) => {
  await setup(page)
  await openStatus(page, {
    appointment: statusAppointment('PENDING'),
    reference: null,
    payment: null,
    whatsappUrl: null,
  })

  await expect(page.getByRole('heading', { name: 'Aguardando confirmação' })).toBeVisible()
  // Nunca "confirmado" antes de a barbearia decidir.
  await expect(page.getByRole('heading', { name: /confirmado!/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Confirmar pelo WhatsApp/ })).toHaveCount(0)
  await expect(page.getByText('Pix copia e cola')).toHaveCount(0)
  await expect(page.getByText('Corte', { exact: true })).toBeVisible()
})

test('acompanhamento AWAITING_PAYMENT: valor, prazo, Pix e nenhum "ja paguei"', async ({ page }) => {
  await setup(page)
  await openStatus(page, {
    appointment: statusAppointment('AWAITING_PAYMENT'),
    reference: 'EC-7F3K2Q',
    payment: payment('PENDING'),
    whatsappUrl: null,
  })

  await expect(page.getByRole('heading', { name: 'Pedido aprovado!' })).toBeVisible()
  await expect(page.getByText('R$ 35,00').first()).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Aguardando pagamento' })).toBeVisible()
  await expect(page.getByText('EC-7F3K2Q', { exact: true })).toBeVisible()
  await expect(page.getByText('14:00')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pagar agora' })).toHaveAttribute(
    'href',
    'https://pagamento.invalido/manual/abc',
  )
  await expect(page.getByText('00020126MANUALabc123')).toBeVisible()

  // Nada que afirme pagamento por conta própria, e nada de WhatsApp ainda.
  await expect(page.getByRole('button', { name: /j. paguei/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Confirmar pelo WhatsApp/ })).toHaveCount(0)
  await expect(page.getByText(/confirmação é automática/i)).toBeVisible()
})

test('acompanhamento CONFIRMED: pagamento confirmado e WhatsApp da barbearia', async ({ page }) => {
  await setup(page)
  const whatsappUrl =
    'https://wa.me/5571999990000?text=' +
    encodeURIComponent(
      'Meu agendamento na ErickCorttes foi confirmado\n\nServico: Corte\nReferencia: EC-7F3K2Q\n\nObrigado!',
    )
  await openStatus(page, {
    appointment: statusAppointment('CONFIRMED'),
    reference: 'EC-7F3K2Q',
    payment: { ...payment('PAID'), expiresInSeconds: 0 },
    whatsappUrl,
  })

  await expect(page.getByRole('heading', { name: 'Agendamento confirmado!' })).toBeVisible()
  // Duas menções legítimas: o subtítulo e o selo com o valor. Ancoramos no selo.
  await expect(page.getByText(/Pagamento confirmado — R\$ 35,00/)).toBeVisible()

  const link = page.getByRole('link', { name: /Confirmar pelo WhatsApp/ })
  await expect(link).toHaveAttribute('href', whatsappUrl)
  // Abre em aba nova e sem vazar o referrer.
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', /noopener/)

  // O token NAO viaja na mensagem.
  const href = (await link.getAttribute('href'))!
  expect(decodeURIComponent(href)).not.toContain(TOKEN)

  // A reserva não depende de o WhatsApp abrir.
  await expect(page.getByText(/está tudo certo do mesmo jeito/i)).toBeVisible()
})

test('acompanhamento: pagamento recusado nao confirma e oferece nova tentativa', async ({ page }) => {
  await setup(page)
  await openStatus(page, {
    appointment: statusAppointment('AWAITING_PAYMENT'),
    reference: 'EC-7F3K2Q',
    payment: payment('FAILED', 600),
    whatsappUrl: null,
  })

  await expect(page.getByRole('status').filter({ hasText: 'Pagamento recusado' })).toBeVisible()
  await expect(page.getByText(/ainda pode tentar de novo/i)).toBeVisible()
  await expect(page.getByRole('heading', { name: /confirmado!/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Confirmar pelo WhatsApp/ })).toHaveCount(0)
})

test('acompanhamento EXPIRED: horario liberado, sem cobranca viva e sem WhatsApp', async ({ page }) => {
  await setup(page)
  await openStatus(page, {
    appointment: statusAppointment('EXPIRED'),
    reference: 'EC-7F3K2Q',
    payment: { ...payment('EXPIRED'), expiresInSeconds: 0 },
    whatsappUrl: null,
  })

  await expect(page.getByRole('heading', { name: 'Solicitação expirada' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Confirmar pelo WhatsApp/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Fazer outro agendamento' })).toBeVisible()
})

test('acompanhamento: token desconhecido nao revela nada e limpa o comprovante', async ({ page }) => {
  await setup(page)
  await page.route('**/api/booking/requests/**', route =>
    route.fulfill({
      status: 404,
      json: { success: false, error: { code: 'NOT_FOUND', message: 'Solicitação não encontrada.' } },
    }),
  )
  await page.addInitScript(token => {
    localStorage.setItem('ec.booking.lastRequest', token as string)
  }, TOKEN)
  await open(page, 'status')

  await expect(page.getByRole('heading', { name: /Não encontramos essa solicitação/ })).toBeVisible()
  // Comprovante inválido sai do navegador.
  expect(await page.evaluate(() => localStorage.getItem('ec.booking.lastRequest'))).toBeNull()
})

for (const width of [360, 375, 390, 412, 430]) {
  test('acompanhamento mobile ' + width + ': pagamento e confirmacao cabem; alvos >=44px', async ({ page }) => {
    await setup(page)
    await page.setViewportSize({ width, height: 900 })
    await openStatus(page, {
      appointment: statusAppointment('AWAITING_PAYMENT'),
      reference: 'EC-7F3K2Q',
      payment: payment('PENDING'),
      whatsappUrl: null,
    })
    await expect(page.getByRole('heading', { name: 'Pedido aprovado!' })).toBeVisible()
    await noOverflow(page)
    await touchTargets(page)
  })

  test('confirmacao mobile ' + width + ': botao do WhatsApp cabe e tem alvo >=44px', async ({ page }) => {
    await setup(page)
    await page.setViewportSize({ width, height: 900 })
    await openStatus(page, {
      appointment: statusAppointment('CONFIRMED'),
      reference: 'EC-7F3K2Q',
      payment: { ...payment('PAID'), expiresInSeconds: 0 },
      whatsappUrl: 'https://wa.me/5571999990000?text=ok',
    })
    await expect(page.getByRole('heading', { name: 'Agendamento confirmado!' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Confirmar pelo WhatsApp/ })).toBeVisible()
    await noOverflow(page)
    await touchTargets(page)
  })
}

// §30 — retorno posterior pelo link, sem autenticacao e sem comprovante local.
test('acompanhamento por link: token vem da URL, sem sessao e sem localStorage', async ({ page }) => {
  await setup(page)
  const urlToken = 'B'.repeat(43)
  let requested = ''
  let sentAuth: string | undefined
  await page.route('**/api/booking/requests/**', route => {
    requested = route.request().url()
    sentAuth = route.request().headers()['authorization']
    return ok(route, {
      appointment: statusAppointment('CONFIRMED'),
      reference: 'EC-7F3K2Q',
      payment: null,
      whatsappUrl: 'https://wa.me/5571999990000?text=ok',
    })
  })
  // Nada guardado no navegador: so o link.
  await page.goto('/tests/browser/fixture.html?page=status-route&token=' + urlToken)

  await expect(page.getByRole('heading', { name: 'Agendamento confirmado!' })).toBeVisible()
  expect(requested).toContain(urlToken)
  expect(await page.evaluate(() => localStorage.getItem('ec.booking.lastRequest'))).toBeNull()
  // A consulta do pedido nao leva credencial: o token do pedido e a unica chave.
  // (O AuthProvider da aplicacao tenta restaurar sessao em qualquer pagina; isso
  //  e comportamento global, nao um requisito desta tela.)
  expect(sentAuth).toBeUndefined()
  await expect(page.getByText('EC-7F3K2Q', { exact: true })).toBeVisible()
})

// §30 — o token da URL tem prioridade sobre o comprovante guardado.
test('token da URL prevalece sobre o comprovante em localStorage', async ({ page }) => {
  await setup(page)
  const urlToken = 'C'.repeat(43)
  const stored = 'D'.repeat(43)
  const asked: string[] = []
  await page.route('**/api/booking/requests/**', route => {
    asked.push(route.request().url())
    return ok(route, {
      appointment: statusAppointment('PENDING'), reference: null, payment: null, whatsappUrl: null,
    })
  })
  await page.addInitScript(t => localStorage.setItem('ec.booking.lastRequest', t as string), stored)
  await page.goto('/tests/browser/fixture.html?page=status-route&token=' + urlToken)

  await expect(page.getByRole('heading', { name: 'Aguardando confirmação' })).toBeVisible()
  expect(asked.some(u => u.includes(urlToken))).toBe(true)
  expect(asked.some(u => u.includes(stored))).toBe(false)
})

// §29 — estados reais restantes, com texto coerente e sem dado interno.
for (const [status, heading] of [
  ['REJECTED', 'Pedido não aceito'],
  ['CANCELLED', 'Agendamento cancelado'],
  ['COMPLETED', 'Atendimento concluído'],
] as const) {
  test('acompanhamento ' + status + ': texto coerente, sem WhatsApp e sem dado interno', async ({ page }) => {
    await setup(page)
    await openStatus(page, {
      appointment: statusAppointment(status),
      reference: status === 'COMPLETED' ? 'EC-7F3K2Q' : null,
      payment: null,
      whatsappUrl: null,
    })
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await expect(page.getByRole('link', { name: /Confirmar pelo WhatsApp/ })).toHaveCount(0)
    // Nenhum identificador interno na tela.
    const text = await page.locator('main').innerText()
    expect(text).not.toContain('33333333-3333-4333-8333-333333333333')
    expect(text).not.toContain(service30.id)
    expect(text).not.toMatch(/AWAITING_PAYMENT|PENDING|CONFIRMED|REJECTED/)
  })
}

// ---------------------------------------------------------------------------
// Pagamento via Pix na tela de acompanhamento
// ---------------------------------------------------------------------------

/** BR Code plausivel, com CRC que o backend teria calculado. */
const BRCODE =
  '00020101021126580014br.gov.bcb.pix01365f79a1c2-3b4d-4e5f-8a9b-0c1d2e3f8c21520400005303986540540.005802BR5922ERICKCORTTES BARBEARIA6008SALVADOR62120508EC7F3K2Q6304D4D7'
const PIX_KEY = '5f79a1c2-3b4d-4e5f-8a9b-0c1d2e3f8c21'
const QR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25" shape-rendering="crispEdges"><rect width="25" height="25" fill="#fff"/><rect x="2" y="2" width="7" height="7" fill="#000"/></svg>'

const staticPix = {
  source: 'STATIC_PIX',
  copyPaste: BRCODE,
  qrCodeSvg: QR_SVG,
  key: PIX_KEY,
  keyMasked: '5f79…8c21',
  receiverName: 'ErickCorttes Barbearia',
  requiresManualConfirmation: true,
}

const dynamicPix = {
  source: 'DYNAMIC_PROVIDER_PIX',
  copyPaste: BRCODE,
  qrCodeSvg: QR_SVG,
  key: null,
  keyMasked: null,
  receiverName: null,
  requiresManualConfirmation: false,
}

const awaitingPayment = (pix: unknown, extra: Record<string, unknown> = {}) => ({
  appointment: statusAppointment('AWAITING_PAYMENT'),
  reference: 'EC-7F3K2Q',
  payment: payment('PENDING'),
  whatsappUrl: null,
  pix,
  paymentHelpUrl: 'https://wa.me/5571999990000?text=' + encodeURIComponent('Meu agendamento foi aprovado.'),
  ...extra,
})

test('Pix estatico: aprovado, com QR, chave e Copia e Cola, sem dizer confirmado', async ({ page }) => {
  await setup(page)
  await openStatus(page, awaitingPayment(staticPix))

  await expect(page.getByRole('heading', { name: 'Seu horário foi aprovado!' })).toBeVisible()
  await expect(page.getByText('Agora realize o pagamento para confirmar o agendamento.')).toBeVisible()
  // A expressao proibida nao aparece enquanto o pagamento esta pendente.
  await expect(page.getByText(/Agendamento confirmado/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Confirmar pelo WhatsApp/ })).toHaveCount(0)

  // Card do agendamento.
  await expect(page.getByText('Corte', { exact: true })).toBeVisible()
  await expect(page.getByText('29/09/2026', { exact: true })).toBeVisible()
  await expect(page.getByText('EC-7F3K2Q', { exact: true })).toBeVisible()

  // Secao Pix.
  await expect(page.getByRole('heading', { name: 'Pague via Pix' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'QR Code para pagamento via Pix' })).toBeVisible()
  // O QR e grafico de verdade, nao a chave em texto.
  expect(await page.locator('[role="img"] svg').count()).toBe(1)
  await expect(page.getByText('5f79…8c21')).toBeVisible()
  await expect(page.getByText('ErickCorttes Barbearia')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copiar chave Pix' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copiar código Pix' })).toBeVisible()
  await expect(page.getByText('Pix Copia e Cola')).toBeVisible()

  // Pix estatico avisa que a confirmacao e da barbearia.
  await expect(page.getByText('Após o pagamento, aguarde a confirmação da barbearia.')).toBeVisible()
  await expect(page.getByText(/confirmação é automática/)).toHaveCount(0)

  // E oferece falar com a barbearia.
  await expect(page.getByRole('link', { name: /Falar com a barbearia/ })).toBeVisible()
  // Nada de "ja paguei".
  await expect(page.getByRole('button', { name: /j. paguei/i })).toHaveCount(0)
})

test('Pix: copiar chave e copiar codigo usam o valor completo, nao o mascarado', async ({ page }) => {
  await setup(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await openStatus(page, awaitingPayment(staticPix))

  await page.getByRole('button', { name: 'Copiar chave Pix' }).click()
  await expect(page.getByRole('button', { name: 'Chave Pix copiada' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PIX_KEY)

  await page.getByRole('button', { name: 'Copiar código Pix' }).click()
  await expect(page.getByRole('button', { name: 'Código Pix copiado' })).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toBe(BRCODE)
  // Nada de segredo no que foi para a area de transferencia.
  expect(copied).not.toContain(TOKEN)
  expect(copied).not.toMatch(/eyJ|Bearer|secret/i)
})

test('Pix: copiar nao altera o estado do pagamento', async ({ page }) => {
  await setup(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const methods: string[] = []
  await page.route('**/api/booking/requests/**', route => {
    methods.push(route.request().method())
    return ok(route, awaitingPayment(staticPix))
  })
  await page.addInitScript(t => localStorage.setItem('ec.booking.lastRequest', t as string), TOKEN)
  await open(page, 'status')

  await page.getByRole('button', { name: 'Copiar chave Pix' }).click()
  await page.getByRole('button', { name: 'Copiar código Pix' }).click()
  await expect(page.getByRole('heading', { name: 'Seu horário foi aprovado!' })).toBeVisible()

  // Copiar nao dispara escrita nenhuma na API.
  expect(methods.every(m => m === 'GET')).toBe(true)
  const writes = await page.evaluate(() =>
    (window as any).auditRequests.filter((r: any) => /booking/.test(r.url)).length)
  expect(writes).toBeGreaterThan(0)
  // E a tela continua dizendo que falta pagar.
  await expect(page.getByText(/Agendamento confirmado/)).toHaveCount(0)
})

test('Pix dinamico: sem chave da barbearia e com confirmacao automatica', async ({ page }) => {
  await setup(page)
  await openStatus(page, awaitingPayment(dynamicPix))

  await expect(page.getByRole('heading', { name: 'Pague via Pix' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'QR Code para pagamento via Pix' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copiar código Pix' })).toBeVisible()
  // Cobranca de provedor nao expoe a chave estatica.
  await expect(page.getByRole('button', { name: 'Copiar chave Pix' })).toHaveCount(0)
  await expect(page.getByText('Chave Pix')).toHaveCount(0)
  await expect(page.getByText(/confirmação é automática/)).toBeVisible()
  await expect(page.getByText(/aguarde a confirmação da barbearia/)).toHaveCount(0)
})

test('sem Pix apresentavel e sem checkout, orienta falar com a barbearia', async ({ page }) => {
  await setup(page)
  await openStatus(page, awaitingPayment(null, { payment: { ...payment('PENDING'), checkoutUrl: null } }))

  await expect(page.getByRole('heading', { name: 'Seu horário foi aprovado!' })).toBeVisible()
  await expect(page.getByText(/Não conseguimos gerar o pagamento agora/)).toBeVisible()
  // Nao inventa QR nenhum.
  await expect(page.getByRole('img', { name: 'QR Code para pagamento via Pix' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Falar com a barbearia/ })).toBeVisible()
})

test('pagamento recusado: rotulo honesto e sem confirmacao', async ({ page }) => {
  await setup(page)
  await openStatus(page, {
    ...awaitingPayment(staticPix),
    payment: payment('FAILED', 600),
  })
  await expect(
    page.getByRole('status').filter({ hasText: 'Não foi possível confirmar o pagamento' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: /Confirmar pelo WhatsApp/ })).toHaveCount(0)
})

test('confirmado: Pix sai da tela e o WhatsApp de confirmacao aparece', async ({ page }) => {
  await setup(page)
  const url = 'https://wa.me/5571999990000?text=' + encodeURIComponent('confirmado')
  await openStatus(page, {
    appointment: statusAppointment('CONFIRMED'),
    reference: 'EC-7F3K2Q',
    payment: { ...payment('PAID'), expiresInSeconds: 0 },
    whatsappUrl: url,
    pix: null,
    paymentHelpUrl: null,
  })

  await expect(page.getByRole('heading', { name: 'Agendamento confirmado!' })).toBeVisible()
  await expect(page.getByText(/Pagamento confirmado — R\$ 35,00/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Confirmar pelo WhatsApp/ })).toHaveAttribute('href', url)
  // O QR nao pode continuar convidando a pagar.
  await expect(page.getByRole('img', { name: 'QR Code para pagamento via Pix' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Copiar chave Pix' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Falar com a barbearia/ })).toHaveCount(0)
})

test('rotulo de aguardando aprovacao segue o especificado', async ({ page }) => {
  await setup(page)
  await openStatus(page, {
    appointment: statusAppointment('PENDING'),
    reference: null, payment: null, whatsappUrl: null, pix: null, paymentHelpUrl: null,
  })
  await expect(page.getByRole('heading', { name: 'Aguardando aprovação' })).toBeVisible()
})

test('rotulo de solicitacao recusada segue o especificado', async ({ page }) => {
  await setup(page)
  await openStatus(page, {
    appointment: statusAppointment('REJECTED'),
    reference: null, payment: null, whatsappUrl: null, pix: null, paymentHelpUrl: null,
  })
  await expect(page.getByRole('heading', { name: 'Solicitação recusada' })).toBeVisible()
})

test('nenhum segredo aparece na tela de pagamento', async ({ page }) => {
  await setup(page)
  await openStatus(page, awaitingPayment(staticPix))
  await expect(page.getByRole('heading', { name: 'Pague via Pix' })).toBeVisible()
  const text = await page.locator('main').innerText()
  const html = await page.content()
  for (const forbidden of [TOKEN, '33333333-3333-4333-8333-333333333333', service30.id]) {
    expect(text).not.toContain(forbidden)
    expect(html).not.toContain(forbidden)
  }
  expect(text).not.toMatch(/eyJ|Bearer |secret|webhook|DATABASE_URL|v2\./i)
  // A chave Pix nao e segredo — ela PRECISA estar dentro do BR Code, senao o QR
  // nao paga. O que a tela nao faz e estampa-la como valor solto: a linha
  // dedicada mostra a forma curta, e o valor inteiro so sai pelo botao de copiar.
  await expect(page.getByText('5f79…8c21')).toBeVisible()
  expect(await page.getByText(PIX_KEY, { exact: true }).count()).toBe(0)
})

for (const width of [360, 375, 390, 412, 430]) {
  test('Pix mobile ' + width + ': QR, chave e botoes cabem; alvos >=44px', async ({ page }) => {
    await setup(page)
    await page.setViewportSize({ width, height: 900 })
    await openStatus(page, awaitingPayment(staticPix))
    await expect(page.getByRole('heading', { name: 'Pague via Pix' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'QR Code para pagamento via Pix' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copiar chave Pix' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Falar com a barbearia/ })).toBeVisible()
    await noOverflow(page)
    await touchTargets(page)
  })
}

// ---------------------------------------------------------------------------
// Painel administrativo: confirmar o recebimento do Pix
// ---------------------------------------------------------------------------

const APPT_ID = '44444444-4444-4444-8444-444444444444'

const adminPayment = (over: Record<string, unknown> = {}) => ({
  method: 'PIX_MANUAL',
  status: 'PENDING',
  amountCents: 4000,
  amountFormatted: '40,00',
  canConfirmManually: true,
  expiresAt: '2026-09-24T15:30:00Z',
  expiresInSeconds: 1790,
  windowClosed: false,
  paidAt: null,
  ...over,
})

const adminAppointment = (status: string, payment: unknown, over: Record<string, unknown> = {}) => ({
  id: APPT_ID,
  ...slot('18:20', 40),
  date: '2026-09-29',
  startsAt: '2026-09-29T18:20:00-03:00',
  serviceId: service30.id,
  serviceName: 'Corte + Barba',
  servicePriceCents: 4000,
  servicePriceFormatted: '40,00',
  durationMinutes: 40,
  status,
  notes: null,
  createdAt: '2026-09-24T00:00:00Z',
  cancelledAt: null,
  customer: {
    id: '55555555-5555-4555-8555-555555555555',
    fullName: 'Guilherme Santana',
    phone: '71988881234',
    phoneFormatted: '(71) 98888-1234',
  },
  reference: 'EC-7F3K2Q',
  payment,
  ...over,
})

/** Serve o detalhe administrativo e abre a tela. */
async function openAppointment(page: Page, appointment: unknown) {
  await page.route('**/api/admin/appointments/' + APPT_ID, route => {
    if (route.request().method() !== 'GET') return route.fallback()
    return ok(route, { appointment })
  })
  await page.goto('/tests/browser/fixture.html?page=appointment&token=' + APPT_ID)
}

test('admin AWAITING_PAYMENT: secao Pagamento com metodo, valor, status e referencia', async ({ page }) => {
  await setup(page)
  await openAppointment(page, adminAppointment('AWAITING_PAYMENT', adminPayment()))

  const secao = page.getByRole('region', { name: 'Pagamento' })
  await expect(page.getByRole('heading', { name: 'Pagamento' })).toBeVisible()
  await expect(secao.getByText('Pix', { exact: true })).toBeVisible()
  await expect(secao.getByText('R$ 40,00')).toBeVisible()
  await expect(secao.getByText('Aguardando pagamento', { exact: true })).toBeVisible()
  await expect(secao.getByText('EC-7F3K2Q', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirmar recebimento do Pix' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pagamento não identificado' })).toBeVisible()
  await expect(page.getByText(/Confira o recebimento no extrato/)).toBeVisible()

  // Nenhum identificador interno na tela.
  const text = await page.locator('main').innerText()
  expect(text).not.toContain(APPT_ID)
  expect(text).not.toContain('static-pix')
  expect(text).not.toMatch(/providerPaymentId|paymentId/)
})

test('admin: confirmar exige modal, nao um clique so', async ({ page }) => {
  await setup(page)
  let posted = 0
  await page.route('**/api/admin/appointments/' + APPT_ID + '/payment', route => {
    posted++
    return ok(route, { appointment: adminAppointment('CONFIRMED', adminPayment({ status: 'PAID', canConfirmManually: false, paidAt: '2026-09-24T15:05:00Z' })) })
  })
  await openAppointment(page, adminAppointment('AWAITING_PAYMENT', adminPayment()))

  await page.getByRole('button', { name: 'Confirmar recebimento do Pix' }).click()
  // Nada foi enviado ainda: o modal esta no caminho.
  expect(posted).toBe(0)

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Confirmar pagamento?' })).toBeVisible()
  await expect(dialog.getByText(/Confirme somente após verificar o recebimento/)).toBeVisible()
  // O modal repete o que esta em jogo.
  await expect(dialog.getByText('Guilherme Santana')).toBeVisible()
  await expect(dialog.getByText('Corte + Barba')).toBeVisible()
  await expect(dialog.getByText('R$ 40,00')).toBeVisible()
  await expect(dialog.getByText('29 de setembro de 2026')).toBeVisible()
  await expect(dialog.getByText('18:20')).toBeVisible()
  await expect(dialog.getByText('EC-7F3K2Q')).toBeVisible()

  // Cancelar nao envia nada.
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(posted).toBe(0)

  // Confirmar envia uma vez e mostra o resultado.
  await page.getByRole('button', { name: 'Confirmar recebimento do Pix' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar pagamento' }).click()
  await expect(page.getByText('Pagamento confirmado. Agendamento confirmado.')).toBeVisible()
  expect(posted).toBe(1)
  // O botao sai da tela: nao ha mais o que confirmar.
  await expect(page.getByRole('button', { name: 'Confirmar recebimento do Pix' })).toHaveCount(0)
  await expect(page.getByText('Pagamento confirmado.', { exact: true })).toBeVisible()
})

test('admin: o corpo enviado leva somente a decisao', async ({ page }) => {
  await setup(page)
  let body: any = null
  await page.route('**/api/admin/appointments/' + APPT_ID + '/payment', route => {
    body = route.request().postDataJSON()
    return ok(route, { appointment: adminAppointment('CONFIRMED', adminPayment({ status: 'PAID', canConfirmManually: false })) })
  })
  await openAppointment(page, adminAppointment('AWAITING_PAYMENT', adminPayment()))
  await page.getByRole('button', { name: 'Confirmar recebimento do Pix' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar pagamento' }).click()
  await expect(page.getByText('Pagamento confirmado. Agendamento confirmado.')).toBeVisible()

  // O painel nao escolhe valor, provedor, data de pagamento nem estado.
  expect(Object.keys(body).sort()).toEqual(['decision'])
  expect(body.decision).toBe('PAID')
})

test('admin: duplo clique envia uma requisicao so', async ({ page }) => {
  await setup(page)
  let posted = 0
  await page.route('**/api/admin/appointments/' + APPT_ID + '/payment', async route => {
    posted++
    // Resposta lenta: e nessa janela que o duplo clique acontece.
    await new Promise(resolve => setTimeout(resolve, 600))
    return ok(route, { appointment: adminAppointment('CONFIRMED', adminPayment({ status: 'PAID', canConfirmManually: false })) })
  })
  await openAppointment(page, adminAppointment('AWAITING_PAYMENT', adminPayment()))
  await page.getByRole('button', { name: 'Confirmar recebimento do Pix' }).click()

  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Confirmar pagamento' })
  await confirm.click()
  // Enquanto voa, o botao esta desabilitado e mostra progresso.
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Processando...' })).toBeDisabled()
  await expect(page.getByText('Pagamento confirmado. Agendamento confirmado.')).toBeVisible()
  expect(posted).toBe(1)
})

test('admin: 409 de outra sessao aparece como aviso, nao erro generico', async ({ page }) => {
  await setup(page)
  await page.route('**/api/admin/appointments/' + APPT_ID + '/payment', route =>
    route.fulfill({
      status: 409,
      json: { success: false, error: { code: 'CONFLICT', message: 'Este pagamento já foi confirmado.' } },
    }),
  )
  // A recarga apos o conflito devolve o estado real.
  let gets = 0
  await page.route('**/api/admin/appointments/' + APPT_ID, route => {
    if (route.request().method() !== 'GET') return route.fallback()
    gets++
    return ok(route, gets === 1
      ? { appointment: adminAppointment('AWAITING_PAYMENT', adminPayment()) }
      : { appointment: adminAppointment('CONFIRMED', adminPayment({ status: 'PAID', canConfirmManually: false })) })
  })
  await page.goto('/tests/browser/fixture.html?page=appointment&token=' + APPT_ID)

  await page.getByRole('button', { name: 'Confirmar recebimento do Pix' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar pagamento' }).click()

  // A mensagem do servidor aparece como status, e o estado se atualiza.
  await expect(page.getByRole('status').filter({ hasText: 'Este pagamento já foi confirmado.' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Confirmar recebimento do Pix' })).toHaveCount(0)
})

test('admin: marcar como nao identificado nao cancela o agendamento', async ({ page }) => {
  await setup(page)
  let body: any = null
  await page.route('**/api/admin/appointments/' + APPT_ID + '/payment', route => {
    body = route.request().postDataJSON()
    return ok(route, { appointment: adminAppointment('AWAITING_PAYMENT', adminPayment({ status: 'FAILED' })) })
  })
  await openAppointment(page, adminAppointment('AWAITING_PAYMENT', adminPayment()))

  await page.getByRole('button', { name: 'Pagamento não identificado' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Marcar como não identificado?' })).toBeVisible()
  await expect(dialog.getByText(/continua aguardando pagamento e o cliente pode tentar de novo/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Marcar como não identificado' }).click()

  expect(body.decision).toBe('FAILED')
  await expect(page.getByText(/ainda pode pagar dentro do prazo/)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Pagamento' }).getByText('Não identificado', { exact: true })).toBeVisible()
})

test('admin CONFIRMED: sem botao de confirmar', async ({ page }) => {
  await setup(page)
  await openAppointment(page, adminAppointment('CONFIRMED', adminPayment({ status: 'PAID', canConfirmManually: false, paidAt: '2026-09-24T15:05:00Z' })))
  await expect(page.getByRole('heading', { name: 'Pagamento' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Pagamento' }).getByText('Pago', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirmar recebimento do Pix' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pagamento não identificado' })).toHaveCount(0)
})

test('admin PENDING: sem cobranca, sem secao de pagamento', async ({ page }) => {
  await setup(page)
  await openAppointment(page, adminAppointment('PENDING', null, { reference: null }))
  await expect(page.getByRole('heading', { name: 'Pagamento' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Confirmar recebimento do Pix' })).toHaveCount(0)
})

test('admin prazo vencido: botao desaparece e orienta tratamento manual', async ({ page }) => {
  await setup(page)
  await openAppointment(page, adminAppointment('EXPIRED', adminPayment({
    canConfirmManually: false, windowClosed: true, expiresInSeconds: 0,
  })))
  await expect(page.getByRole('heading', { name: 'Pagamento' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Pagamento' }).getByText('Prazo vencido', { exact: true })).toBeVisible()
  // O botao normal sai da tela.
  await expect(page.getByRole('button', { name: 'Confirmar recebimento do Pix' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pagamento não identificado' })).toHaveCount(0)
  // E o painel explica o risco de confirmar um horario que voltou a ficar livre.
  await expect(page.getByText(/trate o caso manualmente com o cliente/)).toBeVisible()
})

test('admin cobranca de provedor: confirmacao manual nao e oferecida', async ({ page }) => {
  await setup(page)
  await openAppointment(page, adminAppointment('AWAITING_PAYMENT', adminPayment({
    method: 'PROVIDER', canConfirmManually: false,
  })))
  await expect(page.getByRole('region', { name: 'Pagamento' }).getByText('Provedor', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirmar recebimento do Pix' })).toHaveCount(0)
  await expect(page.getByText(/confirmação chega automaticamente pelo provedor/)).toBeVisible()
})

test('agenda admin: AWAITING_PAYMENT se distingue e chama para a acao', async ({ page }) => {
  await setup(page)
  const date = '2026-09-24'
  await page.route('**/api/admin/agenda**', route => ok(route, {
    appointments: [
      adminAppointment('AWAITING_PAYMENT', adminPayment(), { id: APPT_ID, date, startsAt: date + 'T09:00:00-03:00', ...slot('09:00', 40) }),
      adminAppointment('CONFIRMED', null, { id: '66666666-6666-4666-8666-666666666666', reference: null, date, startsAt: date + 'T11:00:00-03:00', ...slot('11:00', 40), customer: { id: 'c2', fullName: 'Outro Cliente', phone: '71977770000', phoneFormatted: '(71) 97777-0000' } }),
    ],
  }))
  await open(page, 'agenda')

  // O rotulo distingue, e a chamada para acao aparece so no que aguarda Pix.
  await expect(page.getByText('Aguardando pagamento').first()).toBeVisible()
  await expect(page.getByText(/Pix de R\$ 40,00 a conferir/)).toBeVisible()
  expect(await page.getByText(/a conferir/).count()).toBe(1)
  // A borda esquerda usa cor propria, diferente de confirmado.
  const classes = await page.locator('a[href*="' + APPT_ID + '"]').getAttribute('class')
  expect(classes).toContain('border-l-amber-400')
})

for (const width of [360, 375, 390, 412, 430]) {
  test('admin pagamento mobile ' + width + ': secao e modal cabem; alvos >=44px', async ({ page }) => {
    await setup(page)
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/admin/appointments/' + APPT_ID + '/payment', route =>
      ok(route, { appointment: adminAppointment('CONFIRMED', adminPayment({ status: 'PAID', canConfirmManually: false })) }))
    await openAppointment(page, adminAppointment('AWAITING_PAYMENT', adminPayment()))

    await expect(page.getByRole('heading', { name: 'Pagamento' })).toBeVisible()
    await noOverflow(page)
    await touchTargets(page)

    // E com o modal aberto.
    await page.getByRole('button', { name: 'Confirmar recebimento do Pix' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const small = await page.getByRole('dialog').locator('button').evaluateAll(nodes =>
      nodes.filter(node => node.getBoundingClientRect().height < 44).map(node => node.textContent))
    expect(small).toEqual([])
    const overflowing = await page.getByRole('dialog').evaluate(node => {
      const rect = node.getBoundingClientRect()
      return rect.left < -1 || rect.right > innerWidth + 1
    })
    expect(overflowing).toBe(false)
  })
}

// §15 — a agenda distingue os cinco estados e chama para acao so onde cabe.
test('agenda admin: cinco estados distintos, aviso de Pix so onde ha Pix manual', async ({ page }) => {
  await setup(page)
  const date = '2026-09-24'
  const at = (clock: string) => ({ date, startsAt: date + 'T' + clock + ':00-03:00', ...slot(clock, 40) })
  const person = (name: string) => ({
    id: 'c-' + name, fullName: name, phone: '71977770000', phoneFormatted: '(71) 97777-0000',
  })

  await page.route('**/api/admin/agenda**', route => ok(route, {
    appointments: [
      // AWAITING_PAYMENT com Pix manual aguardando conferencia.
      adminAppointment('AWAITING_PAYMENT', adminPayment(), {
        id: APPT_ID, ...at('09:00'), customer: person('Aguarda Pix'),
      }),
      // PENDING: aguardando aprovacao, sem cobranca.
      adminAppointment('PENDING', null, {
        id: 'a-pending', reference: null, ...at('10:00'), customer: person('Aguarda Aprovacao'),
      }),
      // CONFIRMED com Pix ja pago.
      adminAppointment('CONFIRMED', adminPayment({ status: 'PAID', canConfirmManually: false }), {
        id: 'a-confirmed', ...at('11:00'), customer: person('Confirmado'),
      }),
      // REJECTED.
      adminAppointment('REJECTED', null, {
        id: 'a-rejected', reference: null, ...at('12:00'), customer: person('Recusado'),
      }),
      // EXPIRED com cobranca cujo prazo venceu.
      adminAppointment('EXPIRED', adminPayment({ canConfirmManually: false, windowClosed: true, expiresInSeconds: 0 }), {
        id: 'a-expired', ...at('13:00'), customer: person('Expirado'),
      }),
    ],
  }))
  await open(page, 'agenda')

  // Cada estado tem seu rotulo.
  for (const label of ['Aguardando pagamento', 'Aguardando', 'Confirmado', 'Recusado', 'Expirado']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
  }

  // A chamada para acao aparece UMA vez, no item que realmente aguarda Pix.
  await expect(page.getByText(/Pix de R\$ 40,00 a conferir/)).toBeVisible()
  expect(await page.getByText(/a conferir/).count()).toBe(1)
  // E o aviso de prazo vencido so no expirado.
  await expect(page.getByText('Prazo de pagamento vencido')).toBeVisible()
  expect(await page.getByText('Prazo de pagamento vencido').count()).toBe(1)

  // Cores de borda distintas entre aguardando pagamento e confirmado.
  const awaiting = await page.locator('a[href*="' + APPT_ID + '"]').getAttribute('class')
  const confirmed = await page.locator('a[href*="a-confirmed"]').getAttribute('class')
  const pending = await page.locator('a[href*="a-pending"]').getAttribute('class')
  expect(awaiting).toContain('border-l-amber-400')
  expect(confirmed).not.toContain('border-l-amber-400')
  expect(pending).not.toContain('border-l-amber-400')
  expect(confirmed).toContain('border-l-[var(--primary)]')

  // Nenhum identificador interno de pagamento na lista.
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(/static-pix|providerPaymentId|paymentId/)
})
