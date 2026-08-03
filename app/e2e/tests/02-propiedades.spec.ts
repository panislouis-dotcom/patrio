import { test, expect } from '../fixtures/auth'
import type { Locator, Page } from '@playwright/test'
import { getToken, createProperty, deleteProperty, deletePropertyByName, transitionProperty } from '../helpers/api'

/**
 * The single inventory. One table for the whole lifecycle, so the interesting
 * behaviour is what changes with the stage filter: a property before the
 * purchase is judged by what it promises, one already bought by what it is
 * returning, and a sold one by what it left. The columns follow.
 */

const TEST_NAME = '[TEST] Propiedad Tabla'
const CREATED_NAME = '[TEST] Propiedad Creada'

/** A header cell of the table, matched on its label (the sort arrow is a suffix). */
function header(page: Page, label: string | RegExp): Locator {
  return page.locator('thead th').filter({ hasText: label })
}

/** The row a property occupies, found by its name. */
function row(page: Page, name: string): Locator {
  return page.locator('tbody tr').filter({ hasText: name })
}

/** A stage chip in the toolbar. Chips carry their count, so match label + number. */
function chip(page: Page, label: string): Locator {
  return page.locator('button').filter({ hasText: new RegExp(`^${label}\\s*\\d+$`) })
}

/** A field of the capture modal — the label sits two levels above its input. */
function modalField(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true }).locator('xpath=../..').locator('input')
}

