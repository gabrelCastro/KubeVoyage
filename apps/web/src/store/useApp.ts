import { create } from 'zustand'

/**
 * "Your app": what the learner's Pods run, as the outside world sees it — a name, an emoji,
 * a color and a message. Purely presentational: the simulation doesn't know about it, so
 * every lesson behaves the same with or without it.
 */

export const APP_COLORS = {
  violeta: '#a78bfa',
  azul: '#60a5fa',
  verde: '#34d399',
  amarelo: '#fbbf24',
  laranja: '#fb923c',
  rosa: '#f472b6',
} as const
export type AppColor = keyof typeof APP_COLORS

export const APP_EMOJIS = ['🦊', '🐙', '🐳', '🦄', '🐢', '🦉', '🐝', '🌵', '🍕', '🍩', '☕', '🎸', '🚀', '🪐', '🎲', '🌈'] as const

export interface AppDesign {
  name: string
  emoji: string
  color: AppColor
  message: string
}

export const DEFAULT_DESIGN: AppDesign = { name: 'Meu app', emoji: '🐳', color: 'azul', message: 'Olá do cluster!' }
export const LIMITS = { name: 24, message: 60 }

/** One visitor's request, as the Service routed it (recorded when the request arrives). */
export interface Visit {
  id: number
  ok: boolean
  podUid?: string
  podName?: string
}

const KEY = 'kubelearn.app.v1'
const MAX_VISITS = 32

function load(): { design: AppDesign; customized: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (raw && typeof raw === 'object') {
      const d = raw.design ?? {}
      const design: AppDesign = {
        name: typeof d.name === 'string' && d.name.trim() ? d.name.slice(0, LIMITS.name) : DEFAULT_DESIGN.name,
        emoji: (APP_EMOJIS as readonly string[]).includes(d.emoji) ? d.emoji : DEFAULT_DESIGN.emoji,
        color: d.color in APP_COLORS ? d.color : DEFAULT_DESIGN.color,
        message: typeof d.message === 'string' ? d.message.slice(0, LIMITS.message) : DEFAULT_DESIGN.message,
      }
      return { design, customized: raw.customized === true }
    }
  } catch {
    // storage unavailable: the default app it is
  }
  return { design: DEFAULT_DESIGN, customized: false }
}

interface AppState {
  design: AppDesign
  /** Whether the learner made it theirs (the studio nudges until then). */
  customized: boolean
  studioOpen: boolean
  visits: Visit[]
  served: number
  failed: number
  setDesign: (d: AppDesign) => void
  openStudio: (open: boolean) => void
  visit: (v: Omit<Visit, 'id'>) => void
  resetVisits: () => void
}

let seq = 0

export const useApp = create<AppState>((set) => ({
  ...(typeof localStorage === 'undefined' ? { design: DEFAULT_DESIGN, customized: false } : load()),
  studioOpen: false,
  visits: [],
  served: 0,
  failed: 0,
  setDesign: (design) => {
    set({ design, customized: true })
    try {
      localStorage.setItem(KEY, JSON.stringify({ design, customized: true }))
    } catch {
      // kept for this session only
    }
  },
  openStudio: (studioOpen) => set({ studioOpen }),
  visit: (v) =>
    set((s) => ({
      visits: [...s.visits, { ...v, id: ++seq }].slice(-MAX_VISITS),
      served: s.served + (v.ok ? 1 : 0),
      failed: s.failed + (v.ok ? 0 : 1),
    })),
  resetVisits: () => set({ visits: [], served: 0, failed: 0 }),
}))
