import { create } from 'zustand'

/**
 * Onboarding state: whether the guided first run happened, and which one-time tips were
 * already shown. Kept on this device — it's about this browser, not the account.
 */

export type TourStatus = 'unseen' | 'welcome' | 'running' | 'done' | 'skipped'

interface Stored {
  tour: 'done' | 'skipped' | null
  tips: string[]
}

const KEY = 'kubelearn.onboarding.v1'

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    return {
      tour: raw?.tour === 'done' || raw?.tour === 'skipped' ? raw.tour : null,
      tips: Array.isArray(raw?.tips) ? raw.tips.filter((t: unknown) => typeof t === 'string') : [],
    }
  } catch {
    return { tour: null, tips: [] }
  }
}

function save(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // private mode: the tour may show again next visit, which is harmless
  }
}

interface TourStore {
  status: TourStatus
  step: number
  seenTips: string[]
  /** The tip on screen right now (only one at a time). */
  tip: string | null
  /** When the tour last ended — tips stay quiet for a moment after it. */
  endedAt: number
  showWelcome(): void
  start(): void
  next(): void
  finish(): void
  skip(): void
  showTip(id: string): void
  dismissTip(): void
}

const initial = load()

export const useTour = create<TourStore>((set, get) => {
  const persist = (patch: Partial<Stored>) => save({ tour: patch.tour ?? load().tour, tips: patch.tips ?? get().seenTips })
  return {
    status: initial.tour ?? 'unseen',
    step: 0,
    seenTips: initial.tips,
    tip: null,
    endedAt: 0,
    showWelcome: () => set({ status: 'welcome', tip: null }),
    start: () => set({ status: 'running', step: 0, tip: null }),
    next: () => set((s) => ({ step: s.step + 1 })),
    finish() {
      persist({ tour: 'done' })
      set({ status: 'done', endedAt: Date.now() })
    },
    skip() {
      persist({ tour: 'skipped' })
      set({ status: 'skipped', endedAt: Date.now() })
    },
    showTip(id) {
      const s = get()
      if (s.seenTips.includes(id) || s.tip || s.status === 'running' || s.status === 'welcome') return
      const seenTips = [...s.seenTips, id]
      persist({ tips: seenTips })
      set({ tip: id, seenTips })
    },
    dismissTip: () => set({ tip: null }),
  }
})
