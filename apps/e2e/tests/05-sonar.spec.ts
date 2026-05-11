import { test, expect } from '../fixtures/auth'

const SSE_BODY = [
  'data: {"type":"start","portals":["lamudi"],"total":1,"cves":[]}',
  '',
  'data: {"type":"portal_start","portal":"lamudi"}',
  '',
  'data: {"type":"portal_done","portal":"lamudi","fetched":1,"skipped":0}',
  '',
  'data: {"type":"complete","found":1,"skipped":0,"enriched":0,"signals":[{"id":99999,"portal":"lamudi","url":"https://lamudi.com.mx/mock","title":"Terreno Mock","price":1500000,"municipioName":"Monterrey","municipioCve":"19039","colonia":null,"address":null,"sqmLand":null,"sqmConst":null,"ppsqm":null,"score":null,"lat":null,"lng":null}]}',
  '',
  '',
].join('\n')

test.describe('Sonar', () => {
  test("/prospectos/sonar loads with scan button 'EJECUTAR SCAN ▸'", async ({ page }) => {
    await page.goto('/prospectos/sonar')
    await expect(page.getByText('EJECUTAR SCAN ▸')).toBeVisible()
  })

  test('zone chips Monterrey, San Pedro, Santa Catarina, García are visible', async ({ page }) => {
    await page.goto('/prospectos/sonar')
    // Scope to button elements — when signals exist, the zone filter <select> also contains
    // <option> elements with these names which are not visible but fool getByText
    await expect(page.locator('button', { hasText: 'Monterrey' })).toBeVisible()
    await expect(page.locator('button', { hasText: 'San Pedro' })).toBeVisible()
    await expect(page.locator('button', { hasText: 'Santa Catarina' })).toBeVisible()
    await expect(page.locator('button', { hasText: 'García' })).toBeVisible()
  })

  test('clicking Monterrey chip toggles its visual state', async ({ page }) => {
    await page.goto('/prospectos/sonar')
    // The zone chip is a <button> — scope to button to avoid matching zone filter select options
    const chip = page.locator('button', { hasText: 'Monterrey' })

    // Get initial background before click
    const initialBg = await chip.evaluate(el => window.getComputedStyle(el).backgroundColor)

    // First click — should activate/deactivate
    await chip.click()
    const afterFirstClick = await chip.evaluate(el => window.getComputedStyle(el).backgroundColor)

    // Second click — should toggle back
    await chip.click()
    const afterSecondClick = await chip.evaluate(el => window.getComputedStyle(el).backgroundColor)

    // At least one transition should have changed the background
    const changed =
      initialBg !== afterFirstClick ||
      afterFirstClick !== afterSecondClick
    expect(changed).toBe(true)
  })

  test('mocked scan stream — lamudi appears after scan', async ({ page }) => {
    // Intercept the scan API and return a fake SSE stream
    await page.route('**/api/sonar/run', route => {
      route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
        body: SSE_BODY,
      })
    })

    await page.goto('/prospectos/sonar')
    await page.getByText('EJECUTAR SCAN ▸').click()

    // Scope to span elements to skip hidden <option> elements in the portal filter select
    await expect(page.locator('span').filter({ hasText: 'lamudi' }).first()).toBeVisible({ timeout: 8000 })
  })
})
