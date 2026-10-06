import { expect, test } from './fixtures'

test('phone: the page and the apostila fit the screen', async ({ page, errors }) => {
  void errors
  await page.goto('/#/services')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  await page.locator('[data-tour=apostila]').click()
  const article = page.locator('article.apostila-content')
  await expect(article).toBeVisible()
  // the text column must end inside the dialog, not past its right edge
  const overflow = await article.evaluate((el) => el.getBoundingClientRect().right - el.closest('[role=dialog]')!.getBoundingClientRect().right)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('phone: the docs fit the screen, and the index folds under the bar', async ({ page, errors }) => {
  void errors
  await page.goto('/doc')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  await page.getByRole('button', { name: /Nesta página/ }).click()
  await page.getByRole('navigation', { name: 'Conteúdo da documentação' }).getByRole('link', { name: 'Pipes' }).click()
  await expect(page.locator('#doc-mobile-index')).toBeHidden()
  const pipes = page.getByRole('heading', { name: 'Pipes' })
  await expect(pipes).toBeInViewport()
  // below the sticky bar, not under it
  const bar = await page.locator('header').boundingBox()
  await expect.poll(async () => (await pipes.boundingBox())!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height)
})
