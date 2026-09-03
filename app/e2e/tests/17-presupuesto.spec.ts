import { test, expect } from '../fixtures/auth'
import type { Locator, Page } from '@playwright/test'
import { getToken, createProperty, deleteProperty, deletePropertyByName } from '../helpers/api'
import { gotoProperty, fieldInput, enterEditMode, saveEdits, setNumericField } from '../helpers/detail'

/**
 * El presupuesto de obra, mirado desde el navegador.
 *
 * Hasta el 2026-08-30 el total NO era la suma de sus renglones: era un objetivo
 * que la ficha fijaba por fuera —`m² × $/m² × overhead`— y un renglón residual
 * («Otros, por detallar») se comía la diferencia. De ahí salían dos defectos, y
 * el segundo es el que Eduardo reportó: **corregir el metraje de 200 a 220 m²
 * inflaba el presupuesto entero 10%**, capítulos cotizados con proveedor
 * incluidos, y nada en la pantalla lo decía.
 *
 * Ninguna prueba de navegador miraba esa costura. El cambio que la arregla no
 * tocó una línea de `app/e2e/`, así que la suite podía seguir verde con la liga
 * viva de vuelta. Este archivo es esa red: cada prueba de aquí falla si el total
 * vuelve a moverse solo.
 *
 * Se afirma sobre lo que se ve —el importe del pie, las dos cifras rotuladas, el
 * renglón y su ✕— y se escribe por la pantalla, no por el API: el panel ES el
 * sujeto, y una prueba que llama al API se salta justo la costura donde vive el
 * riesgo (la pestaña escribe, el servidor devuelve la propiedad recalculada en
 * la MISMA respuesta, y el pie tiene que enterarse sin recargar).
 */

/**
 * `constructionOverhead: 1` a propósito: con el 1.3 por omisión el renglón que
 * siembra la calculadora se llamaría «… × $8,000/m² × 1.3» y valdría $2,080,000.
 * Fijar el overhead deja el nombre y la cifra en su forma limpia —200 × 8,000 =
 * $1,600,000— que es contra la que se afirma abajo.
 */
const OBRA = {
  name: '[TEST] Presupuesto Independiente',
  address: 'Calle Presupuesto 100',
  city: 'Monterrey',
  assetType: 'casa',
  url: 'https://refigan.mx',
  latitude: 25.6866,
  longitude: -100.3161,
  sqmLand: 400,
  sqmConstruction: 200,
  constructionCostPerSqm: 8_000,
  constructionOverhead: 1,
  purchasePrice: 2_000_000,
  projectedSale: 3_000_000,
  holdMonths: 12,
}

/** El renglón con que nace la propiedad: la calculadora corre UNA vez y firma. */
const SEMBRADO = 'Estimado inicial · 200 m² × $8,000/m²'
const SEMBRADO_TOTAL = '$1,600,000'

/**
 * Abre la pestaña del presupuesto y espera al pie, que es donde vive el total.
 * Sin la espera, una aserción disparada enseguida corre contra la pestaña vieja.
 */
async function abrirPresupuesto(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'PRESUPUESTO', exact: true }).click()
  await expect(page.getByText('TOTAL · ES EL COSTO DE OBRA')).toBeVisible()
}

/**
 * El importe del pie. Es la MISMA cifra que la ficha enseña como obra del
 * desglose, y desde el 2026-08-30 la única manera de moverla es mover renglones:
 * aquí vivía AJUSTAR, que la fijaba por fuera.
 *
 * Se ancla por el rótulo y no por una clase: la celda del importe es la segunda
 * de la fila que ese rótulo encabeza, y su primer `div` es el número (el segundo
 * es la línea de COMP/PAG, que no es el total).
 */
function total(page: Page): Locator {
  return page.getByText('TOTAL · ES EL COSTO DE OBRA')
    .locator('../..')
    .locator('td').nth(1)
    .locator('div').first()
}

/**
 * Las dos cifras rotuladas del pie, en el orden en que se leen: «TU ESTIMADO»
 * —el supuesto que se captura en la ficha— y «· EL PRESUPUESTO» —esta suma entre
 * los metros—. Van en la misma tira porque la comparación ES el dato; separarlas
 * en dos pantallas es como se leían antes como una sola cifra que a veces
 * cambiaba sola.
 */
function porM2(page: Page): { estimado: Locator; presupuesto: Locator } {
  const tira = page.getByText('TU ESTIMADO', { exact: true }).locator('..')
  return { estimado: tira.locator('span').nth(1), presupuesto: tira.locator('span').nth(3) }
}

/** Los capítulos nacen cerrados; sus renglones no existen en el DOM hasta abrirlo. */
async function abrirCapitulo(page: Page, nombre: string): Promise<void> {
  await page.getByRole('button', { name: `Abrir ${nombre}`, exact: true }).click()
}

