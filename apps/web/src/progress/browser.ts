import { LESSON_CATALOG, emptyProgress, isLessonId, type LessonId, type Progress } from '@kubelearn/shared'
import { create } from 'zustand'
import { api } from '../api/http'
import { ProgressSync, parseStoredProgress, type SyncState } from './sync'

const KEY = 'kubelearn.progress.v2'
const LEGACY_KEY = 'kubelearn.progress.v1'

const storage = {
  read(): unknown {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) return JSON.parse(raw)
      return migrateLegacy()
    } catch {
      return null
    }
  },
  write(value: unknown) {
    try {
      localStorage.setItem(KEY, JSON.stringify(value))
    } catch {
      // storage full or disabled: progress still lives in memory and (when signed in) on the server
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY)
    } catch {
      // nothing to clear
    }
  },
}

/** v1 only knew which lessons were completed. Carry that forward, once. */
function migrateLegacy(): unknown {
  const raw = localStorage.getItem(LEGACY_KEY)
  if (!raw) return null
  const completed: unknown = JSON.parse(raw)?.completed
  const lessons: Progress['lessons'] = {}
  if (Array.isArray(completed)) {
    for (const id of completed) {
      if (typeof id === 'string' && isLessonId(id)) {
        lessons[id] = { objectives: [...LESSON_CATALOG[id].required].sort(), completedAt: new Date().toISOString(), bestMs: null }
      }
    }
  }
  const doc = { v: 2, progress: { lessons, last: null } }
  localStorage.setItem(KEY, JSON.stringify(doc))
  localStorage.removeItem(LEGACY_KEY)
  return doc
}

interface ProgressStore {
  progress: Progress
  sync: SyncState
}

export const useProgress = create<ProgressStore>(() => ({ progress: emptyProgress(), sync: { status: 'local', lastSyncedAt: null } }))

let onUnauthorized = () => {}
/** Called by the auth layer, which owns what "signed out" means. */
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn)

export const progressSync = new ProgressSync({
  storage,
  push: (progress, { keepalive }) => api('/api/progress', { method: 'PUT', body: progress, keepalive }),
  schedule: (fn, ms) => {
    const t = setTimeout(fn, ms)
    return () => clearTimeout(t)
  },
  now: () => Date.now(),
  isOnline: () => navigator.onLine,
  onUnauthorized: () => onUnauthorized(),
  onChange: (progress, sync) => useProgress.setState({ progress, sync }),
})
useProgress.setState({ progress: progressSync.progress, sync: progressSync.state })

// keep every surface in step: other tabs, reconnects, coming back to the tab, closing it
let lastFocusSync = 0
window.addEventListener('storage', (e) => {
  if (e.key === KEY && e.newValue) progressSync.absorb(JSON.parse(e.newValue))
})
window.addEventListener('online', () => void progressSync.syncNow())
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastFocusSync > 15_000) {
    lastFocusSync = Date.now()
    void progressSync.syncNow()
  } else if (document.visibilityState === 'hidden') {
    progressSync.flush()
  }
})
window.addEventListener('pagehide', () => progressSync.flush())

// ── what the lessons record ───────────────────────────────────────────────

const now = () => new Date().toISOString()

export function recordObjectives(lessonId: string, objectives: string[]) {
  if (!isLessonId(lessonId) || !objectives.length) return
  progressSync.record({ lessons: { [lessonId]: { objectives: [...objectives].sort(), completedAt: null, bestMs: null } }, last: null })
}

export function recordCompletion(lessonId: string, objectives: string[], elapsedMs: number) {
  if (!isLessonId(lessonId)) return
  const bestMs = Number.isFinite(elapsedMs) && elapsedMs >= 1 ? Math.min(Math.round(elapsedMs), 86_400_000) : null
  progressSync.record({ lessons: { [lessonId]: { objectives: [...objectives].sort(), completedAt: now(), bestMs } }, last: null })
}

export function recordOpened(lessonId: string) {
  if (!isLessonId(lessonId)) return
  progressSync.record({ lessons: {}, last: { lessonId, at: now() } })
}

export const lastLesson = (): LessonId | null => progressSync.progress.last?.lessonId ?? null

export { parseStoredProgress }
