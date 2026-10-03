import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN, parseStoredApp, useApp } from '../useApp'

describe('useApp', () => {
  beforeEach(() => {
    useApp.setState({ design: DEFAULT_DESIGN, customized: false, studioOpen: false, visits: [], served: 0, failed: 0 })
  })

  it('falls back safely when stored data is missing, malformed or invalid', () => {
    expect(parseStoredApp(null)).toEqual({ design: DEFAULT_DESIGN, customized: false })
    expect(parseStoredApp('{')).toEqual({ design: DEFAULT_DESIGN, customized: false })
    expect(parseStoredApp('[]')).toEqual({ design: DEFAULT_DESIGN, customized: false })
    expect(parseStoredApp(JSON.stringify({ customized: true, design: { name: '', emoji: 'x', color: 'invisível', message: 4 } }))).toEqual({
      design: DEFAULT_DESIGN,
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
})
