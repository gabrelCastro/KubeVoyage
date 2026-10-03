import { create } from 'zustand'
import { setBrokenImages } from '../sim/engine'
import { IMAGE } from '../sim/manifests'

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

/**
 * A published version of the app: an image with its own tag. Like a real image it never
 * changes once published — to change the app, publish another one.
 */
export interface Release {
  tag: string
  design: AppDesign
  /** Published "forgetting" DATABASE_URL: crashes on start, like 1.5. */
  broken: boolean
}

export const IMAGE_REPO = IMAGE.split(':')[0]
export const imageOf = (tag: string) => `${IMAGE_REPO}:${tag}`
export const MAX_RELEASES = 9

/** The next free tag: 2.0, 2.1, … (1.x belongs to the lessons). */
export const nextTag = (releases: Release[]) => `2.${releases.length}`

/** The app as a given image serves it: its release if it is one, the starting design otherwise. */
export function designFor(state: { design: AppDesign; releases: Release[] }, image: string): AppDesign {
  if (!image.startsWith(`${IMAGE_REPO}:`)) return state.design
  const tag = image.slice(IMAGE_REPO.length + 1)
  return state.releases.find((r) => r.tag === tag)?.design ?? state.design
}

/**
 * A change made by hand inside one running container — what `kubectl exec` and editing a
 * file would do. No Kubernetes object knows about it, so it dies with the Pod.
 */
export interface PodEdit {
  podName: string
  emoji: string
  message: string
}

/** The app as one particular Pod serves it: its image's version, plus any edit made inside it. */
export function designForPod(state: { design: AppDesign; releases: Release[]; podEdits: Record<string, PodEdit> }, uid: string, image: string): AppDesign {
  const base = designFor(state, image)
  const edit = state.podEdits[uid]
  return edit ? { ...base, emoji: edit.emoji, message: edit.message } : base
}

/** One visitor's request, as the Service routed it (recorded when the request arrives). */
export interface Visit {
  id: number
  ok: boolean
  podUid?: string
  podName?: string
  /** The image of the Pod that answered — which version of the app the visitor saw. */
  image?: string
  /** The hand edit that Pod carried when it answered, if any. */
  edited?: PodEdit
  /** APP_MESSAGE from the environment the container started with (a ConfigMap), if any. */
  configMessage?: string
}

const KEY = 'kubelearn.app.v1'
const MAX_VISITS = 32
const initialApp = (): Stored => ({ design: DEFAULT_DESIGN, customized: false, releases: [] })
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

interface Stored {
  design: AppDesign
  customized: boolean
  releases: Release[]
}

function parseDesign(value: unknown): AppDesign {
  const d = record(value) ? value : {}
  return {
    name: typeof d.name === 'string' && d.name.trim() ? d.name.slice(0, LIMITS.name) : DEFAULT_DESIGN.name,
    emoji: typeof d.emoji === 'string' && (APP_EMOJIS as readonly string[]).includes(d.emoji) ? d.emoji : DEFAULT_DESIGN.emoji,
    color: typeof d.color === 'string' && d.color in APP_COLORS ? (d.color as AppColor) : DEFAULT_DESIGN.color,
    message: typeof d.message === 'string' ? d.message.slice(0, LIMITS.message) : DEFAULT_DESIGN.message,
  }
}

export function parseStoredApp(value: string | null): Stored {
  try {
    const raw: unknown = JSON.parse(value ?? 'null')
    if (record(raw)) {
      // releases are renumbered in order, so tags stay unique and sequential whatever was stored
      const releases: Release[] = (Array.isArray(raw.releases) ? raw.releases : [])
        .filter(record)
        .slice(0, MAX_RELEASES)
        .map((r, i) => ({ tag: `2.${i}`, design: parseDesign(r.design), broken: r.broken === true }))
      return { design: parseDesign(raw.design), customized: raw.customized === true, releases }
    }
  } catch {
    // storage unavailable: the default app it is
  }
  return initialApp()
}

function load() {
  try {
    return parseStoredApp(localStorage.getItem(KEY))
  } catch {
    return initialApp()
  }
}

interface AppState {
  design: AppDesign
  releases: Release[]
  /** Whether the learner made it theirs (the studio nudges until then). */
  customized: boolean
  studioOpen: boolean
  visits: Visit[]
  podEdits: Record<string, PodEdit>
  /** Edits whose Pod is gone — shown once, to explain where they went. */
  lostEdits: PodEdit[]
  served: number
  failed: number
  setDesign: (d: AppDesign) => void
  /** Publish a new version; returns its image. */
  publish: (d: AppDesign, broken: boolean) => string | null
  openStudio: (open: boolean) => void
  visit: (v: Omit<Visit, 'id'>) => void
  editPod: (uid: string, edit: PodEdit) => void
  /** Pods that no longer exist take their edits with them. */
  forgetGone: (liveUids: Set<string>) => void
  dismissLost: () => void
  resetVisits: () => void
}

let seq = 0

const save = (state: Stored) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // kept for this session only
  }
}

/** The engine must know which published images crash on start. */
const syncBroken = (releases: Release[]) => setBrokenImages(releases.filter((r) => r.broken).map((r) => imageOf(r.tag)))

const stored = typeof localStorage === 'undefined' ? initialApp() : load()
syncBroken(stored.releases)

export const useApp = create<AppState>((set, get) => ({
  ...stored,
  studioOpen: false,
  visits: [],
  podEdits: {},
  lostEdits: [],
  served: 0,
  failed: 0,
  setDesign: (design) => {
    set({ design, customized: true })
    save({ design, customized: true, releases: get().releases })
  },
  publish: (design, broken) => {
    const { releases } = get()
    if (releases.length >= MAX_RELEASES) return null
    const next = [...releases, { tag: nextTag(releases), design, broken }]
    set({ releases: next, customized: true })
    save({ design: get().design, customized: true, releases: next })
    syncBroken(next)
    return imageOf(next[next.length - 1].tag)
  },
  openStudio: (studioOpen) => set({ studioOpen }),
  visit: (v) =>
    set((s) => ({
      visits: [...s.visits, { ...v, id: ++seq }].slice(-MAX_VISITS),
      served: s.served + (v.ok ? 1 : 0),
      failed: s.failed + (v.ok ? 0 : 1),
    })),
  editPod: (uid, edit) => set((s) => ({ podEdits: { ...s.podEdits, [uid]: edit } })),
  forgetGone: (live) => {
    const { podEdits, lostEdits } = get()
    const gone = Object.keys(podEdits).filter((uid) => !live.has(uid))
    if (!gone.length) return
    const kept = Object.fromEntries(Object.entries(podEdits).filter(([uid]) => live.has(uid)))
    set({ podEdits: kept, lostEdits: [...lostEdits, ...gone.map((uid) => podEdits[uid])] })
  },
  dismissLost: () => set({ lostEdits: [] }),
  // a restarted lesson is a new cluster: nothing was "lost", it simply never existed there
  resetVisits: () => set({ visits: [], served: 0, failed: 0, podEdits: {}, lostEdits: [] }),
}))
