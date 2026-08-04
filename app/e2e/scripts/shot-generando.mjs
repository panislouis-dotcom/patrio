// Captura lo que ve el usuario en los dos momentos que antes se leían como
// «no pasó nada»: (1) al llegar, sin foto elegida; (2) a mitad de la generación.
import { chromium } from '@playwright/test'

const WEB = process.env.WEB ?? 'http://localhost:5174'
const DIR = process.env.DIR ?? '/tmp'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })

await page.goto(WEB)
await page.locator('input[type=email]').first().fill(process.env.E2E_USER)
await page.locator('input[type=password]').first().fill(process.env.E2E_PASS)
await page.locator('button[type=submit]').first().click()
await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 20000 })
await page.goto(`${WEB}/propiedades/1`)
await page.getByText('RENDERS', { exact: true }).click()
await page.getByLabel(/preset/i).waitFor({ timeout: 10000 })

// (1) Sin foto elegida: ¿el botón dice qué le falta?
await page.getByLabel(/preset/i).selectOption({ label: 'Jardín regional (xeriscape)' })
const pista = await page.getByText(/elige una foto base/i).count()
await page.screenshot({ path: `${DIR}/sin-foto.png`, clip: { x: 360, y: 500, width: 1080, height: 200 } })

// (2) A mitad de la generación: ¿la lista muestra algo?
await page.locator('img[alt$=".jpg"]').first().click()
const pistaTrasElegir = await page.getByText(/elige una foto base/i).count()
await page.getByRole('button', { name: /GENERAR RENDER/i }).click()
await page.waitForTimeout(4000)
const enProgreso = await page.getByText(/generando render/i).count()
const aviso = await page.getByText(/puede tardar/i).count()
await page.screenshot({ path: `${DIR}/generando.png`, clip: { x: 360, y: 520, width: 1080, height: 330 } })

await browser.close()
console.log(JSON.stringify({
  pistaSinFoto: pista, pistaTrasElegirFoto: pistaTrasElegir,
  tarjetaEnProgreso: enProgreso, avisoDeDuracion: aviso,
}, null, 2))
