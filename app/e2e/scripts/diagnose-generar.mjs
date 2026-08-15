// Diagnóstico: «le piqué y no pasó nada».
// Instrumenta cada capa —estado del botón, consola, red con tiempos— para saber
// DÓNDE se rompe antes de proponer un arreglo. Los selectores no dependen del
// texto del botón porque ese texto cambia justo cuando arranca el trabajo.
import { chromium } from '@playwright/test'

const WEB = process.env.WEB ?? 'http://localhost:5174'
const EMAIL = process.env.E2E_USER
const PASS = process.env.E2E_PASS
const t0 = Date.now()
const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })

const consola = []
const red = []
page.on('console', m => { if (m.type() === 'error') consola.push(m.text()) })
page.on('pageerror', e => consola.push('PAGEERROR: ' + String(e)))
page.on('request', r => { if (/\/renders/.test(r.url())) red.push(`${ms()} → ${r.method()} ${r.url().replace(WEB, '')}`) })
page.on('response', r => { if (/\/renders/.test(r.url())) red.push(`${ms()} ← ${r.status()}`) })
page.on('requestfailed', r => { if (/\/renders/.test(r.url())) red.push(`${ms()} ✗ ${r.failure()?.errorText}`) })

await page.goto(WEB)
await page.locator('input[type=email]').first().fill(EMAIL)
await page.locator('input[type=password]').first().fill(PASS)
await page.locator('button[type=submit]').first().click()
await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 20000 })
await page.goto(`${WEB}/propiedades/1`)
// RENDERS ya no es pestaña de nivel superior (Tarea 16): vive en FOTOS.
await page.getByRole('button', { name: 'FOTOS' }).click()
await page.getByText('RENDERS', { exact: true }).click()
await page.getByLabel(/preset/i).waitFor({ timeout: 10000 })

// Selector estable: el último botón de la fila de acciones, sea cual sea su texto.
const accion = page.locator('button').filter({ hasText: /GENERA/i }).last()
const estado = async () => ({
  texto: (await accion.textContent())?.trim(),
  deshabilitado: await accion.isDisabled(),
})

const alLlegar = await estado()
const tarjetasAntes = await page.locator('figure').count()

// El usuario elige preset y le pica SIN elegir foto.
await page.getByLabel(/preset/i).selectOption({ label: 'Jardín regional (xeriscape)' })
const trasPreset = await estado()
await accion.click({ force: true }).catch(e => consola.push('CLICK: ' + e.message))
await page.waitForTimeout(1200)
const trasClickSinFoto = { ...(await estado()), peticiones: red.length }

// Ahora elige foto y le pica de verdad.
await page.locator('img[alt$=".jpg"]').first().click()
const trasElegirFoto = await estado()
const tClick = Date.now()
await accion.click()

// Seguimiento segundo a segundo de lo que ve el usuario.
const linea = []
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000)
  const e = await estado()
  const n = await page.locator('figure').count()
  if (i < 3 || n !== tarjetasAntes || i % 15 === 0) {
    linea.push(`${ms()} boton="${e.texto}" tarjetas=${n}`)
  }
  if (n !== tarjetasAntes) break
}
const segundos = ((Date.now() - tClick) / 1000).toFixed(1)
const tarjetasDespues = await page.locator('figure').count()

await browser.close()
console.log(JSON.stringify({
  alLlegar, trasPreset, trasClickSinFoto, trasElegirFoto,
  segundosHastaQueAparecio: segundos,
  tarjetasAntes, tarjetasDespues,
  lineaDeTiempo: linea,
  red,
  erroresDeConsola: consola,
}, null, 2))
