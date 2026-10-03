import { LESSON_CATALOG, LESSON_IDS } from '@kubelearn/shared'
import { describe, expect, it } from 'vitest'
import { LESSONS } from '..'

/** The server accepts progress for the ids in catalog.json; the app must use exactly those. */
describe('lessons match the shared catalog', () => {
  it('has the same lessons', () => {
    expect(LESSONS.map((l) => l.id).sort()).toEqual([...LESSON_IDS].sort())
  })

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s has the same required and optional objectives', (id, lesson) => {
    const entry = LESSON_CATALOG[id as keyof typeof LESSON_CATALOG]
    expect(lesson.objectives.filter((o) => !o.optional).map((o) => o.id)).toEqual(entry.required)
    expect(lesson.objectives.filter((o) => o.optional).map((o) => o.id)).toEqual(entry.optional)
  })
})