test.describe('Propiedades — la tabla', () => {
  let token: string
  let propertyId: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    // Clear leftovers first: a worker that died mid-run leaves its fixture behind.
    await deletePropertyByName(request, TEST_NAME, token)
    await deletePropertyByName(request, CREATED_NAME, token)
    propertyId = (await createProperty(request, {
      name: TEST_NAME,
      address: 'Av. Tabla 100',
      city: 'Monterrey',
      landPrice: 2_000_000,
      sqmLand: 300,
      projectedSale: 3_000_000,
      holdMonths: 12,
      latitude: 25.6866,
      longitude: -100.3161,
    }, token)).id
  })

  test.afterAll(async ({ request }) => {
    await deleteProperty(request, propertyId, token)
    await deletePropertyByName(request, CREATED_NAME, token)
  })

  // ── Chips y columnas adaptativas ────────────────────────────────────────────

  test('TODAS lists the whole inventory with the columns that mean the same at every stage', async ({ page }) => {
    await page.goto('/propiedades')

    await expect(header(page, 'ESTADO')).toBeVisible()
    await expect(header(page, 'SCORE')).toBeVisible()
    await expect(header(page, 'INVERSIÓN')).toBeVisible()
    await expect(header(page, /^ROI\s*[↑↓]?$/)).toBeVisible()
    await expect(header(page, /^PLAZO\s*[↑↓]?$/)).toBeVisible()
  })

  test('every lifecycle stage has its own chip', async ({ page }) => {
    await page.goto('/propiedades')

    for (const label of ['TODAS', 'PROSPECTO', 'OFERTA', 'DESARROLLO', 'EN RENTA', 'VENDIDA']) {
      await expect(chip(page, label)).toBeVisible()
    }
    // Archived is a drawer, not a stage: it only appears once asked for.
    await expect(chip(page, 'ARCHIVADA')).toHaveCount(0)
  })

  test('PROSPECTO swaps in the pre-purchase columns — the bet', async ({ page }) => {
    await page.goto('/propiedades')
    await chip(page, 'PROSPECTO').click()

    await expect(header(page, 'ROI PROY.')).toBeVisible()
    await expect(header(page, 'CAP RATE')).toBeVisible()
    await expect(header(page, 'VENTA PROY.')).toBeVisible()
    await expect(header(page, 'SCORE')).toBeVisible()
    // The stage is the filter now — printing it in every row would say nothing.
    await expect(header(page, 'ESTADO')).toHaveCount(0)
  })

  test('EN RENTA swaps in the held columns and retires the score', async ({ page }) => {
    await page.goto('/propiedades')
    await chip(page, 'EN RENTA').click()

    await expect(header(page, 'VALUACIÓN')).toBeVisible()
    await expect(header(page, 'GANANCIA')).toBeVisible()
    await expect(header(page, 'ROI ANUAL')).toBeVisible()
    await expect(header(page, 'PLAZO REAL')).toBeVisible()
    // Score ranks candidates competing for capital; a bought property competes
    // with nobody, and the server returns none for it.
    await expect(header(page, 'SCORE')).toHaveCount(0)
  })

  test('VENDIDA shows what the deal actually left', async ({ page }) => {
    await page.goto('/propiedades')
    await chip(page, 'VENDIDA').click()

    await expect(header(page, /^VENTA\s*[↑↓]?$/)).toBeVisible()
    await expect(header(page, 'GANANCIA')).toBeVisible()
    await expect(header(page, 'ROI REAL')).toBeVisible()
    await expect(header(page, 'SCORE')).toHaveCount(0)
  })

  test('VER ARCHIVADAS reveals the archived chip and hides it again', async ({ page }) => {
    await page.goto('/propiedades')

    await page.getByRole('button', { name: 'VER ARCHIVADAS' }).click()
    await expect(chip(page, 'ARCHIVADA')).toBeVisible()

    await page.getByRole('button', { name: '✓ ARCHIVADAS' }).click()
    await expect(chip(page, 'ARCHIVADA')).toHaveCount(0)
  })

  test('the fixture sits under PROSPECTO and disappears from the other stages', async ({ page }) => {
    await page.goto('/propiedades')
    await chip(page, 'PROSPECTO').click()
    await expect(row(page, TEST_NAME)).toBeVisible()

    await chip(page, 'OFERTA').click()
    await expect(row(page, TEST_NAME)).toHaveCount(0)
  })

  // ── Ordenamiento ────────────────────────────────────────────────────────────

  test('clicking a header sorts by it and toggles the direction', async ({ page }) => {
    await page.goto('/propiedades')
    const inversion = header(page, 'INVERSIÓN')

    await inversion.click()
    await expect(inversion).toContainText('↓')

    await inversion.click()
    await expect(inversion).toContainText('↑')
  })

  // ── Resumen del portafolio ──────────────────────────────────────────────────

  test('the portfolio strip totals only what has been bought', async ({ page }) => {
    await page.goto('/propiedades')

    await expect(page.getByText('Capital desplegado:')).toBeVisible()
    await expect(page.getByText('propiedades en portafolio')).toBeVisible()
  })

  // ── Favoritos ───────────────────────────────────────────────────────────────

  test('the star marks a favourite and it survives a reload', async ({ page }) => {
    await page.goto('/propiedades')
    const star = row(page, TEST_NAME).locator('td').first()
    await expect(star).toHaveText('☆')

    await star.click()
    await expect(star).toHaveText('★')

    await page.reload()
    await expect(row(page, TEST_NAME).locator('td').first()).toHaveText('★')

    // Leave the fixture as it was found — favourites are what the deck is built from.
    await row(page, TEST_NAME).locator('td').first().click()
    await expect(row(page, TEST_NAME).locator('td').first()).toHaveText('☆')
  })

  // ── Alta ────────────────────────────────────────────────────────────────────

  test('+ NUEVA opens the capture modal', async ({ page }) => {
    await page.goto('/propiedades')
    await page.getByRole('button', { name: '+ NUEVA' }).click()

    await expect(page.getByText('NUEVA PROPIEDAD')).toBeVisible()
    await expect(page.getByRole('button', { name: 'ANALIZAR ▸' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'LLENAR MANUALMENTE ▸' })).toBeVisible()
  })

  test('a property captured by hand lands in the table as a prospecto', async ({ page }) => {
    await page.goto('/propiedades')
    await page.getByRole('button', { name: '+ NUEVA' }).click()
    await page.getByRole('button', { name: 'LLENAR MANUALMENTE ▸' }).click()

    await modalField(page, 'Nombre').fill(CREATED_NAME)
    await modalField(page, 'Dirección').fill('Calle Alta 456')
    // Only the name and the land price gate the save: capture fast, complete later.
    await modalField(page, 'Precio terreno (MXN)').fill('1500000')
    await page.getByRole('button', { name: 'GUARDAR ▸' }).click()

    await expect(page.getByText('NUEVA PROPIEDAD')).toHaveCount(0)
    // Every property is born a prospecto — the stage is not a field on the form.
    await chip(page, 'PROSPECTO').click()
    await expect(row(page, CREATED_NAME)).toBeVisible()
  })

  // ── Prospecto en PDF ────────────────────────────────────────────────────────

  test('📄 PROSPECTO downloads the investor deck', async ({ page }) => {
    await page.goto('/propiedades')

    const download = page.waitForEvent('download', { timeout: 20_000 })
    await page.getByRole('button', { name: '📄 PROSPECTO' }).click()

    expect((await download).suggestedFilename()).toBe('prospecto.pdf')
  })

  // ── Navegación ──────────────────────────────────────────────────────────────

  test('clicking a row opens its detail page', async ({ page }) => {
    await page.goto('/propiedades')
    await row(page, TEST_NAME).click()

    await expect(page).toHaveURL(new RegExp(`/propiedades/${propertyId}$`))
  })

  test('the area offers TABLA / MAPA / SONAR / COMPARABLES and nothing of the old world', async ({ page }) => {
    await page.goto('/propiedades')

    for (const label of ['TABLA', 'MAPA', 'SONAR', 'COMPARABLES']) {
      await expect(page.getByRole('link', { name: label })).toBeVisible()
    }
    // Prospectos and proyectos were the same thing told twice; both tabs are gone.
    await expect(page.getByRole('link', { name: 'PROSPECTOS' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'PROYECTOS' })).toHaveCount(0)
  })

  test('/propiedades/mapa renders the map', async ({ page }) => {
    await page.goto('/propiedades/mapa')

    await expect(page).toHaveURL(/\/propiedades\/mapa/)
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })
  })
})

