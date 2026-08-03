import { test, expect } from '../fixtures/auth'
import {
  getToken, createProperty, deleteProperty, deletePropertyByName,
  clearPropertyFields, transitionProperty, attachInstanceToProperty, detachInstance,
} from '../helpers/api'
import {
  gotoProperty, detailRow, fieldInput, enterEditMode, saveEdits, setNumericField, clearField,
} from '../helpers/detail'

/**
 * One page for the whole lifecycle. Two fixtures pin the two halves of it,
 * because no single property can show both: a `prospecto` with a complete
 * underwriting breakdown (so the investment is derived and the score exists),
 * and an `en_renta` whose breakdown is deliberately incomplete (so the
 * investment is captured by hand and the tools of a bought property are open).
 *
 * Every derived figure asserted below was confirmed against the API for exactly
 * these inputs. The ones that move with the calendar — ROI ANUAL and PLAZO REAL
 * on a property still held — are asserted for presence, never for value.
 */

/**
 * `holdMonths` is captured on purpose and the other two assumptions are left
 * alone, so this one fixture shows both provenances SUPUESTOS distinguishes.
 * The arithmetic is unchanged either way: the defaults it falls back to are
 * exactly the 6.5% and 1.3 that used to be written into every new row.
 */
const PROSPECTO = {
  name: '[TEST] Propiedad Prospecto',
  address: 'Av. Detalle 300',
  city: 'Monterrey',
  assetType: 'casa',
  holdMonths: 12,
  url: 'https://refigan.mx',
  latitude: 25.6866,
  longitude: -100.3161,
  sqmLand: 400,
  sqmConstruction: 0,
  purchasePrice: 2_000_000,
  permitsCost: 0,
  subdivisionCost: 0,
  constructionCostPerSqm: 0,
  projectedSale: 3_000_000,
  rentMonthlyProjected: 20_000,
  notes: 'Nota inicial de la ficha',
}

// purchase 2,000,000 + the assumed 6.5% acquisition cost, 130,000
const INVESTMENT = '$2,130,000'
// 20,000 × 12 / 2,130,000 — the modelled rent, so the projected yield
const CAP_RATE = '11.3%'
// (3,000,000 − 2,130,000) over the twelve modelled months
const PROJECTED_ROI = '+40.8%'

