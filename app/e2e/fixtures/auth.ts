import { test as base } from '@playwright/test'
import { API_BASE } from '../helpers/api'

const APP_BASE = process.env.E2E_APP_BASE_URL ?? 'http://localhost:5173'

let cachedToken: string | null = null

export const test = base.extend({
  page: async ({ page }, use) => {
    if (!cachedToken) {
      const password = process.env.E2E_PASS
      if (!password) throw new Error('E2E_PASS env var must be set')
      const res = await page.request.post(`${API_BASE}/api/auth/login`, {
        data: {
          email: process.env.E2E_USER ?? 'test@refigan.com',
          password,
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
