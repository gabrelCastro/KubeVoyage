import { expect, test } from '@playwright/test'
import { accountApp, accountProgress, device, kubectl, newEmail, signIn, signOut, terminal, watch, writeCode } from './helpers'

/**
 * Accounts against the real API: what's done on one device reaches the others, nothing is lost
 * when signing out, and nothing of one person ever lands in another person's account.
 */

test('two devices: an image built offline is uploaded on sign-in, and the other device runs it', async ({ browser }) => {
  const email = newEmail('dois')
  const laptop = await device(browser)
  await laptop.page.goto('/#/services')
  // signed out: the work lives on this device only
  await writeCode(laptop.page, `function handle(req) { return req.path === '/healthz' ? 'ok' : 'Feito no notebook!' }`)
  await kubectl(laptop.page, 'docker build -t backend:nb-1 .')
  await expect(terminal(laptop.page)).toContainText('Successfully built ghcr.io/kubelearn/backend:nb-1')
  await signIn(laptop.page, email)
  await expect.poll(async () => (await accountApp(laptop.page)).releases.map((r: { tag: string }) => r.tag)).toEqual(['nb-1'])

  const phone = await device(browser)
  await phone.page.goto('/#/services')
  await signIn(phone.page, email)
  // signing in may take you to the account's last lesson: come back to this one
  await phone.page.goto('/#/services')
  await kubectl(phone.page, 'docker images')
  await expect(terminal(phone.page)).toContainText(/backend\s+nb-1/)
  await kubectl(phone.page, 'kubectl apply -f service.yaml')
  await kubectl(phone.page, 'kubectl set image deployment/backend backend=ghcr.io/kubelearn/backend:nb-1')
  await expect(phone.page.getByLabel('Janela do app')).toContainText('Feito no notebook!', { timeout: 60_000 })

  // and back: an edit on the phone reaches the laptop
  await writeCode(phone.page, `console.log('editado no celular')`)
  await expect.poll(async () => (await accountApp(phone.page)).draft.code).toBe(`console.log('editado no celular')`)
  await laptop.page.reload()
  await expect.poll(() => laptop.page.evaluate(() => JSON.parse(localStorage.getItem('kubelearn.app.v1') ?? '{}').code)).toBe(`console.log('editado no celular')`)

  // the export has it
  const exported = await phone.page.evaluate(async () => (await fetch('/api/me/export')).json())
  expect(exported.workspace.releases.map((r: { tag: string }) => r.tag)).toEqual(['nb-1'])
  expect([...laptop.errors, ...phone.errors]).toEqual([])
})

test('signing out right after a change loses nothing — progress or app — and the device forgets both', async ({ browser }) => {
  const email = newEmail('saida')
  const d = await device(browser)
  await d.page.goto('/#/self-healing')
  await signIn(d.page, email)
  await d.page.goto('/#/self-healing')
  await writeCode(d.page, `console.log('digitado antes de sair')`)
  // an objective done and out at once: progress waits a moment before syncing, so the moment it's
  // saved on this device it hasn't reached the account yet — that's when "Sair" is clicked
  await kubectl(d.page, 'kubectl apply -f backend.yaml')
  await expect.poll(() => d.page.evaluate(() => localStorage.getItem('kubelearn.progress.v2') ?? ''), { intervals: [50] }).toContain('apply')
  await signOut(d.page)

  const other = await signedInAgain(browser, email)
  expect((await accountProgress(other)).lessons['self-healing']?.objectives).toContain('apply')
  expect((await accountApp(other)).draft.code).toBe(`console.log('digitado antes de sair')`)
  // this device kept nothing
  expect(await d.page.evaluate(() => [localStorage.getItem('kubelearn.app.v1'), localStorage.getItem('kubelearn.progress.v2')])).toEqual([null, null])
  expect(d.errors).toEqual([])
})

