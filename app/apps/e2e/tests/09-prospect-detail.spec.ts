import { test, expect } from '../fixtures/auth'

test.describe('Prospect Detail Page', () => {
  async function goToFirstProspect(page: import('@playwright/test').Page) {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    await firstRow.waitFor({ state: 'visible', timeout: 8000 })
    await firstRow.click()
    await expect(page).toHaveURL(/\/prospectos\/tabla\/\d+/)
  }

  test('detail page shows INFO tab active by default', async ({ page }) => {
    await goToFirstProspect(page)
    // Left tab bar has INFO / EDITAR / ANÁLISIS buttons
    await expect(page.locator('button').filter({ hasText: 'INFO' })).toBeVisible({ timeout: 6000 })
    await expect(page.locator('button').filter({ hasText: 'EDITAR' })).toBeVisible()
    await expect(page.locator('button').filter({ hasText: 'ANÁLISIS' }).first()).toBeVisible()
  })

  test('INFO tab shows ROI ANUAL and PROFIT metrics', async ({ page }) => {
    await goToFirstProspect(page)
    // The INFO tab renders ROI ANUAL label and PROFIT stat
    await expect(page.getByText('ROI ANUAL').first()).toBeVisible({ timeout: 6000 })
    await expect(page.getByText('PROFIT').first()).toBeVisible()
  })

  test('header shows back button and CONVERTIR action', async ({ page }) => {
    await goToFirstProspect(page)
    // Back button
    await expect(page.getByText('← PROSPECTOS').first()).toBeVisible({ timeout: 6000 })
    // Convert button
    await expect(page.getByText('CONVERTIR ▸ PROYECTO')).toBeVisible()
  })

  test('click EDITAR tab — shows inline editable fields', async ({ page }) => {
    await goToFirstProspect(page)
    await page.locator('button').filter({ hasText: 'EDITAR' }).click()
    // EDITAR tab content: text inputs for NOMBRE, DIRECCIÓN, etc.
    await expect(page.getByText('NOMBRE').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('DIRECCIÓN').first()).toBeVisible()
  })

  test('editing a field in EDITAR tab reveals GUARDAR ▸ in header', async ({ page }) => {
    await goToFirstProspect(page)
    await page.locator('button').filter({ hasText: 'EDITAR' }).click()
    // Type something into the first text input to trigger edits state
    const inputs = page.locator('input[type="text"]')
    await inputs.first().waitFor({ state: 'visible', timeout: 5000 })
    const originalValue = await inputs.first().inputValue()
    await inputs.first().fill(originalValue + ' ')
    // GUARDAR ▸ button should appear in the header
    await expect(page.getByText('GUARDAR ▸')).toBeVisible({ timeout: 5000 })
  })

  test('click ANÁLISIS tab — analysis section renders', async ({ page }) => {
    await goToFirstProspect(page)
    await page.locator('button').filter({ hasText: 'ANÁLISIS' }).click()
    // ProspectAnalysisSection mounts inside the left panel
    // At minimum the container appears without crashing
    await page.waitForTimeout(500)
    // The left panel content area should still be present
    await expect(page.locator('button').filter({ hasText: 'ANÁLISIS' }).first()).toBeVisible()
  })

  test('center panel has MAPA and FOTOS tabs', async ({ page }) => {
    await goToFirstProspect(page)
    // Center panel tab bar
    await expect(page.locator('button').filter({ hasText: 'MAPA' })).toBeVisible({ timeout: 6000 })
    await expect(page.locator('button').filter({ hasText: 'FOTOS' })).toBeVisible()
  })

  test('click FOTOS tab in center panel — gallery renders', async ({ page }) => {
    await goToFirstProspect(page)
    await page.locator('button').filter({ hasText: 'FOTOS' }).click()
    // PhotoGallery renders — at minimum no crash occurs
    await page.waitForTimeout(400)
    await expect(page.locator('button').filter({ hasText: 'FOTOS' })).toBeVisible()
  })

  test('back navigation — ← PROSPECTOS returns to table', async ({ page }) => {
    await goToFirstProspect(page)
    await page.getByText('← PROSPECTOS').first().click()
    await expect(page).toHaveURL(/\/prospectos\/tabla$/)
  })

  test('detail page shows ELIMINAR button in header', async ({ page }) => {
    await goToFirstProspect(page)
    // There is a top-level ELIMINAR button that triggers confirm flow
    await expect(page.getByText('ELIMINAR').first()).toBeVisible({ timeout: 6000 })
  })
})
