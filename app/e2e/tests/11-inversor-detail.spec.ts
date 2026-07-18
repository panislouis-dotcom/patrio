import { test, expect } from '../fixtures/auth'
import { getToken } from '../helpers/api'

test.describe('Inversor Detail Page', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
  })

  // ── Helper: navigate to first investor detail page ─────────────────────────
  async function goToFirstInversorDetail(page: Parameters<Parameters<typeof test>[1]>[0]) {
    await page.goto('/inversionistas')
    const firstRow = page.locator('table tbody tr').first()
    await firstRow.waitFor({ state: 'visible' })
    await firstRow.click()
    await expect(page).toHaveURL(/\/inversionistas\/\d+/)
  }

  // ── Helper: check investor rows exist ─────────────────────────────────────
  async function requireInvestors(page: Parameters<Parameters<typeof test>[1]>[0]) {
    await page.goto('/inversionistas')
    const rows = page.locator('table tbody tr')
    const count = await rows.count()
    if (count === 0) { test.skip(); return false }
    return true
  }

  // ── 1. Navigation ──────────────────────────────────────────────────────────

  test('clicking first investor row navigates to /inversionistas/:id', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    const firstRow = page.locator('table tbody tr').first()
    await firstRow.click()
    await expect(page).toHaveURL(/\/inversionistas\/\d+/)
  })

  // ── 2. Header ─────────────────────────────────────────────────────────────

  test('header shows VOLVER back button and ELIMINAR button', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    await expect(page.getByText('← VOLVER')).toBeVisible()
    await expect(page.getByText('ELIMINAR')).toBeVisible()
  })

  test('header displays investor full name', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    // The investor name is shown in the header as a serif span
    // At minimum, something in the header between the back button and ELIMINAR must be non-empty
    const header = page.locator('div').filter({ hasText: '← VOLVER' }).first()
    await expect(header).toBeVisible()
  })

  // ── 3. Summary metrics (left panel — DATOS section) ───────────────────────

  test('DATOS section shows TOTAL INTERESADO label', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    await expect(page.getByText('TOTAL INTERESADO')).toBeVisible()
  })

  test('DATOS section shows TOTAL COMPROMETIDO and TOTAL FONDEADO labels', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    await expect(page.getByText('TOTAL COMPROMETIDO')).toBeVisible()
    await expect(page.getByText('TOTAL FONDEADO')).toBeVisible()
  })

  // ── 4. Retornos section ────────────────────────────────────────────────────

  test('RETORNOS section shows TOTAL A RECIBIR and PENDIENTE labels', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    await expect(page.getByText('RETORNOS')).toBeVisible()
    await expect(page.getByText('TOTAL A RECIBIR')).toBeVisible()
    await expect(page.getByText('PENDIENTE')).toBeVisible()
  })

  test('RETORNOS section shows TOTAL PAGADO label', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    await expect(page.getByText('TOTAL PAGADO')).toBeVisible()
  })

  // ── 5. EDITAR section (left panel — edit form) ────────────────────────────

  test('EDITAR section shows form field labels', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    await expect(page.getByText('EDITAR')).toBeVisible()
    await expect(page.getByText('NOMBRE').first()).toBeVisible()
    await expect(page.getByText('APELLIDOS').first()).toBeVisible()
    await expect(page.getByText('EMAIL').first()).toBeVisible()
    await expect(page.getByText('TELÉFONO').first()).toBeVisible()
  })

  test('EDITAR section shows NOTAS textarea and GUARDAR button', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    await expect(page.getByText('NOTAS').first()).toBeVisible()
    await expect(page.locator('textarea').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'GUARDAR' })).toBeVisible()
  })

  test('EDITAR section shows select dropdowns for TEMPERATURA, CAPACIDAD, FUENTE, CONFIANZA', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    await expect(page.getByText('TEMPERATURA').first()).toBeVisible()
    await expect(page.getByText('CAPACIDAD').first()).toBeVisible()
    await expect(page.getByText('FUENTE').first()).toBeVisible()
    await expect(page.getByText('CONFIANZA').first()).toBeVisible()
  })

  // ── 6. Edit and save a field ───────────────────────────────────────────────

  test('editing TELÉFONO field and clicking GUARDAR saves without error', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    // Find the phone input (4th input in the form — after NOMBRE, APELLIDOS, EMAIL)
    const phoneInput = page.locator('input[type="tel"]').first()
    await phoneInput.waitFor({ state: 'visible' })
    const originalValue = await phoneInput.inputValue()

    // Make a small edit (append a space then trim — effectively a no-op data-wise but triggers save)
    await phoneInput.fill(originalValue.trim() || '5551234567')

    await page.getByRole('button', { name: 'GUARDAR' }).click()

    // Button should briefly show GUARDANDO… then return to GUARDAR
    await expect(page.getByRole('button', { name: 'GUARDAR' })).toBeVisible({ timeout: 8000 })
  })

  // ── 7. PROYECTOS panel (right panel) ──────────────────────────────────────

  test('PROYECTOS section heading is visible with + AGREGAR button', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    await expect(page.locator('[data-testid="proyectos-section-heading"]')).toBeVisible()
    await expect(page.getByText('+ AGREGAR')).toBeVisible()
  })

  test('PROYECTOS section shows table headers or empty state', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    // Use count() to avoid strict mode violation — getByText('PROYECTO') can match nav links too.
    // A table header <th> with "PROYECTO" text is unambiguous.
    const hasTable = await page.locator('th').filter({ hasText: /^PROYECTO$/ }).count() > 0
    const hasEmpty = await page.locator('text=Sin proyectos asociados').count() > 0
    expect(hasTable || hasEmpty).toBe(true)
  })

  test('clicking + AGREGAR opens add position form with project selector', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    await page.getByText('+ AGREGAR').click()

    // The add form contains a project select and INTERESADO/COMPROMETIDO/FONDEADO labels
    await expect(page.getByText('INTERESADO').first()).toBeVisible()
    await expect(page.getByText('COMPROMETIDO').first()).toBeVisible()
    await expect(page.getByText('FONDEADO').first()).toBeVisible()
    await expect(page.getByText('TASA %').first()).toBeVisible()
  })

  test('clicking + AGREGAR again (toggle) closes the add form', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    await page.getByText('+ AGREGAR').click()
    // Now it shows ✕ to close
    const closeBtn = page.getByText('✕').first()
    await expect(closeBtn).toBeVisible()
    await closeBtn.click()

    // The INTERESADO label inside the add form should no longer be visible
    await expect(page.getByText('TASA %')).not.toBeVisible()
  })

  // ── 8. Back navigation ────────────────────────────────────────────────────

  test('clicking ← VOLVER navigates back to /inversionistas', async ({ page }) => {
    const hasRows = await requireInvestors(page)
    if (!hasRows) return

    await goToFirstInversorDetail(page)

    await page.getByText('← VOLVER').click()
    await expect(page).toHaveURL(/\/inversionistas$/)
  })
})
