import { test, expect } from '../fixtures/auth'
import { getToken, deleteProveedorByName, deleteProveedorCategoryByName } from '../helpers/api'

const PROV_NAME = '[TEST] Proveedor Prueba'
const CAT_NAME = '[TEST] Tipo Prueba'

test.describe('Proveedores', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
  })

  test.afterEach(async ({ request }) => {
    await deleteProveedorByName(request, PROV_NAME, token)
    await deleteProveedorCategoryByName(request, CAT_NAME, token)
  })

  test('/proveedores/lista page loads with table headers', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await expect(page).not.toHaveURL(/\/login/)
    // Table headers should be visible
    await expect(page.locator('th').filter({ hasText: 'NOMBRE' })).toBeVisible({ timeout: 8000 })
    await expect(page.locator('th').filter({ hasText: 'STATUS' })).toBeVisible()
  })

  test('sub-tabs PROVEEDORES and TIPOS are visible in nav', async ({ page }) => {
    await page.goto('/proveedores/lista')
    await expect(page.getByText('PROVEEDORES').first()).toBeVisible({ timeout: 6000 })
    await expect(page.getByText('TIPOS')).toBeVisible()
  })

  test('create proveedor via inline form — appears in table', async ({ page }) => {
    await page.goto('/proveedores/lista')
    // Click + PROVEEDOR button
    await page.getByText('+ PROVEEDOR').click()
    // Inline input appears with autoFocus
    const input = page.getByPlaceholder('Nombre del proveedor...')
    await input.waitFor({ state: 'visible', timeout: 5000 })
    await input.fill(PROV_NAME)
    await page.getByText('CREAR').click()
    // After creation, ProveedorDetailPage opens (selected state)
    // The proveedor name should be visible in the header
    await expect(page.getByText(PROV_NAME).first()).toBeVisible({ timeout: 8000 })
  })

  test('click proveedor row — opens detail view with INFO tab', async ({ page }) => {
    await page.goto('/proveedores/lista')
    // Wait for table to load
    const rows = page.locator('table tbody tr')
    await rows.first().waitFor({ state: 'visible', timeout: 8000 })
    await rows.first().click()
    // ProveedorDetailPage renders with left tabs INFO / EDITAR / FOTOS
    await expect(page.getByText('INFO')).toBeVisible({ timeout: 6000 })
    await expect(page.getByText('EDITAR')).toBeVisible()
    await expect(page.getByText('FOTOS')).toBeVisible()
    // Back button (←) is visible in header
    await expect(page.locator('button').filter({ hasText: '←' })).toBeVisible()
  })

  test('click EDITAR tab in proveedor detail — edit form renders with GUARDAR', async ({ page }) => {
    await page.goto('/proveedores/lista')
    const rows = page.locator('table tbody tr')
    await rows.first().waitFor({ state: 'visible', timeout: 8000 })
    await rows.first().click()
    // Switch to EDITAR tab
    await page.getByText('EDITAR').click()
    // GUARDAR button should be visible in the edit form
    await expect(page.getByText('GUARDAR')).toBeVisible({ timeout: 6000 })
  })

  test('back button from detail — returns to proveedor list', async ({ page }) => {
    await page.goto('/proveedores/lista')
    const rows = page.locator('table tbody tr')
    await rows.first().waitFor({ state: 'visible', timeout: 8000 })
    await rows.first().click()
    // Go back via ← button
    await page.locator('button').filter({ hasText: '←' }).click()
    // Table headers should be visible again
    await expect(page.locator('th').filter({ hasText: 'NOMBRE' })).toBeVisible({ timeout: 6000 })
  })

  test('/proveedores/tipos page loads with + AGREGAR TIPO button', async ({ page }) => {
    await page.goto('/proveedores/tipos')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByText('TIPOS DE PROVEEDOR')).toBeVisible({ timeout: 6000 })
    await expect(page.getByText('+ AGREGAR TIPO')).toBeVisible()
  })

  test('add tipo in /proveedores/tipos — appears in list', async ({ page }) => {
    await page.goto('/proveedores/tipos')
    await page.getByText('+ AGREGAR TIPO').click()
    const input = page.getByPlaceholder('Nombre del tipo...')
    await input.waitFor({ state: 'visible', timeout: 5000 })
    await input.fill(CAT_NAME)
    await page.getByText('CREAR').click()
    await expect(page.getByText(CAT_NAME)).toBeVisible({ timeout: 6000 })
  })

  test('right panel shows CALIFICACIONES and TAREAS ASIGNADAS sections', async ({ page }) => {
    await page.goto('/proveedores/lista')
    const rows = page.locator('table tbody tr')
    await rows.first().waitFor({ state: 'visible', timeout: 8000 })
    await rows.first().click()
    // Right panel always shows these two sections
    await expect(page.getByText('CALIFICACIONES')).toBeVisible({ timeout: 6000 })
    await expect(page.getByText(/TAREAS ASIGNADAS/)).toBeVisible()
  })
})
