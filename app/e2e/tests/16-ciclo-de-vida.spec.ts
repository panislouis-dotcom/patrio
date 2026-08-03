import { test, expect } from '../fixtures/auth'
import type { Page } from '@playwright/test'
import { getToken, createProperty, deleteProperty, deletePropertyByName, API_BASE } from '../helpers/api'
import {
  gotoProperty, detailRow, advanceTo, confirmTransition, enterEditMode, saveEdits, setNumericField,
} from '../helpers/detail'

/**
 * The journey, walked once end to end through the UI.
 *
 * A property is born a prospecto and reaches every other stage by living
 * through the one before it: prospecto → oferta → desarrollo → en renta →
 * vendida. What this file is really asserting is qué contesta la ficha en cada
 * paso. El score existe solo mientras la propiedad sigue compitiendo por
 * capital; la proyección sobrevive a la compra Y a la venta, porque es contra
 * ella que se califica el resultado; lo realizado aparece solo cuando hay una
 * venta que reportar. Y cada paso exige su propia evidencia antes de permitirse.
 *
 * The figures were confirmed against the API for exactly these inputs. PLAZO
 * REAL se mueve con el calendario mientras la propiedad se tenga, así que solo
 * se afirma después de que la venta lo congela. ROI ANUAL ya no se mueve: cierra
 * su reloj en la fecha de la valuación que lo alimenta.
 */

const CICLO = {
  name: '[TEST] Propiedad Ciclo',
  address: 'Av. Ciclo 700',
  city: 'Monterrey',
  assetType: 'edificio',
  purchasePrice: 4_000_000,
  acquisitionCostPct: 0,
  permitsCost: 0,
  subdivisionCost: 0,
  sqmLand: 500,
  sqmConstruction: 0,
  constructionCostPerSqm: 0,
  constructionOverhead: 1,
  projectedSale: 7_000_000,
  holdMonths: 24,
  latitude: 25.6866,
  longitude: -100.3161,
}

const ACQUIRED_ON = '2024-06-01'
const FIRST_RENT_ON = '2025-06-01'
const SOLD_ON = '2026-06-01'

/** A field of the gate modal — every input carries its label as aria-label. */
function gateField(page: Page, label: string) {
  return page.getByLabel(label, { exact: true })
}

/** The stages AVANZAR A ▸ is willing to move this property to right now. */
async function offeredStages(page: Page): Promise<string[]> {
  await page.getByRole('button', { name: 'AVANZAR A ▸' }).click()
  const labels = await page.locator('button').filter({ hasText: /^(OFERTA|DESARROLLO|EN RENTA|VENDIDA)$/ }).allInnerTexts()
  await page.keyboard.press('Escape')
  return labels
}

