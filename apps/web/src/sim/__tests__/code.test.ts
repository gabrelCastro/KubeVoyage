import { afterEach, describe, expect, it } from 'vitest'
import { assemble, execute, type Profile } from '../../runtime/program'
import { nodeSandbox } from '../../runtime/__tests__/nodeSandbox'
import { setCodeRuntime, Simulation } from '../engine'
import { run } from '../kubectl'
import { settle } from './helpers'

const text = (r: ReturnType<typeof run>) => r.lines.map((l) => l.map((s) => s.t).join('')).join('\n')
const live = (sim: Simulation) => Object.values(sim.cluster.pods).filter((p) => p.deletedAt === null)

const IMG = 'ghcr.io/kubelearn/backend:meu-app'

/**
 * The browser runs code in a Worker and answers 'pending' until it's done. Here the profiles are
 * computed up front with the same core (node:vm), and each one is 'pending' the first time it's asked.
 */
async function runtime(code: string, envs: Record<string, string>[] = [{}]) {
  const profiles = new Map<string, Profile>()
  for (const env of envs) profiles.set(JSON.stringify(env), assemble(await execute(nodeSandbox(), code, env)))
  const asked = new Set<string>()
  setCodeRuntime({
    profile(image, env) {
      if (image !== IMG) return null
      const key = JSON.stringify(env)
      if (!asked.has(key)) {
        asked.add(key)
        return 'pending'
      }
      return profiles.get(key) ?? null
    },
  })
}

function deployment(extra = '') {
  const sim = new Simulation()
  sim.bootstrap({
    deployments: [{ name: 'backend', replicas: 2, labels: { app: 'backend' }, image: 'ghcr.io/kubelearn/backend:1.4' }],
    services: [{ name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 }],
  })
  settle(sim, 8000)
  run(sim, `kubectl set image deployment/backend backend=${IMG}${extra}`)
  return sim
}

afterEach(() => setCodeRuntime(null))

