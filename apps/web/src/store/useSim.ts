import { create } from 'zustand'
import { getLesson } from '../lessons'
import { lastLesson } from '../progress/browser'
import type { Lesson } from '../lessons/types'
import { Simulation } from '../sim/engine'
import { podHeader, podRow, run, type Line } from '../sim/kubectl'
import type { ClusterEvent, ClusterState, Effect, Narration, PendingTask } from '../sim/types'

export interface TermEntry {
  id: number
  input?: string
  lines: Line[]
  origin?: 'ui' | 'palette'
}

export type Speed = 0.5 | 1 | 2

interface SimStore {
  sim: Simulation
  cluster: ClusterState
  events: ClusterEvent[]
  narration: Narration[]
  effects: Effect[]
  pending: PendingTask[]

  lessonId: string
  /** Objectives completed in this run. Sticky: once done, they stay done. */
  done: string[]
  /** Resources selected on the stage during this run (some objectives are about looking). */
  seen: string[]
  /** Hints the learner chose to reveal, by objective id. */
  hints: string[]

  paused: boolean
  speed: Speed
  reducedMotion: boolean
  wallStart: number
  /** Bumped on restart so components can reset local state. */
  epoch: number

  selected: string | null
  hovered: string | null
  attention: { uid: string; n: number } | null

  term: TermEntry[]
  history: string[]
  watching: boolean
  paletteOpen: boolean
  /** Text pushed into the terminal prompt from elsewhere (lesson hints, palette). */
  draft: { text: string; n: number } | null

  exec: (input: string, origin?: TermEntry['origin']) => void
  stopWatch: () => void
  select: (uid: string | null) => void
  hover: (uid: string | null) => void
  togglePause: () => void
  step: () => void
  setSpeed: (s: Speed) => void
  setReducedMotion: (v: boolean) => void
  restart: () => void
  openLesson: (id: string) => void
  markDone: (ids: string[]) => void
  revealHint: (objectiveId: string) => void
  setPalette: (open: boolean) => void
  setDraft: (text: string) => void
}

/** Lessons are addressed as #/<id>. Anything else in the hash (e.g. a sign-in token) isn't a lesson. */
const lessonFromHash = () => (typeof location !== 'undefined' && location.hash.startsWith('#/') ? location.hash.slice(2) : '')

let termSeq = 0
let lastWatch = new Map<string, string>()
/** While a command runs, hold streamed watch rows so the command's echo is printed first. */
let holdWatch = false

const snapshot = (sim: Simulation) => ({
  cluster: sim.cluster,
  events: sim.events,
  narration: sim.narration,
  effects: sim.effects,
  pending: sim.pending,
})

function createSim(lesson: Lesson) {
  const sim = new Simulation()
  sim.files = lesson.files
  if (lesson.setup) sim.bootstrap(lesson.setup)
  return sim
}

const welcome = (lesson: Lesson): TermEntry[] => [
  {
    id: ++termSeq,
    lines: [
      [{ t: 'Conectado a ', c: 'muted' }, { t: 'kubelearn-sandbox', c: 'accent' }, { t: ' · 3 nodes · namespace default', c: 'muted' }],
      [{ t: 'Arquivos aqui: ', c: 'muted' }, ...lesson.files.map((f) => ({ t: `${f}  `, c: 'accent' as const }))],
      [{ t: 'Digite ', c: 'muted' }, { t: 'help', c: 'strong' }, { t: ' para ver os comandos. Tab completa nomes.', c: 'muted' }],
    ],
  },
]

