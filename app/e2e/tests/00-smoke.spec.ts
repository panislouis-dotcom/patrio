import { test, expect, request } from '@playwright/test'

// Smoke tests target whatever BASE_URL is set to.
// In prod CI: BASE_URL=https://admin.refigan.com
// In local dev: BASE_URL=http://localhost:5173 (default from playwright.config.ts)
//
// API_BASE_URL is separate because in local dev the API runs on a different port.
// In prod both frontend and API are served from the same origin (FastAPI serves the SPA).
const API_BASE =
  process.env.API_BASE_URL ??
  (process.env.BASE_URL
    ? process.env.BASE_URL.replace(':5173', ':8000')
    : 'http://localhost:8000')

const E2E_EMAIL = process.env.E2E_USER ?? 'test@refigan.com'
const E2E_PASS = process.env.E2E_PASS
if (!E2E_PASS) throw new Error('E2E_PASS env var must be set')

// Smoke tests always start unauthenticated
test.use({ storageState: { cookies: [], origins: [] } })

// ── 1. Health ─────────────────────────────────────────────────────────────────
test('GET /health returns 200 with status ok', async () => {
  const ctx = await request.newContext({ baseURL: API_BASE })
  const res = await ctx.get('/health')
  expect(res.status()).toBe(200)
  const body = await res.json() as { status: string }
  expect(body.status).toBe('ok')
  await ctx.dispose()
})

// ── 2. Root redirect ──────────────────────────────────────────────────────────
test('unauthenticated / redirects to /login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

// ── 3. Login page structure ───────────────────────────────────────────────────
test('/login page loads with email and password inputs', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})

// ── 4. Login success ──────────────────────────────────────────────────────────
test('login with valid credentials redirects to /propiedades', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(E2E_EMAIL)
  await page.locator('input[type="password"]').fill(E2E_PASS)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/propiedades/, { timeout: 10_000 })
})

// ── 5. Nav visible after login ────────────────────────────────────────────────
test('PROPIEDADES nav link is visible after login', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(E2E_EMAIL)
  await page.locator('input[type="password"]').fill(E2E_PASS)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/propiedades/, { timeout: 10_000 })
  await expect(page.locator('a', { hasText: 'PROPIEDADES' }).first()).toBeVisible()
})

// ── 6. API /api/properties returns 200 with auth ──────────────────────────────
test('GET /api/properties returns 200 with valid Authorization header', async () => {
  const ctx = await request.newContext({ baseURL: API_BASE })

  // Obtain token via login endpoint
  const loginRes = await ctx.post('/api/auth/login', {
    data: { email: E2E_EMAIL, password: E2E_PASS },
  })
  expect(loginRes.status()).toBe(200)
  const { access_token } = (await loginRes.json()) as { access_token: string }

  // Hit the protected endpoint
  const propertiesRes = await ctx.get('/api/properties', {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  expect(propertiesRes.status()).toBe(200)

  await ctx.dispose()
})

// ── 7. The old two-entity surface is gone, not redirected ─────────────────────
// The merge gave every property a fresh id, so a preserved /prospects/19 would
// answer about a different building. A 404 is the honest answer.
test('GET /api/prospects and /api/projects are gone', async () => {
  const ctx = await request.newContext({ baseURL: API_BASE })
  const loginRes = await ctx.post('/api/auth/login', {
    data: { email: E2E_EMAIL, password: E2E_PASS },
  })
  const { access_token } = (await loginRes.json()) as { access_token: string }
  const headers = { Authorization: `Bearer ${access_token}` }

  expect((await ctx.get('/api/prospects', { headers })).status()).toBe(404)
  expect((await ctx.get('/api/projects', { headers })).status()).toBe(404)

  await ctx.dispose()
})

// ── 8. Logout ─────────────────────────────────────────────────────────────────
test('SALIR button logs out and redirects to /login', async ({ page }) => {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(E2E_EMAIL)
  await page.locator('input[type="password"]').fill(E2E_PASS)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/propiedades/, { timeout: 10_000 })

  // SALIR is always visible in the tab bar — click directly
  await page.getByRole('button', { name: 'SALIR' }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})
