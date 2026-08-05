import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000'
const externalReadOnlyOnly =
  process.env.ACACIA_READONLY_EXTERNAL_ONLY === '1'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: externalReadOnlyOnly
    ? undefined
    : {
        command: 'cd ../.. && npm run local:start',
        url: `${baseURL}/auth/login`,
        reuseExistingServer: true,
        timeout: 240_000,
      },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
})