test.describe.serial('El ciclo de vida de una propiedad', () => {
  let token: string
  let id: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    await deletePropertyByName(request, CICLO.name, token)
    id = (await createProperty(request, CICLO, token)).id
  })

  test.afterAll(async ({ request }) => {
    await deleteProperty(request, id, token)
  })

  // ── Prospecto ───────────────────────────────────────────────────────────────

  test('nace prospecto: se juzga por lo que promete y solo puede volverse oferta', async ({ page }) => {
    await gotoProperty(page, id)

    await expect(detailRow(page, 'ETAPA')).toContainText('PROSPECTO')
    // 7,000,000 out of a 4,000,000 basis over the twenty-four modelled months
    await expect(detailRow(page, 'ROI PROY. ANUAL')).toContainText('+32.3%')
    await expect(detailRow(page, 'GANANCIA PROYECTADA')).toContainText('+75.0%')
    await expect(detailRow(page, 'ROI PROY. ANUAL')).toContainText(/Score \d+/)
    // Nothing has been bought, so there is no result to report
    await expect(page.getByText('RESULTADO', { exact: true })).toHaveCount(0)

    expect(await offeredStages(page)).toEqual(['OFERTA'])
  })

  // ── Oferta ──────────────────────────────────────────────────────────────────

  test('avanzar a oferta exige el modelo de salida, y abre el dinero', async ({ page }) => {
    await gotoProperty(page, id)
    await advanceTo(page, 'OFERTA')

    // Every offer models its exit, even when the plan is to rent
    await expect(gateField(page, 'VENTA PROYECTADA')).toHaveValue('7000000')
    await confirmTransition(page, 'OFERTA').click()

    await expect(detailRow(page, 'ETAPA')).toContainText('OFERTA')
    // Still competing for capital, so still scored
    await expect(detailRow(page, 'ROI PROY. ANUAL')).toContainText(/Score \d+/)
    // From the offer on there is a real deal to fund
    await expect(page.getByRole('button', { name: 'FINANZAS', exact: true })).toBeVisible()

    expect(await offeredStages(page)).toEqual(['DESARROLLO'])
  })

  // ── El portón de desarrollo ─────────────────────────────────────────────────

  test('el portón de desarrollo no deja pasar sin sus insumos', async ({ page }) => {
    await gotoProperty(page, id)
    await advanceTo(page, 'DESARROLLO')

    // El portón pide lo que solo sabe quien compró, y nada más.
    await expect(gateField(page, 'FECHA DE ADQUISICIÓN')).not.toHaveValue('')
    await expect(gateField(page, 'UNIDADES')).not.toHaveValue('')

    // Comprar no produce un avalúo: no se pide ninguna valuación. Antes se
    // ofrecía prellenada con la venta proyectada, que es otro dato con otro
    // nombre — y una plusvalía que nace igualada al plan no es una plusvalía.
    await expect(page.getByLabel(/VALUACI[ÓO]N/)).toHaveCount(0)

    // Y con el desglose completo la inversión ya está sumada: preguntarla sería
    // pedir un dato que el sistema tiene mejor que quien lo teclea.
    await expect(page.getByLabel('INVERSIÓN TOTAL')).toHaveCount(0)

    await gateField(page, 'FECHA DE ADQUISICIÓN').fill('')
    await expect(confirmTransition(page, 'DESARROLLO')).toBeDisabled()

    await gateField(page, 'FECHA DE ADQUISICIÓN').fill('2026-01-15')
    await expect(confirmTransition(page, 'DESARROLLO')).toBeEnabled()

    await page.getByRole('button', { name: 'CANCELAR', exact: true }).click()
    // A refused move leaves the property exactly where it was
    await expect(detailRow(page, 'ETAPA')).toContainText('OFERTA')
  })

  test('y el servidor lo vuelve a rechazar por su cuenta, con una frase', async ({ request }) => {
    // The modal is the first gate, not the only one. Posting the body the modal
    // would have refused to send must come back a 422 with a sentence a person
    // can read — never a 500 from the database trigger underneath.
    const res = await request.post(`${API_BASE}/api/properties/${id}/transition`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { to: 'vendida', saleDate: SOLD_ON, salePrice: 7_000_000 },
    })

    expect(res.status()).toBe(422)
    const body = await res.json() as { error: { message: string } }
    // La frase habla el vocabulario de docs/glosario.md: nombres de etapa, no
    // valores de columna, y dice a dónde SÍ se puede ir.
    expect(body.error.message).toBe(
      'No se puede pasar de Oferta a Vendida. Desde Oferta solo se puede pasar a Desarrollo o Archivada.')
  })

  // ── Desarrollo ──────────────────────────────────────────────────────────────

  test('en desarrollo muere el score, y comprar no inventa un avalúo', async ({ page }) => {
    await gotoProperty(page, id)
    await advanceTo(page, 'DESARROLLO')

    await gateField(page, 'FECHA DE ADQUISICIÓN').fill(ACQUIRED_ON)
    await gateField(page, 'UNIDADES').fill('2')
    await confirmTransition(page, 'DESARROLLO').click()

    await expect(detailRow(page, 'ETAPA')).toContainText('DESARROLLO')
    await expect(detailRow(page, 'UNIDADES')).toContainText('2')
    await expect(detailRow(page, 'ADQUISICIÓN')).toContainText(ACQUIRED_ON)

    // A bought property competes with nobody: the score is over
    await expect(page.getByText(/^Score/)).toHaveCount(0)

    // Y como nadie ha avaluado nada todavía, no hay marca que enseñar: comprar
    // no produce un avalúo. El héroe no se queda por eso en dos guiones — lo
    // ocupa la proyección, que es la mejor respuesta que esta propiedad tiene
    // hoy. (Que la marca lo desplace cuando alguien sí valúa es el test que
    // sigue.)
    await expect(page.getByText('GANANCIA NO REALIZADA')).toHaveCount(0)
    await expect(detailRow(page, 'ROI PROY. ANUAL')).toContainText('+32.3%')

    // The projection it was bought on stays readable — it is what reality is
    // measured against, and in later steps you see everything from before
    await expect(detailRow(page, 'GANANCIA PROYECTADA')).toContainText('$3,000,000')
    // Works can be tracked on a building that is yours
    await expect(page.getByText('TAREAS', { exact: true })).toBeVisible()

    // A development can end in a sale or in a tenancy — both are on offer
    expect(await offeredStages(page)).toEqual(['EN RENTA', 'VENDIDA'])
  })

  test('la ganancia no realizada aparece cuando alguien valúa, no cuando alguien compra', async ({ page }) => {
    await gotoProperty(page, id)
    await enterEditMode(page)

    // The appraisal is captured on the ficha the day one actually exists — which
    // is the workflow the gate stopped pretending to cover.
    await setNumericField(page, 'VALUACIÓN', '5000000')
    await saveEdits(page)

    // 5,000,000 marked against the 4,000,000 that went in — y ahora la marca sí
    // desplaza a la proyección en el héroe, porque tiene más realidad detrás.
    await expect(detailRow(page, 'GANANCIA NO REALIZADA')).toContainText('$1,000,000 +25.0%')
    // Se capturó el monto y no su fecha de corte, así que el reloj del ROI sí
    // corre a hoy — y la ficha lo dice con esas palabras en vez de dejar leer la
    // cifra como si fuera de cualquier día.
    await expect(detailRow(page, 'ROI ANUAL')).toContainText('AL DÍA DE HOY')
  })

  // ── En renta ────────────────────────────────────────────────────────────────

  test('una renta anterior a la compra se rechaza con su motivo, no con un 500', async ({ page }) => {
    await gotoProperty(page, id)
    await advanceTo(page, 'EN RENTA')

    // The modal cannot know this is impossible; the domain can, and says so
    await gateField(page, 'FECHA DE LA PRIMERA RENTA').fill('2024-01-01')
    await gateField(page, 'RENTA MENSUAL COBRADA').fill('40000')
    await confirmTransition(page, 'EN RENTA').click()

    await expect(page.getByText('La primera renta no puede ser anterior a la adquisición.')).toBeVisible()

    await page.getByRole('button', { name: 'CANCELAR', exact: true }).click()
    await expect(detailRow(page, 'ETAPA')).toContainText('DESARROLLO')
  })

  test('con la fecha correcta la propiedad pasa a renta y el cap rate se vuelve real', async ({ page }) => {
    await gotoProperty(page, id)
    await advanceTo(page, 'EN RENTA')

    await gateField(page, 'FECHA DE LA PRIMERA RENTA').fill(FIRST_RENT_ON)
    await gateField(page, 'RENTA MENSUAL COBRADA').fill('40000')
    await confirmTransition(page, 'EN RENTA').click()

    await expect(detailRow(page, 'ETAPA')).toContainText('EN RENTA')
    await expect(detailRow(page, 'PRIMERA RENTA')).toContainText(FIRST_RENT_ON)
    await expect(detailRow(page, 'RENTA/MES COBRADA')).toContainText('$40,000')
    // 40,000 × 12 / 4,000,000 — the yield the property is actually producing
    await expect(detailRow(page, 'CAP RATE REAL')).toContainText('12.0%')
    await expect(detailRow(page, 'RENTA ANUAL COBRADA')).toContainText('$480,000')
    // Nothing was ever modelled, so the projected pair stays empty rather than
    // quietly adopting the collected rent
    await expect(detailRow(page, 'CAP RATE PROY.')).toContainText('—')

    // The rent history is kept: a hold still exits through a sale
    expect(await offeredStages(page)).toEqual(['VENDIDA'])
  })

  // ── Vendida ─────────────────────────────────────────────────────────────────

  test('al vender, el resultado encabeza y el plan queda a su lado para calificarlo', async ({ page }) => {
    await gotoProperty(page, id)
    await advanceTo(page, 'VENDIDA')

    await gateField(page, 'FECHA DE VENTA').fill(SOLD_ON)
    await gateField(page, 'PRECIO DE VENTA').fill('7000000')
    await confirmTransition(page, 'VENDIDA').click()

    await expect(detailRow(page, 'ETAPA')).toContainText('VENDIDA')

    // 7,000,000 out of 4,000,000, held the twenty-four months between the two
    // dates. El ROI cierra su reloj en la fecha de venta, y lo dice.
    await expect(detailRow(page, 'ROI REAL ANUAL')).toContainText('+32.3%')
    await expect(detailRow(page, 'ROI REAL ANUAL')).toContainText(`AL ${SOLD_ON}`)
    await expect(detailRow(page, 'GANANCIA REALIZADA')).toContainText('$3,000,000 +75.0%')

    // Lo realizado NO tiene sección propia, y es la misma regla que gobierna
    // todo lo demás: cada cifra etiquetada vive en un solo lugar. Sus dos cifras
    // derivadas son justo las que el héroe promueve, y las capturadas ya viven
    // donde se capturan — PRECIO DE VENTA en FECHAS, PLAZO REAL en DATOS. Una
    // sección que solo puede repetir lo que ya está en pantalla no organiza
    // nada: hace dudar de si son la misma cifra o dos parecidas.
    await expect(page.getByText('RESULTADO', { exact: true })).toHaveCount(0)
    await expect(page.getByText('GANANCIA %', { exact: true })).toHaveCount(0)
    await expect(detailRow(page, 'PRECIO DE VENTA')).toContainText('$7,000,000')
    await expect(detailRow(page, 'PLAZO REAL')).toContainText('24 meses')
    await expect(page.getByText('ROI REAL ANUAL')).toHaveCount(1)
    await expect(page.getByText('GANANCIA REALIZADA')).toHaveCount(1)
    await expect(page.getByText('PLAZO REAL')).toHaveCount(1)

    // A sold asset is a closed fact, not a live mark: la marca se apaga…
    await expect(page.getByText('GANANCIA NO REALIZADA')).toHaveCount(0)
    // …pero el plan NO. Es el par que el modelo promete, y se apagaba justo
    // cuando se volvía comprobable: se proyectaron 3,000,000 de ganancia y se
    // realizaron 3,000,000, y las dos cifras tienen que poder leerse juntas.
    await expect(detailRow(page, 'GANANCIA PROYECTADA')).toContainText('$3,000,000')
    await expect(detailRow(page, 'ROI PROY. ANUAL')).toContainText('32.3%')

    // Terminal: a sale is the firm's track record, and it is not filed away
    await expect(page.getByRole('button', { name: 'AVANZAR A ▸' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'ARCHIVAR' })).toHaveCount(0)
  })

  test('la propiedad aparece en la tabla con sus cifras realizadas', async ({ page }) => {
    await page.goto('/propiedades')
    await page.locator('button').filter({ hasText: /^VENDIDA\s*\d+$/ }).click()

    const sold = page.locator('tbody tr').filter({ hasText: CICLO.name })
    await expect(sold).toContainText('$7.0M')
    await expect(sold).toContainText('$3.0M')
    await expect(sold).toContainText('32.3%')
    await expect(sold).toContainText('24m')
  })
})

