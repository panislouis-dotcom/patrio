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

/**
 * Empties the persisted signal list the page loads on mount.
 *
 * SonarTab fetches the stored signals in a `useEffect` and calls `setSignals`
 * when that resolves. A mocked scan finishes in milliseconds, so the two race:
 * when the stored list lands last it overwrites the results the scan just
 * produced, and the table goes back to "Sin señales" while the header still
 * reports what the scan found. (A real scan takes seconds, so the app never
 * shows this — but it is the app's race, not the test's.) Serving the list
 * instantly and empty takes the race out of the scan tests.
 */
function mockStoredSignals(page: import('@playwright/test').Page) {
  return page.route('**/api/sonar/signals', route =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' }),
  )
}

test.describe('Sonar', () => {
  test("page loads with scan button 'EJECUTAR SCAN ▸'", async ({ page }) => {
    await page.goto('/propiedades/sonar')
    await expect(page.getByText('EJECUTAR SCAN ▸')).toBeVisible()
  })

  test('/api/sonar/zones is called on page load', async ({ page }) => {
    const zonesRequest = page.waitForRequest('**/api/sonar/zones', { timeout: 15_000 })
    await page.goto('/propiedades/sonar')
    await zonesRequest  // resolves only when the request fires — proves the endpoint is called on mount
  })

  test('state dropdown shows Nuevo León', async ({ page }) => {
    await mockZones(page)
    await page.goto('/propiedades/sonar')
    // ESTADO <select> is the first select in the header
    const stateSelect = page.locator('select').first()
    await expect(stateSelect).toContainText('Nuevo León', { timeout: 5000 })
  })

  test('all 6 city chips are visible after zones load', async ({ page }) => {
    await mockZones(page)
    await page.goto('/propiedades/sonar')
    // Chips truncate to first 2 words of municipio name
    for (const label of ['Monterrey', 'San Pedro', 'Santa Catarina', 'García', 'Apodaca', 'Escobedo']) {
      await expect(page.locator('button', { hasText: label })).toBeVisible({ timeout: 5000 })
    }
  })

  test('"Todas" button selects all chips and reveals ✕', async ({ page }) => {
    await mockZones(page)
    await page.goto('/propiedades/sonar')
    await page.locator('button', { hasText: 'Todas' }).waitFor({ state: 'visible', timeout: 5000 })
    await page.locator('button', { hasText: 'Todas' }).click()
    // ✕ clear button has no title; "Descartar" row buttons have title="Descartar"
    await expect(page.locator('button:not([title])').filter({ hasText: '✕' })).toBeVisible()
  })

  test('✕ button clears city selection', async ({ page }) => {
    await mockZones(page)
    await page.goto('/propiedades/sonar')
    await page.locator('button', { hasText: 'Todas' }).waitFor({ state: 'visible', timeout: 5000 })
    await page.locator('button', { hasText: 'Todas' }).click()
    const clearBtn = page.locator('button:not([title])').filter({ hasText: '✕' })
    await expect(clearBtn).toBeVisible()
    await clearBtn.click()
    await expect(clearBtn).not.toBeVisible()
  })

  test('clicking a city chip toggles its visual state', async ({ page }) => {
    await mockZones(page)
    await page.goto('/propiedades/sonar')
    const chip = page.locator('button', { hasText: 'Monterrey' })
    await chip.waitFor({ state: 'visible', timeout: 5000 })

    const before = await chip.evaluate(el => window.getComputedStyle(el).backgroundColor)
    await chip.click()
    const after = await chip.evaluate(el => window.getComputedStyle(el).backgroundColor)
    expect(before).not.toBe(after)
  })

  // The PORTALES strip only exists while `running` is true. A mocked stream
  // completes in a few milliseconds, so asserting on it is a race against a
  // frame that may never be polled — these tests assert on the result the scan
  // leaves behind, which is what the user is actually there for.
  test('mocked scan — the signal lands in the results table', async ({ page }) => {
    await mockZones(page)
    await mockStoredSignals(page)
    await page.route('**/api/sonar/run', route =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        body: SSE_BODY,
      }),
    )

    await page.goto('/propiedades/sonar')
    // The chips only render once zones resolve, so they are the signal that the
    // component finished mounting. Clicking before that hits a button whose
    // handler React has not attached yet — the click lands and nothing happens.
    await page.locator('button', { hasText: 'Monterrey' }).waitFor({ state: 'visible', timeout: 8000 })
    await page.getByText('EJECUTAR SCAN ▸').click()

    // The scraped listing survives the scan; the progress strip does not
    await expect(page.getByText(MOCK_SIGNAL.title)).toBeVisible({ timeout: 8000 })
    // Results table with VS MUN column header
    await expect(page.getByText('VS MUN')).toBeVisible({ timeout: 8000 })
  })

  test('mocked scan with city filter — CVEs sent in request body', async ({ page }) => {
    await mockZones(page)
    await mockStoredSignals(page)

    let capturedBody: string | null = null
    await page.route('**/api/sonar/run', async route => {
      capturedBody = route.request().postData()
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        body: SSE_BODY,
      })
    })

    await page.goto('/propiedades/sonar')
    await page.locator('button', { hasText: 'Monterrey' }).waitFor({ state: 'visible', timeout: 8000 })
    await page.locator('button', { hasText: 'Monterrey' }).click()
    // The ✕ only exists while a city is selected, so it is proof the selection
    // reached state — scanning before it does would send an empty cve list.
    await expect(page.locator('button:not([title])').filter({ hasText: '✕' })).toBeVisible()
    await page.getByText('EJECUTAR SCAN ▸').click()

    await expect(page.getByText(MOCK_SIGNAL.title)).toBeVisible({ timeout: 8000 })
    expect(capturedBody).toContain('19039')
  })
})
