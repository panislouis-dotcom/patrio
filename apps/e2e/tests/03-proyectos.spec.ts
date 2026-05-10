import { test, expect } from '../fixtures/auth'

test.describe('Proyectos', () => {
  test('/proyectos loads with Capital desplegado metric visible', async ({ page }) => {
    await page.goto('/proyectos')
    await expect(page.getByText('Capital desplegado:')).toBeVisible()
  })

  test("'proyectos activos' count metric visible", async ({ page }) => {
    await page.goto('/proyectos')
    await expect(page.getByText(/proyectos activos/)).toBeVisible()
  })

  test('at least one project row in table', async ({ page }) => {
    await page.goto('/proyectos')
    const firstRow = page.locator('table tbody tr').first()
    await expect(firstRow).toBeVisible()
  })

  test('sort by column — click INVERSIÓN header shows ↑ or ↓ suffix', async ({ page }) => {
    await page.goto('/proyectos')
    // The first th is PROYECTO (non-sortable static label) — target the sortable INVERSIÓN column
    const invHeader = page.locator('table thead th').filter({ hasText: 'INVERSIÓN' })
    await invHeader.waitFor({ state: 'visible' })
    await invHeader.click()
    // After click, INVERSIÓN becomes the active sort and shows a direction indicator
    const headerText = await invHeader.innerText()
    expect(headerText).toMatch(/↑|↓/)
  })

  test('click project row — navigates to /proyectos/:id', async ({ page }) => {
    await page.goto('/proyectos')
    const firstRow = page.locator('table tbody tr').first()
    await firstRow.waitFor({ state: 'visible' })
    await firstRow.click()
    await expect(page).toHaveURL(/\/proyectos\/\d+/)
  })

  test('detail page shows project name and key section visible', async ({ page }) => {
    await page.goto('/proyectos')
    const firstRow = page.locator('table tbody tr').first()
    await firstRow.waitFor({ state: 'visible' })
    await firstRow.click()
    await expect(page).toHaveURL(/\/proyectos\/\d+/)

    // Key section visible: GANANCIA NO REALIZADA hero metric on the left panel
    await expect(page.getByText('GANANCIA NO REALIZADA')).toBeVisible()

    // Back button should be visible
    await expect(page.getByText('← PROYECTOS')).toBeVisible()
  })

  test('back link navigates to /proyectos', async ({ page }) => {
    await page.goto('/proyectos')
    const firstRow = page.locator('table tbody tr').first()
    await firstRow.waitFor({ state: 'visible' })
    await firstRow.click()
    await expect(page).toHaveURL(/\/proyectos\/\d+/)

    await page.getByText('← PROYECTOS').click()
    await expect(page).toHaveURL(/\/proyectos$/)
  })
})
