import { test, expect } from '../fixtures/auth'
import { getToken, createProspect, deleteProspect, deleteProspectByName } from '../helpers/api'
import { detailRow, fieldInput, enterEditMode, saveEdits, setNumericField } from '../helpers/detail'

/**
 * A dedicated prospect keeps every derived figure below deterministic — the
 * seeded one carries no rent, so it could never cover the CAP RATE row. Values
 * were confirmed against the API for exactly these inputs.
 */
const FIXTURE = {
  name: '[TEST] Prospecto Detalle',
  address: 'Av. Prospecto 300',
  city: 'Monterrey',
  status: 'evaluating',
  type: 'Casa',
  holdMonths: 12,
  url: 'https://refigan.mx',
  latitude: 25.6866,
  longitude: -100.3161,
  sqmLand: 400,
  sqmConstruction: 0,
  landPrice: 2_000_000,
  acquisitionCostPct: 0.065,
  permitsCost: 0,
  subdivisionCost: 0,
  constructionCostPerSqm: 0,
  constructionOverhead: 1.3,
  projectedSale: 3_000_000,
  rentMonthly: 20_000,
  notes: 'Nota inicial de la ficha',
}

// land 2,000,000 + adq 6.5% 130,000
const INVESTMENT = '$2,130,000'
// 20,000 × 12 / 2,130,000
const CAP_RATE = '11.3%'
// 3,000,000 − 2,130,000
const PROFIT = '$870,000'

