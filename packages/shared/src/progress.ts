// zod/mini: same validation, tree-shakeable (this ships in the web bundle)
import * as z from 'zod/mini'
import { isLessonId, LESSON_CATALOG, objectivesOf, type LessonId } from './catalog.ts'

/**
 * Progress is designed to only ever grow, so any two copies can be merged without
 * conflicts — in any order, any number of times — and always agree:
 *
 *   objectives   set union          (once done, always done)
 *   completedAt  earliest           (when you *first* finished)
 *   bestMs       smallest           (personal best)
 *   last         latest `at` wins   (where to resume; the only last-writer-wins field)
 */
export interface LessonProgress {
  objectives: string[]
  completedAt: string | null
  bestMs: number | null
}

export interface Progress {
  lessons: Partial<Record<LessonId, LessonProgress>>
  last: { lessonId: LessonId; at: string } | null
}

const isoDate = z.iso.datetime({ offset: true })

const LessonProgressSchema = z.object({
  objectives: z.array(z.string().check(z.minLength(1), z.maxLength(40))).check(z.maxLength(32)),
  completedAt: z.nullable(isoDate),
  bestMs: z.nullable(z.int().check(z.positive(), z.lte(24 * 60 * 60 * 1000))),
})

/** Shape check for anything that crosses a trust boundary (network, localStorage). */
export const ProgressSchema = z.object({
  lessons: z.record(z.string().check(z.maxLength(40)), LessonProgressSchema).check(z.refine((r) => Object.keys(r).length <= 64, 'too many lessons')),
  last: z.nullable(z.object({ lessonId: z.string().check(z.maxLength(40)), at: isoDate })),
})

export const emptyProgress = (): Progress => ({ lessons: {}, last: null })

const toIso = (s: string) => new Date(s).toISOString()
const earliest = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : Date.parse(a) <= Date.parse(b) ? a : b)
const smallest = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b))

/**
 * Drop what this version doesn't know (unknown lessons or objectives), and put the rest
 * in canonical form: sorted, de-duplicated, UTC timestamps. Valid input never throws.
 */
export function sanitizeProgress(input: z.infer<typeof ProgressSchema>): Progress {
  const lessons: Progress['lessons'] = {}
  for (const [id, lp] of Object.entries(input.lessons)) {
    if (!isLessonId(id)) continue
    const known = new Set(objectivesOf(id))
    const objectives = [...new Set(lp.objectives.filter((o) => known.has(o)))].sort()
    const completedAt = lp.completedAt ? toIso(lp.completedAt) : null
    // a best time only means something for a finished lesson
    const bestMs = completedAt ? lp.bestMs : null
    if (!objectives.length && !completedAt) continue
    lessons[id] = { objectives, completedAt, bestMs }
  }
  const last = input.last && isLessonId(input.last.lessonId) ? { lessonId: input.last.lessonId, at: toIso(input.last.at) } : null
  return { lessons, last }
}

/** Parse untrusted data into canonical Progress, or null if the shape is wrong. */
export function parseProgress(data: unknown): Progress | null {
  const r = ProgressSchema.safeParse(data)
  return r.success ? sanitizeProgress(r.data) : null
}

function mergeLesson(a: LessonProgress | undefined, b: LessonProgress | undefined): LessonProgress {
  if (!a) return b!
  if (!b) return a
  return {
    objectives: [...new Set([...a.objectives, ...b.objectives])].sort(),
    completedAt: earliest(a.completedAt, b.completedAt),
    bestMs: smallest(a.bestMs, b.bestMs),
  }
}

/** Commutative, associative and idempotent. Inputs must be canonical (see sanitizeProgress). */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const ids = [...new Set([...Object.keys(a.lessons), ...Object.keys(b.lessons)])].sort() as LessonId[]
  const lessons: Progress['lessons'] = {}
  for (const id of ids) lessons[id] = mergeLesson(a.lessons[id], b.lessons[id])
  let last = a.last ?? b.last
  if (a.last && b.last) {
    const ta = Date.parse(a.last.at)
    const tb = Date.parse(b.last.at)
    // ties broken by id so every replica picks the same winner
    last = ta > tb || (ta === tb && a.last.lessonId >= b.last.lessonId) ? a.last : b.last
  }
  return { lessons, last }
}

/** Structural equality for canonical Progress (key order independent). */
export function sameProgress(a: Progress, b: Progress): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

function canonicalJson(p: Progress) {
  const ids = Object.keys(p.lessons).sort() as LessonId[]
  return JSON.stringify({ lessons: ids.map((id) => [id, p.lessons[id]]), last: p.last })
}

export const isComplete = (p: Progress, id: LessonId) => !!p.lessons[id]?.completedAt

export const completedCount = (p: Progress) => Object.values(p.lessons).filter((l) => l?.completedAt).length

/** Share of required objectives ever done — for "partially done" indicators. */
export function lessonFraction(p: Progress, id: LessonId) {
  const lp = p.lessons[id]
  if (!lp) return 0
  if (lp.completedAt) return 1
  const required: readonly string[] = LESSON_CATALOG[id].required
  return lp.objectives.filter((o) => required.includes(o)).length / required.length
}
