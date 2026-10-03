import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { LESSON_IDS, objectivesOf, type LessonId } from '../src/catalog.ts'
import { emptyProgress, lessonFraction, mergeProgress, parseProgress, sameProgress, sanitizeProgress, type Progress } from '../src/progress.ts'

const date = fc.date({ min: new Date('2024-01-01'), max: new Date('2030-01-01'), noInvalidDate: true }).map((d) => d.toISOString())

const lessonArb = (id: LessonId) =>
  fc.record({
    objectives: fc.subarray([...objectivesOf(id)]),
    completedAt: fc.option(date, { nil: null }),
    bestMs: fc.option(fc.integer({ min: 1, max: 3_600_000 }), { nil: null }),
  })

const progressArb: fc.Arbitrary<Progress> = fc
  .record({
    lessons: fc.dictionary(fc.constantFrom(...LESSON_IDS), fc.constant(null)).chain((keys) =>
      fc.record(Object.fromEntries(Object.keys(keys).map((id) => [id, lessonArb(id as LessonId)]))),
    ),
    last: fc.option(fc.record({ lessonId: fc.constantFrom(...LESSON_IDS), at: date }), { nil: null }),
  })
  .map((raw) => sanitizeProgress(raw as never))

describe('mergeProgress', () => {
  it('is commutative', () => fc.assert(fc.property(progressArb, progressArb, (a, b) => sameProgress(mergeProgress(a, b), mergeProgress(b, a)))))

  it('is associative', () =>
    fc.assert(fc.property(progressArb, progressArb, progressArb, (a, b, c) => sameProgress(mergeProgress(mergeProgress(a, b), c), mergeProgress(a, mergeProgress(b, c))))))

  it('is idempotent', () => fc.assert(fc.property(progressArb, (a) => sameProgress(mergeProgress(a, a), a))))

  it('never loses anything either side had', () =>
    fc.assert(
      fc.property(progressArb, progressArb, (a, b) => {
        const m = mergeProgress(a, b)
        for (const side of [a, b])
          for (const [id, lp] of Object.entries(side.lessons)) {
            const merged = m.lessons[id as LessonId]!
            if (!lp!.objectives.every((o) => merged.objectives.includes(o))) return false
            if (lp!.completedAt && !merged.completedAt) return false
          }
        return true
      }),
    ))

  it('keeps the first completion and the best time', () => {
    const a = sanitizeProgress({ lessons: { scaling: { objectives: ['drag'], completedAt: '2026-01-02T00:00:00.000Z', bestMs: 9000 } }, last: null })
    const b = sanitizeProgress({ lessons: { scaling: { objectives: ['command'], completedAt: '2026-01-01T00:00:00.000Z', bestMs: 12000 } }, last: null })
    expect(mergeProgress(a, b).lessons.scaling).toEqual({ objectives: ['command', 'drag'], completedAt: '2026-01-01T00:00:00.000Z', bestMs: 9000 })
  })

  it('resumes the most recently opened lesson', () => {
    const a = sanitizeProgress({ lessons: {}, last: { lessonId: 'scaling', at: '2026-01-01T10:00:00Z' } })
    const b = sanitizeProgress({ lessons: {}, last: { lessonId: 'labels', at: '2026-01-01T11:00:00Z' } })
    expect(mergeProgress(a, b).last?.lessonId).toBe('labels')
  })
})

describe('parseProgress', () => {
  it('round-trips canonical progress through JSON', () =>
    fc.assert(fc.property(progressArb, (p) => sameProgress(parseProgress(JSON.parse(JSON.stringify(p)))!, p))))

  it('drops unknown lessons and objectives instead of failing', () => {
    const p = parseProgress({
      lessons: { 'from-the-future': { objectives: ['x'], completedAt: null, bestMs: null }, scaling: { objectives: ['drag', 'ghost', 'drag'], completedAt: null, bestMs: null } },
      last: { lessonId: 'from-the-future', at: '2026-01-01T00:00:00Z' },
    })
    expect(p).toEqual({ lessons: { scaling: { objectives: ['drag'], completedAt: null, bestMs: null } }, last: null })
  })

  it('normalizes timestamps to UTC', () => {
    const p = parseProgress({ lessons: { debugging: { objectives: [], completedAt: '2026-03-01T12:00:00+03:00', bestMs: 4000 } }, last: null })
    expect(p?.lessons.debugging?.completedAt).toBe('2026-03-01T09:00:00.000Z')
  })

  it('rejects malformed input', () => {
    for (const bad of [null, 42, 'x', {}, { lessons: [], last: null }, { lessons: {}, last: { lessonId: 'scaling', at: 'yesterday' } }, { lessons: { scaling: { objectives: 'drag', completedAt: null, bestMs: null } }, last: null }, { lessons: { scaling: { objectives: [], completedAt: null, bestMs: -5 } }, last: null }])
      expect(parseProgress(bad)).toBeNull()
  })
})

describe('lessonFraction', () => {
  it('counts required objectives, and is 1 once complete', () => {
    const p = sanitizeProgress({ lessons: { labels: { objectives: ['inspect', 'return'], completedAt: null, bestMs: null } }, last: null })
    expect(lessonFraction(p, 'labels')).toBeCloseTo(1 / 3)
    expect(lessonFraction(emptyProgress(), 'labels')).toBe(0)
  })
})

describe('sanitizeProgress', () => {
  it('is idempotent', () =>
    fc.assert(fc.property(progressArb, (p) => sameProgress(sanitizeProgress(p as never), p))))
})