test.describe('ProspectDetailPage', () => {
  let token: string
  let prospectId: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    // Clear leftovers first: a worker that died mid-run leaves its fixture behind.
    await deleteProspectByName(request, FIXTURE.name, token)
    prospectId = (await createProspect(request, FIXTURE, token)).id
  })

  test.afterAll(async ({ request }) => {
    await deleteProspect(request, prospectId, token)
  })

  // ── Header ──────────────────────────────────────────────────────────────────

  test('header shows back link, title, status chip, CONVERTIR and the edit actions', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)

    await expect(page.getByText('← PROSPECTOS')).toBeVisible()
    await expect(page.getByText(FIXTURE.name)).toBeVisible()
    // The chip and the ESTADO row both print the label
    await expect(page.getByText('EVALUANDO').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'CONVERTIR ▸ PROYECTO' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'EDITAR', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ELIMINAR', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /GUARDAR/ })).toHaveCount(0)
  })

  // ── GENERAL tab (default) ───────────────────────────────────────────────────

  test('GENERAL renders by default with the ROI heroes and the derived rows', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)

    await expect(detailRow(page, 'ROI ANUAL')).toContainText('+40.8%')
    await expect(detailRow(page, 'ROI TOTAL')).toContainText('+40.8%')

    await expect(detailRow(page, 'PROFIT')).toContainText(PROFIT)
    await expect(detailRow(page, 'CAP RATE')).toContainText(CAP_RATE)
    await expect(detailRow(page, 'INVERSIÓN')).toContainText(INVESTMENT)
    await expect(detailRow(page, 'VENTA')).toContainText('$3,000,000')
    await expect(detailRow(page, 'PLAZO')).toContainText('12 meses')
    await expect(detailRow(page, 'RENTA/MES')).toContainText('$20,000')
    await expect(detailRow(page, 'TERRENO')).toContainText('400 m²')
    await expect(detailRow(page, 'TIPO')).toContainText('Casa')
    await expect(detailRow(page, 'ESTADO')).toContainText('EVALUANDO')
  })

  test('GENERAL shows the UBICACIÓN rows and the investment breakdown', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)

    await expect(detailRow(page, 'DIRECCIÓN')).toContainText(FIXTURE.address)
    await expect(detailRow(page, 'CIUDAD')).toContainText('Monterrey')
    await expect(page.getByRole('link', { name: 'VER FUENTE ↗' })).toBeVisible()

    await expect(page.getByText('INVERSIÓN TOTAL')).toBeVisible()
    await expect(page.getByText('PRECIO TERRENO')).toBeVisible()
  })

  // ── View ⇄ edit ─────────────────────────────────────────────────────────────

  test('EDITAR swaps the row values for inputs in place', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)

    await expect(detailRow(page, 'DIRECCIÓN')).toContainText(FIXTURE.address)
    await expect(fieldInput(page, 'DIRECCIÓN')).toHaveCount(0)

    await enterEditMode(page)

    await expect(fieldInput(page, 'DIRECCIÓN')).toHaveValue(FIXTURE.address)
    await expect(fieldInput(page, 'Nombre')).toHaveValue(FIXTURE.name)
    await expect(fieldInput(page, 'VENTA')).toHaveValue('3,000,000')
    await expect(fieldInput(page, 'RENTA/MES')).toHaveValue('20,000')
    await expect(fieldInput(page, 'NOTAS')).toHaveValue(FIXTURE.notes)
  })

  test('PROFIT, CAP RATE and INVERSIÓN stay read-only while editing', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)
    await enterEditMode(page)

    for (const label of ['PROFIT', 'CAP RATE', 'INVERSIÓN']) {
      await expect(fieldInput(page, label)).toHaveCount(0)
    }
    await expect(detailRow(page, 'CAP RATE')).toContainText(CAP_RATE)
  })

  test('DESGLOSE shows the underwriting inputs in edit mode instead of the bars', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)
    await enterEditMode(page)

    await expect(fieldInput(page, 'PRECIO TERRENO')).toHaveValue('2,000,000')
    await expect(fieldInput(page, 'PERMISOS')).toBeVisible()
    await expect(fieldInput(page, 'SUBDIVISIÓN')).toBeVisible()
    await expect(fieldInput(page, 'COSTOS ADQ. (%)')).toHaveValue('6.5')
    await expect(fieldInput(page, 'OVERHEAD CONSTRUCCIÓN')).toHaveValue('1.3')
    await expect(page.getByText('INVERSIÓN TOTAL')).toHaveCount(0)
  })

  // ── Saving and discarding ───────────────────────────────────────────────────

  test('CANCELAR discards the pending edits and leaves edit mode', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)

    const venta = detailRow(page, 'VENTA')
    await expect(venta).toContainText('$')
    const original = (await venta.innerText()).match(/\$[\d,]+/)![0]

    await enterEditMode(page)
    await setNumericField(page, 'VENTA', '9999999')

    await expect(page.getByRole('button', { name: /GUARDAR/ })).toBeVisible()
    await page.getByRole('button', { name: 'CANCELAR', exact: true }).click()

    await expect(page.getByRole('button', { name: 'EDITAR', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /GUARDAR/ })).toHaveCount(0)
    await expect(venta).toContainText(original)
    await expect(venta).not.toContainText('9,999,999')
  })

  test('GUARDAR persists the edited NOTAS across a reload', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)
    await enterEditMode(page)

    const notes = `Nota e2e ${Date.now()}`
    await fieldInput(page, 'NOTAS').fill(notes)
    await saveEdits(page)

    await expect(page.getByText(notes)).toBeVisible()

    await page.reload()
    await expect(page.getByText(notes)).toBeVisible()
  })

  test('saving a new RENTA/MES recomputes the CAP RATE', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)
    await enterEditMode(page)

    // 30,000 × 12 / 2,130,000 — the investment is pinned by the breakdown
    await setNumericField(page, 'RENTA/MES', '30000')
    await saveEdits(page)

    await expect(detailRow(page, 'RENTA/MES')).toContainText('$30,000')
    await expect(detailRow(page, 'CAP RATE')).toContainText('16.9%')

    await page.reload()
    await expect(detailRow(page, 'CAP RATE')).toContainText('16.9%')
  })

  // ── ANÁLISIS tab ────────────────────────────────────────────────────────────

  test('ANÁLISIS tab shows the analysis section and its form', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)
    await page.getByRole('button', { name: 'ANÁLISIS', exact: true }).click()

    await expect(page.getByRole('button', { name: 'CORRER ANÁLISIS' })).toBeVisible()
    await page.getByRole('button', { name: 'CORRER ANÁLISIS' }).click()

    await expect(page.getByText('INTERVENCIÓN')).toBeVisible()
    await expect(page.getByText('PLAZO (MESES)')).toBeVisible()
    await expect(page.getByRole('button', { name: 'EJECUTAR' })).toBeVisible()
  })

  test('switching back to GENERAL restores the derived rows', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)
    const url = page.url()

    await page.getByRole('button', { name: 'ANÁLISIS', exact: true }).click()
    await expect(page.getByRole('button', { name: 'CORRER ANÁLISIS' })).toBeVisible()
    await page.getByRole('button', { name: 'GENERAL', exact: true }).click()

    await expect(detailRow(page, 'ROI ANUAL')).toBeVisible()
    expect(page.url()).toBe(url)
  })

  // ── CONVERTIR ───────────────────────────────────────────────────────────────

  test('CONVERTIR ▸ PROYECTO opens the conversion modal prefilled from the prospect', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)
    await page.getByRole('button', { name: 'CONVERTIR ▸ PROYECTO' }).click()

    await expect(page.getByText(`CONVERTIR A PROYECTO — ${FIXTURE.name}`)).toBeVisible()
    await expect(page.getByRole('button', { name: 'CREAR PROYECTO ▸' })).toBeVisible()
    // The projected sale seeds the valuation the new project starts with
    const valuacion = page.getByText('VALUACIÓN ACTUAL ($)').locator('..').locator('input')
    await expect(valuacion).toHaveValue('3000000')

    await page.getByRole('button', { name: 'CANCELAR', exact: true }).click()

    await expect(page.getByText(`CONVERTIR A PROYECTO — ${FIXTURE.name}`)).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/prospectos/tabla/${prospectId}$`))
  })

  // ── Center column ───────────────────────────────────────────────────────────

  test('center column offers the MAPA / FOTOS / PLANO tabs', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)

    await expect(page.getByRole('button', { name: 'MAPA' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'FOTOS' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'PLANO' })).toBeVisible()

    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })
  })

  test('FOTOS tab renders the upload input', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)
    await page.getByRole('button', { name: 'FOTOS' }).click()

    await expect(page.locator('input[type="file"][accept="image/*"]')).toHaveCount(1)
  })

  test('PLANO tab lands on the empty state and mounts the editor from it', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)
    await page.getByRole('button', { name: 'PLANO' }).click()

    // A prospect with no geometry starts on the trace-or-blank landing state
    await expect(page.getByText('Trace over a reference image or start from a blank footprint.')).toBeVisible()
    await page.getByRole('button', { name: /start blank/i }).click()

    await expect(page.getByRole('button', { name: 'Fit to screen' })).toBeVisible()
  })

  // ── Delete confirmation ─────────────────────────────────────────────────────

  test('ELIMINAR asks for confirmation and CANCELAR aborts it', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)

    await page.getByRole('button', { name: 'ELIMINAR', exact: true }).click()
    await expect(page.getByRole('button', { name: '¿CONFIRMAR BORRADO?' })).toBeVisible()

    await page.getByRole('button', { name: 'CANCELAR', exact: true }).click()

    await expect(page.getByRole('button', { name: 'ELIMINAR', exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/prospectos/tabla/${prospectId}$`))
  })

  // ── The `nuevo` route keeps its own form ────────────────────────────────────

  test('/prospectos/tabla/nuevo renders the creation form, not the detail shell', async ({ page }) => {
    await page.goto('/prospectos/tabla/nuevo')

    await expect(page.getByText('Nombre', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'GUARDAR', exact: true })).toBeVisible()
    // The `nuevo` route never enters the in-place edit shell
    await expect(page.getByRole('button', { name: 'EDITAR', exact: true })).toHaveCount(0)
  })

  // ── Back navigation ─────────────────────────────────────────────────────────

  test('← PROSPECTOS returns to the prospect table', async ({ page }) => {
    await page.goto(`/prospectos/tabla/${prospectId}`)

    await page.getByText('← PROSPECTOS').click()

    await expect(page).toHaveURL(/\/prospectos\/tabla$/)
  })
})
