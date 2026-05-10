import { test, expect } from '../fixtures/auth'
import { getToken, deleteInvestorByName } from '../helpers/api'

const INV_NAME = '[TEST] Inversionista'

test.describe('Inversionistas', () => {
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
  })

  test.afterEach(async ({ request }) => {
    await deleteInvestorByName(request, INV_NAME, token)
  })

  test('/inversionistas loads with investor table', async ({ page }) => {
    await page.goto('/inversionistas')
    // Summary strip contains 'inversionistas' count
    await expect(page.getByText(/inversionistas/)).toBeVisible()
    // Table header column NOMBRE is visible
    await expect(page.getByText('NOMBRE')).toBeVisible()
  })

  test("'+ NUEVO' opens create form with NOMBRE * placeholder", async ({ page }) => {
    await page.goto('/inversionistas')
    await page.getByText('+ NUEVO').click()
    await expect(page.getByPlaceholder('NOMBRE *')).toBeVisible()
  })

  test('fill NOMBRE * and click GUARDAR — investor appears in list', async ({ page }) => {
    await page.goto('/inversionistas')
    await page.getByText('+ NUEVO').click()
    await page.getByPlaceholder('NOMBRE *').fill(INV_NAME)
    await page.getByText('GUARDAR').click()

    // Form closes and name appears in the table
    await expect(page.getByPlaceholder('NOMBRE *')).not.toBeVisible()
    await expect(page.getByText(INV_NAME)).toBeVisible()
  })

  test('click investor row — navigates to /inversionistas/:id', async ({ page }) => {
    await page.goto('/inversionistas')
    const firstRow = page.locator('table tbody tr').first()
    await firstRow.waitFor({ state: 'visible' })
    await firstRow.click()
    await expect(page).toHaveURL(/\/inversionistas\/\d+/)
  })

  test('detail page is visible with back button', async ({ page }) => {
    await page.goto('/inversionistas')
    const firstRow = page.locator('table tbody tr').first()
    await firstRow.waitFor({ state: 'visible' })
    await firstRow.click()
    await expect(page).toHaveURL(/\/inversionistas\/\d+/)

    // The detail page header contains the back button
    await expect(page.getByText('← VOLVER')).toBeVisible()
    // And the ELIMINAR button
    await expect(page.getByText('ELIMINAR')).toBeVisible()
  })
})
