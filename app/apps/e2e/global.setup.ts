import { test as setup } from '@playwright/test'
import path from 'path'
import { API_BASE } from './helpers/api'

const AUTH_FILE = path.join(__dirname, '.auth/user.json')
const APP_BASE = process.env.E2E_APP_BASE_URL ?? 'http://localhost:5173'

setup('authenticate', async ({ page }) => {
  const email = process.env.E2E_USER
  const password = process.env.E2E_PASS
  if (!email || !password) throw new Error('E2E_USER and E2E_PASS env vars must be set')

  const response = await page.request.post(`${API_BASE}/api/auth/login`, {
    data: { email, password },
  })

  if (!response.ok()) {
    throw new Error(`E2E login failed (${response.status()}). Is the stack running?`)
  }

  const { access_token } = (await response.json()) as { access_token: string }

  await page.goto(APP_BASE)
  await page.evaluate((token: string) => localStorage.setItem('token', token), access_token)
  await page.context().storageState({ path: AUTH_FILE })
})
