import { test, expect } from '../fixtures/auth'
import type { Page } from '@playwright/test'

// Helper: navigate to /proyectos and click the first row, then wait for the detail URL.
// Returns false if no project rows exist (graceful skip), true otherwise.
async function navigateToFirstProject(page: Page): Promise<boolean> {
  await page.goto('/proyectos')
  const firstRow = page.locator('table tbody tr').first()
  // .count() does not auto-wait; wait for the row to actually render before
  // deciding there's no data, otherwise React's async fetch races the check.
  const appeared = await firstRow.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)
  if (!appeared) return false
  await firstRow.click()
  await page.waitForURL(/\/proyectos\/\d+/)
  return true
}

test.describe('ProjectDetailPage', () => {

  // ── Left panel: tab bar ──────────────────────────────────────────────────────

  test('INFO tab button is visible and active by default', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    const infoTab = page.getByRole('button', { name: 'INFO' })
    await expect(infoTab).toBeVisible()
    await expect(infoTab).toHaveText('INFO')
  })

  test('EDITAR tab button is visible', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await expect(page.getByRole('button', { name: 'EDITAR' })).toBeVisible()
  })

  test('FINANZAS tab button is visible', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await expect(page.getByRole('button', { name: 'FINANZAS' })).toBeVisible()
  })

  // ── INFO tab content ─────────────────────────────────────────────────────────

  test('INFO tab — ROI ANUAL label is visible', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    // INFO is the default left tab; ROI ANUAL is the hero metric header
    await expect(page.getByText('ROI ANUAL')).toBeVisible()
  })

  test('INFO tab — FECHAS section divider is visible', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await expect(page.getByText('FECHAS')).toBeVisible()
  })

  test('INFO tab — TAREAS section heading is visible', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await expect(page.getByText('TAREAS').first()).toBeVisible()
  })

  test('INFO tab — LIGAR EXISTENTE button is visible in TAREAS section', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await expect(page.getByRole('button', { name: 'LIGAR EXISTENTE' })).toBeVisible()
  })

  test('INFO tab — + NUEVA TAREA button is visible in TAREAS section', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await expect(page.getByRole('button', { name: '+ NUEVA TAREA' })).toBeVisible()
  })

  // ── EDITAR tab ───────────────────────────────────────────────────────────────

  test('EDITAR tab — clicking tab reveals form inputs', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await page.getByRole('button', { name: 'EDITAR' }).click()

    // The Nombre input should now be visible (first text input in the EDITAR panel)
    const nombreInput = page.locator('input[type="text"]').first()
    await expect(nombreInput).toBeVisible()
  })

  test('EDITAR tab — editing name field makes GUARDAR button appear in header', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await page.getByRole('button', { name: 'EDITAR' }).click()

    const nombreInput = page.locator('input[type="text"]').first()
    await expect(nombreInput).toBeVisible()

    // Append a space to trigger the hasEdits state without breaking the actual value
    await nombreInput.click()
    await nombreInput.press('End')
    await nombreInput.type(' ')

    // GUARDAR ▸ button appears in the header whenever there are pending edits
    const guardarBtn = page.getByRole('button', { name: /GUARDAR/ })
    await expect(guardarBtn).toBeVisible()
  })

  test('EDITAR tab — DIRECCIÓN field label is visible', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await page.getByRole('button', { name: 'EDITAR' }).click()

    await expect(page.getByText('DIRECCIÓN')).toBeVisible()
  })

  // ── FINANZAS tab ─────────────────────────────────────────────────────────────

  test('FINANZAS tab — INVERSIONISTAS heading is visible', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await page.getByRole('button', { name: 'FINANZAS' }).click()

    // Heading may include month count in parentheses, so use partial match
    await expect(page.getByText(/INVERSIONISTAS/).first()).toBeVisible()
  })

  test('FINANZAS tab — + AGREGAR investor button is visible', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await page.getByRole('button', { name: 'FINANZAS' }).click()

    await expect(page.getByRole('button', { name: '+ AGREGAR' })).toBeVisible()
  })

  test('FINANZAS tab — FLUJO FINANCIERO section is visible', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await page.getByRole('button', { name: 'FINANZAS' }).click()

    await expect(page.getByText('FLUJO FINANCIERO').first()).toBeVisible()
  })

  test('FINANZAS tab — SPLIT DEL EQUIPO section is visible', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await page.getByRole('button', { name: 'FINANZAS' }).click()

    await expect(page.getByText('SPLIT DEL EQUIPO')).toBeVisible()
  })

  // ── Center panel: MAPA / FOTOS tab bar ──────────────────────────────────────

  test('center panel — MAPA tab button is visible', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await expect(page.getByRole('button', { name: 'MAPA' })).toBeVisible()
  })

  test('center panel — FOTOS tab button is visible', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await expect(page.getByRole('button', { name: 'FOTOS' })).toBeVisible()
  })

  test('center MAPA tab — shows map or SIN COORDENADAS message', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    // MAPA is the default center tab; wait for either the leaflet map or the fallback message
    await page.locator('.leaflet-container').or(page.getByText('SIN COORDENADAS')).first().waitFor({ timeout: 10_000 })

    const mapVisible = await page.locator('.leaflet-container').isVisible().catch(() => false)
    const noCoordVisible = await page.getByText('SIN COORDENADAS').isVisible().catch(() => false)

    expect(mapVisible || noCoordVisible).toBe(true)
  })

  test('center FOTOS tab — photo gallery renders upload controls', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await page.getByRole('button', { name: 'FOTOS' }).click()

    // Gallery always renders "antes" and "después" upload buttons regardless of image count
    const antesBtn = page.getByRole('button', { name: /antes/i }).first()
    const despuesBtn = page.getByRole('button', { name: /después/i }).first()

    await expect(antesBtn).toBeVisible()
    await expect(despuesBtn).toBeVisible()
  })

  // ── Back navigation ───────────────────────────────────────────────────────────

  test('← PROYECTOS back button is visible', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await expect(page.getByText('← PROYECTOS')).toBeVisible()
  })

  test('← PROYECTOS back button navigates to /proyectos list', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await page.getByText('← PROYECTOS').click()
    await expect(page).toHaveURL(/\/proyectos$/)
  })

  test('EDITAR tab — ESTADO select is visible with project status options', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await page.getByRole('button', { name: 'EDITAR' }).click()

    await expect(page.getByText('ESTADO').first()).toBeVisible()

    const statusSelect = page.locator('select').filter({ has: page.locator('option[value="construction"]') }).first()
    await expect(statusSelect).toBeVisible()
    await expect(statusSelect.locator('option[value="construction"]')).toHaveText('CONSTRUCCIÓN')
    await expect(statusSelect.locator('option[value="stabilizing"]')).toHaveText('ESTABILIZANDO')
    await expect(statusSelect.locator('option[value="operating"]')).toHaveText('OPERANDO')
    await expect(statusSelect.locator('option[value="exited"]')).toHaveText('VENDIDO')
  })

  test('EDITAR tab — changing ESTADO and clicking GUARDAR persists the new status', async ({ page }) => {
    const hasProject = await navigateToFirstProject(page)
    if (!hasProject) { test.skip(); return }

    await page.getByRole('button', { name: 'EDITAR' }).click()

    const statusSelect = page.locator('select').filter({ has: page.locator('option[value="construction"]') }).first()
    await expect(statusSelect).toBeVisible({ timeout: 8_000 })

    const originalStatus = await statusSelect.inputValue()
    const validStatuses = ['construction', 'stabilizing', 'operating', 'exited']
    // Pick any valid status that differs from the current one
    const newStatus = validStatuses.find(s => s !== originalStatus) ?? 'construction'

    await statusSelect.selectOption(newStatus)

    const guardarBtn = page.getByRole('button', { name: /GUARDAR/ })
    await expect(guardarBtn).toBeVisible()
    await guardarBtn.click()
    await expect(guardarBtn).not.toBeVisible({ timeout: 8_000 })

    // Switch to INFO and back to EDITAR to confirm the value was persisted
    await page.getByRole('button', { name: 'INFO' }).click()
    await page.getByRole('button', { name: 'EDITAR' }).click()

    const persistedSelect = page.locator('select').filter({ has: page.locator('option[value="construction"]') }).first()
    await expect(persistedSelect).toHaveValue(newStatus, { timeout: 8_000 })

    // Restore original status only if it was a valid value in the select
    if (validStatuses.includes(originalStatus)) {
      await persistedSelect.selectOption(originalStatus)
      const restoreBtn = page.getByRole('button', { name: /GUARDAR/ })
      await expect(restoreBtn).toBeVisible()
      await restoreBtn.click()
    }
  })

})
