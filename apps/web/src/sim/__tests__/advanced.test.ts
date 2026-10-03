import { describe, expect, it } from 'vitest'
import { NO_OWNER, Simulation, isBroken } from '../engine'
import { IMAGE, run } from '../kubectl'
import { live, ready, reasons, settle } from './helpers'

const text = (r: ReturnType<typeof run>) => r.lines.map((l) => l.map((s) => s.t).join('')).join('\n')
const backend = { name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }

function cluster(withService = false, selector = { app: 'backend' }) {
  const sim = new Simulation()
  sim.bootstrap({ deployments: [backend], services: withService ? [{ name: 'backend', selector, port: 80, targetPort: 8080 }] : [] })
  return sim
}

describe('bootstrap', () => {
  it('materializes a reconciled cluster with no pending work', () => {
    const sim = cluster(true)
    expect(ready(sim)).toHaveLength(3)
    expect(sim.pending).toHaveLength(0)
    expect(Object.values(sim.cluster.services)[0].endpoints).toHaveLength(3)
    expect(sim.narration).toHaveLength(0)
  })
})

describe('services & endpoints', () => {
  it('expose creates a Service whose endpoints are the ready Pods', () => {
    const sim = cluster()
    expect(sim.expose('backend', 80, 8080)).toBe('created')
    const svc = sim.findService('backend')!
    expect(svc.endpoints).toHaveLength(3)
    expect(text(run(sim, 'kubectl get endpoints backend'))).toMatch(/10\.244\.\d+\.\d+:8080/)
  })

  it('drops a terminating Pod from endpoints at once and adds the replacement only when Ready', () => {
    const sim = cluster(true)
    const victim = live(sim)[0]
    sim.deletePod(victim.name)
    expect(sim.findService('backend')!.endpoints).not.toContain(victim.uid)
    expect(sim.findService('backend')!.endpoints).toHaveLength(2)
    settle(sim, 2500)
    const starting = live(sim).find((p) => !p.ready)
    if (starting) expect(sim.findService('backend')!.endpoints).not.toContain(starting.uid)
    settle(sim)
    expect(sim.findService('backend')!.endpoints).toHaveLength(3)
  })

  it('a wrong selector means no endpoints; fixing it restores them', () => {
    const sim = cluster(true, { app: 'api' })
    expect(sim.findService('backend')!.endpoints).toHaveLength(0)
    run(sim, 'kubectl set selector service backend app=backend')
    expect(sim.findService('backend')!.endpoints).toHaveLength(3)
    expect(reasons(sim)).toContain('EndpointAdded')
  })
})

describe('labels', () => {
  it('relabeling a Pod out of the selector orphans it and the ReplicaSet replaces it', () => {
    const sim = cluster(true)
    const pod = live(sim)[1]
    const r = sim.labelPod(pod.name, { app: 'debug' }, true)
    expect(r).toEqual({ ok: true, changed: true })
    const after = sim.cluster.pods[pod.uid]
    expect(after.ownerUid).toBeNull()
    expect(sim.findService('backend')!.endpoints).not.toContain(pod.uid)
    settle(sim)
    const rs = Object.values(sim.cluster.replicaSets)[0]
    expect(sim.activePods(rs.uid)).toHaveLength(3)
    expect(live(sim)).toHaveLength(4) // the orphan keeps running
    expect(sim.cluster.pods[pod.uid].phase).toBe('Running')
  })

  it('refuses to overwrite without --overwrite', () => {
    const sim = cluster()
    expect('error' in sim.labelPod(live(sim)[0].name, { app: 'x' }, false)).toBe(true)
  })

  it('putting the label back gets the Pod adopted, and the surplus terminated', () => {
    const sim = cluster()
    const pod = live(sim)[0]
    sim.labelPod(pod.name, { app: 'debug' }, true)
    settle(sim)
    sim.labelPod(pod.name, { app: 'backend' }, true)
    settle(sim)
    expect(sim.cluster.pods[pod.uid]?.ownerUid).toBeTruthy()
    expect(live(sim)).toHaveLength(3)
    expect(reasons(sim)).toContain('Adopted')
  })

  it('a Service only cares about labels — not owners', () => {
    const sim = new Simulation()
    sim.bootstrap({ deployments: [backend], services: [{ name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 }], pods: [{ name: 'frontend', labels: { app: 'frontend' }, image: 'web:2' }] })
    const fe = sim.findPod('frontend')!
    expect(fe.ownerUid).toBeNull()
    sim.labelPod('frontend', { app: 'backend' }, true)
    settle(sim)
    expect(sim.findService('backend')!.endpoints).toContain(fe.uid)
    expect(sim.findPod('frontend')!.ownerUid).toBeNull() // no pod-template-hash → no adoption
    expect(sim.cluster.pods[fe.uid].slot).toBe(0)
    expect(Object.values(sim.cluster.pods).filter((p) => (p.ownerUid ?? NO_OWNER) === NO_OWNER)).toHaveLength(1)
  })
})

