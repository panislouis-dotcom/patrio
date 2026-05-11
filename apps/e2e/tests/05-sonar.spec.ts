import { test, expect } from '../fixtures/auth'

const MOCK_ZONES = {
  states: [{
    name: 'Nuevo León',
    municipios: [
      { cve: '19039', name: 'Monterrey' },
      { cve: '19019', name: 'San Pedro Garza García' },
      { cve: '19046', name: 'Santa Catarina' },
      { cve: '19021', name: 'García' },
      { cve: '19006', name: 'Apodaca' },
      { cve: '19010', name: 'Escobedo' },
    ],
  }],
}

const MOCK_SIGNAL = {
  id: 99999, portal: 'lamudi', url: 'https://lamudi.com.mx/mock',
  title: 'Terreno Mock', price: 1500000, municipioName: 'Monterrey',
  municipioCve: '19039', stateName: 'Nuevo León', colonia: null,
  address: null, sqmLand: null, sqmConst: null, ppsqm: null,
  score: null, lat: null, lng: null, lastPrice: null, firstSeen: null, lastSeen: null,
}

const SSE_BODY = [
  'data: {"type":"start","portals":["lamudi"],"total":1,"cves":[]}',
  '',
  'data: {"type":"portal_start","portal":"lamudi"}',
  '',
  'data: {"type":"portal_done","portal":"lamudi","fetched":1,"skipped":0}',
  '',
  `data: {"type":"complete","found":1,"skipped":0,"enriched":0,"signals":[${JSON.stringify(MOCK_SIGNAL)}]}`,
  '',
  '',
].join('\n')

function mockZones(page: import('@playwright/test').Page) {
  return page.route('**/api/sonar/zones', route =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(MOCK_ZONES) }),
  )
}

test.describe('Sonar', () => {
  test("page loads with scan button 'EJECUTAR SCAN ▸'", async ({ page }) => {
    await page.goto('/prospectos/sonar')
    await expect(page.getByText('EJECUTAR SCAN ▸')).toBeVisible()
  })

  test('/api/sonar/zones is called on page load', async ({ page }) => {
    let zonesHit = false
    await page.route('**/api/sonar/zones', route => { zonesHit = true; route.continue() })
    await page.goto('/prospectos/sonar')
    await page.waitForTimeout(1500)
    expect(zonesHit).toBe(true)
  })

  test('state dropdown shows Nuevo León', async ({ page }) => {
    await mockZones(page)
    await page.goto('/prospectos/sonar')
    // ESTADO <select> is the first select in the header
    const stateSelect = page.locator('select').first()
    await expect(stateSelect).toContainText('Nuevo León', { timeout: 5000 })
  })

  test('all 6 city chips are visible after zones load', async ({ page }) => {
    await mockZones(page)
    await page.goto('/prospectos/sonar')
    // Chips truncate to first 2 words of municipio name
    for (const label of ['Monterrey', 'San Pedro', 'Santa Catarina', 'García', 'Apodaca', 'Escobedo']) {
      await expect(page.locator('button', { hasText: label })).toBeVisible({ timeout: 5000 })
    }
  })

  test('"Todas" button selects all chips and reveals ✕', async ({ page }) => {
    await mockZones(page)
    await page.goto('/prospectos/sonar')
    await page.locator('button', { hasText: 'Todas' }).waitFor({ state: 'visible', timeout: 5000 })
    await page.locator('button', { hasText: 'Todas' }).click()
    // ✕ clear button has no title; "Descartar" row buttons have title="Descartar"
    await expect(page.locator('button:not([title])').filter({ hasText: '✕' })).toBeVisible()
  })

  test('✕ button clears city selection', async ({ page }) => {
    await mockZones(page)
    await page.goto('/prospectos/sonar')
    await page.locator('button', { hasText: 'Todas' }).waitFor({ state: 'visible', timeout: 5000 })
    await page.locator('button', { hasText: 'Todas' }).click()
    const clearBtn = page.locator('button:not([title])').filter({ hasText: '✕' })
    await expect(clearBtn).toBeVisible()
    await clearBtn.click()
    await expect(clearBtn).not.toBeVisible()
  })

  test('clicking a city chip toggles its visual state', async ({ page }) => {
    await mockZones(page)
    await page.goto('/prospectos/sonar')
    const chip = page.locator('button', { hasText: 'Monterrey' })
    await chip.waitFor({ state: 'visible', timeout: 5000 })

    const before = await chip.evaluate(el => window.getComputedStyle(el).backgroundColor)
    await chip.click()
    const after = await chip.evaluate(el => window.getComputedStyle(el).backgroundColor)
    expect(before).not.toBe(after)
  })

  test('mocked scan — lamudi result appears and VS MUN column is shown', async ({ page }) => {
    await mockZones(page)
    await page.route('**/api/sonar/run', route =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        body: SSE_BODY,
      }),
    )

    await page.goto('/prospectos/sonar')
    await page.getByText('EJECUTAR SCAN ▸').click()

    // Portal row shows up during/after scan
    await expect(page.locator('span').filter({ hasText: 'lamudi' }).first()).toBeVisible({ timeout: 8000 })
    // Results table with VS MUN column header
    await expect(page.getByText('VS MUN')).toBeVisible({ timeout: 8000 })
  })

  test('mocked scan with city filter — CVEs sent in request body', async ({ page }) => {
    await mockZones(page)

    let capturedBody: string | null = null
    await page.route('**/api/sonar/run', async route => {
      capturedBody = route.request().postData()
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        body: SSE_BODY,
      })
    })

    await page.goto('/prospectos/sonar')
    await page.locator('button', { hasText: 'Monterrey' }).waitFor({ state: 'visible', timeout: 5000 })
    await page.locator('button', { hasText: 'Monterrey' }).click()
    await page.getByText('EJECUTAR SCAN ▸').click()

    await page.locator('span').filter({ hasText: 'lamudi' }).first().waitFor({ timeout: 8000 })
    expect(capturedBody).toContain('19039')
  })
})
