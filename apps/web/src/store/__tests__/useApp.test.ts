import { beforeEach, describe, expect, it } from 'vitest'
import { Simulation, isBroken } from '../../sim/engine'
import { run } from '../../sim/kubectl'
import { settle } from '../../sim/__tests__/helpers'
import { DEFAULT_DESIGN, designFor, imageOf, parseStoredApp, useApp, type AppDesign } from '../useApp'

describe('useApp', () => {
  beforeEach(() => {
    useApp.setState({ design: DEFAULT_DESIGN, customized: false, releases: [], studioOpen: false, visits: [], served: 0, failed: 0 })
  })

  it('falls back safely when stored data is missing, malformed or invalid', () => {
    expect(parseStoredApp(null)).toEqual({ design: DEFAULT_DESIGN, customized: false, releases: [] })
    expect(parseStoredApp('{')).toEqual({ design: DEFAULT_DESIGN, customized: false, releases: [] })
    expect(parseStoredApp('[]')).toEqual({ design: DEFAULT_DESIGN, customized: false, releases: [] })
    expect(parseStoredApp(JSON.stringify({ customized: true, design: { name: '', emoji: 'x', color: 'invisível', message: 4 } }))).toEqual({
      design: DEFAULT_DESIGN,
      customized: true,
      releases: [],
    })
  })

  it('sanitizes valid stored fields and enforces text limits', () => {
    const stored = parseStoredApp(JSON.stringify({ customized: true, design: { name: 'n'.repeat(40), emoji: '🦊', color: 'verde', message: 'm'.repeat(80) } }))
    expect(stored.customized).toBe(true)
    expect(stored.design).toEqual({ name: 'n'.repeat(24), emoji: '🦊', color: 'verde', message: 'm'.repeat(60) })
  })

  it('keeps the latest 32 visits while counters cover the whole session', () => {
    for (let i = 0; i < 40; i++) useApp.getState().visit({ ok: i % 2 === 0, podName: `backend-${i}` })
    const state = useApp.getState()
    expect(state.visits).toHaveLength(32)
    expect(state.visits[0].podName).toBe('backend-8')
    expect(state.served).toBe(20)
    expect(state.failed).toBe(20)
  })

  it('resets visits and both counters together', () => {
    useApp.getState().visit({ ok: true, podName: 'backend-a' })
    useApp.getState().visit({ ok: false })
    useApp.getState().resetVisits()
    expect(useApp.getState()).toMatchObject({ visits: [], served: 0, failed: 0 })
  })

  const fox: AppDesign = { name: 'Raposa', emoji: '🦊', color: 'laranja', message: 'v2!' }

  it('publishes versions as sequential, immutable tags', () => {
    expect(useApp.getState().publish(fox, false)).toBe(imageOf('2.0'))
    expect(useApp.getState().publish({ ...fox, emoji: '🐙' }, true)).toBe(imageOf('2.1'))
    const s = useApp.getState()
    expect(s.releases.map((r) => r.tag)).toEqual(['2.0', '2.1'])
    expect(designFor(s, imageOf('2.0')).emoji).toBe('🦊')
    // the lessons' images and unknown tags show the starting design
    expect(designFor(s, imageOf('1.4'))).toEqual(DEFAULT_DESIGN)
    expect(designFor(s, 'nginx:1.27')).toEqual(DEFAULT_DESIGN)
  })

  it('restores stored releases with clean, renumbered tags', () => {
    const stored = parseStoredApp(JSON.stringify({ releases: [{ tag: '9.9', design: fox, broken: true }, 'junk', { design: {} }] }))
    expect(stored.releases).toEqual([
      { tag: '2.0', design: fox, broken: true },
      { tag: '2.1', design: DEFAULT_DESIGN, broken: false },
    ])
  })

  it('a version published with a bug really crash-loops in the cluster', () => {
    const image = useApp.getState().publish(fox, true)!
    expect(isBroken(image)).toBe(true)
    expect(isBroken(useApp.getState().publish(fox, false)!)).toBe(false)
    const sim = new Simulation()
    run(sim, 'kubectl apply -f backend.yaml')
    settle(sim)
    run(sim, `kubectl set image deployment/backend backend=${image}`)
    settle(sim, 20000)
    const crashing = Object.values(sim.cluster.pods).filter((p) => p.image === image)
    expect(crashing.length).toBeGreaterThan(0)
    expect(crashing.every((p) => !p.ready && p.restarts > 0)).toBe(true)
    expect(sim.findDeployment('backend')!.rollout).toBe('stalled')
  })
})