/**
 * Suelta la celda que se acaba de teclear. `NumericInput` guarda al perder el
 * foco, así que el guardado es un clic en cualquier otra parte del panel — el
 * título sirve y no tiene efecto propio.
 */
async function soltarCelda(page: Page): Promise<void> {
  await page.getByText('PRESUPUESTO DE OBRA').click()
}

// ── La liga viva, que era el bug ──────────────────────────────────────────────

/**
 * El total es invariante en todo este bloque: nada de lo que se teclea en la
 * ficha puede moverlo. Por eso las pruebas de aquí no dependen del orden — todas
 * afirman la misma cifra— salvo la última, que sí cotiza a mano y por eso va al
 * final, igual que la del presupuesto en `09-propiedad-detalle`.
 */
test.describe('Editar la ficha no reprecia el presupuesto', () => {
  let token: string
  let id: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    await deletePropertyByName(request, OBRA.name, token)
    id = (await createProperty(request, OBRA, token)).id
  })

  test.afterAll(async ({ request }) => {
    await deleteProperty(request, id, token)
  })

  test('corregir los m² de construcción no mueve el total', async ({ page }) => {
    await gotoProperty(page, id)
    await abrirPresupuesto(page)
    await expect(total(page)).toHaveText(SEMBRADO_TOTAL)

    // ESTE es el bug reportado: 200 → 220 inflaba la obra entera un 10%.
    await enterEditMode(page)
    await setNumericField(page, 'M² DE CONSTRUCCIÓN', '220')
    await saveEdits(page)

    // Sin recargar: la respuesta del PATCH trae la propiedad y el pie la lee.
    await expect(total(page)).toHaveText(SEMBRADO_TOTAL)

    // Y con recarga, porque «la pantalla no se enteró» y «el dato no se movió»
    // son cosas distintas y solo la segunda es la que se prometió.
    await gotoProperty(page, id)
    await abrirPresupuesto(page)
    await expect(total(page)).toHaveText(SEMBRADO_TOTAL)
  })

  test('corregir el $/m² supuesto tampoco lo mueve', async ({ page }) => {
    await gotoProperty(page, id)
    await abrirPresupuesto(page)

    await enterEditMode(page)
    await setNumericField(page, 'COSTO OBRA/m²', '12000')
    await saveEdits(page)

    await expect(total(page)).toHaveText(SEMBRADO_TOTAL)
  })

  /**
   * Va al final: es la única que cotiza a mano, y deja el presupuesto en una
   * cifra que ya no es la del renglón sembrado.
   */
  test('una obra cotizada a mano sobrevive a que le muevan los dos supuestos', async ({ page }) => {
    await gotoProperty(page, id)
    await abrirPresupuesto(page)
    await abrirCapitulo(page, 'Otros')

    // La cotización real llega: $900,000, tecleados por una persona.
    const precio = page.getByLabel(`Precio unitario de ${SEMBRADO}`)
    await precio.click()
    await precio.fill('900000')
    await soltarCelda(page)
    await expect(total(page)).toHaveText('$900,000')

    // Y ahora alguien corrige el metraje Y el supuesto de $/m². Con la liga viva
    // esto repreciaba la cotización a 350 × $25,000 = $8,750,000.
    await enterEditMode(page)
    await setNumericField(page, 'M² DE CONSTRUCCIÓN', '350')
    await setNumericField(page, 'COSTO OBRA/m²', '25000')
    await saveEdits(page)

    await expect(total(page)).toHaveText('$900,000')
  })
})

// ── Los dos $/m² ─────────────────────────────────────────────────────────────

