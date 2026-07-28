import { test, expect } from '../fixtures/auth'
import type { Page } from '@playwright/test'
import { detailRow, fieldInput, enterEditMode } from '../helpers/detail'

/**
 * Smoke over whatever prospect the table happens to rank first: it covers the
 * table → detail hop and the shape of the page, never the numbers. The seeded
 * fixture in 15-prospect-detail.spec.ts owns the derived-value assertions.
 */
test.describe('Prospect Detail Page (smoke)', () => {
  async function goToFirstProspect(page: Page) {
    await page.goto('/prospectos/tabla')
    const firstRow = page.locator('table tbody tr').first()
    await firstRow.waitFor({ state: 'visible', timeout: 8_000 })
    await firstRow.click()
    await expect(page).toHaveURL(/\/prospectos\/tabla\/\d+/)
  }

  test('clicking the first table row opens the detail page', async ({ page }) => {
    await goToFirstProspect(page)

    await expect(detailRow(page, 'ROI ANUAL')).toBeVisible()
  })

  test('left column offers GENERAL and ANÁLISIS, with GENERAL active by default', async ({ page }) => {
    await goToFirstProspect(page)

    await expect(page.getByRole('button', { name: 'GENERAL', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ANÁLISIS', exact: true })).toBeVisible()

    // GENERAL is the default panel — its heroes and derived rows are on screen
    await expect(detailRow(page, 'ROI TOTAL')).toBeVisible()
    await expect(detailRow(page, 'CAP RATE')).toBeVisible()
    await expect(detailRow(page, 'INVERSIÓN')).toBeVisible()
  })

  test('header shows the back link, CONVERTIR and the edit actions', async ({ page }) => {
    await goToFirstProspect(page)

    await expect(page.getByText('← PROSPECTOS')).toBeVisible()
    await expect(page.getByRole('button', { name: 'CONVERTIR ▸ PROYECTO' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'EDITAR', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ELIMINAR', exact: true })).toBeVisible()
  })

  test('EDITAR reveals the in-place inputs and VER puts them away', async ({ page }) => {
    await goToFirstProspect(page)
    await expect(detailRow(page, 'DIRECCIÓN')).toBeVisible()

    await enterEditMode(page)
    await expect(fieldInput(page, 'DIRECCIÓN')).toBeVisible()

    await page.getByRole('button', { name: 'VER', exact: true }).click()

    await expect(page.getByRole('button', { name: 'EDITAR', exact: true })).toBeVisible()
    await expect(fieldInput(page, 'DIRECCIÓN')).toHaveCount(0)
  })

  test('ANÁLISIS tab renders its section without leaving the detail page', async ({ page }) => {
    await goToFirstProspect(page)
    const url = page.url()

    await page.getByRole('button', { name: 'ANÁLISIS', exact: true }).click()

    await expect(page.getByRole('button', { name: 'CORRER ANÁLISIS' })).toBeVisible()
    expect(page.url()).toBe(url)
  })

  test('center column offers the MAPA / FOTOS / PLANO tabs', async ({ page }) => {
    await goToFirstProspect(page)

    await expect(page.getByRole('button', { name: 'MAPA' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'FOTOS' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'PLANO' })).toBeVisible()
  })

  test('← PROSPECTOS returns to the table', async ({ page }) => {
    await goToFirstProspect(page)

    await page.getByText('← PROSPECTOS').click()

    await expect(page).toHaveURL(/\/prospectos\/tabla$/)
  })
})
