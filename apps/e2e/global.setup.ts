import { test as setup } from '@playwright/test'
import path from 'path'

const AUTH_FILE = path.join(__dirname, '.auth/user.json')

setup('authenticate', async ({ page }) => {
  const response = await page.request.post('http://localhost:8000/api/auth/login', {
    data: {
      email: process.env.E2E_USER ?? 'test@refigan.com',
      password: process.env.E2E_PASS ?? 'testpassword',
    },
  })

  if (!response.ok()) {
    throw new Error(
      `E2E login failed (${response.status()}). Is the stack running? ` +
      `Set E2E_USER and E2E_PASS env vars if credentials differ from defaults.`
    )
  }

  const { access_token } = (await response.json()) as { access_token: string }

  await page.goto('http://localhost:5173')
  await page.evaluate((token: string) => localStorage.setItem('token', token), access_token)
  await page.context().storageState({ path: AUTH_FILE })
})
