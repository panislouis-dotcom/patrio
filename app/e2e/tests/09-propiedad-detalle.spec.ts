import { test, expect } from '../fixtures/auth'
import {
  getToken, createProperty, deleteProperty, deletePropertyByName,
  transitionProperty, attachInstanceToProperty, getInstances,
} from '../helpers/api'
import {
  gotoProperty, detailRow, fieldInput, enterEditMode, saveEdits, setNumericField, clearField,
} from '../helpers/detail'

/**
 * One page for the whole lifecycle. Two fixtures pin the two halves of it,
 * because no single property can show both: a `prospecto`, still competing for
 * capital and therefore scored, and an `en_renta` with the tools of a bought
 * property open. La inversión de las dos se suma igual — del desglose, siempre,
 * porque ya no hay otra manera de llegar a ella.
 *
 * Every derived figure asserted below was confirmed against the API for exactly
 * these inputs. PLAZO REAL sí se mueve con el calendario mientras la propiedad
 * se tenga, así que solo se afirma su presencia; ROI ANUAL ya no: cierra su
 * reloj en la fecha de la valuación que lo alimenta.
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
    await expect(detailRow(page, 'GANANCIA PROYECTADA')).toContainText(PROJECTED_ROI)
    // Score is a percentile against the other candidates, so it moves with them:
    // this asserts it is computed and shown, not what it happens to be today.
    await expect(detailRow(page, 'ROI PROY. ANUAL')).toContainText(/Score \d+/)
  })

  test('DATOS shows what is known and leaves the post-purchase rows empty', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(detailRow(page, 'INVERSIÓN')).toContainText(INVESTMENT)
    await expect(detailRow(page, 'RENTA/MES ESTIMADA')).toContainText('$20,000')
    await expect(detailRow(page, 'CAP RATE PROY. S/ INVERSIÓN')).toContainText(CAP_RATE)
    await expect(detailRow(page, 'TIPO DE ACTIVO')).toContainText('Casa')
    await expect(detailRow(page, 'ETAPA')).toContainText('PROSPECTO')
    // Nothing has been bought, so nothing has been held
    await expect(detailRow(page, 'PLAZO REAL')).toContainText('—')
    await expect(detailRow(page, 'UNIDADES')).toContainText('—')
  })

  test('UBICACIÓN, the breakdown bars and the captured m² figures', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(detailRow(page, 'DIRECCIÓN')).toContainText(PROSPECTO.address)
    await expect(detailRow(page, 'CIUDAD')).toContainText('Monterrey')
    await expect(page.getByRole('link', { name: 'VER FUENTE ↗' })).toBeVisible()

    // MÉTRICAS (INVERSIÓN/m², etc.) is gone — unused derived stats, retired.
    // What replaced it as the read-mode home for m² is these three rows, which
    // are captured fields now and no longer editing-only: DESGLOSE offers what
    // is captured, and never what is derived below is the edit-mode half of
    // this same guarantee.
    await expect(page.getByText('DESGLOSE DE INVERSIÓN')).toBeVisible()
    await expect(page.getByText('MÉTRICAS')).toHaveCount(0)
    await expect(detailRow(page, 'M² DE TERRENO')).toContainText(String(PROSPECTO.sqmLand))
    await expect(detailRow(page, 'M² DE CONSTRUCCIÓN')).toBeVisible()
  })

  test('PROYECCIÓN spells out the bet the property is', async ({ page }) => {
    await gotoProperty(page, id)

    // La ganancia se imprime entera: monto y porcentaje son la misma cifra en dos
    // unidades. Aquí la sube el héroe, así que ahí va completa.
    await expect(detailRow(page, 'GANANCIA PROYECTADA')).toContainText(`$870,000 ${PROJECTED_ROI}`)

    // Y lo que queda en la sección es lo que el héroe no subió
    await expect(page.getByText('PROYECCIÓN')).toBeVisible()
    await expect(detailRow(page, 'VENTA PROYECTADA')).toContainText('$3,000,000')
    await expect(detailRow(page, 'RENTA ANUAL ESTIMADA')).toContainText('$240,000')
    // Un héroe es una promoción, no una copia: cada cifra queda una sola vez.
    for (const promoted of ['ROI PROY. ANUAL', 'GANANCIA PROYECTADA']) {
      await expect(page.getByText(promoted, { exact: true })).toHaveCount(1)
    }
    // El plazo tampoco está aquí: es un supuesto, y SUPUESTOS lo enseña con su
    // origen — que es más de lo que decía esta fila.
    await expect(detailRow(page, 'PLAZO PROYECTADO (MESES)')).toContainText('12')
    // Lo realizado no tiene sección propia: sus cifras son las que el héroe
    // promueve, y las capturadas viven donde se capturan.
    await expect(page.getByText('RESULTADO', { exact: true })).toHaveCount(0)
  })

  test('a prospecto has no tab switcher — money comes with the offer', async ({ page }) => {
    await gotoProperty(page, id)

    // With nothing to switch to yet, the GENERAL tab strip doesn't render at
    // all — one option is not a choice, and the row was just wasted space.
    await expect(page.getByRole('button', { name: 'GENERAL', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'FINANZAS', exact: true })).toHaveCount(0)
    await expect(page.getByText('DATOS', { exact: true })).toBeVisible()
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

    // El desglose es el único origen del total: el sistema lo suma, nadie lo teclea
    await expect(detailRow(page, 'INVERSIÓN')).toContainText('SUMA DEL DESGLOSE')
    // Y la fila donde antes se tecleaba tampoco aparece al editar
    await expect(fieldInput(page, 'INVERSIÓN CAPTURADA')).toHaveCount(0)
    await expect(detailRow(page, 'PLAZO REAL')).toContainText('DERIVADO DE FECHAS')
    // The stage has its own door, and the row says which one
    await expect(detailRow(page, 'ETAPA')).toContainText('SE MUEVE CON AVANZAR A')

    for (const label of ['INVERSIÓN', 'CAP RATE PROY. S/ INVERSIÓN', 'PLAZO REAL']) {
      await expect(fieldInput(page, label)).toHaveCount(0)
    }
  })

  test('DESGLOSE captures the costs, and COSTO OBRA/m² re-runs the calculator', async ({ page }) => {
    await gotoProperty(page, id)
    await enterEditMode(page)

    // The costs — what the money actually goes on. The assumptions moved out of
    // here into SUPUESTOS, because a number the model invents does not belong in
    // a list of things somebody paid for.
    await expect(fieldInput(page, 'PRECIO DE COMPRA')).toHaveValue('2,000,000')
    await expect(fieldInput(page, 'M² DE TERRENO')).toBeVisible()
    await expect(fieldInput(page, 'M² DE CONSTRUCCIÓN')).toBeVisible()
    await expect(fieldInput(page, 'PERMISOS')).toBeVisible()
    await expect(fieldInput(page, 'SUBDIVISIÓN')).toBeVisible()

    // COSTO OBRA/m² is captured again too — not a second place to type the
    // work's cost, but the calculator that seeded the budget's first line,
    // offered again here for as long as nobody has detailed a real partida.
    // MÉTRICAS (the read-only home this used to have) is gone.
    await expect(fieldInput(page, 'COSTO OBRA/m²')).toBeVisible()
    await expect(page.getByText('MÉTRICAS')).toHaveCount(0)
  })

  test('SUPUESTOS is always on screen and says which numbers nobody chose', async ({ page }) => {
    await gotoProperty(page, id)

    // Visible in view mode too: money on this page is computed from these, so
    // hiding them behind EDITAR meant reading figures whose inputs were
    // invisible.
    await expect(page.getByText('SUPUESTOS')).toBeVisible()

    // Captured explicitly by the fixture
    await expect(detailRow(page, 'PLAZO PROYECTADO (MESES)')).toContainText('12')
    await expect(detailRow(page, 'PLAZO PROYECTADO (MESES)')).toContainText('CAPTURADO')

    // Never captured — the model applies its own and admits it
    await expect(detailRow(page, 'COSTOS ADQ. (%)')).toContainText('6.5%')
    await expect(detailRow(page, 'COSTOS ADQ. (%)')).toContainText('SUPUESTO POR OMISIÓN')

    // They are TWO. The works overhead was the third and left the contract with
    // the formula it multiplied: it is applied once, when the calculator seeds
    // the first budget line, and from there it lives inside the amount. An
    // assumption that moves no money is not an assumption — showing it here
    // would be a figure anyone can read, compare and edit without a peso ever
    // changing, which is the «NO SE USA» defect under another name.
    await expect(page.getByText('OVERHEAD DE OBRA')).toHaveCount(0)
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
    await expect(detailRow(page, 'CAP RATE PROY. S/ INVERSIÓN')).toContainText('16.9%')

    await page.reload()
    await expect(detailRow(page, 'CAP RATE PROY. S/ INVERSIÓN')).toContainText('16.9%')
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
    await expect(detailRow(page, 'CAP RATE PROY. S/ INVERSIÓN')).toContainText('—')

    await page.reload()
    await expect(detailRow(page, 'RENTA/MES ESTIMADA')).toContainText('—')

    // Put the fixture back the way the rest of the file expects to find it
    await enterEditMode(page)
    await setNumericField(page, 'RENTA/MES ESTIMADA', '20000')
    await saveEdits(page)
    await expect(detailRow(page, 'CAP RATE PROY. S/ INVERSIÓN')).toContainText(CAP_RATE)
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

  /**
   * La cifra que cambió de fuente, vigilada de punta a punta.
   *
   * El costo de obra dejó de ser `m² × $/m² × overhead` y pasó a ser la SUMA DEL
   * PRESUPUESTO. Ninguna prueba de navegador miraba esa costura, que es
   * justamente donde vive el riesgo: la pestaña escribe un renglón, el servidor
   * devuelve la propiedad recalculada en la MISMA respuesta, y la ficha —que
   * está en la otra columna— tiene que enterarse sin recargar.
   *
   * Va al final del archivo a propósito: deja la propiedad con obra capturada, y
   * las pruebas de arriba afirman sobre la que nace sin ella.
   */
  test('la obra del DESGLOSE es la suma del presupuesto, capturada en su pestaña', async ({ page }) => {
    await gotoProperty(page, id)

    // Nace sin obra: el presupuesto sembrado vale 0 —la fixture no da metros ni
    // precio por m²— y una barra de $0 no se dibuja.
    await expect(detailRow(page, 'INVERSIÓN')).toContainText(INVESTMENT)
    await expect(page.getByText('OBRA A EJECUTAR', { exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'PRESUPUESTO', exact: true }).click()
    await expect(page.getByText('TOTAL · ES EL COSTO DE OBRA')).toBeVisible()
    await page.getByRole('button', { name: '+ CAPÍTULO', exact: true }).click()
    await page.getByRole('button', { name: /^Abrir Capítulo nuevo$/ }).click()

    // Clic y DESPUÉS fill, nunca teclear en frío: `NumericInput` se reescribe al
    // enfocar y agenda un `select()`, y el tecleo automatizado le gana la
    // carrera. Es la misma razón por la que existe `setNumericField`.
    const precio = page.getByLabel(/^Precio unitario de/)
    await precio.click()
    await precio.fill('500000')
    const cantidad = page.getByLabel(/^Cantidad de/)
    await cantidad.click()
    await cantidad.fill('1')
    await page.getByText('PRESUPUESTO DE OBRA').click()   // soltar la celda = guardar

    // La barra aparece con lo capturado, y la inversión sube exactamente eso:
    // 2,130,000 + 500,000. Una sola escritura movió las dos columnas.
    await expect(page.getByText('OBRA A EJECUTAR', { exact: true })).toBeVisible()
    await expect(detailRow(page, 'INVERSIÓN')).toContainText('$2,630,000')
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
 * base is a lump sum from before the firm kept a breakdown, the money tools are
 * open, and the projection it was bought on is still on screen — in later steps
 * you see everything from before.
 */
test.describe('Ficha de propiedad — una en renta', () => {
  const RENTADA = {
    name: '[TEST] Propiedad En Renta',
    address: 'Av. Rentada 200',
    city: 'Monterrey',
    assetType: 'departamento',
    // De esta compra solo se conoce el total: «costó $5M todo incluido». Así se
    // captura un all-in ahora que no hay casilla de total — como precio de
    // compra con los costos de adquisición en 0 EXPLÍCITO. Dejarlos sin capturar
    // significa «supón 6.5%» y le sumaría $325,000 que nadie pagó.
    purchasePrice: 5_000_000,
    acquisitionCostPct: 0,
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
    await transitionProperty(request, id, { to: 'oferta' }, token)
    // El portón de desarrollo no pide ninguna inversión: el precio de compra ya
    // está capturado desde el alta, y de ahí sale el total.
    await transitionProperty(request, id, {
      to: 'desarrollo', acquisitionDate: '2024-01-01', totalUnits: 4,
      currentValuation: 8_000_000, valuationDate: '2025-06-01',
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

    // 8,000,000 marked against a 5,000,000 base. El monto y su porcentaje son la
    // misma cifra en dos unidades y se imprimen juntos: separarlos dejaba media
    // pareja arriba y media veinte filas abajo, las dos con el mismo nombre.
    await expect(detailRow(page, 'GANANCIA NO REALIZADA')).toContainText('$3,000,000 +60.0%')
    // El ROI de la marca se anualiza de la compra (2024-01) a la FECHA DE LA
    // VALUACIÓN (2025-06): diecisiete meses, y ahí se queda. Antes el numerador
    // era de junio y el denominador llegaba a hoy, así que la cifra bajaba sola
    // cada mes sin que nadie tocara un dato — por eso este valor no se podía
    // afirmar. Ahora sí, y la ficha además dice hasta cuándo cuenta.
    await expect(detailRow(page, 'ROI ANUAL')).toContainText('+39.3%')
    await expect(detailRow(page, 'ROI ANUAL')).toContainText('AL JUN 2025')
  })

  test('the score is gone — a bought property competes with nobody', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(page.getByText(/^Score/)).toHaveCount(0)
  })

  test('INVERSIÓN sale del desglose también cuando el desglose es un solo número', async ({ page }) => {
    await gotoProperty(page, id)

    // 5,000,000 × (1 + 0) — un total all-in vive en el desglose como cualquier
    // otro, y llega a la ficha por el mismo camino que una compra desglosada.
    await expect(detailRow(page, 'INVERSIÓN')).toContainText('$5,000,000')
    await expect(detailRow(page, 'INVERSIÓN')).toContainText('SUMA DEL DESGLOSE')
    await expect(detailRow(page, 'UNIDADES')).toContainText('4')
    await expect(detailRow(page, 'ETAPA')).toContainText('EN RENTA')
    // El 0% está capturado, no supuesto: es la mitad del idioma, y sin ella el
    // modelo supondría 6.5% y el total dejaría de ser el que se pagó. Se imprime
    // como el cero que es, no como el «—» de lo que nadie tecleó.
    await expect(detailRow(page, 'COSTOS ADQ. (%)')).toContainText('0.0%')
    await expect(detailRow(page, 'COSTOS ADQ. (%)')).toContainText('CAPTURADO')

    await enterEditMode(page)
    // El total nunca es editable. Lo que se corrige es el componente: aquí el
    // precio de compra, que es donde se tecleó el all-in.
    await expect(fieldInput(page, 'INVERSIÓN')).toHaveCount(0)
    await expect(fieldInput(page, 'PRECIO DE COMPRA')).toHaveValue('5,000,000')
  })

  test('la ficha no ofrece capturar un total de inversión', async ({ page }) => {
    await gotoProperty(page, id)

    // Hubo una segunda fila para teclear el total, y con ella la pregunta «¿cuál
    // de los dos números creo?». Una compra vieja de la que solo se sabe el
    // total, como esta, era justo la que la enseñaba también en modo lectura.
    // Ya no existe: ni al ver, ni al editar, ni como caja vacía esperando.
    await expect(page.getByText('INVERSIÓN CAPTURADA', { exact: true })).toHaveCount(0)

    await enterEditMode(page)
    await expect(page.getByText('INVERSIÓN CAPTURADA', { exact: true })).toHaveCount(0)
    await expect(fieldInput(page, 'INVERSIÓN CAPTURADA')).toHaveCount(0)
  })

  test('the rent collected is its own figure, and so is the yield on it', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(detailRow(page, 'RENTA/MES COBRADA')).toContainText('$50,000')
    // 50,000 × 12 / 5,000,000 — the yield the property is actually producing
    await expect(detailRow(page, 'CAP RATE REAL S/ INVERSIÓN')).toContainText('12.0%')
    // Nothing was ever modelled, so the projected pair has nothing to report —
    // and says so rather than borrowing the collected rent
    await expect(detailRow(page, 'RENTA/MES ESTIMADA')).toContainText('—')
    await expect(detailRow(page, 'CAP RATE PROY. S/ INVERSIÓN')).toContainText('—')
  })

  test('the dates of the purchase are on the record', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(detailRow(page, 'ADQUISICIÓN')).toContainText('ene 2024')
    await expect(detailRow(page, 'PRIMERA RENTA')).toContainText('ene 2025')
  })

  test('the projection it was bought on is still readable', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(page.getByText('PROYECCIÓN')).toBeVisible()
    await expect(detailRow(page, 'VENTA PROYECTADA')).toContainText('$9,000,000')
    // El plazo lo dice SUPUESTOS con su origen, que es más de lo que decía la
    // fila de PROYECCIÓN. Repetido, era además lo único que esa sección siempre
    // tenía, así que una propiedad que nunca se modeló no podía dejar de
    // anunciar una proyección vacía.
    await expect(detailRow(page, 'PLAZO PROYECTADO (MESES)')).toContainText('24')
    await expect(page.getByText('PLAZO PROYECTADO', { exact: true })).toHaveCount(0)
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
})

/**
 * A delete that drags its linked processes with it.
 *
 * A property with a tarea attached used to be permanently undeletable — the
 * FK blocked it and nothing could free the tarea. Deleting a property is now
 * the explicit action that takes its process instances with it (node states,
 * comments and files already cascade by FK); captured budget work, profit
 * splits and sonar signals still hold a delete, unchanged.
 */
test.describe('Borrar arrastra sus procesos ligados', () => {
  const CON_TAREA = {
    name: '[TEST] Propiedad Con Tarea',
    address: 'Av. Bloqueada 50',
    city: 'Monterrey',
    // Comprar exige un precio de compra: sin él la propiedad no llega a
    // desarrollo, y sin desarrollo no se le puede ligar la tarea.
    // Esto decía `landPrice`, un nombre que el API ya no conoce — el campo se
    // caía sin ruido y la propiedad viajaba sin costo alguno.
    purchasePrice: 1_000_000,
    projectedSale: 2_000_000,
    latitude: 25.6866,
    longitude: -100.3161,
  }
  const TAREA = '[TEST] Tarea Que Cae Con La Propiedad'

  let token: string
  let id: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    await deletePropertyByName(request, CON_TAREA.name, token)
    id = (await createProperty(request, CON_TAREA, token)).id
    // Tareas only attach from desarrollo on, so the property has to get there.
    await transitionProperty(request, id, { to: 'oferta' }, token)
    await transitionProperty(request, id, {
      to: 'desarrollo', acquisitionDate: '2024-01-01', totalUnits: 1, currentValuation: 1_200_000,
    }, token)
    await attachInstanceToProperty(request, TAREA, id, token)
  })

  test.afterAll(async ({ request }) => {
    // The test itself deletes the property (and cascades its tarea) on the
    // happy path; this only cleans up after a failed run that didn't get there.
    await deletePropertyByName(request, CON_TAREA.name, token)
  })

  test('ELIMINAR borra la propiedad y arrastra su tarea ligada', async ({ page, request }) => {
    await gotoProperty(page, id)

    await page.getByRole('button', { name: 'ELIMINAR', exact: true }).click()
    await page.getByRole('button', { name: '¿CONFIRMAR BORRADO?' }).click()

    // Nothing left to refuse: the delete succeeds and lands on the table.
    await expect(page).toHaveURL(/\/propiedades$/)
    await expect(page.getByText(CON_TAREA.name)).toHaveCount(0)

    // ...and it took its tarea with it, not just the property.
    const instances = await getInstances(request, token)
    expect(instances.map(i => i.name)).not.toContain(TAREA)
  })
})
