// Verificación manual de RENDERS contra el stack levantado en 5174/8010.
// No es parte de la suite: es la prueba de que la pestaña pinta de verdad en un
// navegador antes de decir que está lista.
// RENDERS ya no es pestaña de nivel superior (Tarea 16): las propuestas nacidas
// de una foto viven en la sub-navegación GALERÍA | RENDERS, dentro de FOTOS.
import { chromium } from '@playwright/test'

const WEB = process.env.WEB ?? 'http://localhost:5174'
const EMAIL = process.env.E2E_USER
const PASS = process.env.E2E_PASS
const OUT = process.env.OUT ?? '/tmp/renders-tab.png'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))

await page.goto(WEB)
await page.getByLabel(/email/i).or(page.locator('input[type=email]')).first().fill(EMAIL)
await page.locator('input[type=password]').first().fill(PASS)
await page.locator('button[type=submit]').first().click()
await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 20000 })

await page.goto(`${WEB}/propiedades/1`)
await page.getByRole('button', { name: 'FOTOS' }).click()
await page.getByText('RENDERS', { exact: true }).click()

await page.getByLabel(/preset/i).waitFor({ timeout: 10000 })
const presets = await page.getByLabel(/preset/i).locator('option').allTextContents()
const promptBox = page.getByLabel(/texto del prompt/i)

// Elegir el preset de jardín debe llenar el textarea.
await page.getByLabel(/preset/i).selectOption({ label: 'Jardín regional (xeriscape)' })
const filled = await promptBox.inputValue()

const marks = await page.getByText(/Propuesta · no es una foto/i).count()
const thumbs = await page.locator('img[alt$=".jpg"]').count()

await page.screenshot({ path: OUT, fullPage: false })
await browser.close()

console.log(JSON.stringify({
  presets: presets.length,
  presetLlenaTextarea: filled.slice(0, 45) + '…',
  miniaturasDeFotos: thumbs,
  marcasDePropuesta: marks,
  erroresDeConsola: errors,
}, null, 2))
