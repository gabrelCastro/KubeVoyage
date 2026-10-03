import { describe, expect, it } from 'vitest'
import { Simulation } from '../engine'
import { run } from '../kubectl'
import { IMAGE } from '../manifests'
import { settle } from './helpers'

const text = (r: ReturnType<typeof run>) => r.lines.map((l) => l.map((s) => s.t).join('')).join('\n')
const out = (sim: Simulation, cmd: string) => text(run(sim, cmd))
const LOAD = 'kubectl run load-generator --image=busybox:1.36 --restart=Never -- /bin/sh -c "while sleep 0.01; do wget -q -O- http://backend; done"'

function cluster() {
  const sim = new Simulation()
  sim.bootstrap({
    deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }],
    services: [{ name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 }],
  })
  sim.files.push('backend-resources.yaml')
  return sim
}

describe('resources and the HorizontalPodAutoscaler', () => {
  it('kubectl top shows each Pod using its share of the traffic', () => {
    const sim = cluster()
    expect(out(sim, 'kubectl top pods')).toMatch(/^NAME\s+CPU\(cores\)\s+MEMORY\(bytes\)/)
    expect(out(sim, 'kubectl top pods')).toMatch(/backend-\S+\s+25m\s+\d+Mi/)
    expect(out(sim, 'kubectl top nodes')).toMatch(/^node-1\s+\d+m\s+\d+%/m)
  })

  it('without requests, the HPA cannot compute utilization', () => {
    const sim = cluster()
    expect(out(sim, 'kubectl autoscale deployment backend --cpu=50% --min=2 --max=8')).toBe('horizontalpodautoscaler.autoscaling/backend autoscaled')
    settle(sim, 8000)
    expect(out(sim, 'kubectl get hpa')).toMatch(/backend\s+Deployment\/backend\s+cpu: <unknown>\/50%\s+2\s+8\s+3/)
    expect(sim.events.some((e) => e.reason === 'FailedGetResourceMetric')).toBe(true)
    expect(sim.findDeployment('backend')!.replicas).toBe(3)
  })

  it('with requests, load makes it scale up — and back down only after the load stays low', () => {
    const sim = cluster()
    run(sim, 'kubectl apply -f backend-resources.yaml')
    settle(sim, 25000)
    run(sim, 'kubectl autoscale deployment backend --cpu=50% --min=2 --max=8')
    settle(sim, 8000)
    // 30 req/s over 3 Pods: ~25m of 200m — little load, so it scales down to the minimum after the window
    expect(out(sim, 'kubectl get hpa')).toMatch(/cpu: \d+%\/50%/)
    settle(sim, 40000)
    expect(sim.findDeployment('backend')!.replicas).toBe(2)

    expect(out(sim, LOAD)).toContain('pod/load-generator created')
    settle(sim, 60000)
    const scaledUp = sim.findDeployment('backend')!.replicas
    expect(scaledUp).toBeGreaterThanOrEqual(6)
    expect(sim.events.some((e) => e.reason === 'SuccessfulRescale' && e.message.includes('above target'))).toBe(true)

    run(sim, 'kubectl delete pod load-generator')
    settle(sim, 8000)
    // the load is gone, but the stabilization window holds the replicas for a while
    expect(sim.findDeployment('backend')!.replicas).toBe(scaledUp)
    settle(sim, 60000)
    expect(sim.findDeployment('backend')!.replicas).toBe(2)
  })

  it('requests reserve node CPU: asking for too much leaves Pods Pending', () => {
    const sim = cluster()
    run(sim, 'kubectl apply -f backend-resources.yaml')
    settle(sim, 25000)
    run(sim, 'kubectl scale deployment backend --replicas=8')
    settle(sim, 20000)
    // 8 × 200m = 1600m fits in 3 × 1000m
    expect(Object.values(sim.cluster.pods).filter((p) => p.ready)).toHaveLength(8)
    expect(sim.requestedOn('node-1') + sim.requestedOn('node-2') + sim.requestedOn('node-3')).toBe(1600)
  })

  it('kubectl describe and -o yaml show requests, limits and the HPA', () => {
    const sim = cluster()
    run(sim, 'kubectl apply -f backend-resources.yaml')
    settle(sim, 25000)
    run(sim, 'kubectl autoscale deployment backend --cpu=50% --min=2 --max=8')
    settle(sim, 4000)
    const pod = Object.values(sim.cluster.pods).find((p) => p.deletedAt === null)!
    expect(out(sim, `kubectl describe pod ${pod.name}`)).toMatch(/Requests:\s+cpu: 200m/)
    expect(out(sim, 'kubectl get deploy backend -o yaml')).toMatch(/requests:\n\s+cpu: 200m/)
    expect(out(sim, 'kubectl get hpa backend -o yaml')).toContain('averageUtilization: 50')
    expect(out(sim, 'kubectl describe hpa backend')).toContain('ValidMetricFound')
    expect(out(sim, 'kubectl delete hpa backend')).toBe('horizontalpodautoscaler.autoscaling "backend" deleted')
  })

  it('refuses the interactive endless loop, with the way to do it here', () => {
    const o = out(cluster(), 'kubectl run -i --tty load-generator --rm --image=busybox:1.28 --restart=Never -- /bin/sh -c "while sleep 0.01; do wget -q -O- http://backend; done"')
    expect(o).toContain('Ctrl+C')
    expect(o).toContain('kubectl run load-generator --image=busybox:1.28 --restart=Never --')
  })
})
