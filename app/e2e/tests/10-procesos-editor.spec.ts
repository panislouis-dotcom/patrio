/**
 * E2E tests for the Procesos editor features:
 *   - ProcesoTemplateEditor  (/procesos/plantillas/:tid)
 *   - ProcesoInstanceDetail  (/procesos/tareas/:iid)
 *   - ProcesoNodeDetail      (/procesos/tareas/:iid/nodos/:nid)
 */

import { test, expect } from '../fixtures/auth'
import {
  getToken,
  createTemplate,
  deleteTemplate,
  deleteTemplateByName,
  createTemplateNode,
  createInstance,
  deleteInstance,
  deleteInstanceByName,
} from '../helpers/api'

// ─── Shared test-data names ───────────────────────────────────────────────────

const TEMPLATE_NAME = '[TEST] Editor Plantilla E2E'
const INSTANCE_NAME = '[TEST] Instancia E2E'
const NODE_NAME = '[TEST-NODE] Sección Principal'

// ─── Template Editor ─────────────────────────────────────────────────────────

test.describe('ProcesoTemplateEditor', () => {
  let token: string
  let templateId: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    await deleteTemplateByName(request, TEMPLATE_NAME, token)
    const tpl = await createTemplate(request, TEMPLATE_NAME, token)
    templateId = tpl.id
  })

  test.afterAll(async ({ request }) => {
    // Delete the template (cascades nodes)
    await deleteTemplate(request, templateId, token)
  })

  test('template editor page loads for a known template', async ({ page }) => {
    await page.goto(`/procesos/plantillas/${templateId}`)
    // Should show the template name in the sidebar header
    await expect(page.getByText(TEMPLATE_NAME)).toBeVisible({ timeout: 10_000 })
  })

  test('back link "← PLANTILLAS" is visible in template editor', async ({ page }) => {
    await page.goto(`/procesos/plantillas/${templateId}`)
    await expect(page.getByText('← PLANTILLAS')).toBeVisible({ timeout: 8_000 })
  })

  test('"+ AGREGAR SECCIÓN" button is visible on empty template', async ({ page }) => {
    await page.goto(`/procesos/plantillas/${templateId}`)
    await expect(page.getByText('+ AGREGAR SECCIÓN')).toBeVisible({ timeout: 8_000 })
  })

  test('clicking "+ AGREGAR SECCIÓN" shows the node creation form with Nombre input', async ({ page }) => {
    await page.goto(`/procesos/plantillas/${templateId}`)
    await page.getByText('+ AGREGAR SECCIÓN').click()
    // AddNodeForm renders a "Nombre" placeholder input in node mode
    await expect(page.getByPlaceholder('Nombre')).toBeVisible({ timeout: 5_000 })
  })

  test('AddNodeForm: fill node name and Días, click OK → node appears in tree', async ({ page }) => {
    await page.goto(`/procesos/plantillas/${templateId}`)
    await page.getByText('+ AGREGAR SECCIÓN').click()

    await page.getByPlaceholder('Nombre').fill(NODE_NAME)
    await page.getByPlaceholder('Días').fill('5')
    // Submit with OK button inside the form
    await page.getByRole('button', { name: 'OK' }).first().click()

    // The node name must appear in the tree list
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })
  })

  test('node row shows EDITAR and BORRAR action buttons', async ({ page }) => {
    await page.goto(`/procesos/plantillas/${templateId}`)
    // Wait for node to load
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    // The action buttons are rendered inline next to each node row
    await expect(page.getByRole('button', { name: 'EDITAR' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'BORRAR' })).toBeVisible()
  })

  test('clicking EDITAR opens inline edit form with name input pre-filled', async ({ page }) => {
    await page.goto(`/procesos/plantillas/${templateId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    await page.getByRole('button', { name: 'EDITAR' }).first().click()

    // The inline edit renders an input pre-filled with the node name
    const nameInput = page.locator('input').first()
    await expect(nameInput).toHaveValue(NODE_NAME, { timeout: 5_000 })
  })

  test('inline EDITAR: cancel with ✕ closes form without saving', async ({ page }) => {
    await page.goto(`/procesos/plantillas/${templateId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    await page.getByRole('button', { name: 'EDITAR' }).first().click()
    // The cancel button is labelled ✕
    await page.getByRole('button', { name: '✕' }).first().click()

    // Node name still visible — form closed without navigation
    await expect(page.getByText(NODE_NAME).first()).toBeVisible()
  })

  test('clicking node name navigates to focused view (right panel shows DESCRIPCIÓN)', async ({ page }) => {
    await page.goto(`/procesos/plantillas/${templateId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    // Click the node name span (onClick → onFocus)
    await page.getByText(NODE_NAME).first().click()

    // Right panel shows DESCRIPCIÓN label and a textarea
    await expect(page.getByText('DESCRIPCIÓN')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByPlaceholder('Instrucciones, contexto, criterios de éxito…')).toBeVisible()
  })

  test('clicking BORRAR deletes node — node no longer appears in tree', async ({ page }) => {
    await page.goto(`/procesos/plantillas/${templateId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    await page.getByRole('button', { name: 'BORRAR' }).first().click()

    // After deletion the node should disappear from the tree entirely (0 matches)
    await expect(page.getByText(NODE_NAME)).toHaveCount(0, { timeout: 8_000 })
  })

  test('Gantt preview text "VISTA PREVIA DEL PROCESO" is shown on right panel', async ({ page }) => {
    await page.goto(`/procesos/plantillas/${templateId}`)
    await expect(page.getByText('VISTA PREVIA DEL PROCESO (HIPOTÉTICA)')).toBeVisible({ timeout: 8_000 })
  })
})

// ─── Instance Detail ──────────────────────────────────────────────────────────

test.describe('ProcesoInstanceDetail', () => {
  let token: string
  let templateId: number
  let instanceId: number
  let nodeId: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    await deleteInstanceByName(request, INSTANCE_NAME, token)
    await deleteTemplateByName(request, TEMPLATE_NAME + ' INST', token)

    // Create a template with one leaf node so the instance has template nodes
    const tpl = await createTemplate(request, TEMPLATE_NAME + ' INST', token)
    templateId = tpl.id

    const node = await createTemplateNode(request, templateId, NODE_NAME, token, { durationDays: 3 })
    nodeId = node.id

    const inst = await createInstance(request, INSTANCE_NAME, templateId, token)
    instanceId = inst.id
  })

  test.afterAll(async ({ request }) => {
    // Instance deletion may cascade; delete instance first then template
    await deleteInstance(request, instanceId, token)
    await deleteTemplate(request, templateId, token)
  })

  test('instance detail page loads with instance name in header', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await expect(page.getByText(INSTANCE_NAME)).toBeVisible({ timeout: 10_000 })
  })

  test('"← TAREAS" back button is visible on instance detail page', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await expect(page.getByText('← TAREAS')).toBeVisible({ timeout: 8_000 })
  })

  test('"← TAREAS" navigates back to /procesos/tareas', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await page.getByText('← TAREAS').click()
    await expect(page).toHaveURL(/\/procesos\/tareas$/, { timeout: 8_000 })
  })

  test('ESTADO DE TAREAS section header is visible', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await expect(page.getByText('ESTADO DE TAREAS')).toBeVisible({ timeout: 8_000 })
  })

  test('task table renders column headers: TAREA, ESTADO, RESPONSABLE', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await expect(page.getByText('TAREA', { exact: true })).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText('ESTADO', { exact: true })).toBeVisible()
    await expect(page.getByText('RESPONSABLE', { exact: true })).toBeVisible()
  })

  test('node row is visible in task table with status dropdown', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    // Status dropdown defaults to Pendiente (filter by presence of pending option to skip owner select)
    const statusSelect = page.locator('select').filter({ has: page.locator('option[value="pending"]') }).first()
    await expect(statusSelect).toBeVisible()
    await expect(statusSelect).toHaveValue('pending')
  })

  test('status dropdown contains all four options with Spanish labels', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    const statusSelect = page.locator('select').filter({ has: page.locator('option[value="pending"]') }).first()
    // Verify the Spanish label options from PROCESS_STATUS_LABEL
    await expect(statusSelect.locator('option[value="pending"]')).toHaveText('Pendiente')
    await expect(statusSelect.locator('option[value="in_progress"]')).toHaveText('En progreso')
    await expect(statusSelect.locator('option[value="done"]')).toHaveText('Completado')
    await expect(statusSelect.locator('option[value="skipped"]')).toHaveText('Omitido')
  })

  test('clicking node name in task table navigates to ProcesoNodeDetail', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    // Click the span specifically (not the wrapping div) — the span has the navigate onClick
    await page.locator('span').filter({ hasText: NODE_NAME }).first().click()
    await expect(page).toHaveURL(
      new RegExp(`/procesos/tareas/${instanceId}/nodos/${nodeId}`),
      { timeout: 8_000 },
    )
  })

  test('NOTAS textarea is visible on instance detail page', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    // The instance detail shows a NOTAS section with a textarea
    await expect(page.getByText('NOTAS')).toBeVisible({ timeout: 8_000 })
    await expect(page.getByPlaceholder('Notas, contexto, decisiones…')).toBeVisible()
  })

  test('NOTAS: typing in textarea and blurring saves (field persists on reload)', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await expect(page.getByPlaceholder('Notas, contexto, decisiones…')).toBeVisible({ timeout: 8_000 })

    const textarea = page.getByPlaceholder('Notas, contexto, decisiones…')
    await textarea.fill('Nota de prueba E2E')
    // Blur to trigger onBlur save
    await textarea.blur()

    // Reload and verify the note persisted
    await page.reload()
    await expect(page.getByPlaceholder('Notas, contexto, decisiones…')).toHaveValue(
      'Nota de prueba E2E',
      { timeout: 8_000 },
    )
  })

  test('instance status badge shows "ACTIVE" text', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await expect(page.getByText('ACTIVE')).toBeVisible({ timeout: 8_000 })
  })

  test('instance header shows Inicio and Vence date inputs', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await expect(page.getByText('Inicio:')).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText('Vence:')).toBeVisible()
    // First two date inputs on the page are startDate and dueDate
    await expect(page.locator('input[type="date"]').first()).toBeVisible()
  })

  test('task table shows INICIO REAL and FIN REAL column headers', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await expect(page.getByText('INICIO REAL', { exact: true })).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText('FIN REAL', { exact: true })).toBeVisible()
  })

  test('changing node status to in_progress persists on reload', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    const statusSelect = page.locator('select').filter({ has: page.locator('option[value="pending"]') }).first()
    await statusSelect.selectOption('in_progress')

    await page.reload()
    await expect(
      page.locator('select').filter({ has: page.locator('option[value="in_progress"]') }).first()
    ).toHaveValue('in_progress', { timeout: 8_000 })
  })

  test('setting node actualStart date persists on reload', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    // actualStart is the first date input inside the node's table row
    const nodeRow = page.locator('tr').filter({ hasText: NODE_NAME })
    const actualStartInput = nodeRow.locator('input[type="date"]').nth(0)
    await expect(actualStartInput).toBeVisible()

    await actualStartInput.evaluate((el: HTMLInputElement) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      nativeSetter.call(el, '2025-07-01')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await page.reload()
    const persistedRow = page.locator('tr').filter({ hasText: NODE_NAME })
    await expect(persistedRow.locator('input[type="date"]').nth(0)).toHaveValue('2025-07-01', { timeout: 8_000 })
  })
})

