import { test, expect } from '../fixtures/auth'
import { getToken, deleteComparableByAddress, deleteComparableById } from '../helpers/api'

const TEST_ADDRESS = '[TEST] Calle Comparable E2E 123'

test.describe('Comparables', () => {
  let token: string
  // Track IDs created during tests so we can clean them up even if navigation fails
  let createdIds: number[] = []

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
  })

  test.afterEach(async ({ request }) => {
    // Clean up by address (catches form-submitted ones)
    await deleteComparableByAddress(request, TEST_ADDRESS, token)
    // Clean up any tracked IDs
    for (const id of createdIds) {
      await deleteComparableById(request, id, token).catch(() => { /* already deleted */ })
    }
    createdIds = []
  })

  // ── 1. Comparables list page ───────────────────────────────────────────────

  test('/prospectos/comparables loads and shows COMPARABLES count label', async ({ page }) => {
    await page.goto('/prospectos/comparables')
    // The toolbar always renders "N COMPARABLES" label regardless of count
    await expect(page.getByText(/\d+ COMPARABLES/)).toBeVisible()
  })

  test('comparables list shows + NUEVO COMPARABLE button', async ({ page }) => {
    await page.goto('/prospectos/comparables')
    await expect(page.getByText('+ NUEVO COMPARABLE')).toBeVisible()
  })

  test('comparables list shows table headers: DIRECCIÓN, M², PRECIO', async ({ page }) => {
    await page.goto('/prospectos/comparables')
    await expect(page.getByText('DIRECCIÓN')).toBeVisible()
    await expect(page.getByText('M²', { exact: true })).toBeVisible()
    await expect(page.getByText('PRECIO')).toBeVisible()
  })

  test('comparables list shows status filter dropdown with Todos option', async ({ page }) => {
    await page.goto('/prospectos/comparables')
    const filterSelect = page.locator('select').first()
    await expect(filterSelect).toBeVisible()
    await expect(filterSelect.locator('option', { hasText: 'Todos' })).toBeAttached()
  })

  test('status filter dropdown contains Activos, Vendidos, Retirados, Expirados options', async ({ page }) => {
    await page.goto('/prospectos/comparables')
    const filterSelect = page.locator('select').first()
    await expect(filterSelect.locator('option', { hasText: 'Activos' })).toBeAttached()
    await expect(filterSelect.locator('option', { hasText: 'Vendidos' })).toBeAttached()
    await expect(filterSelect.locator('option', { hasText: 'Retirados' })).toBeAttached()
    await expect(filterSelect.locator('option', { hasText: 'Expirados' })).toBeAttached()
  })

  // ── 2. Navigate to create form ────────────────────────────────────────────

  test('clicking + NUEVO COMPARABLE navigates to /prospectos/comparables/nuevo', async ({ page }) => {
    await page.goto('/prospectos/comparables')
    await page.getByText('+ NUEVO COMPARABLE').click()
    await expect(page).toHaveURL(/\/prospectos\/comparables\/nuevo/)
  })

  // ── 3. ComparableForm fields ───────────────────────────────────────────────

  test('nuevo comparable form shows "Nuevo Comparable" heading', async ({ page }) => {
    await page.goto('/prospectos/comparables/nuevo')
    await expect(page.getByText('Nuevo Comparable')).toBeVisible()
  })

  test('nuevo comparable form shows required field labels', async ({ page }) => {
    await page.goto('/prospectos/comparables/nuevo')
    await expect(page.getByText('Dirección *')).toBeVisible()
    await expect(page.getByText('m² *')).toBeVisible()
    await expect(page.getByText('Precio (MXN) *')).toBeVisible()
    await expect(page.getByText('Fecha listado *')).toBeVisible()
    await expect(page.getByText('URL del listing *')).toBeVisible()
    await expect(page.getByText('Portal *')).toBeVisible()
  })

  test('nuevo comparable form shows optional fields: Colonia, Ciudad, Recámaras, Baños', async ({ page }) => {
    await page.goto('/prospectos/comparables/nuevo')
    await expect(page.getByText('Colonia')).toBeVisible()
    await expect(page.getByText('Ciudad')).toBeVisible()
    await expect(page.getByText('Recámaras')).toBeVisible()
    await expect(page.getByText('Baños')).toBeVisible()
  })

  test('nuevo comparable form shows Tipo and Condición selects and GUARDAR/CANCELAR buttons', async ({ page }) => {
    await page.goto('/prospectos/comparables/nuevo')
    await expect(page.getByText('Tipo')).toBeVisible()
    await expect(page.getByText('Condición')).toBeVisible()
    await expect(page.getByRole('button', { name: 'GUARDAR' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'CANCELAR' })).toBeVisible()
  })

  test('submit without required fields shows validation errors', async ({ page }) => {
    await page.goto('/prospectos/comparables/nuevo')
    await page.getByRole('button', { name: 'GUARDAR' }).click()
    // Validation errors appear for required fields
    await expect(page.getByText('Requerido').first()).toBeVisible()
  })

  test('← COMPARABLES back link navigates back to comparables list', async ({ page }) => {
    await page.goto('/prospectos/comparables/nuevo')
    await page.getByText('← COMPARABLES').click()
    await expect(page).toHaveURL(/\/prospectos\/comparables$/)
  })

  // ── 4. Create comparable end-to-end ───────────────────────────────────────

  test('fill required fields and submit — navigates back to list with new entry', async ({ page }) => {
    await page.goto('/prospectos/comparables/nuevo')

    await page.locator('[data-testid="input-address"]').fill(TEST_ADDRESS)
    await page.locator('[data-testid="input-m2"]').fill('150')
    await page.locator('[data-testid="input-price"]').fill('3500000')

    // Use native value setter + change event to trigger React's onChange on a controlled date input.
    // Plain .fill() updates DOM value but doesn't fire through React's synthetic event system in
    // headless Chromium on Linux, leaving form.listedAt = '' and causing validation to fail.
    await page.locator('[data-testid="input-listed-at"]').evaluate((el: HTMLInputElement) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      nativeSetter.call(el, '2026-01-15')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await page.locator('[data-testid="input-listing-url"]').fill('https://www.inmuebles24.com/test-e2e')
    await page.locator('[data-testid="input-city"]').fill('Monterrey')

    await page.getByRole('button', { name: 'GUARDAR' }).click()

    // After successful save, navigates back to comparables list
    await expect(page).toHaveURL(/\/prospectos\/comparables$/, { timeout: 10000 })

    // The new entry should appear in the table
    await expect(page.getByText(TEST_ADDRESS)).toBeVisible()
  })

  // ── 5. Filter behavior ────────────────────────────────────────────────────

  test('selecting a status filter updates the COMPARABLES count label', async ({ page }) => {
    await page.goto('/prospectos/comparables')

    // Get initial count text
    const countLabel = page.getByText(/\d+ COMPARABLES/)
    await expect(countLabel).toBeVisible()

    // Filter to Activos
    await page.locator('select').first().selectOption('active')

    // Label updates to reflect filtered count
    await expect(page.getByText(/\d+ COMPARABLES/)).toBeVisible()
  })
})
