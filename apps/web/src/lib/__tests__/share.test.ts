import { describe, expect, it } from 'vitest'
import { Simulation } from '../../sim/engine'
import { run } from '../../sim/kubectl'
import { settle } from '../../sim/__tests__/helpers'
import { sameShape, shareList, shareRecord } from '../share'
import { computeLayout, shareLayout } from '../visual'

describe('structural sharing', () => {
  it('compares one level of nested plain objects, nothing deeper or stranger', () => {
    expect(sameShape({ a: 1, p: { x: 1, y: 2 } }, { a: 1, p: { x: 1, y: 2 } })).toBe(true)
    expect(sameShape({ a: 1, p: { x: 1, y: 2 } }, { a: 1, p: { x: 1, y: 3 } })).toBe(false)
    expect(sameShape({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(sameShape({ l: [1] }, { l: [1] })).toBe(false) // arrays aren't plain objects: compared by identity
  })

  it('keeps equal elements, takes new ones, and returns the very same list when nothing changed', () => {
    const prev = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]
    const same = shareList(prev, [{ id: 'a', v: 1 }, { id: 'b', v: 2 }], (t) => t.id)
    expect(same).toBe(prev)
    const next = shareList(prev, [{ id: 'a', v: 1 }, { id: 'b', v: 3 }], (t) => t.id)
    expect(next).not.toBe(prev)
    expect(next[0]).toBe(prev[0])
    expect(next[1]).toEqual({ id: 'b', v: 3 })
    // a reorder is a change, even with the same elements
    const swapped = shareList(prev, [{ id: 'b', v: 2 }, { id: 'a', v: 1 }], (t) => t.id)
    expect(swapped).not.toBe(prev)
    expect(swapped[0]).toBe(prev[1])
    // removals too
    expect(shareList(prev, [{ id: 'a', v: 1 }], (t) => t.id)).toEqual([prev[0]])
  })

  it('records: equal entries keep their object, an unchanged record is the same record', () => {
    const prev = { a: { x: 1 }, b: { x: 2 } }
    expect(shareRecord(prev, { a: { x: 1 }, b: { x: 2 } })).toBe(prev)
    const next = shareRecord(prev, { a: { x: 1 }, b: { x: 5 } })
    expect(next.a).toBe(prev.a)
    expect(next.b).toEqual({ x: 5 })
    expect(shareRecord(prev, { a: { x: 1 } })).not.toBe(prev)
  })

  it('a stage layout: a Pod that changes state but not place keeps every box; a new Pod changes only what moved', () => {
    const sim = new Simulation()
    run(sim, 'kubectl apply -f backend.yaml')
    settle(sim)
    const before = computeLayout(sim.cluster)
    const pod = Object.values(sim.cluster.pods)[0]
    run(sim, `kubectl label pod ${pod.name} extra=1`)
    expect(shareLayout(before, computeLayout(sim.cluster))).toBe(before)
    run(sim, 'kubectl scale deployment backend --replicas=4')
    settle(sim)
    const after = shareLayout(before, computeLayout(sim.cluster))
    expect(after).not.toBe(before)
    const kept = Object.keys(before.boxes).filter((uid) => after.boxes[uid] === before.boxes[uid])
    // the Deployment and the first Pods keep their boxes (and so don't re-render)
    expect(kept.length).toBeGreaterThan(0)
    for (const uid of Object.keys(after.boxes)) {
      if (after.boxes[uid] !== before.boxes[uid]) expect(sameShape(after.boxes[uid], before.boxes[uid])).toBe(false)
    }
  })
})
