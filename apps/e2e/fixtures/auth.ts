import { test as base } from '@playwright/test'

const API_BASE = 'http://localhost:8000'
const APP_BASE = 'http://localhost:5173'

let cachedToken: string | null = null

export const test = base.extend({
  page: async ({ page }, use) => {
    if (!cachedToken) {
      const res = await page.request.post(`${API_BASE}/api/auth/login`, {
        data: {
          email: process.env.E2E_USER ?? 'test@refigan.com',
          password: process.env.E2E_PASS ?? 'testpassword',
        },
      })
      if (!res.ok()) throw new Error(`Auth fixture login failed: ${res.status()}`)
      const json = (await res.json()) as { access_token: string }
      cachedToken = json.access_token
    }
    await page.goto(APP_BASE)
    await page.evaluate((token: string) => localStorage.setItem('token', token), cachedToken!)
    await use(page)
  },
})

export { expect } from '@playwright/test'
