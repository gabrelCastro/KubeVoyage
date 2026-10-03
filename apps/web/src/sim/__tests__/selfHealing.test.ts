import { describe, expect, it } from 'vitest'
import { Simulation } from '../engine'
import { MANIFEST } from '../kubectl'
import { live, ready, reasons, settle } from './helpers'

function running() {
  const sim = new Simulation()
  sim.apply(MANIFEST.manifest)
  settle(sim)
  return sim
}

describe('creating a Deployment', () => {
  it('builds Deployment → ReplicaSet → 3 ready Pods, then reconciles', () => {
    const sim = running()
    expect(Object.values(sim.cluster.deployments)).toHaveLength(1)
    expect(Object.values(sim.cluster.replicaSets)).toHaveLength(1)
    expect(ready(sim)).toHaveLength(3)
    expect(Object.values(sim.cluster.replicaSets)[0].phase).toBe('idle')
    expect(reasons(sim)).toContain('Reconciled')
  })

  it('walks every Pod through the lifecycle in order', () => {
    const sim = running()
    for (const pod of live(sim)) {
      const seq = sim.events.filter((e) => e.involved.uid === pod.uid).map((e) => e.reason)
      expect(seq).toEqual(['SuccessfulCreate', 'Scheduled', 'Pulled', 'Started', 'Ready'])
    }
  })

  it('spreads Pods across nodes', () => {
    const nodes = new Set(live(running()).map((p) => p.nodeName))
    expect(nodes.size).toBe(3)
  })
})

describe('self-healing', () => {
  it('replaces a deleted Pod in the same slot', () => {
    const sim = running()
    const victim = live(sim)[1]
    expect(sim.deletePod(victim.name)).toBe('deleted')
    settle(sim)
    const pods = live(sim)
    expect(pods).toHaveLength(3)
    expect(pods.find((p) => p.uid === victim.uid)).toBeUndefined()
    expect(pods.map((p) => p.slot).sort()).toEqual([0, 1, 2])
    expect(sim.cluster.vacancies).toHaveLength(0)
  })

  it('drops Actual immediately, before the Pod is gone', () => {
    const sim = running()
    const rs = Object.values(sim.cluster.replicaSets)[0]
    sim.deletePod(live(sim)[0].name)
    expect(sim.activePods(rs.uid)).toHaveLength(2)
    expect(sim.cluster.replicaSets[rs.uid].phase).toBe('diverged')
  })

  it('tells the story in order: delete → reconcile → create → ready → reconciled', () => {
    const sim = running()
    const from = sim.events.length
    sim.deletePod(live(sim)[0].name)
    settle(sim)
    const r = reasons(sim, from)
    const order = ['Deleted', 'Killing', 'Reconciling', 'SuccessfulCreate', 'Scheduled', 'Ready', 'Reconciled'].map((x) => r.indexOf(x))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('copes with several deletions at once', () => {
    const sim = running()
    const [a, b] = live(sim)
    sim.deletePod(a.name)
    sim.deletePod(b.name)
    settle(sim)
    expect(ready(sim)).toHaveLength(3)
    expect(Object.values(sim.cluster.pods)).toHaveLength(3)
  })

  it('survives deleting a Pod that is still starting', () => {
    const sim = running()
    sim.deletePod(live(sim)[0].name)
    settle(sim, 2000) // replacement exists but is not ready yet
    const starting = live(sim).find((p) => !p.ready)!
    expect(starting).toBeDefined()
    sim.deletePod(starting.name)
    settle(sim)
    expect(ready(sim)).toHaveLength(3)
  })

  it('refuses to delete what does not exist, and is idempotent on terminating Pods', () => {
    const sim = running()
    expect(sim.deletePod('nope')).toBe('notfound')
    const p = live(sim)[0]
    sim.deletePod(p.name)
    expect(sim.deletePod(p.name)).toBe('terminating')
  })
})

describe('scaling', () => {
  it('scales up and down, keeping slots compact', () => {
    const sim = running()
    sim.scale('backend', 5)
    settle(sim)
    expect(ready(sim)).toHaveLength(5)
    sim.scale('backend', 2)
    settle(sim)
    expect(ready(sim)).toHaveLength(2)
    expect(live(sim).map((p) => p.slot).sort()).toEqual([0, 1])
  })
})

describe('step mode', () => {
  it('runs exactly one scheduled transition per step', () => {
    const sim = new Simulation()
    sim.apply(MANIFEST.manifest)
    expect(sim.pending[0].label).toMatch(/ReplicaSet/)
    sim.step()
    expect(Object.values(sim.cluster.replicaSets)).toHaveLength(1)
    expect(Object.values(sim.cluster.pods)).toHaveLength(0)
  })
})
