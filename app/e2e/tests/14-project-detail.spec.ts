import { test, expect } from '../fixtures/auth'
import { getToken, createProject, deleteProject, deleteProjectByName } from '../helpers/api'
import { detailRow, fieldInput, enterEditMode, saveEdits, setNumericField } from '../helpers/detail'

/**
 * Two fixtures pin the two halves of the hybrid INVERSIÓN row, because the
 * seeded projects only cover one of them: DESGLOSE carries a full underwriting
 * breakdown plus a rent (so the investment is derived and a CAP RATE exists),
 * MANUAL carries neither (so the investment is captured by hand and the CAP
 * RATE row is absent). Every derived figure asserted below was confirmed
 * against the API for exactly these inputs.
 */
const DESGLOSE = {
  name: '[TEST] Proyecto Desglose',
  type: 'Casa',
  address: 'Av. Desglose 100',
  city: 'Monterrey',
  status: 'operating',
  totalUnits: 4,
  acquisitionDate: '2024-01',
  conclusionDate: '2025-01',
  totalInvestment: 0,
  currentValuation: 8_000_000,
  valuationDate: '2025-06',
  latitude: 25.6866,
  longitude: -100.3161,
  landPrice: 3_000_000,
  acquisitionCostPct: 0.065,
  permitsCost: 100_000,
  subdivisionCost: 50_000,
  sqmLand: 300,
  sqmConstruction: 200,
  constructionCostPerSqm: 12_000,
  constructionOverhead: 1.3,
  projectedSale: 9_000_000,
  holdMonths: 12,
  rentMonthly: 50_000,
}

const MANUAL = {
  name: '[TEST] Proyecto Manual',
  type: 'Casa',
  address: 'Av. Manual 200',
  city: 'Monterrey',
  status: 'operating',
  totalUnits: 2,
  acquisitionDate: '2024-01',
  conclusionDate: '2025-01',
  totalInvestment: 5_000_000,
  currentValuation: 6_000_000,
  valuationDate: '2025-06',
  latitude: 25.6866,
  longitude: -100.3161,
}

// land 3,000,000 + adq 6.5% 195,000 + permisos 100,000 + subdivisión 50,000
// + construcción 200 m² × 12,000 × 1.3 = 3,120,000
const DESGLOSE_INVESTMENT = '$6,465,000'
// 50,000 × 12 / 6,465,000
const DESGLOSE_CAP_RATE = '9.3%'

