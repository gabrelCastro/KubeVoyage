import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end checks of the flows that matter, against the production build.
 * Run with `npm run e2e -w @kubelearn/web` (builds first).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: '**/phone.e2e.ts' },
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' }, testMatch: '**/phone.e2e.ts' },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