describe("the learner's code in a Pod", () => {
  it('a healthy server rolls out, becomes Ready and its logs are what it printed', async () => {
    await runtime(`console.log('subindo'); function handle(req) { console.log('GET', req.path); return 'oi' }`)
    const sim = deployment()
    settle(sim, 30000)
    const pods = live(sim)
    expect(pods.every((p) => p.image === IMG && p.ready && p.phase === 'Running')).toBe(true)
    expect(sim.findDeployment('backend')!.rollout).toBe('complete')
    expect(text(run(sim, `kubectl logs ${pods[0].name}`))).toBe('subindo\nGET /\nGET /healthz')
  })

  it('code that throws while starting crash-loops, and the logs show the error', async () => {
    await runtime(`console.log('lendo config'); throw new Error('PORTA não definida')`)
    const sim = deployment()
    settle(sim, 20000)
    const bad = live(sim).filter((p) => p.image === IMG)
    expect(bad.length).toBeGreaterThan(0)
    expect(bad.every((p) => !p.ready)).toBe(true)
    expect(bad.some((p) => p.waiting === 'CrashLoopBackOff' || p.restarts > 0)).toBe(true)
    // the old Pods keep serving: the rollout stalls safely
    expect(live(sim).filter((p) => p.image !== IMG && p.ready).length).toBeGreaterThan(0)
    expect(text(run(sim, `kubectl logs ${bad[0].name}`))).toBe('lendo config\nError: PORTA não definida\nexit status 1')
  })

  it('a script in a Deployment exits and is restarted over and over', async () => {
    await runtime(`console.log('feito')`)
    const sim = deployment()
    settle(sim, 20000)
    const bad = live(sim).filter((p) => p.image === IMG)
    expect(bad.every((p) => !p.ready)).toBe(true)
    expect(sim.narration.some((n) => n.title === 'Uma tarefa num Deployment')).toBe(true)
  })

  it('a /healthz that answers 503 keeps the Pod out of the Service, with the status in the event', async () => {
    await runtime(`function handle(req) { return req.path === '/healthz' ? { status: 503, body: 'sem banco' } : 'oi' }`)
    const sim = deployment()
    settle(sim, 20000)
    const bad = live(sim).filter((p) => p.image === IMG)
    expect(bad.length).toBeGreaterThan(0)
    expect(bad.every((p) => p.phase === 'Running' && !p.ready && p.restarts === 0)).toBe(true)
    expect(sim.events.some((e) => e.reason === 'Unhealthy' && e.message.endsWith('HTTP probe failed with statuscode: 503'))).toBe(true)
    expect(sim.narration.some((n) => n.title === 'Rodando, mas não está pronto')).toBe(true)
    // never Ready: the rollout stops safely, like a crash loop does
    expect(sim.findDeployment('backend')!.rollout).toBe('stalled')
  })

  it('a handler that never returns hangs; with a liveness probe the kubelet restarts it', async () => {
    await runtime(`function handle(req) { if (req.path === '/healthz') for (;;) {} return 'oi' }`)
    const sim = new Simulation()
    sim.bootstrap({
      deployments: [{ name: 'backend', replicas: 1, labels: { app: 'backend' }, image: 'ghcr.io/kubelearn/backend:1.4' }],
      services: [{ name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 }],
    })
    sim.apply({ kind: 'Deployment', name: 'backend', replicas: 1, labels: { app: 'backend' }, image: IMG, livenessProbe: true })
    settle(sim, 40000)
    expect(sim.events.some((e) => e.reason === 'Unhealthy' && e.message.endsWith('context deadline exceeded'))).toBe(true)
    expect(sim.events.some((e) => e.reason === 'Killing')).toBe(true)
    expect(live(sim).find((p) => p.image === IMG)!.restarts).toBeGreaterThan(0)
  })

  it('reads its environment from a ConfigMap: same image, different behavior', async () => {
    const code = `if (!env.DB) throw new Error('DB ausente'); function handle() { return 'ok ' + env.DB }`
    await runtime(code, [{}, { DB: 'postgres' }])
    const sim = new Simulation()
    sim.apply({ kind: 'ConfigMap', name: 'cfg', data: {} })
    // without the ConfigMap the code throws; with it, the same image serves
    sim.apply({ kind: 'Deployment', name: 'backend', replicas: 1, labels: { app: 'backend' }, image: IMG, configMap: 'cfg' })
    settle(sim, 15000)
    expect(live(sim).filter((p) => p.image === IMG).every((p) => !p.ready)).toBe(true)
    run(sim, `kubectl patch configmap cfg -p '{"data":{"DB":"postgres"}}'`)
    run(sim, 'kubectl rollout restart deployment/backend')
    settle(sim, 30000)
    expect(live(sim).every((p) => p.image === IMG && p.ready)).toBe(true)
  })

  it("a Job's exit code comes from the script", async () => {
    await runtime(`console.log('processando'); if (Math.max(1, 2) === 2) throw new Error('arquivo não encontrado')`)
    const sim = new Simulation()
    run(sim, `kubectl create job tarefa --image=${IMG}`)
    settle(sim, 30000)
    const job = sim.findJob('tarefa')!
    expect(job.failed).toBeGreaterThan(0)
    expect(job.succeeded).toBe(0)
    expect(text(run(sim, 'kubectl logs job/tarefa'))).toContain('Error: arquivo não encontrado')
  })

  it('a Job whose script finishes succeeds', async () => {
    await runtime(`console.log('relatório pronto')`)
    const sim = new Simulation()
    run(sim, `kubectl create job tarefa --image=${IMG}`)
    settle(sim, 30000)
    expect(sim.findJob('tarefa')!.status).toBe('Complete')
    expect(text(run(sim, 'kubectl logs job/tarefa'))).toBe('relatório pronto')
  })

  it('a Job whose code throws fails, even if it mentions handle somewhere', async () => {
    await runtime(`// handle depois\nthrow new Error('boom')`)
    const sim = new Simulation()
    run(sim, `kubectl create job tarefa --image=${IMG}`)
    settle(sim, 30000)
    expect(sim.findJob('tarefa')!.failed).toBeGreaterThan(0)
    expect(sim.narration.some((n) => n.title === 'Um servidor não termina')).toBe(false)
  })

  it('a Job whose script never finishes stays Running instead of failing', async () => {
    await runtime(`console.log('começando'); for (;;) {}`)
    const sim = new Simulation()
    run(sim, `kubectl create job tarefa --image=${IMG}`)
    settle(sim, 30000)
    const job = sim.findJob('tarefa')!
    expect(job.failed).toBe(0)
    expect(job.succeeded).toBe(0)
    expect(sim.narration.some((n) => n.title === 'Uma tarefa que não termina')).toBe(true)
  })

  it('a server as a Job never finishes', async () => {
    await runtime(`function handle() { return 'oi' }`)
    const sim = new Simulation()
    run(sim, `kubectl create job tarefa --image=${IMG}`)
    settle(sim, 30000)
    expect(sim.findJob('tarefa')!.status).not.toBe('Complete')
    expect(sim.narration.some((n) => n.title === 'Um servidor não termina')).toBe(true)
  })
})