test.describe('ProjectDetailPage', () => {
  let token: string
  let desgloseId: number
  let manualId: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    // Clear leftovers first: a worker that died mid-run leaves its fixtures behind.
    await deleteProjectByName(request, DESGLOSE.name, token)
    await deleteProjectByName(request, MANUAL.name, token)
    desgloseId = (await createProject(request, DESGLOSE, token)).id
    manualId = (await createProject(request, MANUAL, token)).id
  })

  test.afterAll(async ({ request }) => {
    await deleteProject(request, desgloseId, token)
    await deleteProject(request, manualId, token)
  })

  // ── Header ──────────────────────────────────────────────────────────────────

  test('header shows back link, title, status chip and the EDITAR / ELIMINAR actions', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)

    await expect(page.getByText('← PROYECTOS')).toBeVisible()
    await expect(page.getByText(DESGLOSE.name)).toBeVisible()
    // The chip and the ESTADO row both print the label
    await expect(page.getByText('OPERANDO').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'EDITAR', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ELIMINAR', exact: true })).toBeVisible()
    // Nothing is edited yet, so the save/discard pair stays out of the way
    await expect(page.getByRole('button', { name: /GUARDAR/ })).toHaveCount(0)
  })

  // ── GENERAL tab (default) ───────────────────────────────────────────────────

  test('GENERAL renders by default with the ROI heroes and the DATOS rows', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)

    await expect(detailRow(page, 'ROI ANUAL')).toContainText('+23.7%')
    await expect(detailRow(page, 'ROI ANUAL')).toContainText('+$1,535,000')
    await expect(detailRow(page, 'ROI TOTAL')).toContainText('+23.7%')

    await expect(detailRow(page, 'INVERSIÓN')).toContainText(DESGLOSE_INVESTMENT)
    await expect(detailRow(page, 'VALORACIÓN')).toContainText('$8,000,000')
    await expect(detailRow(page, 'RENTA/MES')).toContainText('$50,000')
    await expect(detailRow(page, 'PLAZO REAL')).toContainText('12 meses')
    await expect(detailRow(page, 'UNIDADES')).toContainText('4')
    await expect(detailRow(page, 'TIPO')).toContainText('Casa')
    await expect(detailRow(page, 'ESTADO')).toContainText('OPERANDO')
  })

  test('GENERAL shows the FECHAS and UBICACIÓN rows', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)

    await expect(detailRow(page, 'ADQUISICIÓN')).toContainText('2024-01')
    await expect(detailRow(page, 'PRIMERA RENTA')).toContainText('2025-01')
    await expect(detailRow(page, 'DIRECCIÓN')).toContainText(DESGLOSE.address)
    await expect(detailRow(page, 'CIUDAD')).toContainText('Monterrey')
  })

  test('CAP RATE row appears when the project has rent and an investment', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)

    await expect(detailRow(page, 'CAP RATE')).toContainText(DESGLOSE_CAP_RATE)
  })

  test('CAP RATE row is absent on a project without rent', async ({ page }) => {
    await page.goto(`/proyectos/${manualId}`)

    await expect(detailRow(page, 'INVERSIÓN')).toContainText('$5,000,000')
    await expect(page.getByText('CAP RATE', { exact: true })).toHaveCount(0)
  })

  // ── View ⇄ edit ─────────────────────────────────────────────────────────────

  test('EDITAR swaps the row values for inputs in place', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)

    // View mode prints the value and offers no box
    await expect(detailRow(page, 'DIRECCIÓN')).toContainText(DESGLOSE.address)
    await expect(fieldInput(page, 'DIRECCIÓN')).toHaveCount(0)

    await enterEditMode(page)

    await expect(fieldInput(page, 'DIRECCIÓN')).toHaveValue(DESGLOSE.address)
    await expect(fieldInput(page, 'CIUDAD')).toHaveValue('Monterrey')
    await expect(fieldInput(page, 'Nombre')).toHaveValue(DESGLOSE.name)
    await expect(fieldInput(page, 'VALORACIÓN')).toBeVisible()
    await expect(fieldInput(page, 'NOTAS')).toBeVisible()
  })

  test('VER returns the page to view mode', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)
    await enterEditMode(page)

    await page.getByRole('button', { name: 'VER', exact: true }).click()

    await expect(page.getByRole('button', { name: 'EDITAR', exact: true })).toBeVisible()
    await expect(fieldInput(page, 'DIRECCIÓN')).toHaveCount(0)
  })

  // ── Hybrid INVERSIÓN row ────────────────────────────────────────────────────

  test('INVERSIÓN is read-only and flagged as derived when a breakdown exists', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)
    await enterEditMode(page)

    await expect(detailRow(page, 'INVERSIÓN')).toContainText('CALCULADA DEL DESGLOSE')
    await expect(detailRow(page, 'INVERSIÓN')).toContainText(DESGLOSE_INVESTMENT)
    await expect(fieldInput(page, 'INVERSIÓN')).toHaveCount(0)
  })

  test('INVERSIÓN is an input flagged as manual when there is no breakdown', async ({ page }) => {
    await page.goto(`/proyectos/${manualId}`)
    await enterEditMode(page)

    await expect(detailRow(page, 'INVERSIÓN')).toContainText('CAPTURA MANUAL')
    await expect(fieldInput(page, 'INVERSIÓN')).toHaveValue('5,000,000')
  })

  test('PLAZO REAL stays read-only and flagged as derived from the dates', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)
    await enterEditMode(page)

    await expect(detailRow(page, 'PLAZO REAL')).toContainText('DERIVADO DE FECHAS')
    await expect(fieldInput(page, 'PLAZO REAL')).toHaveCount(0)
  })

  // ── DESGLOSE DE INVERSIÓN ───────────────────────────────────────────────────

  test('DESGLOSE shows the derived blocks in view mode and the raw inputs in edit mode', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)

    await expect(page.getByText('MÉTRICAS')).toBeVisible()
    await expect(detailRow(page, 'INVERSIÓN/m²')).toContainText('$21,550')
    await expect(page.getByText('PROYECCIÓN')).toBeVisible()
    await expect(detailRow(page, 'ROI PROYECTADO')).toContainText('39.2%')

    await enterEditMode(page)

    await expect(fieldInput(page, 'PRECIO TERRENO')).toHaveValue('3,000,000')
    await expect(fieldInput(page, 'CONSTRUCCIÓN (m²)')).toHaveValue('200')
    await expect(fieldInput(page, 'PLAZO PROYECTADO (MESES)')).toHaveValue('12')
    await expect(page.getByText('MÉTRICAS')).toHaveCount(0)
  })

  // ── Saving and discarding ───────────────────────────────────────────────────

  test('CANCELAR discards the pending edits and leaves edit mode', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)

    const valoracion = detailRow(page, 'VALORACIÓN')
    await expect(valoracion).toContainText('$')
    // Read the stored amount instead of hard-coding it: a later test edits it
    const original = (await valoracion.innerText()).match(/\$[\d,]+/)![0]

    await enterEditMode(page)
    await setNumericField(page, 'VALORACIÓN', '9999999')

    await expect(page.getByRole('button', { name: /GUARDAR/ })).toBeVisible()
    await page.getByRole('button', { name: 'CANCELAR', exact: true }).click()

    await expect(page.getByRole('button', { name: 'EDITAR', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /GUARDAR/ })).toHaveCount(0)
    await expect(valoracion).toContainText(original)
    await expect(valoracion).not.toContainText('9,999,999')
  })

  test('GUARDAR persists the edit across a reload', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)
    await enterEditMode(page)

    await setNumericField(page, 'VALORACIÓN', '8500000')
    await saveEdits(page)

    await expect(detailRow(page, 'VALORACIÓN')).toContainText('$8,500,000')

    await page.reload()
    await expect(detailRow(page, 'VALORACIÓN')).toContainText('$8,500,000')
  })

  test('saving a new RENTA/MES recomputes the CAP RATE', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)
    await enterEditMode(page)

    // 40,000 × 12 / 6,465,000 — the investment is pinned by the breakdown
    await setNumericField(page, 'RENTA/MES', '40000')
    await saveEdits(page)

    await expect(detailRow(page, 'RENTA/MES')).toContainText('$40,000')
    await expect(detailRow(page, 'CAP RATE')).toContainText('7.4%')

    await page.reload()
    await expect(detailRow(page, 'CAP RATE')).toContainText('7.4%')
  })

  // ── FINANZAS tab ────────────────────────────────────────────────────────────

  test('FINANZAS tab shows the waterfall, the investors table and the team split', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)
    await page.getByRole('button', { name: 'FINANZAS', exact: true }).click()

    await expect(page.getByText('FLUJO FINANCIERO')).toBeVisible()
    await expect(page.getByText(/INVERSIONISTAS/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '+ AGREGAR' })).toBeVisible()
    await expect(page.getByText('SPLIT DEL EQUIPO')).toBeVisible()
  })

  test('switching back to GENERAL restores the DATOS rows', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)
    const url = page.url()

    await page.getByRole('button', { name: 'FINANZAS', exact: true }).click()
    await expect(page.getByText('FLUJO FINANCIERO')).toBeVisible()
    await page.getByRole('button', { name: 'GENERAL', exact: true }).click()

    await expect(detailRow(page, 'ROI ANUAL')).toBeVisible()
    expect(page.url()).toBe(url)
  })

  // ── TAREAS ──────────────────────────────────────────────────────────────────

  test('GENERAL shows the TAREAS section with its link and create actions', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)

    await expect(page.getByText('TAREAS', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'LIGAR EXISTENTE' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ NUEVA TAREA' })).toBeVisible()
  })

  // ── Center column ───────────────────────────────────────────────────────────

  test('center column offers the MAPA / FOTOS / PLANO tabs', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)

    await expect(page.getByRole('button', { name: 'MAPA' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'FOTOS' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'PLANO' })).toBeVisible()

    // MAPA is the default panel — the fixture carries coordinates
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })
  })

  test('FOTOS tab renders the antes/después upload inputs', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)
    await page.getByRole('button', { name: 'FOTOS' }).click()

    await expect(page.locator('input[type="file"][accept="image/*"]')).toHaveCount(2)
  })

  test('PLANO tab lands on the empty state and mounts the editor from it', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)
    await page.getByRole('button', { name: 'PLANO' }).click()

    // A project with no geometry starts on the trace-or-blank landing state
    await expect(page.getByText('Trace over a reference image or start from a blank footprint.')).toBeVisible()
    await page.getByRole('button', { name: /start blank/i }).click()

    await expect(page.getByRole('button', { name: 'Fit to screen' })).toBeVisible()
  })

  // ── Delete confirmation ─────────────────────────────────────────────────────

  test('ELIMINAR asks for confirmation and CANCELAR aborts it', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)

    await page.getByRole('button', { name: 'ELIMINAR', exact: true }).click()
    await expect(page.getByRole('button', { name: '¿CONFIRMAR BORRADO?' })).toBeVisible()

    await page.getByRole('button', { name: 'CANCELAR', exact: true }).click()

    await expect(page.getByRole('button', { name: 'ELIMINAR', exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/proyectos/${desgloseId}$`))
  })

  // ── Back navigation ─────────────────────────────────────────────────────────

  test('← PROYECTOS returns to the project list', async ({ page }) => {
    await page.goto(`/proyectos/${desgloseId}`)

    await page.getByText('← PROYECTOS').click()

    await expect(page).toHaveURL(/\/proyectos$/)
  })
})