test.describe('Ficha de propiedad — un prospecto', () => {
  let token: string
  let id: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    // Clear leftovers first: a worker that died mid-run leaves its fixture behind.
    await deletePropertyByName(request, PROSPECTO.name, token)
    id = (await createProperty(request, PROSPECTO, token)).id
  })

  test.afterAll(async ({ request }) => {
    await deleteProperty(request, id, token)
  })

  // ── Header ──────────────────────────────────────────────────────────────────

  test('the header carries the stage, the way forward and the edit actions', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(page.getByText('← PROPIEDADES')).toBeVisible()
    await expect(page.getByText(PROSPECTO.name)).toBeVisible()
    // The chip and the ETAPA row both print the label
    await expect(page.getByText('PROSPECTO').first()).toBeVisible()
    // A stage is not a field: it moves through AVANZAR A ▸, never through EDITAR.
    await expect(page.getByRole('button', { name: 'AVANZAR A ▸' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ARCHIVAR' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'EDITAR', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ELIMINAR', exact: true })).toBeVisible()
    // Nothing is edited yet, so the save/discard pair stays out of the way
    await expect(page.getByRole('button', { name: /GUARDAR/ })).toHaveCount(0)
  })

  test('AVANZAR A ▸ only offers the destination this stage really has', async ({ page }) => {
    await gotoProperty(page, id)
    await page.getByRole('button', { name: 'AVANZAR A ▸' }).click()

    await expect(page.getByRole('button', { name: 'OFERTA', exact: true })).toBeVisible()
    // A prospecto cannot skip ahead: those stages are simply not on the menu.
    for (const illegal of ['DESARROLLO', 'EN RENTA', 'VENDIDA']) {
      await expect(page.getByRole('button', { name: illegal, exact: true })).toHaveCount(0)
    }
  })

  // ── GENERAL, la pestaña por defecto ─────────────────────────────────────────

  test('the heroes are the projection, and the score rides along', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(detailRow(page, 'ROI PROY. ANUAL')).toContainText(PROJECTED_ROI)
    await expect(detailRow(page, 'ROI PROY. TOTAL')).toContainText(PROJECTED_ROI)
    // Score is a percentile against the other candidates, so it moves with them:
    // this asserts it is computed and shown, not what it happens to be today.
    await expect(detailRow(page, 'ROI PROY. ANUAL')).toContainText(/Score \d+/)
  })

  test('DATOS shows what is known and leaves the post-purchase rows empty', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(detailRow(page, 'INVERSIÓN')).toContainText(INVESTMENT)
    await expect(detailRow(page, 'RENTA/MES ESTIMADA')).toContainText('$20,000')
    await expect(detailRow(page, 'CAP RATE PROY.')).toContainText(CAP_RATE)
    await expect(detailRow(page, 'TIPO DE ACTIVO')).toContainText('Casa')
    await expect(detailRow(page, 'ETAPA')).toContainText('PROSPECTO')
    // Nothing has been bought, so nothing has been held
    await expect(detailRow(page, 'PLAZO REAL')).toContainText('—')
    await expect(detailRow(page, 'UNIDADES')).toContainText('—')
  })

  test('UBICACIÓN, the breakdown bars and the derived per-m² figures', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(detailRow(page, 'DIRECCIÓN')).toContainText(PROSPECTO.address)
    await expect(detailRow(page, 'CIUDAD')).toContainText('Monterrey')
    await expect(page.getByRole('link', { name: 'VER FUENTE ↗' })).toBeVisible()

    await expect(page.getByText('DESGLOSE DE INVERSIÓN')).toBeVisible()
    await expect(page.getByText('MÉTRICAS')).toBeVisible()
    await expect(detailRow(page, 'INVERSIÓN/m²')).toContainText('$5,325')
  })

  test('PROYECCIÓN spells out the bet the property is', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(page.getByText('PROYECCIÓN')).toBeVisible()
    await expect(detailRow(page, 'GANANCIA PROYECTADA')).toContainText('$870,000')
    await expect(detailRow(page, 'RENTA ANUAL EST.')).toContainText('$240,000')
    await expect(detailRow(page, 'PLAZO PROYECTADO')).toContainText('12 meses')
    // RESULTADO belongs to a sale that has not happened
    await expect(page.getByText('RESULTADO', { exact: true })).toHaveCount(0)
  })

  test('a prospecto offers GENERAL and ANÁLISIS — money comes with the offer', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(page.getByRole('button', { name: 'GENERAL', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ANÁLISIS', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'FINANZAS', exact: true })).toHaveCount(0)
    // Nor are there works to track on a building nobody owns
    await expect(page.getByText('TAREAS', { exact: true })).toHaveCount(0)
  })

  // ── Ver ⇄ editar ────────────────────────────────────────────────────────────

  test('EDITAR swaps the row values for inputs in place, and VER puts them away', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(detailRow(page, 'DIRECCIÓN')).toContainText(PROSPECTO.address)
    await expect(fieldInput(page, 'DIRECCIÓN')).toHaveCount(0)

    await enterEditMode(page)

    await expect(fieldInput(page, 'DIRECCIÓN')).toHaveValue(PROSPECTO.address)
    await expect(fieldInput(page, 'Nombre')).toHaveValue(PROSPECTO.name)
    await expect(fieldInput(page, 'RENTA/MES ESTIMADA')).toHaveValue('20,000')
    await expect(fieldInput(page, 'NOTAS')).toHaveValue(PROSPECTO.notes)

    await page.getByRole('button', { name: 'VER', exact: true }).click()

    await expect(page.getByRole('button', { name: 'EDITAR', exact: true })).toBeVisible()
    await expect(fieldInput(page, 'DIRECCIÓN')).toHaveCount(0)
  })

  test('the derived rows stay read-only while editing, and say why', async ({ page }) => {
    await gotoProperty(page, id)
    await enterEditMode(page)

    // A complete breakdown owns the total: the system computes it, nobody types it
    await expect(detailRow(page, 'INVERSIÓN')).toContainText('SUMA DEL DESGLOSE')
    await expect(detailRow(page, 'PLAZO REAL')).toContainText('DERIVADO DE FECHAS')
    // The stage has its own door, and the row says which one
    await expect(detailRow(page, 'ETAPA')).toContainText('SE MUEVE CON AVANZAR A')

    for (const label of ['INVERSIÓN', 'CAP RATE PROY.', 'PLAZO REAL']) {
      await expect(fieldInput(page, label)).toHaveCount(0)
    }
  })

  test('DESGLOSE offers the cost inputs in edit mode instead of the bars', async ({ page }) => {
    await gotoProperty(page, id)
    await enterEditMode(page)

    // The five costs — what the money actually goes on. The assumptions moved
    // out of here into SUPUESTOS, because a number the model invents does not
    // belong in a list of things somebody paid for.
    await expect(fieldInput(page, 'PRECIO DE COMPRA')).toHaveValue('2,000,000')
    await expect(fieldInput(page, 'OBRA A EJECUTAR (m²)')).toBeVisible()
    await expect(fieldInput(page, 'COSTO OBRA/m²')).toBeVisible()
    await expect(fieldInput(page, 'PERMISOS')).toBeVisible()
    await expect(fieldInput(page, 'SUBDIVISIÓN')).toBeVisible()
    await expect(page.getByText('MÉTRICAS')).toHaveCount(0)
  })

  test('SUPUESTOS is always on screen and says which numbers nobody chose', async ({ page }) => {
    await gotoProperty(page, id)

    // Visible in view mode too: every figure on the page is computed from these
    // three, so hiding them behind EDITAR meant reading money whose inputs were
    // invisible.
    await expect(page.getByText('SUPUESTOS')).toBeVisible()

    // Captured explicitly by the fixture
    await expect(detailRow(page, 'PLAZO PROYECTADO (MESES)')).toContainText('12')
    await expect(detailRow(page, 'PLAZO PROYECTADO (MESES)')).toContainText('CAPTURADO')

    // Never captured — the model applies its own and admits it
    await expect(detailRow(page, 'COSTOS ADQ. (%)')).toContainText('6.5%')
    await expect(detailRow(page, 'COSTOS ADQ. (%)')).toContainText('SUPUESTO POR OMISIÓN')
    await expect(detailRow(page, 'OVERHEAD DE OBRA')).toContainText('SUPUESTO POR OMISIÓN')
  })

  test('an assumption nobody captured cannot be emptied — there is nothing to empty', async ({ page }) => {
    await gotoProperty(page, id)
    await enterEditMode(page)

    // Clearing is for values a person put there. The default is not stored, so
    // offering ✕ on it would promise to remove something that does not exist.
    await expect(page.getByRole('button', { name: 'Vaciar COSTOS ADQ. (%)' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Vaciar PLAZO PROYECTADO (MESES)' })).toBeVisible()
  })

  // ── Guardar, descartar, vaciar ──────────────────────────────────────────────

  test('CANCELAR discards the pending edits and leaves edit mode', async ({ page }) => {
    await gotoProperty(page, id)

    await enterEditMode(page)
    await setNumericField(page, 'RENTA/MES ESTIMADA', '99999')

    await expect(page.getByRole('button', { name: /GUARDAR/ })).toBeVisible()
    await page.getByRole('button', { name: 'CANCELAR', exact: true }).click()

    await expect(page.getByRole('button', { name: 'EDITAR', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /GUARDAR/ })).toHaveCount(0)
    await expect(detailRow(page, 'RENTA/MES ESTIMADA')).toContainText('$20,000')
  })

  test('GUARDAR persists the edited NOTAS across a reload', async ({ page }) => {
    await gotoProperty(page, id)
    await enterEditMode(page)

    const notes = `Nota e2e ${Date.now()}`
    await fieldInput(page, 'NOTAS').fill(notes)
    await saveEdits(page)

    await expect(page.getByText(notes)).toBeVisible()

    await page.reload()
    await expect(page.getByText(notes)).toBeVisible()
  })

  test('saving a new RENTA/MES ESTIMADA recomputes the projected CAP RATE', async ({ page }) => {
    await gotoProperty(page, id)
    await enterEditMode(page)

    // 30,000 × 12 / 2,130,000 — the investment is pinned by the breakdown
    await setNumericField(page, 'RENTA/MES ESTIMADA', '30000')
    await saveEdits(page)

    await expect(detailRow(page, 'RENTA/MES ESTIMADA')).toContainText('$30,000')
    await expect(detailRow(page, 'CAP RATE PROY.')).toContainText('16.9%')

    await page.reload()
    await expect(detailRow(page, 'CAP RATE PROY.')).toContainText('16.9%')
  })

  test('✕ empties the field through clear-fields, and the cap rate goes with it', async ({ page }) => {
    await gotoProperty(page, id)
    await enterEditMode(page)

    // Emptying is its own operation: it applies on click, without a GUARDAR,
    // because a blank box already means the opposite ("leave this alone").
    await clearField(page, 'RENTA/MES ESTIMADA')
    await expect(page.getByRole('button', { name: /GUARDAR/ })).toHaveCount(0)

    await page.getByRole('button', { name: 'VER', exact: true }).click()
    await expect(detailRow(page, 'RENTA/MES ESTIMADA')).toContainText('—')
    // No rent, no yield — and an empty rent is not a zero rent
    await expect(detailRow(page, 'CAP RATE PROY.')).toContainText('—')

    await page.reload()
    await expect(detailRow(page, 'RENTA/MES ESTIMADA')).toContainText('—')

    // Put the fixture back the way the rest of the file expects to find it
    await enterEditMode(page)
    await setNumericField(page, 'RENTA/MES ESTIMADA', '20000')
    await saveEdits(page)
    await expect(detailRow(page, 'CAP RATE PROY.')).toContainText(CAP_RATE)
  })

  // ── ANÁLISIS ────────────────────────────────────────────────────────────────

  test('ANÁLISIS can still be run before the purchase', async ({ page }) => {
    await gotoProperty(page, id)
    const url = page.url()
    await page.getByRole('button', { name: 'ANÁLISIS', exact: true }).click()

    await expect(page.getByRole('button', { name: 'CORRER ANÁLISIS' })).toBeVisible()
    await page.getByRole('button', { name: 'CORRER ANÁLISIS' }).click()
    await expect(page.getByText('INTERVENCIÓN')).toBeVisible()
    await expect(page.getByRole('button', { name: 'EJECUTAR' })).toBeVisible()

    // The tabs are panels, not pages
    expect(page.url()).toBe(url)
    await page.getByRole('button', { name: 'GENERAL', exact: true }).click()
    await expect(detailRow(page, 'ROI PROY. ANUAL')).toBeVisible()
  })

  // ── Columna central ─────────────────────────────────────────────────────────

  test('the centre column offers MAPA / FOTOS / PLANO', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(page.getByRole('button', { name: 'MAPA' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'FOTOS' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'PLANO' })).toBeVisible()
    // MAPA is the default panel — the fixture carries coordinates
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 })
  })

  test('FOTOS offers one upload input per image type', async ({ page }) => {
    await gotoProperty(page, id)
    await page.getByRole('button', { name: 'FOTOS' }).click()

    await expect(page.getByText('SIN FOTOS')).toBeVisible()
    // general · antes · después — one gallery for the whole life of the property
    await expect(page.locator('input[type="file"][accept="image/*"]')).toHaveCount(3)
  })

  test('PLANO lands on the empty state and mounts the editor from it', async ({ page }) => {
    await gotoProperty(page, id)
    await page.getByRole('button', { name: 'PLANO' }).click()

    await expect(page.getByText('Trace over a reference image or start from a blank footprint.')).toBeVisible()
    await page.getByRole('button', { name: /start blank/i }).click()

    await expect(page.getByRole('button', { name: 'Fit to screen' })).toBeVisible()
  })

  // ── Borrado y navegación ────────────────────────────────────────────────────

  test('ELIMINAR asks for confirmation and CANCELAR aborts it', async ({ page }) => {
    await gotoProperty(page, id)

    await page.getByRole('button', { name: 'ELIMINAR', exact: true }).click()
    await expect(page.getByRole('button', { name: '¿CONFIRMAR BORRADO?' })).toBeVisible()

    await page.getByRole('button', { name: 'CANCELAR', exact: true }).click()

    await expect(page.getByRole('button', { name: 'ELIMINAR', exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/propiedades/${id}$`))
  })

  test('← PROPIEDADES returns to the table', async ({ page }) => {
    await gotoProperty(page, id)

    await page.getByText('← PROPIEDADES').click()

    await expect(page).toHaveURL(/\/propiedades$/)
  })

  test('/propiedades/nueva renders the full capture form, not the detail shell', async ({ page }) => {
    await page.goto('/propiedades/nueva')

    await expect(page.getByText('Nombre', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'GUARDAR', exact: true })).toBeVisible()
    // The creation route never enters the in-place edit shell
    await expect(page.getByRole('button', { name: 'EDITAR', exact: true })).toHaveCount(0)
  })
})

/**
 * The other half of the page: a property already bought and rented. Its capital
 * base is a hand-typed number (the breakdown is incomplete on purpose), the
 * money tools are open, and the projection it was bought on is still on screen
 * — in later steps you see everything from before.
 */
test.describe('Ficha de propiedad — una en renta', () => {
  const RENTADA = {
    name: '[TEST] Propiedad En Renta',
    address: 'Av. Rentada 200',
    city: 'Monterrey',
    assetType: 'departamento',
    purchasePrice: 3_000_000,
    sqmLand: 300,
    projectedSale: 9_000_000,
    holdMonths: 24,
    latitude: 25.6866,
    longitude: -100.3161,
  }

  let token: string
  let id: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    await deletePropertyByName(request, RENTADA.name, token)
    id = (await createProperty(request, RENTADA, token)).id
    // Emptying one of the five costs is what makes the breakdown incomplete,
    // which is what makes the capital base a manual figure — the other half of
    // the hybrid.
    await clearPropertyFields(request, id, ['constructionCostPerSqm'], token)
    await transitionProperty(request, id, { to: 'oferta' }, token)
    await transitionProperty(request, id, {
      to: 'desarrollo', acquisitionDate: '2024-01-01', totalUnits: 4,
      currentValuation: 8_000_000, valuationDate: '2025-06-01',
      totalInvestmentCaptured: 5_000_000,
    }, token)
    await transitionProperty(request, id, {
      to: 'en_renta', firstRentDate: '2025-01-01', rentMonthlyActual: 50_000,
      currentValuation: 8_000_000,
    }, token)
  })

  test.afterAll(async ({ request }) => {
    await deleteProperty(request, id, token)
  })

  test('the heroes turn to what the property is returning', async ({ page }) => {
    await gotoProperty(page, id)

    // ROI ANUAL runs against the months actually held, so it moves every day —
    // its presence is the contract, not its value.
    await expect(detailRow(page, 'ROI ANUAL')).toBeVisible()
    // 8,000,000 marked against a 5,000,000 base
    await expect(detailRow(page, 'GANANCIA NO REALIZADA')).toContainText('+60.0%')
    await expect(detailRow(page, 'ROI ANUAL')).toContainText('$3,000,000')
  })

  test('the score is gone — a bought property competes with nobody', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(page.getByText(/^Score/)).toHaveCount(0)
  })

  test('INVERSIÓN is a hand-typed figure and says so', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(detailRow(page, 'INVERSIÓN')).toContainText('$5,000,000')
    await expect(detailRow(page, 'INVERSIÓN')).toContainText('CAPTURA MANUAL')
    await expect(detailRow(page, 'UNIDADES')).toContainText('4')
    await expect(detailRow(page, 'ETAPA')).toContainText('EN RENTA')

    await enterEditMode(page)
    // The total is read-only wherever it came from; what is editable is the
    // number a person typed, and it keeps its own row so completing the
    // breakdown later cannot silently erase it.
    await expect(fieldInput(page, 'INVERSIÓN')).toHaveCount(0)
    await expect(fieldInput(page, 'INVERSIÓN CAPTURADA')).toHaveValue('5,000,000')
  })

  test('the rent collected is its own figure, and so is the yield on it', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(detailRow(page, 'RENTA/MES COBRADA')).toContainText('$50,000')
    // 50,000 × 12 / 5,000,000 — the yield the property is actually producing
    await expect(detailRow(page, 'CAP RATE REAL')).toContainText('12.0%')
    // Nothing was ever modelled, so the projected pair has nothing to report —
    // and says so rather than borrowing the collected rent
    await expect(detailRow(page, 'RENTA/MES ESTIMADA')).toContainText('—')
    await expect(detailRow(page, 'CAP RATE PROY.')).toContainText('—')
  })

  test('the dates of the purchase are on the record', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(detailRow(page, 'ADQUISICIÓN')).toContainText('2024-01-01')
    await expect(detailRow(page, 'PRIMERA RENTA')).toContainText('2025-01-01')
  })

  test('the projection it was bought on is still readable', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(page.getByText('PROYECCIÓN')).toBeVisible()
    await expect(detailRow(page, 'VENTA PROYECTADA')).toContainText('$9,000,000')
    await expect(detailRow(page, 'PLAZO PROYECTADO')).toContainText('24 meses')
  })

  test('the money tools open once the property is owned', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(page.getByRole('button', { name: 'FINANZAS', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'FINANZAS', exact: true }).click()

    await expect(page.getByText(/INVERSIONISTAS/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '+ AGREGAR' })).toBeVisible()
    await expect(page.getByText('SPLIT DEL EQUIPO')).toBeVisible()
  })

  test('TAREAS tracks the works of a building that is yours', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(page.getByText('TAREAS', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'LIGAR EXISTENTE' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ NUEVA TAREA' })).toBeVisible()
  })

  test('the analyzer closes but its history stays consultable', async ({ page }) => {
    await gotoProperty(page, id)
    await page.getByRole('button', { name: 'ANÁLISIS', exact: true }).click()

    // After the purchase the answer comes from the rent, not from a model
    await expect(page.getByRole('button', { name: 'CORRER ANÁLISIS' })).toHaveCount(0)
    await expect(page.getByText('Sin análisis previos')).toBeVisible()
  })
})

/**
 * A delete the database refuses.
 *
 * This exists because the failure used to be silent: the header caught the
 * error, threw it away, and reset the button — and a delete that says nothing
 * reads exactly like a delete that worked. The property stayed, the user
 * believed it was gone. What the page owes them is the reason, in words, and a
 * button back in the state that means "nothing happened".
 */
test.describe('Un borrado que no puede ocurrir', () => {
  const BLOQUEADA = {
    name: '[TEST] Propiedad Con Tarea',
    address: 'Av. Bloqueada 50',
    city: 'Monterrey',
    landPrice: 1_000_000,
    projectedSale: 2_000_000,
    latitude: 25.6866,
    longitude: -100.3161,
  }

  let token: string
  let id: number
  let instanceId: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    await deletePropertyByName(request, BLOQUEADA.name, token)
    id = (await createProperty(request, BLOQUEADA, token)).id
    // Tareas only attach from desarrollo on, so the property has to get there.
    await transitionProperty(request, id, { to: 'oferta' }, token)
    await transitionProperty(request, id, {
      to: 'desarrollo', acquisitionDate: '2024-01-01', totalUnits: 1, currentValuation: 1_200_000,
    }, token)
    instanceId = (await attachInstanceToProperty(request, '[TEST] Tarea Que Retiene', id, token)).id
  })

  test.afterAll(async ({ request }) => {
    // Free the property first: while the tarea points at it, it is exactly as
    // undeletable for the cleanup as it is for the user. The tarea itself stays
    // — the API has no way to remove one — and the next run reuses it.
    await detachInstance(request, instanceId, token)
    await deleteProperty(request, id, token)
  })

  test('ELIMINAR falla en voz alta y dice qué retiene a la propiedad', async ({ page }) => {
    await gotoProperty(page, id)

    await page.getByRole('button', { name: 'ELIMINAR', exact: true }).click()
    await page.getByRole('button', { name: '¿CONFIRMAR BORRADO?' }).click()

    // The server names the blocker; the page prints that sentence, not a code
    await expect(page.getByText('No se puede eliminar la propiedad porque tiene tareas ligadas.')).toBeVisible()

    // And nothing happened: still here, still deletable-looking, still alive
    await expect(page).toHaveURL(new RegExp(`/propiedades/${id}$`))
    await expect(page.getByRole('button', { name: 'ELIMINAR', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '¿CONFIRMAR BORRADO?' })).toHaveCount(0)

    await page.reload()
    await expect(page.getByText(BLOQUEADA.name)).toBeVisible()
  })
})