// ─── Node Detail ──────────────────────────────────────────────────────────────

test.describe('ProcesoNodeDetail', () => {
  let token: string
  let templateId: number
  let instanceId: number
  let nodeId: number

  test.beforeAll(async ({ request }) => {
    token = await getToken(request)
    await deleteInstanceByName(request, INSTANCE_NAME + ' NODE', token)
    await deleteTemplateByName(request, TEMPLATE_NAME + ' NODE', token)

    const tpl = await createTemplate(request, TEMPLATE_NAME + ' NODE', token)
    templateId = tpl.id

    const node = await createTemplateNode(request, templateId, NODE_NAME, token, { durationDays: 2 })
    nodeId = node.id

    const inst = await createInstance(request, INSTANCE_NAME + ' NODE', templateId, token)
    instanceId = inst.id
  })

  test.afterAll(async ({ request }) => {
    await deleteInstance(request, instanceId, token)
    await deleteTemplate(request, templateId, token)
  })

  test('node detail page loads with node name as heading', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}/nodos/${nodeId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 10_000 })
  })

  test('back button shows instance name and navigates back', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}/nodos/${nodeId}`)
    // Back button text is "← {instanceName.toUpperCase()}"
    const backBtn = page.getByText(`← ${(INSTANCE_NAME + ' NODE').toUpperCase()}`)
    await expect(backBtn).toBeVisible({ timeout: 8_000 })
    await backBtn.click()
    await expect(page).toHaveURL(
      new RegExp(`/procesos/tareas/${instanceId}$`),
      { timeout: 8_000 },
    )
  })

  test('ESTADO DE TAREAS table visible with status dropdown for the node', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}/nodos/${nodeId}`)
    await expect(page.getByText('ESTADO DE TAREAS')).toBeVisible({ timeout: 8_000 })
    const statusSelect = page.locator('select[value="pending"], select').first()
    await expect(statusSelect).toBeVisible()
  })

  test('NOTAS textarea is present with placeholder "Notas sobre esta tarea…"', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}/nodos/${nodeId}`)
    await expect(page.getByPlaceholder('Notas sobre esta tarea…')).toBeVisible({ timeout: 8_000 })
  })

  test('COMENTARIOS section is present with "NUEVO COMENTARIO" label', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}/nodos/${nodeId}`)
    await expect(page.getByText('COMENTARIOS').first()).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText('NUEVO COMENTARIO')).toBeVisible()
  })

  test('comment form: fill author + body, click PUBLICAR → comment appears', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}/nodos/${nodeId}`)
    await expect(page.getByText('NUEVO COMENTARIO')).toBeVisible({ timeout: 8_000 })

    await page.getByPlaceholder('Tu nombre').fill('Tester E2E')
    await page.getByPlaceholder('Escribe un comentario…').fill('Comentario de prueba automatizada')
    await page.getByRole('button', { name: 'PUBLICAR' }).click()

    // Comment body should appear in the comment list
    await expect(page.getByText('Comentario de prueba automatizada')).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText('Tester E2E')).toBeVisible()
  })

  test('task table shows PROVEEDOR column header', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}/nodos/${nodeId}`)
    await expect(page.getByText('PROVEEDOR', { exact: true })).toBeVisible({ timeout: 8_000 })
  })

  test('PROVEEDOR select default option is "— Sin proveedor"', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}/nodos/${nodeId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    // Row select order: 0=ESTADO, 1=RESPONSABLE (— Sin asignar), 2=PROVEEDOR (— Sin proveedor)
    const nodeRow = page.locator('tr').filter({ hasText: NODE_NAME })
    const supplierSelect = nodeRow.locator('select').nth(2)
    await expect(supplierSelect).toBeVisible()
    await expect(nodeRow.locator('option').filter({ hasText: '— Sin proveedor' })).toBeAttached()
  })

  test('changing node status to done persists on reload', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}/nodos/${nodeId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    const statusSelect = page.locator('select').filter({ has: page.locator('option[value="pending"]') }).first()
    await statusSelect.selectOption('done')

    await page.reload()
    await expect(
      page.locator('select').filter({ has: page.locator('option[value="done"]') }).first()
    ).toHaveValue('done', { timeout: 8_000 })
  })

  test('setting node actualStart date persists on reload', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}/nodos/${nodeId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    const nodeRow = page.locator('tr').filter({ hasText: NODE_NAME })
    const actualStartInput = nodeRow.locator('input[type="date"]').nth(0)
    await expect(actualStartInput).toBeVisible()

    await actualStartInput.evaluate((el: HTMLInputElement) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      nativeSetter.call(el, '2025-08-01')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await page.reload()
    const persistedRow = page.locator('tr').filter({ hasText: NODE_NAME })
    await expect(persistedRow.locator('input[type="date"]').nth(0)).toHaveValue('2025-08-01', { timeout: 8_000 })
  })

  test('setting node actualEnd date persists on reload', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}/nodos/${nodeId}`)
    await expect(page.getByText(NODE_NAME).first()).toBeVisible({ timeout: 8_000 })

    const nodeRow = page.locator('tr').filter({ hasText: NODE_NAME })
    const actualEndInput = nodeRow.locator('input[type="date"]').nth(1)
    await expect(actualEndInput).toBeVisible()

    await actualEndInput.evaluate((el: HTMLInputElement) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      nativeSetter.call(el, '2025-09-15')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await page.reload()
    const persistedRow = page.locator('tr').filter({ hasText: NODE_NAME })
    await expect(persistedRow.locator('input[type="date"]').nth(1)).toHaveValue('2025-09-15', { timeout: 8_000 })
  })

  test('NOTAS textarea persists on reload', async ({ page }) => {
    await page.goto(`/procesos/tareas/${instanceId}/nodos/${nodeId}`)
    const textarea = page.getByPlaceholder('Notas sobre esta tarea…')
    await expect(textarea).toBeVisible({ timeout: 8_000 })

    await textarea.fill('Notas nodo E2E persistencia')
    await textarea.blur()

    await page.reload()
    await expect(page.getByPlaceholder('Notas sobre esta tarea…')).toHaveValue(
      'Notas nodo E2E persistencia',
      { timeout: 8_000 },
    )
  })
})
