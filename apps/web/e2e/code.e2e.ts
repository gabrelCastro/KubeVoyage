import { expect, fast, kubectl, terminal, test } from './fixtures'

test("your code: edit app.js, build an image, roll it out — the Pods run it", async ({ page, errors }) => {
  void errors
  await page.goto('/#/services')
  await fast(page)
  await kubectl(page, 'kubectl apply -f service.yaml')

  await kubectl(page, 'edit app.js')
  const editor = page.getByRole('dialog')
  const code = editor.getByLabel('Código de app.js')
  await code.fill(`console.log('subindo a', env.APP_MESSAGE || 'versão de código')
function handle(req) {
  if (req.path === '/healthz') return 'ok'
  return 'Rodando o meu código!'
}`)
  // a dry run, outside the cluster, in the same sandbox the Pods use
  await editor.getByRole('button', { name: 'Testar' }).click()
  await expect(editor.getByRole('status')).toContainText('200 Rodando o meu código!')
  await editor.getByRole('button', { name: /Gerar imagem 2\.0/ }).click()
  await expect(terminal(page)).toContainText('Successfully built ghcr.io/kubelearn/backend:2.0')

  // the image is immutable: editing app.js now changes nothing that was built
  await kubectl(page, 'docker build -t backend:2.0 .')
  await expect(terminal(page)).toContainText('já existe')

  await kubectl(page, 'kubectl set image deployment/backend backend=ghcr.io/kubelearn/backend:2.0')
  await expect(page.getByLabel('Janela do app')).toContainText('Rodando o meu código!', { timeout: 60_000 })
  await kubectl(page, 'kubectl logs -l app=backend')
  await expect(terminal(page)).toContainText('subindo a versão de código')
})

test('your code: a version that throws on start crash-loops, and its logs show why', async ({ page, errors }) => {
  void errors
  await page.goto('/#/services')
  await fast(page)
  await kubectl(page, 'edit app.js')
  const editor = page.getByRole('dialog')
  await editor.getByRole('button', { name: 'Quebra ao iniciar' }).click()
  await editor.getByRole('button', { name: /Gerar imagem/ }).click()
  await expect(terminal(page)).toContainText('Successfully built')
  await kubectl(page, 'kubectl set image deployment/backend backend=ghcr.io/kubelearn/backend:2.0')
  await expect(page.locator('[data-tour=pod][aria-label$=", CrashLoopBackOff"]').first()).toBeVisible({ timeout: 60_000 })
  await kubectl(page, 'kubectl logs -l app=backend')
  await expect(terminal(page)).toContainText('SyntaxError')
})

test('your code: an infinite loop is cut off by the watchdog instead of freezing the page', async ({ page, errors }) => {
  void errors
  await page.goto('/#/services')
  await kubectl(page, 'edit app.js')
  const editor = page.getByRole('dialog')
  await editor.getByLabel('Código de app.js').fill('while (true) {}')
  await editor.getByRole('button', { name: 'Testar' }).click()
  await expect(editor.getByRole('status')).toContainText('Não terminou de iniciar a tempo', { timeout: 10_000 })
  // the page still responds
  await editor.getByRole('button', { name: 'Restaurar modelo' }).click()
  await expect(editor.getByLabel('Código de app.js')).toHaveValue(/function handle/)
})

test('your code: an error that escapes later (a rejected promise) still fails the task', async ({ page, errors }) => {
  void errors
  await page.goto('/#/services')
  await kubectl(page, 'edit app.js')
  const editor = page.getByRole('dialog')
  await editor.getByLabel('Código de app.js').fill(`async function main() {
  console.log('lendo')
  await null
  throw new Error('falhou depois')
}
main()`)
  await editor.getByRole('button', { name: 'Testar' }).click()
  await expect(editor.getByRole('status')).toContainText('terminou com erro')
  await expect(editor.getByRole('status')).toContainText('Error: falhou depois')
})

test('your code: two tabs never overwrite each other — an open editor follows the newer edit', async ({ page, context, errors }) => {
  void errors
  await page.goto('/#/services')
  await kubectl(page, 'edit app.js')
  const editorA = page.getByRole('dialog').getByLabel('Código de app.js')
  await editorA.fill('console.log("aba A")')

  const other = await context.newPage()
  await other.goto('/#/services')
  await kubectl(other, 'edit app.js')
  const editorB = other.getByRole('dialog').getByLabel('Código de app.js')
  await expect(editorB).toHaveValue('console.log("aba A")')
  await editorB.fill('console.log("aba B")')

  // tab A's editor, still open, shows B's newer edit instead of keeping (and later saving) the old text
  await expect(editorA).toHaveValue('console.log("aba B")')
  await page.keyboard.press('Escape')
  await kubectl(page, 'cat app.js')
  await expect(terminal(page)).toContainText('console.log("aba B")')
})
