import { test, expect } from '@playwright/test'

// Auth tests must start unauthenticated
test.use({ storageState: { cookies: [], origins: [] } })

const E2E_EMAIL = process.env.E2E_USER ?? 'test@refigan.com'
const E2E_PASS = process.env.E2E_PASS
if (!E2E_PASS) throw new Error('E2E_PASS env var must be set')

test('unauthenticated / redirects to /login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('unauthenticated /prospectos/tabla redirects to /login', async ({ page }) => {
  await page.goto('/prospectos/tabla')
  await expect(page).toHaveURL(/\/login/)
})

test('login with wrong credentials shows error', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill('wrong@example.com')
  await page.locator('input[type="password"]').fill('wrongpassword')
  await page.locator('button[type="submit"]').click()
  await expect(page.getByText('Correo o contraseña incorrectos')).toBeVisible()
})

test('login success redirects to prospectos', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(E2E_EMAIL)
  await page.locator('input[type="password"]').fill(E2E_PASS)
  // Use explicit button selector — getByText could match other elements if React hasn't updated
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/prospectos\/tabla/, { timeout: 10_000 })
  await expect(page.locator('a', { hasText: 'PROSPECTOS' })).toBeVisible()
})

test('SALIR button logs out and redirects to /login', async ({ page }) => {
  // First log in
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(E2E_EMAIL)
  await page.locator('input[type="password"]').fill(E2E_PASS)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/prospectos\/tabla/, { timeout: 10_000 })
  // SALIR is always visible in the tab bar — click directly
  await page.getByRole('button', { name: 'SALIR' }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})

test('change password panel opens', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(E2E_EMAIL)
  await page.locator('input[type="password"]').fill(E2E_PASS)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/prospectos\/tabla/, { timeout: 10_000 })
  // Open settings gear dropdown
  await page.locator('button[title="Configuración"]').click()
  await expect(page.getByPlaceholder('Contraseña actual')).toBeVisible()
  await expect(page.getByPlaceholder('Nueva contraseña')).toBeVisible()
})
