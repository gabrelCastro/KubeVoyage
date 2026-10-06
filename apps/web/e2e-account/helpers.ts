import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { MAILPIT, WEB } from '../playwright.account.config'

/** A fresh address per account, so tests never see each other's mail or data. */
export const newEmail = (who: string) => `${who}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemplo.com`

const ONBOARDED = JSON.stringify({ tour: 'done', tips: ['pausa', 'paleta', 'apostila', 'app'] })

/** A browser profile of its own (its own storage and cookies): one "device". */
export async function device(browser: Browser): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext()
  await ctx.addInitScript((v) => localStorage.setItem('kubelearn.onboarding.v1', v), ONBOARDED)
  const page = await ctx.newPage()
  const errors = watch(page)
  return { ctx, page, errors }
}

/** Page errors and console errors — the expected 401s of signed-out requests aside. */
export function watch(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|\/api\//.test(m.text())) errors.push(m.text())
  })
  return errors
}

export async function kubectl(page: Page, command: string) {
  const input = page.locator('[data-terminal-input]')
  await input.fill(command)
  await input.press('Enter')
}

export const terminal = (page: Page) => page.getByRole('region', { name: 'Terminal' })

/** Sign in by email, reading the link from Mailpit — the way a person would. */
export async function signIn(page: Page, email: string) {
  const since = Date.now() - 1000
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.locator('#signin-email').fill(email)
  await page.getByRole('button', { name: /Enviar um link/ }).click()
  let link: string | undefined
  await expect
    .poll(
      async () => {
        const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()
        const message = (found.messages ?? []).find((m: { Created: string }) => Date.parse(m.Created) >= since)
        if (!message) return false
        const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()
        link = (full.Text as string).match(/https?:\/\/\S+#token=[\w-]+/)?.[0]
        return !!link
      },
      { timeout: 20_000, message: `no sign-in email for ${email}` },
    )
    .toBe(true)
  await page.goto(link!.replace(/^https?:\/\/[^/]+/, WEB))
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('button', { name: /^Conta: / })).toBeVisible()
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: /^Conta: / }).click()
  await page.getByRole('menuitem', { name: /Sair/ }).click()
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
}

/** What the account holds, straight from the API (with this page's session). */
export const accountApp = (page: Page) => page.evaluate(async () => (await fetch('/api/workspace')).json())
export const accountProgress = (page: Page) => page.evaluate(async () => (await fetch('/api/progress')).json())

/** Write app.js in the editor and close it (it saves as you type). */
export async function writeCode(page: Page, code: string) {
  await kubectl(page, 'edit app.js')
  await page.getByRole('dialog').getByLabel('Código de app.js').fill(code)
  await page.keyboard.press('Escape')
}
