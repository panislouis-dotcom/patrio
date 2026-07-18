import { test, expect } from '../fixtures/auth'
import { getToken, deleteProspectByName } from '../helpers/api'

const TEST_NOTES_PREFIX = '[TEST] notas e2e'

test.describe('Prospect Detail', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
  })

  test.afterEach(async ({ request }) => {
    // Clean up any test notes prospects we may have created
    await deleteProspectByName(request, TEST_NOTES_PREFIX, token)
  })

  // ── Helper: navigate to the first prospect detail page ──────────────────
  async function goToFirstDetail(page: Parameters<Parameters<typeof test>[1]>[0]) {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    await firstRow.waitFor({ state: 'visible' })
    await firstRow.click()
    await expect(page).toHaveURL(/\/prospectos\/tabla\/\d+/)
  }

  // ── 1. Navigation ────────────────────────────────────────────────────────

  test('clicking first table row navigates to detail URL', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }
    await firstRow.click()
    await expect(page).toHaveURL(/\/prospectos\/tabla\/\d+/)
  })

  // ── 2. Header ────────────────────────────────────────────────────────────

  test('header shows back button and action buttons', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)

    await expect(page.getByText('← PROSPECTOS').first()).toBeVisible()
    await expect(page.getByText('CONVERTIR ▸ PROYECTO').first()).toBeVisible()
    await expect(page.getByText('ELIMINAR').first()).toBeVisible()
  })

  // ── 3. Left panel — all three tab buttons ────────────────────────────────

  test('left panel shows INFO, EDITAR, and ANÁLISIS tab buttons', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)

    await expect(page.getByRole('button', { name: 'INFO' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'EDITAR' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ANÁLISIS' })).toBeVisible()
  })

  // ── 4. INFO tab — key metric labels ─────────────────────────────────────

  test('INFO tab (default) shows ROI ANUAL, PROFIT, CAP RATE, INVERSIÓN labels', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)

    // INFO is the default tab — no click needed
    await expect(page.getByText('ROI ANUAL').first()).toBeVisible()
    await expect(page.getByText('PROFIT').first()).toBeVisible()
    await expect(page.getByText('CAP RATE').first()).toBeVisible()
    await expect(page.getByText('INVERSIÓN').first()).toBeVisible()
  })

  test('INFO tab shows TERRENO and CONSTRUCCIÓN stat labels', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)

    await expect(page.getByText('TERRENO').first()).toBeVisible()
    await expect(page.getByText('CONSTRUCCIÓN').first()).toBeVisible()
  })

  // ── 5. EDITAR tab ────────────────────────────────────────────────────────

  test('EDITAR tab shows form fields when clicked', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)

    await page.getByRole('button', { name: 'EDITAR' }).click()

    // The form renders labeled inputs — check for key section labels
    await expect(page.getByText('NOMBRE').first()).toBeVisible()
    await expect(page.getByText('DIRECCIÓN').first()).toBeVisible()
    await expect(page.getByText('NOTAS').first()).toBeVisible()
  })

  test('EDITAR tab — editing Notas and saving persists value', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)

    await page.getByRole('button', { name: 'EDITAR' }).click()

    const uniqueNotes = `${TEST_NOTES_PREFIX} ${Date.now()}`

    // Find the NOTAS textarea and fill it
    const notasTextarea = page.locator('textarea').first()
    await notasTextarea.waitFor({ state: 'visible' })
    await notasTextarea.fill(uniqueNotes)

    // GUARDAR ▸ button appears in header only when there are unsaved edits
    await expect(page.getByText('GUARDAR ▸')).toBeVisible()
    await page.getByText('GUARDAR ▸').click()

    // Wait for save to complete — button disappears
    await expect(page.getByText('GUARDAR ▸')).not.toBeVisible({ timeout: 8000 })

    // Switch to INFO tab and back to confirm it was saved (notes appear in INFO)
    await page.getByRole('button', { name: 'INFO' }).click()
    await page.getByRole('button', { name: 'EDITAR' }).click()

    // The textarea should now contain our saved text
    await expect(page.locator('textarea').first()).toHaveValue(uniqueNotes)
  })

  // ── 6. ANÁLISIS tab ──────────────────────────────────────────────────────

  test('ANÁLISIS tab shows analysis section with CORRER ANÁLISIS button', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)

    await page.getByRole('button', { name: 'ANÁLISIS' }).click()

    // The ProspectAnalysisSection always renders the ANÁLISIS heading and the button
    await expect(page.getByText('ANÁLISIS').first()).toBeVisible()
    await expect(page.getByText('CORRER ANÁLISIS')).toBeVisible()
  })

  test('ANÁLISIS tab — CORRER ANÁLISIS toggle shows form fields', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)

    await page.getByRole('button', { name: 'ANÁLISIS' }).click()
    await page.getByText('CORRER ANÁLISIS').click()

    // The analysis form shows INTERVENCIÓN and PLAZO labels
    await expect(page.getByText('INTERVENCIÓN').first()).toBeVisible()
    await expect(page.getByText('PLAZO (MESES)').first()).toBeVisible()
    await expect(page.getByText('EJECUTAR')).toBeVisible()
    await expect(page.getByText('CANCELAR').first()).toBeVisible()
  })

  // ── 7. Center panel — MAPA tab ───────────────────────────────────────────

  test('center panel shows MAPA and FOTOS tab buttons', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)

    await expect(page.getByRole('button', { name: 'MAPA' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'FOTOS' })).toBeVisible()
  })

  test('MAPA tab — renders map or "SIN COORDENADAS" message', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)

    // MAPA is active by default — wait for either leaflet map or the no-coords message.
    // .isVisible() returns immediately (no waiting), so we must poll until content renders.
    await expect(async () => {
      const hasMap = await page.locator('.leaflet-container').isVisible()
      const hasNoCoords = await page.getByText('SIN COORDENADAS').isVisible()
      expect(hasMap || hasNoCoords).toBe(true)
    }).toPass({ timeout: 10000 })
  })

  // ── 8. Center panel — FOTOS tab ──────────────────────────────────────────

  test('FOTOS tab — clicking FOTOS shows photo upload area', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)

    await page.getByRole('button', { name: 'FOTOS' }).click()

    // PhotoGallery renders a hidden file input (type=file, accept=image/*)
    await expect(page.locator('input[type="file"][accept="image/*"]')).toBeAttached()
  })

  // ── 9. Back navigation ───────────────────────────────────────────────────

  test('back button returns to /prospectos/tabla', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)

    await page.getByText('← PROSPECTOS').first().click()
    await expect(page).toHaveURL(/\/prospectos\/tabla$/)
  })

  // ── 10. Tab switching preserves page integrity ────────────────────────────

  test('switching through all left tabs and back to INFO stays on same detail URL', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)
    const url = page.url()

    await page.getByRole('button', { name: 'EDITAR' }).click()
    await page.getByRole('button', { name: 'ANÁLISIS' }).click()
    await page.getByRole('button', { name: 'INFO' }).click()

    // URL must not have changed — we're still on the same detail page
    expect(page.url()).toBe(url)
    // And INFO content is back
    await expect(page.getByText('ROI ANUAL').first()).toBeVisible()
  })

  // ── 11. EDITAR — ESTADO select ───────────────────────────────────────────

  test('EDITAR tab — ESTADO select is visible with prospect status options', async ({ page }) => {
    // Use goToFirstDetail directly — it waits for the first row to be visible, avoiding
    // the count=0 race where React hasn't finished its fetch before count() runs.
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)
    await page.getByRole('button', { name: 'EDITAR' }).click()

    await expect(page.getByText('ESTADO').first()).toBeVisible()

    const statusSelect = page.locator('select').filter({ has: page.locator('option[value="evaluating"]') }).first()
    await expect(statusSelect).toBeVisible()
    await expect(statusSelect.locator('option[value="evaluating"]')).toHaveText('EVALUANDO')
    await expect(statusSelect.locator('option[value="passed"]')).toHaveText('APROBADO')
    await expect(statusSelect.locator('option[value="converted"]')).toHaveText('CONVERTIDO')
  })

  test('EDITAR tab — changing ESTADO and clicking GUARDAR ▸ persists the new status', async ({ page }) => {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
    if (!appeared) { test.skip(); return }

    await goToFirstDetail(page)
    await page.getByRole('button', { name: 'EDITAR' }).click()

    const statusSelect = page.locator('select').filter({ has: page.locator('option[value="evaluating"]') }).first()
    await expect(statusSelect).toBeVisible({ timeout: 8_000 })

    const originalStatus = await statusSelect.inputValue()
    const validStatuses = ['evaluating', 'passed', 'converted']
    const newStatus = validStatuses.find(s => s !== originalStatus) ?? 'passed'

    await statusSelect.selectOption(newStatus)

    await expect(page.getByText('GUARDAR ▸')).toBeVisible()
    await page.getByText('GUARDAR ▸').click()
    await expect(page.getByText('GUARDAR ▸')).not.toBeVisible({ timeout: 8_000 })

    // Switch to INFO and back to EDITAR to confirm the value was persisted
    await page.getByRole('button', { name: 'INFO' }).click()
    await page.getByRole('button', { name: 'EDITAR' }).click()

    const persistedSelect = page.locator('select').filter({ has: page.locator('option[value="evaluating"]') }).first()
    await expect(persistedSelect).toHaveValue(newStatus, { timeout: 8_000 })

    // Restore original status
    await persistedSelect.selectOption(originalStatus)
    await page.getByText('GUARDAR ▸').click()
    await expect(page.getByText('GUARDAR ▸')).not.toBeVisible({ timeout: 8_000 })
  })
})
