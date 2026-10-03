/**
 * Generates fixtures/merge-cases.json from the TypeScript implementation.
 * The Java API's tests replay every case and must produce the exact same output,
 * which keeps client and server merge semantics identical.
 *
 *   npx tsx scripts/make-fixtures.ts
 */
import fc from 'fast-check'
import { writeFileSync } from 'node:fs'
import { LESSON_IDS, objectivesOf, type LessonId } from '../src/catalog.ts'
import { mergeProgress, parseProgress } from '../src/progress.ts'

const date = fc.date({ min: new Date('2024-01-01'), max: new Date('2030-01-01'), noInvalidDate: true }).map((d) => d.toISOString())
const lesson = (id: LessonId) =>
  fc.record({
    objectives: fc.subarray([...objectivesOf(id), 'not-an-objective']),
    completedAt: fc.option(date, { nil: null }),
    bestMs: fc.option(fc.integer({ min: 1, max: 3_600_000 }), { nil: null }),
  })
const raw = fc.record({
  lessons: fc
    .subarray([...LESSON_IDS, 'retired-lesson' as LessonId])
    .chain((ids) => fc.record(Object.fromEntries(ids.map((id) => [id, lesson(isKnown(id) ? id : 'scaling')])))),
  last: fc.option(fc.record({ lessonId: fc.constantFrom(...LESSON_IDS), at: date }), { nil: null }),
})
function isKnown(id: string): id is LessonId {
  return (LESSON_IDS as string[]).includes(id)
}

const cases = fc.sample(fc.tuple(raw, raw), { numRuns: 200, seed: 20261002 }).map(([a, b], i) => ({
  name: `generated-${i}`,
  a,
  b,
  merged: mergeProgress(parseProgress(a)!, parseProgress(b)!),
}))

// hand-written cases for the edges that matter most
const handmade = [
  {
    name: 'first completion and best time win',
    a: { lessons: { scaling: { objectives: ['drag'], completedAt: '2026-01-02T00:00:00.000Z', bestMs: 9000 } }, last: null },
    b: { lessons: { scaling: { objectives: ['command'], completedAt: '2026-01-01T00:00:00.000Z', bestMs: 12000 } }, last: null },
  },
  {
    name: 'timezone offsets normalize to UTC',
    a: { lessons: { debugging: { objectives: [], completedAt: '2026-03-01T12:00:00+03:00', bestMs: 4000 } }, last: null },
    b: { lessons: {}, last: null },
  },
  {
    name: 'best time without completion is dropped',
    a: { lessons: { labels: { objectives: [], completedAt: null, bestMs: 500 } }, last: null },
    b: { lessons: {}, last: null },
  },
  {
    name: 'last lesson tie broken by id',
    a: { lessons: {}, last: { lessonId: 'scaling', at: '2026-05-05T05:05:05.000Z' } },
    b: { lessons: {}, last: { lessonId: 'labels', at: '2026-05-05T05:05:05.000Z' } },
  },
].map((c) => ({ ...c, merged: mergeProgress(parseProgress(c.a)!, parseProgress(c.b)!) }))

writeFileSync(new URL('../fixtures/merge-cases.json', import.meta.url), JSON.stringify({ cases: [...handmade, ...cases] }, null, 1) + '\n')
console.log(`wrote ${handmade.length + cases.length} cases`)
