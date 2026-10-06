import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  APP_COLOR_NAMES,
  APP_EMOJIS,
  DEFAULT_DESIGN,
  WORKSPACE_RULES,
  emptyWorkspace,
  mergeWorkspace,
  parseWorkspace,
  sameWorkspace,
  sanitizeWorkspace,
  type Workspace,
} from '../src/workspace.ts'

const date = fc.date({ min: new Date('2024-01-01'), max: new Date('2030-01-01'), noInvalidDate: true }).map((d) => d.toISOString())
// few distinct values, so ties and collisions actually happen
const fewDates = fc.constantFrom('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z')
const anyDate = fc.oneof(date, fewDates)
const design = fc.record({
  name: fc.constantFrom('Meu app', 'Raposa', 'Polvo'),
  emoji: fc.constantFrom(...APP_EMOJIS.slice(0, 3)),
  color: fc.constantFrom(...APP_COLOR_NAMES.slice(0, 3)),
  message: fc.constantFrom('', 'oi', 'v2!'),
})
const code = fc.option(fc.constantFrom('console.log(1)', 'function handle() { return "oi" }', ''), { nil: null })
const release = fc.record({ tag: fc.constantFrom('2.0', '2.1', '2.2', 'beta', 'v1', 'x'), design, broken: fc.boolean(), code, createdAt: anyDate })
const raw = fc.record({
  draft: fc.record({ design, designAt: fc.option(anyDate, { nil: null }), code, codeAt: fc.option(anyDate, { nil: null }), customized: fc.boolean() }),
  releases: fc.array(release, { maxLength: 8 }),
})
const ws: fc.Arbitrary<Workspace> = raw.map((r) => sanitizeWorkspace(r))

describe('mergeWorkspace', () => {
  it('is commutative', () => fc.assert(fc.property(ws, ws, (a, b) => sameWorkspace(mergeWorkspace(a, b), mergeWorkspace(b, a)))))

  it('is associative', () =>
    fc.assert(fc.property(ws, ws, ws, (a, b, c) => sameWorkspace(mergeWorkspace(mergeWorkspace(a, b), c), mergeWorkspace(a, mergeWorkspace(b, c))))))

  it('is idempotent', () => fc.assert(fc.property(ws, (a) => sameWorkspace(mergeWorkspace(a, a), a))))

  it('keeps every tag either side had (under the cap), and the newest edits', () =>
    fc.assert(
      fc.property(ws, ws, (a, b) => {
        const m = mergeWorkspace(a, b)
        const tags = new Set([...a.releases, ...b.releases].map((r) => r.tag))
        if (m.releases.length !== Math.min(tags.size, WORKSPACE_RULES.releasesMax)) return false
        const newest = (x: string | null, y: string | null) => (x === null ? y : y === null ? x : Date.parse(x) >= Date.parse(y) ? x : y)
        return m.draft.designAt === newest(a.draft.designAt, b.draft.designAt) && m.draft.codeAt === newest(a.draft.codeAt, b.draft.codeAt)
      }),
    ))

  it('stays associative and commutative when the cap applies', () => {
    const crowded = fc
      .array(fc.record({ tag: fc.integer({ min: 0, max: 40 }).map((n) => `t${n}`), design, broken: fc.boolean(), code, createdAt: fewDates.chain((d) => fc.integer({ min: 0, max: 30 }).map((m) => new Date(Date.parse(d) + m * 60_000).toISOString())) }), { maxLength: 30 })
      .map((releases) => sanitizeWorkspace({ ...emptyWorkspace(), releases }))
    fc.assert(
      fc.property(crowded, crowded, crowded, (a, b, c) =>
        sameWorkspace(mergeWorkspace(mergeWorkspace(a, b), c), mergeWorkspace(a, mergeWorkspace(b, c))) && sameWorkspace(mergeWorkspace(a, b), mergeWorkspace(b, a)),
      ),
      { numRuns: 300 },
    )
  })

  it('the cap keeps the earliest releases, whatever the order of merges', () => {
    const many = (from: number, n: number): Workspace => ({
      ...emptyWorkspace(),
      releases: Array.from({ length: n }, (_, i) => ({ tag: `t${from + i}`, design: DEFAULT_DESIGN, broken: false, code: null, createdAt: new Date(Date.UTC(2026, 0, 1, 0, from + i)).toISOString() })),
    })
    const m = mergeWorkspace(many(10, 15), many(0, 15))
    expect(m.releases).toHaveLength(WORKSPACE_RULES.releasesMax)
    expect(m.releases[0].tag).toBe('t0')
    expect(m.releases.at(-1)!.tag).toBe(`t${WORKSPACE_RULES.releasesMax - 1}`)
  })
})

describe('parseWorkspace', () => {
  const base = { draft: { design: DEFAULT_DESIGN, designAt: null, code: null, codeAt: null, customized: false }, releases: [] }

  it('rejects the wrong shape', () => {
    expect(parseWorkspace(null)).toBeNull()
    expect(parseWorkspace({ ...base, draft: { ...base.draft, code: 'x'.repeat(WORKSPACE_RULES.codeMax + 1) } })).toBeNull()
    expect(parseWorkspace({ ...base, draft: { ...base.draft, design: { ...DEFAULT_DESIGN, name: 'n'.repeat(25) } } })).toBeNull()
    expect(parseWorkspace({ ...base, draft: { ...base.draft, designAt: 'ontem' } })).toBeNull()
  })

  it('drops reserved and invalid tags, unknown emojis and colors, control characters; normalizes dates', () => {
    const r = (tag: string) => ({ tag, design: DEFAULT_DESIGN, broken: false, code: null, createdAt: '2026-03-01T12:00:00+03:00' })
    const w = parseWorkspace({
      draft: { design: { name: '  ', emoji: '👾', color: 'preto', message: ' oi ' }, designAt: null, code: 'a\u0000b\tc\n', codeAt: null, customized: true },
      releases: [r('1.4'), r('latest'), r('-x'), r('2.0')],
    })!
    expect(w.draft.design).toEqual({ ...DEFAULT_DESIGN, message: 'oi' })
    expect(w.draft.code).toBe('ab\tc\n')
    expect(w.releases.map((x) => x.tag)).toEqual(['2.0'])
    expect(w.releases[0].createdAt).toBe('2026-03-01T09:00:00.000Z')
  })

  it('the first image published with a tag is the one that stays', () => {
    const at = (t: string, code: string) => ({ tag: '2.0', design: DEFAULT_DESIGN, broken: false, code, createdAt: t })
    const a = parseWorkspace({ ...base, releases: [at('2026-01-02T00:00:00Z', 'segundo')] })!
    const b = parseWorkspace({ ...base, releases: [at('2026-01-01T00:00:00Z', 'primeiro')] })!
    expect(mergeWorkspace(a, b).releases.map((r) => r.code)).toEqual(['primeiro'])
  })

  it('design and code are edited independently', () => {
    const a = parseWorkspace({ ...base, draft: { ...base.draft, design: { ...DEFAULT_DESIGN, name: 'Celular' }, designAt: '2026-01-05T00:00:00Z', code: 'velho', codeAt: '2026-01-01T00:00:00Z' } })!
    const b = parseWorkspace({ ...base, draft: { ...base.draft, design: { ...DEFAULT_DESIGN, name: 'Notebook' }, designAt: '2026-01-02T00:00:00Z', code: 'novo', codeAt: '2026-01-04T00:00:00Z' } })!
    const m = mergeWorkspace(a, b)
    expect(m.draft.design.name).toBe('Celular')
    expect(m.draft.code).toBe('novo')
  })
})