describe('the workspace in the terminal', () => {
  function workspace(code = 'console.log(1)') {
    const built: string[] = []
    return {
      built,
      ws: {
        code,
        images: built,
        build: (tag: string) => {
          if (built.includes(`ghcr.io/kubelearn/backend:${tag}`)) return { error: `a tag ${tag} já existe` }
          built.push(`ghcr.io/kubelearn/backend:${tag}`)
          return { image: `ghcr.io/kubelearn/backend:${tag}` }
        },
      },
    }
  }

  it('lists and shows app.js and the Dockerfile; edit opens the editor', () => {
    const sim = new Simulation()
    sim.files = ['backend.yaml']
    const { ws } = workspace('console.log("oi")\n')
    expect(text(run(sim, 'ls', { workspace: ws }))).toBe('backend.yaml  app.js  Dockerfile  ')
    // without a workspace (tests, other surfaces) nothing changes
    expect(text(run(sim, 'ls'))).toBe('backend.yaml  ')
    expect(text(run(sim, 'cat app.js', { workspace: ws }))).toBe('console.log("oi")')
    expect(text(run(sim, 'cat Dockerfile', { workspace: ws }))).toContain('COPY app.js .')
    expect(run(sim, 'edit app.js', { workspace: ws }).editCode).toBe(true)
    expect(run(sim, 'edit backend.yaml', { workspace: ws }).editCode).toBeUndefined()
    expect(text(run(sim, 'vim app.js', { workspace: ws }))).toContain('edit app.js')
  })

  it('docker build needs a tag, the backend repo and the current folder — and tags are immutable', () => {
    const sim = new Simulation()
    const { ws, built } = workspace()
    expect(text(run(sim, 'docker build .', { workspace: ws }))).toContain('-t')
    expect(text(run(sim, 'docker build -t backend .', { workspace: ws }))).toContain('informe uma tag')
    expect(text(run(sim, 'docker build -t frontend:1 .', { workspace: ws }))).toContain('só aceita imagens do repositório backend')
    expect(text(run(sim, 'docker build -t backend:2.0 src', { workspace: ws }))).toContain('not found')
    expect(built).toEqual([])
    const out = text(run(sim, 'docker build -t backend:2.0 .', { workspace: ws }))
    expect(out).toContain('Successfully built ghcr.io/kubelearn/backend:2.0')
    expect(out).toContain('kubectl set image deployment/backend backend=ghcr.io/kubelearn/backend:2.0')
    expect(text(run(sim, 'docker build -t ghcr.io/kubelearn/backend:2.0 .', { workspace: ws }))).toContain('já existe')
    expect(text(run(sim, 'docker build --tag=backend:2.1 .', { workspace: ws }))).toContain('Successfully built')
    expect(text(run(sim, 'docker images', { workspace: ws }))).toMatch(/ghcr\.io\/kubelearn\/backend\s+2\.1/)
    expect(text(run(sim, 'docker run backend:2.0', { workspace: ws }))).toContain('quem roda containers é o cluster')
  })

  it('wget and curl get what the code answered', async () => {
    await runtime(`function handle(req) { return req.path === '/healthz' ? 'ok' : 'Olá, ' + (env.NOME || 'mundo') }`)
    const sim = deployment()
    settle(sim, 30000)
    const out = text(run(sim, 'kubectl run t --rm -it --image=busybox -- wget -qO- http://backend'))
    expect(out).toContain('Olá, mundo')
    expect(out).toContain('o seu código respondeu')
    expect(text(run(sim, 'kubectl run t --rm -it --image=busybox -- wget -qO- http://backend/healthz'))).toContain('ok')
    expect(text(run(sim, 'kubectl run t --rm -it --image=busybox -- wget -qO- http://backend/outra'))).toContain('só conhece')
  })

  it('an error status: wget fails, curl shows the body', async () => {
    await runtime(`function handle(req) { return req.path === '/healthz' ? 'ok' : { status: 404, body: 'nada aqui' } }`)
    const sim = deployment()
    settle(sim, 30000)
    expect(text(run(sim, 'kubectl run t --rm -it --image=busybox -- wget -qO- http://backend'))).toContain('HTTP/1.1 404 Not Found')
    expect(text(run(sim, 'kubectl run t --rm -it --image=curlimages/curl -- curl -s http://backend'))).toContain('nada aqui')
  })
})
