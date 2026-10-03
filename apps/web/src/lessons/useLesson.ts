import type { LessonId } from '@kubelearn/shared'
import { useEffect, useMemo, useRef } from 'react'
import { create } from 'zustand'
import { recordCompletion, recordObjectives, recordOpened, useProgress } from '../progress/browser'
import { useSim } from '../store/useSim'
import { getLesson } from '.'

export function useLesson() {
  const lessonId = useSim((s) => s.lessonId)
  const cluster = useSim((s) => s.cluster)
  const events = useSim((s) => s.events)
  const history = useSim((s) => s.history)
  const seen = useSim((s) => s.seen)
  const done = useSim((s) => s.done)
  return useMemo(() => {
    const lesson = getLesson(lessonId)
    const ctx = { cluster, events, history, seen }
    const statuses = lesson.objectives.map((o) => ({ ...o, isDone: done.includes(o.id) || o.done(ctx) }))
    const current = statuses.find((o) => !o.isDone && !o.optional) ?? statuses.find((o) => !o.isDone) ?? null
    const complete = statuses.filter((o) => !o.optional).every((o) => o.isDone)
    return { lesson, statuses, current, complete, suggestion: current?.suggest?.(ctx) ?? null, ctx }
  }, [lessonId, cluster, events, history, seen, done])
}

/**
 * Makes objective completion sticky within a run, and records progress (objectives, the
 * first completion, the best time, the lesson you're on) — locally at once, synced when
 * signed in. Render once.
 */
export function LessonTracker() {
  const { lesson, statuses, complete } = useLesson()
  const done = useSim((s) => s.done)
  const epoch = useSim((s) => s.epoch)
  const recorded = useRef<{ epoch: number; complete: boolean }>({ epoch: -1, complete: false })

  // "where you left off" means where you last *did* something — not a lesson that merely
  // opened by default (that would overwrite what another device knows)
  const acted = useSim((s) => s.events.some((e) => e.source === 'you'))
  useEffect(() => {
    if (acted) recordOpened(lesson.id)
  }, [acted, lesson.id, epoch])

  useEffect(() => {
    const fresh = statuses.filter((o) => o.isDone && !done.includes(o.id)).map((o) => o.id)
    if (fresh.length) {
      useSim.getState().markDone(fresh)
      recordObjectives(lesson.id, fresh)
    }
    if (recorded.current.epoch !== epoch) recorded.current = { epoch, complete: false }
    if (complete && !recorded.current.complete) {
      recorded.current.complete = true
      const all = statuses.filter((o) => o.isDone).map((o) => o.id)
      const { sim } = useSim.getState()
      const previous = useProgress.getState().progress.lessons[lesson.id as LessonId]?.bestMs ?? null
      useRun.setState({ epoch, lessonId: lesson.id, elapsedMs: Math.round(sim.now), previousBestMs: previous })
      recordCompletion(lesson.id, all, sim.now)
    }
  }, [statuses, done, complete, lesson.id, epoch])
  return null
}

/** The run that just finished, for "finished in 1:42 · new best". */
export const useRun = create<{ epoch: number; lessonId: string | null; elapsedMs: number | null; previousBestMs: number | null }>(() => ({
  epoch: -1,
  lessonId: null,
  elapsedMs: null,
  previousBestMs: null,
}))
