import { describe, expect, it } from 'vitest'
import { Simulation } from '../engine'
import { complete, run } from '../kubectl'
import { live, settle } from './helpers'

const text = (r: ReturnType<typeof run>) => r.lines.map((l) => l.map((s) => s.t).join('')).join('\n')

describe('kubectl', () => {
  it('applies the manifest and lists Pods', () => {
    const sim = new Simulation()
    expect(text(run(sim, 'kubectl apply -f backend.yaml'))).toContain('deployment.apps/backend created')
    settle(sim)
    const out = text(run(sim, 'k get pods -o wide'))
    expect(out).toMatch(/NAME\s+READY\s+STATUS/)
    expect(out.match(/Running/g)).toHaveLength(3)
    expect(text(run(sim, 'kubectl apply -f backend.yaml'))).toContain('unchanged')
  })

  it('reports unknown things like kubectl does', () => {
    const sim = new Simulation()
    expect(text(run(sim, 'kubectl delete pod ghost'))).toContain('NotFound')
    expect(text(run(sim, 'kubectl frobnicate'))).toContain('unknown command')
    expect(text(run(sim, 'ls -la'))).not.toContain('command not found')
  })

  it('deletes by label selector', () => {
    const sim = new Simulation()
    run(sim, 'kubectl apply -f backend.yaml')
    settle(sim)
    const out = text(run(sim, 'kubectl delete pods -l app=backend'))
    expect(out.match(/deleted/g)).toHaveLength(3)
  })

  it('tab-completes Pod names', () => {
    const sim = new Simulation()
    run(sim, 'kubectl apply -f backend.yaml')
    settle(sim)
    const pod = live(sim)[0]
    const r = complete(sim, `kubectl delete pod ${pod.name.slice(0, -3)}`)
    expect(r.value.trim()).toBe(`kubectl delete pod ${pod.name}`)
  })
})

describe('--help', () => {
  it('every simulated command explains itself (and the /doc reference is built from the same data)', async () => {
    const { USAGE, VERBS } = await import('../cli/usage')
    for (const verb of VERBS) {
      expect(USAGE[verb], verb).toBeDefined()
      const out = run(new Simulation(), `kubectl ${verb} --help`).lines.map((l) => l.map((s) => s.t).join('')).join('\n')
      expect(out).toContain(USAGE[verb].what)
      expect(out).toContain('Uso:')
    }
  })
})