/**
 * The seed carries no sold property, and the sold columns are the only place
 * the table prints realised figures. Walking one through the lifecycle is the
 * only honest way to see them hold real numbers.
 */
test.describe('Propiedades — una vendida en la tabla', () => {
  const SOLD_NAME = '[TEST] Propiedad Vendida Tabla'
  let token: string
  let soldId: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    await deletePropertyByName(request, SOLD_NAME, token)
    soldId = (await createProperty(request, {
      name: SOLD_NAME,
      address: 'Av. Vendida 900',
      city: 'Monterrey',
      landPrice: 4_000_000,
      acquisitionCostPct: 0,
      permitsCost: 0,
      subdivisionCost: 0,
      sqmLand: 300,
      sqmConstruction: 0,
      constructionCostPerSqm: 0,
      constructionOverhead: 1,
      projectedSale: 6_000_000,
      holdMonths: 12,
      latitude: 25.6866,
      longitude: -100.3161,
    }, token)).id
    await transitionProperty(request, soldId, { to: 'oferta' }, token)
    await transitionProperty(request, soldId, {
      to: 'desarrollo', acquisitionDate: '2024-01-01', totalUnits: 1, currentValuation: 4_500_000,
    }, token)
    await transitionProperty(request, soldId, {
      to: 'vendida', saleDate: '2025-01-01', salePrice: 6_000_000,
    }, token)
  })

  test.afterAll(async ({ request }) => {
    await deleteProperty(request, soldId, token)
  })

  test('the sold row reports its realised figures, not a projection', async ({ page }) => {
    await page.goto('/propiedades')
    await chip(page, 'VENDIDA').click()

    const sold = row(page, SOLD_NAME)
    await expect(sold).toBeVisible()
    // 6,000,000 out of a 4,000,000 basis, held the twelve months to the day
    await expect(sold).toContainText('$6.0M')
    await expect(sold).toContainText('$2.0M')
    await expect(sold).toContainText('50.0%')
    await expect(sold).toContainText('12m')
  })
})
