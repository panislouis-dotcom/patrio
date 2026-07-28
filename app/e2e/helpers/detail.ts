import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/**
 * Selectors for the in-place edit model shared by the project and prospect
 * detail pages: one header toggles the whole left column between viewing and
 * editing, and GUARDAR ▸ / CANCELAR only exist while there are pending edits.
 */

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