test.describe('Los dos $/m² conviven y ninguno gobierna al otro', () => {
  let token: string
  let id: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    await deletePropertyByName(request, OBRA.name, token)
    id = (await createProperty(request, OBRA, token)).id
  })

  test.afterAll(async ({ request }) => {
    await deleteProperty(request, id, token)
  })

  test('el capturado se teclea, el derivado no tiene dónde teclearse', async ({ page }) => {
    await gotoProperty(page, id)
    await abrirPresupuesto(page)
    const { estimado, presupuesto } = porM2(page)

    // Nacen iguales porque la calculadora sembró exactamente ese supuesto.
    await expect(estimado).toHaveText('$8,000/m²')
    await expect(presupuesto).toHaveText('$8,000/m²')

    await enterEditMode(page)
    await expect(fieldInput(page, 'COSTO OBRA/m²')).toBeVisible()
    // El derivado sigue siendo texto incluso editando: no hay caja que lo teclee.
    await expect(presupuesto.locator('input')).toHaveCount(0)
  })

  test('separarse es el dato: subir el supuesto no toca el del presupuesto', async ({ page }) => {
    await gotoProperty(page, id)
    await abrirPresupuesto(page)
    const { estimado, presupuesto } = porM2(page)

    await enterEditMode(page)
    await setNumericField(page, 'COSTO OBRA/m²', '12000')
    await saveEdits(page)

    // $12,000 supuestos contra $8,000 presupuestados. Se leen, no se corrigen:
    // dicen cuánto se aleja el supuesto de lo que ya se lleva capturado.
    await expect(estimado).toHaveText('$12,000/m²')
    await expect(presupuesto).toHaveText('$8,000/m²')
  })

  test('el del presupuesto se mueve con los renglones, y el capturado se queda', async ({ page }) => {
    await gotoProperty(page, id)
    await abrirPresupuesto(page)
    await abrirCapitulo(page, 'Otros')
    const { estimado, presupuesto } = porM2(page)

    // Se lee antes en vez de fijarlo: así esta prueba no depende de si la de
    // arriba ya subió el supuesto, solo de que ESTA escritura no lo toque.
    const supuestoAntes = await estimado.textContent()

    const precio = page.getByLabel(`Precio unitario de ${SEMBRADO}`)
    await precio.click()
    await precio.fill('1000000')
    await soltarCelda(page)

    // 1,000,000 entre los 200 m² de la ficha.
    await expect(total(page)).toHaveText('$1,000,000')
    await expect(presupuesto).toHaveText('$5,000/m²')
    await expect(estimado).toHaveText(supuestoAntes ?? '')

    // Y recargando, porque el importe viejo sigue en pantalla un instante
    // después de soltar la celda: sin esto se estaría afirmando el repintado y
    // no el dato, y un total que no se movió pasaría de largo.
    await gotoProperty(page, id)
    await abrirPresupuesto(page)
    await expect(total(page)).toHaveText('$1,000,000')
  })
})

// ── El renglón sembrado, y el presupuesto vacío ──────────────────────────────

test.describe('El renglón que siembra la calculadora es uno como los demás', () => {
  let token: string
  let id: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    await deletePropertyByName(request, OBRA.name, token)
    id = (await createProperty(request, OBRA, token)).id
  })

  test.afterAll(async ({ request }) => {
    await deleteProperty(request, id, token)
  })

  test('nace con un solo renglón, cuyo nombre carga su propia aritmética', async ({ page }) => {
    await gotoProperty(page, id)
    await abrirPresupuesto(page)
    await expect(total(page)).toHaveText(SEMBRADO_TOTAL)

    await abrirCapitulo(page, 'Otros')
    await expect(page.getByLabel(/^Partida /)).toHaveCount(1)
    await expect(page.getByLabel(`Partida ${SEMBRADO}`)).toHaveValue(SEMBRADO)

    // Del modelo viejo no queda rastro: ni el renglón especial, ni el botón que
    // fijaba el total por fuera.
    await expect(page.getByText('Otros, por detallar')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'AJUSTAR' })).toHaveCount(0)
  })

  test('se teclea como cualquier otro, y el total lo sigue', async ({ page }) => {
    await gotoProperty(page, id)
    await abrirPresupuesto(page)
    await abrirCapitulo(page, 'Otros')

    // El residual no tenía caja de precio: su importe lo ponía una resta. Éste sí.
    const precio = page.getByLabel(`Precio unitario de ${SEMBRADO}`)
    await precio.click()
    await precio.fill('750000')
    await soltarCelda(page)

    await expect(total(page)).toHaveText('$750,000')

    // Recargando: el total es el dato guardado, no el que quedó en pantalla.
    await gotoProperty(page, id)
    await abrirPresupuesto(page)
    await expect(total(page)).toHaveText('$750,000')
  })

  /**
   * Va al final del bloque: deja la propiedad sin renglones, que es justo el
   * estado que afirma.
   */
  test('borrarlo se puede, y deja un presupuesto vacío que vale $0', async ({ page }) => {
    await gotoProperty(page, id)
    await abrirPresupuesto(page)
    await abrirCapitulo(page, 'Otros')

    // El residual traía guardia: «no se borra». Éste se borra con su ✕, como
    // cualquier renglón, porque ya no hay resta que proteger.
    await page.getByRole('button', { name: `Quitar ${SEMBRADO}`, exact: true }).click()

    await expect(page.getByLabel(/^Partida /)).toHaveCount(0)
    // Cero de verdad, no «—»: un presupuesto vacío es una respuesta, no un
    // faltante. Nadie ha cotizado nada todavía y eso vale $0.
    await expect(total(page)).toHaveText('$0')

    // Y sigue vacío al volver: el renglón se fue del presupuesto, no solo de
    // la pantalla. El residuo viejo ni siquiera ofrecía este ✕.
    await gotoProperty(page, id)
    await abrirPresupuesto(page)
    await expect(total(page)).toHaveText('$0')
    await expect(page.getByRole('button', { name: 'Abrir Otros', exact: true })).toHaveCount(0)
  })
})
