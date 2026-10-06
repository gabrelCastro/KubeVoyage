import { beforeEach, describe, expect, it } from 'vitest'
import { Simulation, isBroken } from '../../sim/engine'
import { run } from '../../sim/kubectl'
import { settle } from '../../sim/__tests__/helpers'
import { imageCode } from '../../runtime'
import { DEFAULT_CODE, DEFAULT_DESIGN, designFor, designForPod, imageOf, MAX_RELEASES, nextTag, parseStoredApp, useApp, type AppDesign } from '../useApp'

const EMPTY = { design: DEFAULT_DESIGN, customized: false, releases: [], code: null, designAt: 0, codeAt: 0 }

describe('useApp', () => {
  beforeEach(() => {
    useApp.setState({ ...EMPTY, studioOpen: false, visits: [], podEdits: {}, lostEdits: [], served: 0, failed: 0 })
  })

  it('falls back safely when stored data is missing, malformed or invalid', () => {
    expect(parseStoredApp(null)).toEqual(EMPTY)
    expect(parseStoredApp('{')).toEqual(EMPTY)
    expect(parseStoredApp('[]')).toEqual(EMPTY)
    expect(parseStoredApp(JSON.stringify({ customized: true, design: { name: '', emoji: 'x', color: 'invisível', message: 4 } }))).toEqual({
      ...EMPTY,
      customized: true,
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

  it('restores stored releases keeping valid unique tags, giving the rest the next free one', () => {
    const stored = parseStoredApp(
      JSON.stringify({
        code: 'console.log(1)',
        codeAt: 42,
        releases: [{ tag: 'beta', design: fox, broken: true, code: 'x', createdAt: 7 }, 'junk', { design: {} }, { tag: 'beta', design: fox }, { tag: '1.4', design: fox }],
      }),
    )
    expect(stored.code).toBe('console.log(1)')
    expect(stored.codeAt).toBe(42)
    expect(stored.designAt).toBe(0)
    expect(stored.releases).toEqual([
      { tag: 'beta', design: fox, broken: true, code: 'x', createdAt: 7 },
      { tag: '2.0', design: DEFAULT_DESIGN, broken: false, createdAt: 0 },
      // a duplicate and a lesson tag can't stay as they were
      { tag: '2.1', design: fox, broken: false, createdAt: 0 },
      { tag: '2.2', design: fox, broken: false, createdAt: 0 },
    ])
  })

  it('docker build makes an immutable image from app.js — the template until the learner writes any', () => {
    expect(useApp.getState().build('2.0')).toEqual({ image: imageOf('2.0') })
    expect(imageCode(imageOf('2.0'))).toBe(DEFAULT_CODE)
    useApp.getState().setCode('console.log("v2")')
    expect(useApp.getState().build('2.0')).toMatchObject({ error: expect.stringContaining('já existe') })
    expect(useApp.getState().build('1.4')).toMatchObject({ error: expect.stringContaining('lições') })
    expect(useApp.getState().build('-x')).toMatchObject({ error: expect.stringContaining('invalid tag') })
    expect(useApp.getState().build('com-log')).toEqual({ image: imageOf('com-log') })
    expect(imageCode(imageOf('com-log'))).toBe('console.log("v2")')
    // editing the draft doesn't change what was built
    useApp.getState().setCode('mudou')
    expect(imageCode(imageOf('com-log'))).toBe('console.log("v2")')
    // the studio skips taken tags, and publishes the design only
    expect(nextTag(useApp.getState().releases)).toBe('2.1')
    expect(useApp.getState().publish(fox, false)).toBe(imageOf('2.1'))
    expect(imageCode(imageOf('2.1'))).toBeUndefined()
  })

  it('studio versions never carry code — a "buggy" one crashes like 1.5, whatever app.js says', () => {
    useApp.getState().setCode('console.log("oi")')
    useApp.getState().publish(fox, true)
    expect(useApp.getState().releases[0].code).toBeUndefined()
    expect(imageCode(imageOf('2.0'))).toBeUndefined()
  })

  it(`keeps at most ${MAX_RELEASES} images`, () => {
    for (let i = 0; i < MAX_RELEASES; i++) expect(useApp.getState().build(`v${i}`)).toHaveProperty('image')
    expect(useApp.getState().build('mais-uma')).toHaveProperty('error')
    expect(useApp.getState().publish(fox, false)).toBeNull()
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

  it('a hand edit changes only its Pod, and is lost — and reported — when the Pod goes away', () => {
    const edit = { podName: 'backend-abc-x7f2k', emoji: '🐙', message: 'mexi aqui' }
    useApp.getState().editPod('pod-1', edit)
    const s = useApp.getState()
    expect(designForPod(s, 'pod-1', imageOf('1.4'))).toMatchObject({ emoji: '🐙', message: 'mexi aqui', name: DEFAULT_DESIGN.name })
    expect(designForPod(s, 'pod-2', imageOf('1.4'))).toEqual(DEFAULT_DESIGN)
    useApp.getState().forgetGone(new Set(['pod-1', 'pod-2']))
    expect(useApp.getState().lostEdits).toEqual([])
    useApp.getState().forgetGone(new Set(['pod-2']))
    expect(useApp.getState().podEdits).toEqual({})
    expect(useApp.getState().lostEdits).toEqual([edit])
    useApp.getState().dismissLost()
    expect(useApp.getState().lostEdits).toEqual([])
  })

  it('restarting the lesson drops edits without calling them lost', () => {
    useApp.getState().editPod('pod-1', { podName: 'p', emoji: '🐙', message: 'm' })
    useApp.getState().resetVisits()
    expect(useApp.getState()).toMatchObject({ podEdits: {}, lostEdits: [] })
  })
})
