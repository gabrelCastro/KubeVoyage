import { describe, expect, it } from 'vitest'
import { pushTerm, SCROLLBACK_LINES } from '../scrollback'

type TermEntry = { id: number; lines: { t: string }[][] }

const entry = (id: number, n: number): TermEntry => ({ id, lines: Array.from({ length: n }, () => [{ t: `l${id}` }]) })

describe('terminal scrollback', () => {
  it('keeps everything while it fits', () => {
    let t: TermEntry[] = []
    for (let i = 0; i < 10; i++) t = pushTerm(t, entry(i, 5))
    expect(t).toHaveLength(10)
  })

  it('drops the oldest entries once the lines exceed the limit — the newest always stays', () => {
    let t: TermEntry[] = []
    for (let i = 0; i < 1000; i++) t = pushTerm(t, entry(i, 7))
    const lines = t.reduce((n, e) => n + e.lines.length, 0)
    expect(lines).toBeLessThanOrEqual(SCROLLBACK_LINES)
    expect(lines).toBeGreaterThan(SCROLLBACK_LINES - 7)
    expect(t.at(-1)!.id).toBe(999)
    // a single output longer than the limit: it's what you just asked for, so it stays (alone)
    expect(pushTerm(t, entry(5000, SCROLLBACK_LINES + 50)).map((e) => e.id)).toEqual([5000])
  })
})
