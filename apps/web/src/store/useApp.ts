import { create } from 'zustand'
import { LIMITS as RUN_LIMITS, type Reply } from '../runtime/program'
import { setImageCode } from '../runtime'
import { setBrokenImages } from '../sim/engine'
import { IMAGE } from '../sim/manifests'

/**
 * "Your app": what the learner's Pods run, as the outside world sees it — a name, an emoji,
 * a color and a message — and, once they write it, the code itself (app.js). Images built
 * from that code really run it (see src/runtime); every other image behaves as the lessons
 * script it, so every lesson works the same with or without any of this.
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
  /** The app.js it was built from; without it, the image behaves as the lessons script it. */
  code?: string
  createdAt: number
}

export const IMAGE_REPO = IMAGE.split(':')[0]
export const imageOf = (tag: string) => `${IMAGE_REPO}:${tag}`
export const MAX_RELEASES = 20

/** What a new app.js starts as: a small server that already passes its probes. */
export const DEFAULT_CODE = `// app.js — o que roda dentro do container.
// console.log vai para \`kubectl logs\`; env traz o que ConfigMaps e Secrets definem.
console.log('servidor iniciando')

// Com handle(), o container é um servidor: cada requisição chama esta função.
// Sem ela, é uma tarefa: roda até o fim e termina (trabalho para um Job).
function handle(req, env) {
  if (req.path === '/healthz') return 'ok'
  return env.APP_MESSAGE || 'Olá do cluster!'
}
`

/** A docker tag: letters, digits, `_`, `.` and `-`, not starting with `.` or `-`. */
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}$/
/** 1.x are the lessons' versions: the learner's images can't take them. */
export const reservedTag = (tag: string) => /^1\.\d+$/.test(tag) || tag === 'latest'

export function tagProblem(tag: string, releases: Release[]): string | null {
  if (!TAG.test(tag)) return `invalid tag "${tag}": use letras, números, "_", "." e "-" (até 32), sem começar com "." ou "-"`
  if (reservedTag(tag)) return `a tag ${tag} pertence às imagens das lições — escolha outra (ex.: 2.0)`
  if (releases.some((r) => r.tag === tag)) return `a tag ${tag} já existe e uma imagem publicada não muda — use outra tag (ex.: ${nextTag(releases)})`
  return null
}

/** The next free tag: 2.0, 2.1, … (1.x belongs to the lessons). */
export function nextTag(releases: Release[]) {
  const used = new Set(releases.map((r) => r.tag))
  let n = 0
  while (used.has(`2.${n}`)) n++
  return `2.${n}`
}

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
  /** What the learner's code answered, when the image runs code (an error is a 5xx). */
  reply?: { status: number; body: string }
}

/** A code reply as a visitor gets it: a thrown error is a 500, no answer in time a 504. */
export function visitReply(reply: Reply | undefined): Visit['reply'] {
  if (!reply) return undefined
  if ('timedOut' in reply) return { status: 504, body: 'Gateway Timeout' }
  if ('error' in reply) return { status: 500, body: 'Internal Server Error' }
  return reply
}

/** What a visitor reads: the first line of the code's answer, or the version's message. */
export const replyText = (reply: { status: number; body: string }) =>
  reply.status >= 400 ? `HTTP ${reply.status} · ${reply.body.split('\n')[0] || 'erro'}` : reply.body.split('\n')[0] || `(resposta vazia · HTTP ${reply.status})`

export const APP_STORAGE_KEY = 'kubelearn.app.v1'
const KEY = APP_STORAGE_KEY
const MAX_VISITS = 32
const initialApp = (): Stored => ({ design: DEFAULT_DESIGN, customized: false, releases: [], code: null, designAt: 0, codeAt: 0 })
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export interface Stored {
  design: AppDesign
  customized: boolean
  releases: Release[]
  /** app.js as the learner left it; null until they write any. */
  code: string | null
  /** When the design / the code last changed (ms; 0 = never) — across devices, the newest edit of each wins. */
  designAt: number
  codeAt: number
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

// 8.64e15 is the largest time a Date can hold: anything beyond would throw when sent
const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, 8.64e15) : 0)