describe('rollouts & failures', () => {
  it('a healthy new version rolls over completely, keeping the old ReplicaSet at 0', () => {
    const sim = cluster()
    sim.setImage('backend', 'backend', 'ghcr.io/kubelearn/backend:1.7')
    settle(sim, 30000)
    const dep = sim.findDeployment('backend')!
    expect(dep.rollout).toBe('complete')
    expect(ready(sim)).toHaveLength(3)
    expect(ready(sim).every((p) => p.image.endsWith(':1.7'))).toBe(true)
    const rss = sim.replicaSetsOf(dep)
    expect(rss).toHaveLength(2)
    expect(rss[0].desired).toBe(0)
  })

  it('never drops below desired availability during a rollout', () => {
    const sim = cluster()
    sim.setImage('backend', 'backend', 'ghcr.io/kubelearn/backend:1.7')
    let min = 3
    for (let t = 0; t < 30000; t += 16) {
      sim.advance(16)
      min = Math.min(min, ready(sim).length)
    }
    expect(min).toBe(3)
  })

  it('a broken version crash-loops and stalls the rollout, old Pods keep serving', () => {
    const sim = cluster(true)
    sim.setImage('backend', 'backend', 'ghcr.io/kubelearn/backend:1.5')
    settle(sim, 15000)
    const dep = sim.findDeployment('backend')!
    expect(dep.rollout).toBe('stalled')
    const crashing = live(sim).filter((p) => isBroken(p.image))
    expect(crashing).toHaveLength(1)
    expect(crashing[0].restarts).toBeGreaterThan(1)
    expect(['Error', 'CrashLoopBackOff', 'Running']).toContain(crashing[0].phase)
    expect(ready(sim).filter((p) => !isBroken(p.image))).toHaveLength(3)
    expect(sim.findService('backend')!.endpoints).toHaveLength(3)
    expect(text(run(sim, `kubectl logs ${crashing[0].name}`))).toContain('DATABASE_URL')
  })

  it('rollout undo returns to the previous version and removes the broken Pod', () => {
    const sim = cluster()
    sim.setImage('backend', 'backend', 'ghcr.io/kubelearn/backend:1.5')
    settle(sim, 8000)
    expect(sim.rolloutUndo('backend')).toBe('rolledback')
    settle(sim)
    const dep = sim.findDeployment('backend')!
    expect(dep.rollout).toBe('complete')
    expect(live(sim)).toHaveLength(3)
    expect(live(sim).every((p) => !isBroken(p.image))).toBe(true)
    expect(text(run(sim, 'kubectl rollout status deployment/backend'))).toContain('successfully rolled out')
  })
})

describe('rollout ordering', () => {
  it('reports RolloutComplete only after the old Pods are gone', () => {
    const sim = new Simulation()
    sim.bootstrap({ deployments: [backend] })
    sim.setImage('backend', 'backend', 'ghcr.io/kubelearn/backend:1.5')
    settle(sim, 6000)
    sim.rolloutUndo('backend')
    settle(sim)
    const r = reasons(sim)
    expect(r.lastIndexOf('Removed')).toBeLessThan(r.lastIndexOf('RolloutComplete'))
  })
})
