import { test, expect } from '../fixtures/auth'
import { getToken, deleteProspectByName } from '../helpers/api'

const PROSPECT_NAME = '[TEST] Casa Prueba'

test.describe('Prospectos', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
  })

  test.afterEach(async ({ request }) => {
    await deleteProspectByName(request, PROSPECT_NAME, token)
  })

  test('table loads with expected columns', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    // SCORE is the default active sort and renders as "SCORE ↓" — match by th containing the text
    await expect(page.locator('th').filter({ hasText: 'SCORE' })).toBeVisible()
    await expect(page.locator('th').filter({ hasText: 'ROI' })).toBeVisible()
    await expect(page.locator('th').filter({ hasText: 'CAP RATE' })).toBeVisible()
    await expect(page.locator('th').filter({ hasText: 'PROFIT' })).toBeVisible()
  })

  test('sort by column — click SCORE header shows ↑ or ↓ suffix', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    // SCORE starts as "SCORE ↓" (active sort, descending) — locate by th containing text
    const scoreHeader = page.locator('th').filter({ hasText: 'SCORE' })
    await scoreHeader.click()
    // After clicking the active header, direction toggles — one indicator must be present
    const hasIndicator =
      (await page.locator('th').filter({ hasText: 'SCORE ↑' }).isVisible()) ||
      (await page.locator('th').filter({ hasText: 'SCORE ↓' }).isVisible())
    expect(hasIndicator).toBe(true)
  })

  test("'+ NUEVO' opens modal with 'Nuevo prospecto' title", async ({ page }) => {
    await page.goto('/prospectos/tabla')
    await page.getByText('+ NUEVO').click()
    await expect(page.getByText('Nuevo prospecto')).toBeVisible()
  })

  test('create prospect via modal — row appears in table', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    await page.getByText('+ NUEVO').click()
    await expect(page.getByText('Nuevo prospecto')).toBeVisible()

    // Fill Nombre (autoFocus input — first field in modal)
    await page.getByPlaceholder('ej. 20000').waitFor({ state: 'visible' })
    // Fill name using the label scoped approach
    const nombreLabel = page.getByText('Nombre').first()
    await nombreLabel.locator('..').locator('input').fill(PROSPECT_NAME)

    // Fill Dirección
    const direccionLabel = page.getByText('Dirección')
    await direccionLabel.locator('..').locator('input').fill('Calle Test 123')

    // Fill Renta mensual
    await page.getByPlaceholder('ej. 20000').fill('25000')

    await page.getByText('GUARDAR').click()

    // Modal should close and the name appears in the table
    await expect(page.getByText('Nuevo prospecto')).not.toBeVisible()
    // The name may appear in the table row AND in other contexts — first() handles it
    await expect(page.getByText(PROSPECT_NAME).first()).toBeVisible()
  })

  test('click row — navigates to detail page', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    // Click the first row in the table (seed data, not test prospect)
    const firstRow = page.locator('table tbody tr').first()
    await firstRow.waitFor({ state: 'visible' })
    await firstRow.click()
    await expect(page).toHaveURL(/\/prospectos\/tabla\/\d+/)
  })

  test('detail page shows key content and back navigation works', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    await firstRow.waitFor({ state: 'visible' })
    await firstRow.click()
    await expect(page).toHaveURL(/\/prospectos\/tabla\/\d+/)

    // Key content visible on detail page: ROI label and PROFIT stat
    // Some labels appear twice (responsive layout) — first() avoids strict mode
    await expect(page.getByText('ROI').first()).toBeVisible()
    await expect(page.getByText('PROFIT').first()).toBeVisible()

    // Back link navigates back to the table — two buttons exist (responsive), use first()
    await page.getByText('← PROSPECTOS').first().click()
    await expect(page).toHaveURL(/\/prospectos\/tabla$/)
  })

  test('/prospectos/mapa loads — map container visible', async ({ page }) => {
    await page.goto('/prospectos/mapa')
    // The map tab should load without errors; check for leaflet container or the page itself
    await expect(page).toHaveURL(/\/prospectos\/mapa/)
    // Leaflet renders a div with class leaflet-container
    await page.waitForSelector('.leaflet-container', { timeout: 8000 })
  })
})