export function parseStoredApp(value: string | null): Stored {
  try {
    const raw: unknown = JSON.parse(value ?? 'null')
    if (record(raw)) {
      // a tag must be valid and unique; anything else (older versions numbered by position) gets the next free one
      const releases: Release[] = []
      for (const r of (Array.isArray(raw.releases) ? raw.releases : []).filter(record).slice(0, MAX_RELEASES)) {
        const tag = typeof r.tag === 'string' && !tagProblem(r.tag, releases) ? r.tag : nextTag(releases)
        const code = typeof r.code === 'string' ? r.code.slice(0, RUN_LIMITS.codeChars) : undefined
        const createdAt = time(r.createdAt)
        releases.push({ tag, design: parseDesign(r.design), broken: r.broken === true, ...(code !== undefined && { code }), createdAt })
      }
      return {
        design: parseDesign(raw.design),
        customized: raw.customized === true,
        releases,
        code: typeof raw.code === 'string' ? raw.code.slice(0, RUN_LIMITS.codeChars) : null,
        designAt: time(raw.designAt),
        codeAt: time(raw.codeAt),
      }
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
  /** The app.js editor. */
  codeOpen: boolean
  visits: Visit[]
  podEdits: Record<string, PodEdit>
  /** Edits whose Pod is gone — shown once, to explain where they went. */
  lostEdits: PodEdit[]
  served: number
  failed: number
  code: string | null
  designAt: number
  codeAt: number
  setDesign: (d: AppDesign) => void
  /** Save app.js (the draft: nothing running changes until an image is built from it). */
  setCode: (code: string | null) => void
  /** Publish a new version; returns its image. */
  publish: (d: AppDesign, broken: boolean) => string | null
  /** `docker build -t backend:TAG .` — an image from app.js as it is now. */
  build: (tag: string) => { image: string } | { error: string }
  /** Take in the app as merged with the account (see workspace/sync.ts). */
  adopt: (next: Stored) => void
  /** Signing out: this (possibly shared) device forgets the app — it's in the account. */
  clearLocal: () => void
  openStudio: (open: boolean) => void
  openCode: (open: boolean) => void
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

/** The engine must know which published images crash on start, and which run code. */
const syncImages = (releases: Release[]) => {
  setBrokenImages(releases.filter((r) => r.broken).map((r) => imageOf(r.tag)))
  setImageCode(releases.flatMap((r) => (r.code === undefined ? [] : [[imageOf(r.tag), r.code] as [string, string]])))
}

const stored = typeof localStorage === 'undefined' ? initialApp() : load()
syncImages(stored.releases)

const storedOf = (s: Stored): Stored => ({ design: s.design, customized: s.customized, releases: s.releases, code: s.code, designAt: s.designAt, codeAt: s.codeAt })

// typing in the editor saves on every keystroke: write to storage once it pauses
let pendingSave: ReturnType<typeof setTimeout> | undefined
const saveSoon = (get: () => Stored) => {
  clearTimeout(pendingSave)
  pendingSave = setTimeout(() => {
    pendingSave = undefined
    save(storedOf(get()))
  }, 400)
}
const saveNow = () => {
  if (pendingSave === undefined) return
  clearTimeout(pendingSave)
  pendingSave = undefined
  save(storedOf(useApp.getState()))
}
// a tab being hidden may never come back (mobile browsers discard them): save then, too
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', saveNow)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveNow())
}

export const useApp = create<AppState>((set, get) => ({
  ...stored,
  studioOpen: false,
  codeOpen: false,
  visits: [],
  podEdits: {},
  lostEdits: [],
  served: 0,
  failed: 0,
  setDesign: (design) => {
    set({ design, customized: true, designAt: Date.now() })
    save(storedOf(get()))
  },
  setCode: (code) => {
    set({ code: code === null ? null : code.slice(0, RUN_LIMITS.codeChars), codeAt: Date.now() })
    saveSoon(get)
  },
  publish: (design, broken) => {
    const { releases } = get()
    if (releases.length >= MAX_RELEASES) return null
    // the studio's versions are the design only; app.js becomes an image through docker build
    const release: Release = { tag: nextTag(releases), design, broken, createdAt: Date.now() }
    const next = [...releases, release]
    set({ releases: next, customized: true })
    save(storedOf(get()))
    syncImages(next)
    return imageOf(release.tag)
  },
  build: (tag) => {
    const { releases, code, design } = get()
    const problem = tagProblem(tag, releases)
    if (problem) return { error: problem }
    if (releases.length >= MAX_RELEASES) return { error: `o registry do curso guarda até ${MAX_RELEASES} imagens suas — e todas já existem` }
    const release: Release = { tag, design, broken: false, code: code ?? DEFAULT_CODE, createdAt: Date.now() }
    const next = [...releases, release]
    set({ releases: next, customized: true })
    save(storedOf(get()))
    syncImages(next)
    return { image: imageOf(tag) }
  },
  adopt: (next) => {
    clearTimeout(pendingSave)
    set(storedOf(next))
    save(storedOf(get()))
    syncImages(next.releases)
  },
  clearLocal: () => {
    clearTimeout(pendingSave)
    const fresh = initialApp()
    set(fresh)
    try {
      localStorage.removeItem(KEY)
    } catch {
      // nothing stored
    }
    syncImages(fresh.releases)
  },
  openStudio: (studioOpen) => set({ studioOpen }),
  openCode: (codeOpen) => set({ codeOpen }),
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
