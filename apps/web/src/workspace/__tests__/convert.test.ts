import { APP_COLOR_NAMES, APP_EMOJIS as SHARED_EMOJIS, DEFAULT_DESIGN as SHARED_DEFAULT, parseWorkspace, sameWorkspace, WORKSPACE_RULES } from '@kubelearn/shared'
import { describe, expect, it } from 'vitest'
import { LIMITS as RUN_LIMITS } from '../../runtime/program'
import { APP_COLORS, APP_EMOJIS, DEFAULT_DESIGN, LIMITS, MAX_RELEASES, reservedTag, type Stored } from '../../store/useApp'
import { fromWire, toWire } from '../convert'

describe('the app store agrees with the shared rules the server enforces', () => {
  it('same emojis, colors, limits and default design', () => {
    expect([...APP_EMOJIS]).toEqual([...SHARED_EMOJIS])
    expect(Object.keys(APP_COLORS)).toEqual([...APP_COLOR_NAMES])
    expect(LIMITS).toEqual({ name: WORKSPACE_RULES.design.nameMax, message: WORKSPACE_RULES.design.messageMax })
    expect(RUN_LIMITS.codeChars).toBe(WORKSPACE_RULES.codeMax)
    expect(MAX_RELEASES).toBe(WORKSPACE_RULES.releasesMax)
    expect(DEFAULT_DESIGN).toEqual(SHARED_DEFAULT)
    for (const tag of ['1.4', '1.10', 'latest', '2.0', 'beta']) expect(reservedTag(tag)).toBe(new RegExp(WORKSPACE_RULES.reservedTagPattern).test(tag))
  })
})

describe('toWire / fromWire', () => {
  const stored: Stored = {
    design: { name: 'Raposa', emoji: '🦊', color: 'laranja', message: 'oi' },
    customized: true,
    code: 'console.log(1)\n',
    designAt: Date.UTC(2026, 0, 2),
    codeAt: Date.UTC(2026, 0, 3, 4, 5, 6, 789),
    releases: [
      { tag: '2.0', design: { name: 'Raposa', emoji: '🦊', color: 'laranja', message: 'oi' }, broken: true, createdAt: Date.UTC(2026, 0, 1) },
      { tag: 'com-codigo', design: { name: 'Raposa', emoji: '🦊', color: 'laranja', message: 'oi' }, broken: false, code: 'x', createdAt: Date.UTC(2026, 0, 4) },
    ],
  }

  it('round-trips everything the store holds, and the wire form is already canonical', () => {
    const wire = toWire(stored)
    expect(fromWire(wire)).toEqual(stored)
    expect(sameWorkspace(parseWorkspace(JSON.parse(JSON.stringify(wire)))!, wire)).toBe(true)
  })

  it('"never" is 0 in the store and null on the wire; older releases without a date sort first', () => {
    const wire = toWire({ ...stored, designAt: 0, codeAt: 0, code: null, releases: [{ ...stored.releases[0], createdAt: 0 }] })
    expect(wire.draft).toMatchObject({ designAt: null, codeAt: null, code: null })
    expect(wire.releases[0].createdAt).toBe('1970-01-01T00:00:00.000Z')
    expect(fromWire(wire).releases[0].createdAt).toBe(0)
  })
})

describe('canonical', () => {
  it('is what the server would store, so sync never chases a difference it normalizes away', async () => {
    const { canonical } = await import('../convert')
    const messy = toWire({
      design: { name: ' Raposa ', emoji: '🦊', color: 'laranja', message: 'oi ' },
      customized: true,
      code: 'a\u0000b',
      designAt: 1,
      codeAt: 1,
      releases: [
        { tag: 'b', design: DEFAULT_DESIGN, broken: false, createdAt: Date.UTC(2026, 0, 2) },
        { tag: 'a', design: DEFAULT_DESIGN, broken: false, createdAt: Date.UTC(2026, 0, 1) },
      ],
    })
    const c = canonical(messy)
    expect(c.draft.design).toMatchObject({ name: 'Raposa', message: 'oi' })
    expect(c.draft.code).toBe('ab')
    expect(c.releases.map((r) => r.tag)).toEqual(['a', 'b'])
    expect(sameWorkspace(canonical(c), c)).toBe(true)
  })
})
