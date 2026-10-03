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
