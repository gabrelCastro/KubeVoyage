import { test as base, expect, type Page } from '@playwright/test'

/**
 * Every test starts as a returning learner (no tour, no tips) and fails on any uncaught
 * error or console error — the API isn't running, so its connection errors are expected.
 */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, provide) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error' && !/\/api\/|Failed to load resource|ECONNREFUSED/.test(m.text())) errors.push(m.text())
    })
    await page.addInitScript(() => localStorage.setItem('kubelearn.onboarding.v1', JSON.stringify({ tour: 'done', tips: ['pausa', 'paleta', 'apostila', 'app'] })))
    await provide(errors)
    expect(errors, 'no errors in the page').toEqual([])
  },
})

export { expect }

export async function kubectl(page: Page, command: string) {
  const input = page.locator('[data-terminal-input]')
  await input.fill(command)
  await input.press('Enter')
}

/** Run the cluster at 2× so waits stay short. */
export async function fast(page: Page) {
  await page.getByRole('radio', { name: '2×' }).click()
}

export const terminal = (page: Page) => page.getByRole('region', { name: 'Terminal' })
