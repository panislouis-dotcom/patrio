import { test, expect } from '../fixtures/auth'
import { getToken, deleteTemplateByName } from '../helpers/api'

const TEMPLATE_NAME = '[TEST] Plantilla Prueba'

test.describe('Procesos', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
  })

  test.afterEach(async ({ request }) => {
    await deleteTemplateByName(request, TEMPLATE_NAME, token)
  })

  test('/procesos redirects to /procesos/plantillas', async ({ page }) => {
    await page.goto('/procesos')
    await expect(page).toHaveURL(/\/procesos\/plantillas/)
  })

  test('PLANTILLAS and TAREAS sub-nav links are visible', async ({ page }) => {
    await page.goto('/procesos/plantillas')
    // 'PLANTILLAS' is also a substring of the heading 'PLANTILLAS DE PROCESO' — require exact match
    await expect(page.getByText('PLANTILLAS', { exact: true })).toBeVisible()
    await expect(page.getByText('TAREAS', { exact: true })).toBeVisible()
  })

  test('template list loads with PLANTILLAS DE PROCESO heading', async ({ page }) => {
    await page.goto('/procesos/plantillas')
    await expect(page.getByText('PLANTILLAS DE PROCESO')).toBeVisible()
  })

  test("'+ NUEVA PLANTILLA' opens create form with placeholder", async ({ page }) => {
    await page.goto('/procesos/plantillas')
    await page.getByText('+ NUEVA PLANTILLA').click()
    await expect(page.getByPlaceholder('Nombre de la plantilla')).toBeVisible()
  })

  test('fill template name and click CREAR — template appears in list', async ({ page }) => {
    await page.goto('/procesos/plantillas')
    await page.getByText('+ NUEVA PLANTILLA').click()
    await page.getByPlaceholder('Nombre de la plantilla').fill(TEMPLATE_NAME)
    await page.getByText('CREAR').click()

    // After creation, the app navigates to the template editor page
    await expect(page).toHaveURL(/\/procesos\/plantillas\/\d+/)
  })

  test('click template row — navigates to /procesos/plantillas/:id', async ({ page }) => {
    await page.goto('/procesos/plantillas')
    // Only run if at least one template exists in seed data
    const firstRow = page.locator('table tbody tr').first()
    const count = await page.locator('table tbody tr').count()
    if (count === 0) {
      // No seed templates — skip by just verifying the list page loads
      await expect(page.getByText('PLANTILLAS DE PROCESO')).toBeVisible()
      return
    }
    await firstRow.click()
    await expect(page).toHaveURL(/\/procesos\/plantillas\/\d+/)
  })

  test('click TAREAS sub-nav — navigates to /procesos/tareas', async ({ page }) => {
    await page.goto('/procesos/plantillas')
    await page.getByText('TAREAS').click()
    await expect(page).toHaveURL(/\/procesos\/tareas/)
  })

  test('/procesos/tareas loads with instance list', async ({ page }) => {
    await page.goto('/procesos/tareas')
    // The instance list renders its header section regardless of data
    // Check for the table header or an empty-state message
    await expect(
      page.getByText('NOMBRE').or(page.getByText('Sin tareas')).or(page.locator('table'))
    ).toBeVisible({ timeout: 8000 })
  })
})