test('signing out offline keeps on the device what never reached the account, and says so', async ({ browser }) => {
  const email = newEmail('offline')
  const d = await device(browser)
  await d.page.goto('/#/self-healing')
  await signIn(d.page, email)
  await d.page.goto('/#/self-healing')
  // the terminal loads on first use: before the network goes
  await kubectl(d.page, 'kubectl get pods')
  await expect(d.page.getByRole('region', { name: 'Terminal' })).toContainText('No resources found')
  await d.ctx.setOffline(true)
  await kubectl(d.page, 'kubectl apply -f backend.yaml')
  await expect.poll(() => d.page.evaluate(() => localStorage.getItem('kubelearn.progress.v2') ?? '')).toContain('apply')
  await writeCode(d.page, `console.log('feito sem rede')`)
  await signOut(d.page)
  await expect(d.page.getByText(/não chegaram à sua conta, então ficaram neste dispositivo/)).toBeVisible()
  const kept = await d.page.evaluate(() => ({
    app: JSON.parse(localStorage.getItem('kubelearn.app.v1') ?? '{}').code,
    progress: localStorage.getItem('kubelearn.progress.v2') ?? '',
  }))
  expect(kept.app).toBe(`console.log('feito sem rede')`)
  expect(kept.progress).toContain('apply')
})

test("a shared device: another person signing in never receives the previous person's app", async ({ browser }) => {
  const first = newEmail('primeira')
  const second = newEmail('segunda')
  const d = await device(browser)
  await d.page.goto('/#/services')
  await signIn(d.page, first)
  await writeCode(d.page, `console.log('código da primeira pessoa')`)
  await expect.poll(async () => (await accountApp(d.page)).draft.code).toContain('primeira pessoa')
  // the session ends (expired, say) and the app stays on the device…
  await d.ctx.clearCookies()
  await d.page.reload()
  await expect(d.page.getByRole('button', { name: 'Entrar' })).toBeVisible()
  // …then someone else signs in here
  await signIn(d.page, second)
  await expect.poll(async () => (await accountApp(d.page)).draft.code).toBeNull()
  expect((await accountApp(d.page)).releases).toEqual([])
  expect(d.errors).toEqual([])
})

test('two tabs: when another account signs in in one, the other starts over instead of carrying the old app across', async ({ browser }) => {
  const a = newEmail('aba-a')
  const b = newEmail('aba-b')
  const d = await device(browser)
  await d.page.goto('/#/services')
  await signIn(d.page, a)
  const tab2 = await d.ctx.newPage()
  const errors2 = watch(tab2)
  await tab2.goto('/#/services')
  await expect(tab2.getByRole('button', { name: /^Conta: / })).toBeVisible()
  await writeCode(tab2, `console.log('código da A')`)
  await expect.poll(async () => (await accountApp(tab2)).draft.code).toBe(`console.log('código da A')`)
  await tab2.evaluate(() => ((window as unknown as { sameTab: boolean }).sameTab = true))

  // A's session ends; B signs in in the first tab while the second still holds A's app in memory
  await d.ctx.clearCookies()
  await d.page.reload()
  await signIn(d.page, b)
  // the second tab starts over as B's session…
  await expect.poll(() => tab2.evaluate(() => (window as unknown as { sameTab?: boolean }).sameTab === true)).toBe(false)
  await kubectl(tab2, 'edit app.js')
  await expect(tab2.getByRole('dialog').getByLabel('Código de app.js')).not.toHaveValue(/código da A/)
  // …and B's account has nothing of A
  expect(String((await accountApp(d.page)).draft.code)).not.toContain('da A')
  expect([...d.errors, ...errors2]).toEqual([])
})

/** A separate device signed in as `email` — to read the account without touching the one under test. */
async function signedInAgain(browser: import('@playwright/test').Browser, email: string) {
  const other = await device(browser)
  await other.page.goto('/#/self-healing')
  await signIn(other.page, email)
  return other.page
}
