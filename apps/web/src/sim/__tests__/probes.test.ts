import { describe, expect, it } from 'vitest'
import { Simulation } from '../engine'
import { run } from '../kubectl'
import { IMAGE } from '../manifests'
import { settle } from './helpers'

const text = (r: ReturnType<typeof run>) => r.lines.map((l) => l.map((s) => s.t).join('')).join('\n')
const live = (sim: Simulation) => Object.values(sim.cluster.pods).filter((p) => p.deletedAt === null)

function cluster() {
  const sim = new Simulation()
  sim.bootstrap({
    deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }],
    services: [{ name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 }],
  })
  sim.files.push('backend-liveness.yaml')
  return sim
}

describe('probes', () => {
  it('v1.6 rolls out fine, then freezes: readiness takes it out of the Service, and nothing restarts it', () => {
    const sim = cluster()
    run(sim, 'kubectl set image deployment/backend backend=ghcr.io/kubelearn/backend:1.6')
    settle(sim, 24000)
    // the rollout finishes before anything freezes: the bug only shows up later
    expect(sim.findDeployment('backend')!.rollout).toBe('complete')
    expect(live(sim).every((p) => p.ready)).toBe(true)
    settle(sim, 30000)
    const pods = live(sim)
    expect(pods.every((p) => p.hung && !p.ready && p.phase === 'Running' && p.restarts === 0)).toBe(true)
    expect(sim.findService('backend')!.endpoints).toEqual([])
    expect(sim.events.some((e) => e.reason === 'Unhealthy' && e.message.startsWith('Readiness probe failed'))).toBe(true)
    expect(text(run(sim, `kubectl logs ${pods[0].name}`))).toContain('worker pool exhausted')
    expect(text(run(sim, `kubectl describe pod ${pods[0].name}`))).toMatch(/Liveness:\s+<none>/)
  })

  it('with a liveness probe, the kubelet restarts frozen containers and the app keeps serving', () => {
    const sim = cluster()
    expect(text(run(sim, 'kubectl apply -f backend-liveness.yaml'))).toBe('deployment.apps/backend configured')
    settle(sim, 80000)
    const pods = live(sim)
    expect(pods.every((p) => p.liveness)).toBe(true)
    expect(pods.some((p) => p.restarts > 0)).toBe(true)
    expect(sim.events.some((e) => e.reason === 'Killing' && e.message.includes('failed liveness probe'))).toBe(true)
    expect(text(run(sim, 'kubectl get deploy backend -o yaml'))).toContain('livenessProbe:')
    // the safety net, not the fix: set image keeps the probe and ends the freezing
    run(sim, 'kubectl set image deployment/backend backend=ghcr.io/kubelearn/backend:1.4')
    settle(sim, 30000)
    const fixed = live(sim)
    expect(fixed.every((p) => p.image === IMAGE && p.liveness && p.ready)).toBe(true)
  })

  it('rollout undo from the probe revision also undoes the probe', () => {
    const sim = cluster()
    run(sim, 'kubectl set image deployment/backend backend=ghcr.io/kubelearn/backend:1.6')
    settle(sim, 4000)
    run(sim, 'kubectl apply -f backend-liveness.yaml')
    settle(sim, 6000)
    run(sim, 'kubectl rollout undo deployment/backend')
    settle(sim, 6000)
    expect(sim.findDeployment('backend')!.template.liveness).toBeFalsy()
  })
})
