import { defineConfig, devices } from '@playwright/test'

/**
 * Accounts, end to end: the production build against the real API, Postgres and Mailpit
 * (the API's spring-boot-docker-compose starts both from apps/api/compose.yaml, so Docker
 * must be running). Sign-in links are read from Mailpit, like a person reading their inbox.
 *
 *   npm run e2e:account -w @kubelearn/web
 */
export const WEB = 'http://localhost:4174'
export const MAILPIT = 'http://localhost:8025'

export default defineConfig({
  testDir: './e2e-account',
  testMatch: '**/*.e2e.ts',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // each test signs in fresh accounts; they don't share state, but the sign-in limits are per IP
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { ...devices['Desktop Chrome'], baseURL: WEB, viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'cd ../api && ./mvnw -q -B spring-boot:run',
      url: 'http://localhost:8080/api/health',
      env: {
        PUBLIC_URL: WEB,
        // these tests sign in many times from one IP within minutes
        KUBELEARN_LIMITS_LINKSPEREMAIL: '1000',
        KUBELEARN_LIMITS_LINKSPERIP: '1000',
        KUBELEARN_LIMITS_VERIFIESPERIP: '1000',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
    {
      command: 'npm run build && npx vite preview --port 4174 --strictPort',
      url: WEB,
      env: { KUBELEARN_PREVIEW_API: '1' },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
})
