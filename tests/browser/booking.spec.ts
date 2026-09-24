import { test, expect, type Page, type Route } from '@playwright/test'

const legacy = Boolean(process.env.LEGACY_AGENDA_REF)
const service30 = { id: 'cut', name: 'Corte', description: 'Corte simples', priceCents: 3500, priceFormatted: '35,00', durationMinutes: 30, active: true }
const service50 = { ...service30, id: 'combo', name: 'Cabelo + Barba + Pigmentação', durationMinutes: 50, priceCents: 10000, priceFormatted: '100,00' }
const slot = (clock: string, duration = 30) => {
  const startsAt = '2026-09-25T' + clock + ':00-03:00'
  const end = new Date(new Date(startsAt).getTime() + duration * 60_000)
  return { startsAtClock: clock, endsAtClock: new Date(end.getTime() - 3 * 60 * 60_000).toISOString().slice(11, 16), startsAt, endsAt: end.toISOString() }
}
const appointment = (id: string, clock: string, date = '2026-09-24') => ({
  id, ...slot(clock), startsAt: date + 'T' + clock + ':00-03:00', date,
  serviceId: 'cut', serviceName: 'Corte', servicePriceCents: 3500,
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
  await page.route('**/api/booking/services', route => ok(route, { services: [service30, service50] }))
  await page.route('**/api/booking/business-hours', route => ok(route, { days: Array.from({ length: 7 }, (_, weekday) => ({ weekday, closed: false, opensAt: '09:00', closesAt: '20:00', breakStartsAt: '12:00', breakEndsAt: '14:00' })) }))
}
async function open(page: Page, screen: string) {
  await page.goto('/tests/browser/fixture.html?page=' + screen)
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
      return ok(route, { slots: serviceId === 'cut' ? [slot('11:30')] : [slot('11:00', 50)], reason: null })
    })
    await open(page, 'schedule'); await chooseService(page); await chooseDate(page)
    await page.getByRole('button', { name: '11:30', exact: true }).click()
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Confirmar agendamento', exact: true })).toBeVisible()
    for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Voltar à etapa anterior' }).click()
    await chooseService(page, 'Cabelo')
    await expect(page.getByRole('status').filter({ hasText: 'horário foi limpo' })).toBeVisible()
    await chooseDate(page)
    await expect(page.getByRole('button', { name: '11:00', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '11:30', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled()
    expect(ids.at(-1)).toBe('combo')
  })

  for (const width of [360, 375, 390, 412, 430]) {
    test('Schedule mobile ' + width + ': service, calendar, grouped slots and confirmation fit; targets >=44px', async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.route('**/api/booking/availability?**', route => ok(route, { slots: [slot('09:00', 50), slot('14:00', 50), slot('18:00', 50)], reason: null }))
      await open(page, 'schedule')
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
    await open(page, 'schedule'); await chooseService(page); await chooseDate(page)
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
    expect(writes.slice(2).map(write => write.path)).toEqual(['/api/admin/services/cut/deactivate', '/api/admin/services/cut/activate'])
    expect(await page.getByLabel(/buffer/i).count()).toBe(0)
  })
})