export const useSim = create<SimStore>((set, get) => {
  const wire = (sim: Simulation) =>
    sim.subscribe(() => {
      const snap = snapshot(sim)
      const { selected, hovered } = get()
      const c = snap.cluster
      const gone = (uid: string | null) => !!uid && !c.pods[uid] && !c.replicaSets[uid] && !c.deployments[uid] && !c.services[uid]
      // A deleted resource can't stay selected — otherwise its (empty) ownership chain dims everything.
      set({ ...snap, selected: gone(selected) ? null : selected, hovered: gone(hovered) ? null : hovered })
      if (get().watching && !holdWatch) appendWatchRows(sim)
    })

  const appendWatchRows = (sim: Simulation) => {
    const rows: Line[] = []
    const seen = new Set<string>()
    for (const p of Object.values(sim.cluster.pods)) {
      seen.add(p.uid)
      const sig = `${p.phase}|${p.ready}|${p.restarts}`
      if (lastWatch.get(p.uid) !== sig) {
        rows.push(podRow(sim, p))
        lastWatch.set(p.uid, sig)
      }
    }
    for (const uid of [...lastWatch.keys()]) if (!seen.has(uid)) lastWatch.delete(uid)
    if (!rows.length) return
    // Pad against the header width so streamed rows line up with the initial table.
    const widths = [28, 8, 20, 11]
    const aligned = rows.map((r) => r.map((s, i) => ({ ...s, t: i < widths.length ? s.t.padEnd(Math.max(widths[i], s.t.length + 3)) : s.t })))
    set((s) => ({ term: [...s.term, { id: ++termSeq, lines: aligned }] }))
  }

  // an explicit #/lesson wins; otherwise resume where this learner left off
  const initial = getLesson(lessonFromHash() || lastLesson())
  let sim = createSim(initial)
  let unsub = wire(sim)

  // ── the clock ─────────────────────────────────────────────────────────────
  let last = performance.now()
  const tick = (t: number) => {
    const dt = Math.min(100, t - last)
    last = t
    const { paused, speed } = get()
    if (!paused) get().sim.advance(dt * speed)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', () => {
      const hash = lessonFromHash()
      if (!hash) return
      const id = getLesson(hash).id
      if (id !== get().lessonId) get().openLesson(id)
    })
  }

  return {
    sim,
    ...snapshot(sim),
    lessonId: initial.id,
    done: [],
    seen: [],
    hints: [],
    paused: false,
    speed: 1,
    reducedMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    wallStart: Date.now(),
    epoch: 0,
    selected: null,
    hovered: null,
    attention: null,
    term: welcome(initial),
    history: [],
    watching: false,
    paletteOpen: false,
    draft: null,

    exec(input, origin) {
      const trimmed = input.trim()
      const state = get()
      // Typing in the terminal interrupts a watch (like Ctrl+C); acting on the stage doesn't, so you can watch rows stream in.
      if (state.watching && !origin) state.stopWatch()
      if (!trimmed) {
        set((s) => ({ term: [...s.term, { id: ++termSeq, input: '', lines: [] }] }))
        return
      }
      holdWatch = true
      const result = run(state.sim, trimmed)
      holdWatch = false
      if (result.clear) {
        set({ term: [], history: [...state.history, trimmed] })
        return
      }
      if (result.watch) {
        lastWatch = new Map(Object.values(state.sim.cluster.pods).map((p) => [p.uid, `${p.phase}|${p.ready}|${p.restarts}`]))
        if (!Object.keys(state.sim.cluster.pods).length)
          result.lines = [podHeader().map((h) => ({ t: h.padEnd(h === 'NAME' ? 28 : h === 'STATUS' ? 20 : h === 'READY' ? 8 : 11), c: 'muted' as const }))]
      }
      set((s) => ({
        term: [...s.term, { id: ++termSeq, input: trimmed, lines: result.lines, origin }],
        history: [...s.history, trimmed],
        watching: !!result.watch || (s.watching && !!origin),
        attention: result.focusUid ? { uid: result.focusUid, n: (s.attention?.n ?? 0) + 1 } : s.attention,
      }))
      if (get().watching && !result.watch) appendWatchRows(state.sim)
    },

    stopWatch() {
      if (!get().watching) return
      set((s) => ({ watching: false, term: [...s.term, { id: ++termSeq, lines: [[{ t: '^C', c: 'muted' }]] }] }))
    },

    select: (uid) => set((s) => ({ selected: uid, seen: uid && !s.seen.includes(uid) ? [...s.seen, uid] : s.seen })),
    hover: (uid) => set((s) => (s.hovered === uid ? s : { hovered: uid })),
    togglePause: () => set((s) => ({ paused: !s.paused })),
    step() {
      set({ paused: true })
      get().sim.step()
    },
    setSpeed: (speed) => set({ speed }),
    setReducedMotion: (reducedMotion) => set({ reducedMotion }),
    setPalette: (paletteOpen) => set({ paletteOpen }),
    setDraft: (text) => set((s) => ({ draft: { text, n: (s.draft?.n ?? 0) + 1 } })),
    markDone: (ids) => set((s) => ({ done: [...s.done, ...ids.filter((id) => !s.done.includes(id))] })),
    revealHint: (id) => set((s) => ({ hints: s.hints.includes(id) ? s.hints : [...s.hints, id] })),

    restart() {
      const lesson = getLesson(get().lessonId)
      unsub()
      sim = createSim(lesson)
      unsub = wire(sim)
      lastWatch = new Map()
      set((s) => ({
        sim,
        ...snapshot(sim),
        done: [],
        seen: [],
        hints: [],
        paused: false,
        wallStart: Date.now(),
        epoch: s.epoch + 1,
        selected: null,
        hovered: null,
        attention: null,
        term: welcome(lesson),
        history: [],
        watching: false,
      }))
    },

    openLesson(id) {
      const lesson = getLesson(id)
      if (location.hash !== `#/${lesson.id}`) history.pushState(null, '', `#/${lesson.id}`)
      set({ lessonId: lesson.id })
      get().restart()
    },
  }
})

export const clockTime = (wallStart: number, at: number) => {
  const d = new Date(wallStart + at)
  return d.toTimeString().slice(0, 8)
}
