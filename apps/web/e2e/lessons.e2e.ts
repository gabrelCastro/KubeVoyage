import { expect, fast, kubectl, terminal, test } from './fixtures'

const readyPods = (page: import('@playwright/test').Page) => page.locator('[data-tour=pod][aria-label$=", Ready"]')

test('self-healing: apply, delete a Pod, and a replacement takes its place', async ({ page, errors }) => {
  void errors
  await page.goto('/#/self-healing')
  await fast(page)
  await page.getByRole('button', { name: /Aplicar backend.yaml/ }).click()
  await expect(readyPods(page)).toHaveCount(3)
  const victim = (await readyPods(page).first().getAttribute('aria-label'))!.match(/Pod (\S+),/)![1]
  await kubectl(page, `kubectl delete pod ${victim}`)
  await expect(terminal(page)).toContainText(`pod "${victim}" deleted`)
  await expect(page.locator(`[data-tour=pod][aria-label^="Pod ${victim},"]`)).toHaveCount(0)
  await expect(readyPods(page)).toHaveCount(3)
})

test('terminal: completion, explain and a real error message', async ({ page, errors }) => {
  void errors
  await page.goto('/#/services')
  const input = page.locator('[data-terminal-input]')
  await input.fill('kubectl get endpointsl')
  await input.press('Tab')
  await expect(input).toHaveValue('kubectl get endpointslices ')
  await kubectl(page, 'explicar kubectl get pods -l app=backend -o wide')
  await expect(terminal(page)).toContainText('selector: só o que tiver app igual a backend')
  await kubectl(page, 'kubectl gte pods')
  await expect(terminal(page)).toContainText('Did you mean this?')
})

test('services: the app window fills with visitors once there is a Service', async ({ page, errors }) => {
  void errors
  await page.goto('/#/services')
  await fast(page)
  await expect(page.getByLabel('Janela do app')).toContainText('falta um Service')
  await kubectl(page, 'kubectl apply -f service.yaml')
  await expect(page.getByLabel('Janela do app')).toContainText(/\d+ atendidos/)
})

test('app studio: publish a version and roll it out', async ({ page, errors }) => {
  void errors
  await page.goto('/#/services')
  await fast(page)
  await kubectl(page, 'kubectl apply -f service.yaml')
  await page.getByLabel('Janela do app').getByRole('button', { name: /Criar seu app|Editar/ }).click()
  const studio = page.getByRole('dialog')
  await studio.getByRole('tab', { name: /Nova versão/ }).click()
  await studio.getByLabel('Mensagem').fill('Versão 2 no ar!')
  await studio.getByRole('button', { name: /Publicar 2\.0/ }).click()
  await studio.getByRole('button', { name: /Implantar no cluster/ }).click()
  await expect(page.locator('[data-terminal-input]')).toHaveValue('kubectl set image deployment/backend backend=ghcr.io/kubelearn/backend:2.0')
  await page.locator('[data-terminal-input]').press('Enter')
  await expect(page.getByLabel('Janela do app')).toContainText('Versão 2 no ar!')
})

test('ConfigMaps: a changed value reaches the Pods only after a restart', async ({ page, errors }) => {
  void errors
  await page.goto('/#/configmaps')
  await fast(page)
  // the lesson's order: the Deployment first, so the missing ConfigMap shows up
  await kubectl(page, 'kubectl apply -f backend-config.yaml')
  await expect(page.locator('[data-tour=pod][aria-label$=", CreateContainerConfigError"]').first()).toBeVisible()
  await kubectl(page, 'kubectl apply -f configmap.yaml')
  await expect(page.locator('[data-tour=licao]')).toContainText('2/4', { timeout: 60_000 })
  await kubectl(page, `kubectl patch configmap app-config -p '{"data":{"APP_MESSAGE":"Mensagem nova!"}}'`)
  await expect(page.getByText(/Pods? com valor antigo/)).toBeVisible()
  await kubectl(page, 'kubectl rollout restart deployment/backend')
  await expect(page.getByText(/Pods? com valor antigo/)).toHaveCount(0, { timeout: 60_000 })
})

test('Jobs: tasks end Completed and the Job finishes', async ({ page, errors }) => {
  void errors
  await page.goto('/#/jobs')
  await fast(page)
  await kubectl(page, 'kubectl apply -f relatorio.yaml')
  await expect(page.locator('[aria-label="Job relatorio, Concluído"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-tour=pod][aria-label$=", Completed"]')).toHaveCount(5)
})

test('Nodes: drain cordons the node, moves the backend and keeps the DaemonSet agent', async ({ page, errors }) => {
  void errors
  await page.goto('/#/nodes')
  await fast(page)
  await kubectl(page, 'kubectl apply -f log-agent.yaml')
  await expect(page.getByLabel(/DaemonSet log-agent, 3 de 3 prontos/)).toBeVisible({ timeout: 30_000 })

  await kubectl(page, 'kubectl drain node-2')
  await expect(terminal(page)).toContainText('cannot delete DaemonSet-managed Pods')
  await expect(page.getByTitle('SchedulingDisabled — nenhum Pod novo será agendado aqui')).toContainText('node-2')

  await kubectl(page, 'kubectl drain node-2 --ignore-daemonsets')
  await expect(terminal(page)).toContainText('node/node-2 drained')
  await expect(page.locator('[data-tour=pod][aria-label^="Pod backend-"][aria-label$=", Ready"]')).toHaveCount(3, { timeout: 30_000 })
  await expect(page.locator('[data-tour=pod][aria-label^="Pod log-agent-"][aria-label$=", Ready"]')).toHaveCount(3)
})

test('apostila: opens with its sections, and a glossary link jumps to the right one', async ({ page, errors }) => {
  void errors
  await page.goto('/#/services')
  await page.locator('[data-tour=apostila]').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'O que você vai entender' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.locator('a.decoration-dotted', { hasText: /^label$/ }).first().click()
  await expect(page.getByRole('dialog').locator('h3#labels')).toBeInViewport()
})

test('privacy page renders on its own URL', async ({ page, errors }) => {
  void errors
  await page.goto('/privacidade')
  await expect(page.getByRole('heading', { level: 1, name: 'Privacidade' })).toBeVisible()
})

test('Secrets: a Pod waiting for a missing Secret says which one', async ({ page, errors }) => {
  void errors
  await page.goto('/#/secrets')
  await fast(page)
  await kubectl(page, 'kubectl apply -f backend-secret.yaml')
  const waiting = page.locator('[data-tour=pod][aria-label$=", CreateContainerConfigError"]').first()
  await expect(waiting).toBeVisible({ timeout: 30_000 })
  await waiting.click()
  await expect(page.locator('[data-tour=inspetor]')).toContainText('o Secret db-credentials não existe')
})
