import { expect, test } from './fixtures'

test('docs: search finds a topic, accents optional, and takes you there', async ({ page, errors }) => {
  void errors
  await page.goto('/doc')
  await expect(page.getByRole('heading', { name: 'Como usar o KubeLearn', level: 1 })).toBeVisible()
  await page.keyboard.press('/')
  await page.keyboard.type('simulacao fiel')
  await expect(page.getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#o-que-e-fiel$/)
  await expect(page.getByRole('heading', { name: 'O que é fiel' })).toBeInViewport()
  await expect(page.getByRole('navigation', { name: 'Conteúdo da documentação' }).getByRole('link', { name: 'O que é fiel' })).toHaveAttribute('aria-current', 'location')
})

test('docs: a link to a section lands on it', async ({ page, errors }) => {
  void errors
  await page.goto('/doc#contrato')
  await expect(page.getByRole('heading', { name: 'Como escrever o app.js' })).toBeInViewport()
  // the reference is the one --help shows
  await expect(page.locator('#kubectl-drain')).toContainText('kubectl drain <node> [--ignore-daemonsets] [--force]')
})

test('docs: reachable from the app, in a new tab', async ({ page, errors }) => {
  void errors
  await page.goto('/#/self-healing')
  await page.getByRole('button', { name: 'Ajuda' }).click()
  const [docs] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('menuitem', { name: 'Documentação' }).click()])
  await expect(docs).toHaveURL(/\/doc$/)
  await expect(docs.getByRole('heading', { name: 'Como usar o KubeLearn', level: 1 })).toBeVisible()
  // and back: the lesson links open the app on that lesson
  await docs.getByRole('link', { name: 'Começar pela lição 1 →' }).click()
  await expect(docs).toHaveURL(/\/#\/self-healing$/)
})