/**
 * Archiving is the other way out, and it is not a step forward: it takes a
 * property off the active inventory without deleting anything and without
 * pretending a deal happened — ni le cambia un número. Se archiva justamente
 * para poder volver a mirarla, y sin ventana de métricas era la única etapa que
 * no contestaba nada: toda cifra derivada salía en blanco.
 */
test.describe.serial('Archivar una propiedad', () => {
  const ARCHIVADA = {
    name: '[TEST] Propiedad Archivada',
    address: 'Av. Archivo 10',
    city: 'Monterrey',
    purchasePrice: 1_000_000,
    projectedSale: 1_200_000,
    latitude: 25.6866,
    longitude: -100.3161,
  }

  let token: string
  let id: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    await deletePropertyByName(request, ARCHIVADA.name, token)
    id = (await createProperty(request, ARCHIVADA, token)).id
  })

  test.afterAll(async ({ request }) => {
    await deleteProperty(request, id, token)
  })

  test('ARCHIVAR avisa que es terminal y la saca del inventario activo', async ({ page }) => {
    await gotoProperty(page, id)
    await page.getByRole('button', { name: 'ARCHIVAR' }).click()

    await expect(page.getByText(/Archivar la saca del inventario activo sin borrar nada/)).toBeVisible()
    await confirmTransition(page, 'ARCHIVADA').click()

    await expect(detailRow(page, 'ETAPA')).toContainText('ARCHIVADA')
    // From archived there is no way back and no way on
    await expect(page.getByRole('button', { name: 'AVANZAR A ▸' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'ARCHIVAR' })).toHaveCount(0)

    // Y conserva lo que tenía: 1,200,000 de venta proyectada sobre una base de
    // 1,065,000 (1,000,000 más el 6.5% de costos de adquisición supuesto).
    await expect(detailRow(page, 'ROI PROY. ANUAL')).toContainText('+12.7%')
    await expect(detailRow(page, 'GANANCIA PROYECTADA')).toContainText('$135,000')
    await expect(detailRow(page, 'INVERSIÓN')).toContainText('$1,065,000')
  })

  test('la tabla la esconde hasta que se piden las archivadas', async ({ page }) => {
    await page.goto('/propiedades')
    await expect(page.locator('tbody tr').filter({ hasText: ARCHIVADA.name })).toHaveCount(0)

    await page.getByRole('button', { name: 'VER ARCHIVADAS' }).click()
    await page.locator('button').filter({ hasText: /^ARCHIVADA\s*\d+$/ }).click()

    await expect(page.locator('tbody tr').filter({ hasText: ARCHIVADA.name })).toBeVisible()
  })
})
