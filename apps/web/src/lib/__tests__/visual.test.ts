import { describe, expect, it } from 'vitest'
import { Simulation } from '../../sim/engine'
import { computeLayout } from '../visual'

describe('computeLayout', () => {
  it('lays out multiple Deployments and their children without overlap', () => {
    const sim = new Simulation()
    sim.bootstrap({
      deployments: [
        { name: 'backend', replicas: 3, labels: { app: 'backend' }, image: 'backend:1' },
        { name: 'worker', replicas: 2, labels: { app: 'worker' }, image: 'worker:1' },
      ],
    })
    const layout = computeLayout(sim.cluster)
    const boxes = Object.values(layout.boxes)
    expect(boxes.filter((box) => box.kind === 'Deployment')).toHaveLength(2)
    expect(boxes.filter((box) => box.kind === 'ReplicaSet')).toHaveLength(2)
    expect(boxes.filter((box) => box.kind === 'Pod')).toHaveLength(5)
    for (const [index, a] of boxes.entries()) {
      expect(a.x - a.w / 2).toBeGreaterThanOrEqual(0)
      expect(a.x + a.w / 2).toBeLessThanOrEqual(layout.width)
      for (const b of boxes.slice(index + 1)) {
        if (a.y !== b.y) continue
        expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual((a.w + b.w) / 2)
      }
    }
  })
})
