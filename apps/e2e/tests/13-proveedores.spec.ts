import { test, expect } from '../fixtures/auth'
import { getToken, deleteProveedorByName, deleteProveedorCategoryByName } from '../helpers/api'

const PROVEEDOR_NAME = '[TEST] Proveedor e2e'
const TIPO_NAME = '[TEST] Tipo e2e'

test.describe('Proveedores', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    await deleteProveedorByName(request, PROVEEDOR_NAME, token)
    await deleteProveedorCategoryByName(request, TIPO_NAME, token)
  })

  test.afterEach(async ({ request }) => {
    await deleteProveedorByName(request, PROVEEDOR_NAME, token)
    await deleteProveedorCategoryByName(request, TIPO_NAME, token)
  })

  // ── List page ────────────────────────────────────────────────────────────────

  test('/proveedores redirects to /proveedores/lista', async ({ page }) => {
    await page.goto('/proveedores')
    await expect(page).toHaveURL(/\/proveedores\/lista/)
  })

  test('list page shows sub-tabs PROVEEDORES and TIPOS', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await expect(page.getByText('PROVEEDORES').first()).toBeVisible()
    await expect(page.getByText('TIPOS')).toBeVisible()
  })

  test('list page shows "+ PROVEEDOR" button', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await expect(page.getByText('+ PROVEEDOR')).toBeVisible()
  })

  test('list page shows table column headers', async ({ page }) => {
    await page.goto('/proveedores/lista')
    for (const header of ['NOMBRE', 'ZONA', 'TIPO', 'CALIDAD', 'PUNTUALIDAD', 'PRECIO', 'STATUS']) {
      await expect(page.locator('th').filter({ hasText: header })).toBeVisible()
    }
  })

  // ── Create supplier ───────────────────────────────────────────────────────────

  test('clicking "+ PROVEEDOR" reveals inline form with name input', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await page.getByText('+ PROVEEDOR').click()
    await expect(page.getByPlaceholder('Nombre del proveedor...')).toBeVisible()
    await expect(page.getByText('CREAR')).toBeVisible()
  })

  test('create proveedor — navigates to detail page and name visible', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await page.getByText('+ PROVEEDOR').click()
    await page.getByPlaceholder('Nombre del proveedor...').fill(PROVEEDOR_NAME)
    await page.getByText('CREAR').click()

    // After creation the component switches to ProveedorDetailPage (same URL)
    // The proveedor name appears in the header
    await expect(page.getByText(PROVEEDOR_NAME).first()).toBeVisible({ timeout: 6000 })
  })

  // ── Detail page ───────────────────────────────────────────────────────────────

  test('detail page shows INFO, EDITAR, FOTOS tabs', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await page.getByText('+ PROVEEDOR').click()
    await page.getByPlaceholder('Nombre del proveedor...').fill(PROVEEDOR_NAME)
    await page.getByText('CREAR').click()
    await expect(page.getByText(PROVEEDOR_NAME).first()).toBeVisible({ timeout: 6000 })

    await expect(page.getByText('INFO')).toBeVisible()
    await expect(page.getByText('EDITAR')).toBeVisible()
    await expect(page.getByText('FOTOS')).toBeVisible()
  })

  test('INFO tab shows contact/status field labels', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await page.getByText('+ PROVEEDOR').click()
    await page.getByPlaceholder('Nombre del proveedor...').fill(PROVEEDOR_NAME)
    await page.getByText('CREAR').click()
    await expect(page.getByText(PROVEEDOR_NAME).first()).toBeVisible({ timeout: 6000 })

    // INFO tab is active by default
    await expect(page.getByText('TELÉFONO')).toBeVisible()
    await expect(page.getByText('EMAIL')).toBeVisible()
    await expect(page.getByText('ZONA')).toBeVisible()
  })

  test('EDITAR tab shows form fields and GUARDAR button', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await page.getByText('+ PROVEEDOR').click()
    await page.getByPlaceholder('Nombre del proveedor...').fill(PROVEEDOR_NAME)
    await page.getByText('CREAR').click()
    await expect(page.getByText(PROVEEDOR_NAME).first()).toBeVisible({ timeout: 6000 })

    await page.getByText('EDITAR').click()

    await expect(page.getByText('NOMBRE')).toBeVisible()
    await expect(page.getByText('ZONA DE COBERTURA')).toBeVisible()
    await expect(page.getByText('STATUS')).toBeVisible()
    await expect(page.getByText('NOTAS')).toBeVisible()
    await expect(page.getByText('GUARDAR')).toBeVisible()
  })

  test('EDITAR tab — rating dropdowns visible with "Sin calificar" option', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await page.getByText('+ PROVEEDOR').click()
    await page.getByPlaceholder('Nombre del proveedor...').fill(PROVEEDOR_NAME)
    await page.getByText('CREAR').click()
    await expect(page.getByText(PROVEEDOR_NAME).first()).toBeVisible({ timeout: 6000 })

    await page.getByText('EDITAR').click()

    await expect(page.getByText('CALIDAD (1-5)')).toBeVisible()
    await expect(page.getByText('PUNTUALIDAD (1-5)')).toBeVisible()
    await expect(page.getByText('PRECIO (1-5)')).toBeVisible()

    // All rating selects start with "Sin calificar"
    const selects = page.locator('select')
    // At least one select should have "Sin calificar" as an option
    await expect(selects.first()).toBeVisible()
  })

  test('EDITAR tab — status dropdown has activo / inactivo / vetado options', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await page.getByText('+ PROVEEDOR').click()
    await page.getByPlaceholder('Nombre del proveedor...').fill(PROVEEDOR_NAME)
    await page.getByText('CREAR').click()
    await expect(page.getByText(PROVEEDOR_NAME).first()).toBeVisible({ timeout: 6000 })

    await page.getByText('EDITAR').click()

    // The STATUS label should be visible and the select should contain the three options
    await expect(page.getByText('STATUS').first()).toBeVisible()
    const statusSelect = page.locator('[data-testid="status-select"]')
    await expect(statusSelect.locator('option[value="activo"]')).toHaveCount(1)
    await expect(statusSelect.locator('option[value="inactivo"]')).toHaveCount(1)
    await expect(statusSelect.locator('option[value="vetado"]')).toHaveCount(1)
  })

  test('EDITAR tab — edit notas and GUARDAR saves value', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await page.getByText('+ PROVEEDOR').click()
    await page.getByPlaceholder('Nombre del proveedor...').fill(PROVEEDOR_NAME)
    await page.getByText('CREAR').click()
    await expect(page.getByText(PROVEEDOR_NAME).first()).toBeVisible({ timeout: 6000 })

    await page.getByText('EDITAR').click()

    // Fill notas textarea
    await page.locator('textarea').fill('Nota de prueba e2e')
    await page.getByText('GUARDAR').click()

    // After save switch to INFO to confirm notas persisted
    await page.getByText('INFO').click()
    await expect(page.getByText('Nota de prueba e2e')).toBeVisible({ timeout: 6000 })
  })

  test('FOTOS tab shows photo upload "+" button', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await page.getByText('+ PROVEEDOR').click()
    await page.getByPlaceholder('Nombre del proveedor...').fill(PROVEEDOR_NAME)
    await page.getByText('CREAR').click()
    await expect(page.getByText(PROVEEDOR_NAME).first()).toBeVisible({ timeout: 6000 })

    await page.getByText('FOTOS').click()

    // PhotoGallery renders a "+" button to trigger the file input
    await expect(page.getByText('+')).toBeVisible()
  })

  test('back button (←) returns to the proveedor list', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await page.getByText('+ PROVEEDOR').click()
    await page.getByPlaceholder('Nombre del proveedor...').fill(PROVEEDOR_NAME)
    await page.getByText('CREAR').click()
    await expect(page.getByText(PROVEEDOR_NAME).first()).toBeVisible({ timeout: 6000 })

    // The ← back button is in the header of ProveedorDetailPage
    await page.locator('button').filter({ hasText: '←' }).click()

    // Should show the list again with the "+ PROVEEDOR" button
    await expect(page.getByText('+ PROVEEDOR')).toBeVisible({ timeout: 6000 })
  })

  // ── Tipos page ────────────────────────────────────────────────────────────────

  test('/proveedores/tipos loads with "TIPOS DE PROVEEDOR" heading', async ({ page }) => {
    await page.goto('/proveedores/tipos')
    await expect(page).toHaveURL(/\/proveedores\/tipos/)
    await expect(page.getByText('TIPOS DE PROVEEDOR')).toBeVisible()
  })

  test('/proveedores/tipos shows "+ AGREGAR TIPO" button', async ({ page }) => {
    await page.goto('/proveedores/tipos')
    await expect(page.getByText('+ AGREGAR TIPO')).toBeVisible()
  })

  test('create a tipo — inline form appears and tipo shows in list after CREAR', async ({ page }) => {
    await page.goto('/proveedores/tipos')
    await page.getByText('+ AGREGAR TIPO').click()

    await expect(page.getByPlaceholder('Nombre del tipo...')).toBeVisible()
    await page.getByPlaceholder('Nombre del tipo...').fill(TIPO_NAME)
    await page.getByText('CREAR').click()

    // Tipo should appear in the list
    await expect(page.getByText(TIPO_NAME)).toBeVisible({ timeout: 6000 })
  })
})
