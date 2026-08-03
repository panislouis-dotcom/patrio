import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/**
 * Selectors for the in-place edit model of the property detail page: one header
 * toggles the whole left column between viewing and editing, and GUARDAR ▸ /
 * CANCELAR only exist while there are pending edits.
 *
 * Writing has exactly three doors, and each has its own helper here:
 *   · PATCH  — type into a row and `saveEdits`; an empty box means "leave it".
 *   · clear-fields — `clearField`, the ✕ beside the box, applied immediately.
 *   · transition — `advanceTo`, which opens the stage's gate modal.
 */

/**
 * Opens a property's detail page and waits for it to actually be one.
 *
 * The page renders "Cargando…" until the property and its geometry both
 * resolve, so an assertion fired straight after `goto` is racing that fetch
 * rather than the thing it means to check. Under load that race is lost often
 * enough to matter, and it fails as "element not found" — which reads like the
 * element is wrong rather than absent. Every test here means "given this
 * property's page is open, …"; this is that precondition, stated once.
 */
export async function gotoProperty(page: Page, id: number): Promise<void> {
  await page.goto(`/propiedades/${id}`)
  await expect(page.getByRole('button', { name: 'EDITAR', exact: true })).toBeVisible({ timeout: 15_000 })
}

/**
 * The row a detail page renders for `label`.
 *
 * EditableRow puts the label in its own span, so the span's parent is the row —
 * it carries the value in view mode, the input in edit mode, and any hint
 * ("CALCULADA DEL DESGLOSE", "DERIVADO DE FECHAS") in both.
 */
export function detailRow(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true }).first().locator('..')
}

/** The box a row swaps its value for while editing — named by its aria-label. */
export function fieldInput(page: Page, label: string): Locator {
  return page.getByLabel(label, { exact: true })
}

/**
 * Replaces a numeric field's value.
 *
 * NumericInput rewrites its own value on focus (thousands-separated → raw), so
 * a plain `fill()` races that re-render: the click focuses, Playwright selects
 * the text, React swaps the value underneath and drops the selection, and the
 * typed digits land appended instead of replacing. Focusing, clearing and only
 * then filling leaves nothing for the re-render to fight over.
 */
export async function setNumericField(page: Page, label: string, value: string): Promise<void> {
  const input = fieldInput(page, label)
  await input.click()
  await input.fill('')
  await input.fill(value)
  await expect(input).toHaveValue(value)
}

export async function enterEditMode(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'EDITAR', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'VER', exact: true })).toBeVisible()
}

/** Saves the pending edits and waits for the header button to retire. */
export async function saveEdits(page: Page): Promise<void> {
  const guardar = page.getByRole('button', { name: /GUARDAR/ })
  await expect(guardar).toBeVisible()
  await guardar.click()
  await expect(guardar).not.toBeVisible()
}

/**
 * Empties a field through POST /clear-fields — the ✕ next to the box. It applies
 * on click, without a GUARDAR, because emptying is its own operation and not a
 * pending edit.
 */
export async function clearField(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: `Vaciar ${label}`, exact: true }).click()
}

/**
 * Opens the AVANZAR A ▸ menu and picks a destination stage, revealing its gate.
 *
 * Assumes the page is loaded — `gotoProperty` is what guarantees that, and every
 * caller goes through it. This used to re-assert the load itself, from back when
 * the wait lived nowhere: the destinations are computed from the status, so a
 * menu opened mid-fetch is one the next render throws away. Now that the wait
 * has one home, repeating it here only meant failing earlier, with a worse
 * message, and against a shorter timeout than the real precondition uses.
 */
export async function advanceTo(page: Page, stageLabel: string): Promise<void> {
  await page.getByRole('button', { name: 'AVANZAR A ▸' }).click()
  await page.getByRole('button', { name: stageLabel, exact: true }).click()
}

/** The confirm button of the gate modal — labelled with the destination stage. */
export function confirmTransition(page: Page, stageLabel: string): Locator {
  return page.getByRole('button', { name: `${stageLabel} ▸`, exact: true })
}
