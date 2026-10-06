import { create } from 'zustand'
import { getLesson } from '../lessons'
import { lastLesson } from '../progress/browser'
import type { Lesson } from '../lessons/types'
import { deploymentEditYaml } from '../lib/deploymentEditYaml'
import { DEFAULT_CODE, designFor, designForPod, imageOf, useApp } from './useApp'
import { profileFor } from '../runtime'
import { setCodeRuntime, Simulation } from '../sim/engine'
import type { Line, WatchSpec } from '../sim/kubectl'
import type { ClusterEvent, ClusterState, Effect, Narration, PendingTask } from '../sim/types'

// images built from the learner's code run it for real (in a Worker); the engine asks here
setCodeRuntime({ profile: profileFor })

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
  watching: string | null
  paletteOpen: boolean
  /** Text pushed into the terminal prompt from elsewhere (lesson hints, palette). */
  draft: { text: string; n: number } | null
  editing: { name: string; yaml: string; error: string | null } | null

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
  updateEditYaml: (yaml: string) => void
  saveEdit: () => Promise<void>
  cancelEdit: () => void
}

/** Lessons are addressed as #/<id>. Anything else in the hash (e.g. a sign-in token) isn't a lesson. */
const lessonFromHash = () => (typeof location !== 'undefined' && location.hash.startsWith('#/') ? location.hash.slice(2) : '')

let termSeq = 0
let lastWatch = new Map<string, string>()
let activeWatch: WatchSpec | null = null
let watchRows: typeof import('../sim/kubectl')['watchRows'] | null = null
let kubectlModule: Promise<typeof import('../sim/kubectl')> | null = null
const loadKubectl = () => (kubectlModule ??= import('../sim/kubectl'))
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
    if (!activeWatch || !watchRows) return
    const rows: Line[] = []
    const seen = new Set<string>()
    for (const current of watchRows(sim, activeWatch)) {
      seen.add(current.key)
      if (lastWatch.get(current.key) !== current.signature) {
        rows.push(current.line)
        lastWatch.set(current.key, current.signature)
      }
    }
    for (const key of [...lastWatch.keys()]) if (!seen.has(key)) lastWatch.delete(key)
    if (!rows.length) return
    set((s) => ({ term: [...s.term, { id: ++termSeq, lines: rows }] }))
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
    watching: null,
    paletteOpen: false,
    draft: null,
    editing: null,

    async exec(input, origin) {
      const trimmed = input.trim()
      const state = get()
      // Typing in the terminal interrupts a watch (like Ctrl+C); acting on the stage doesn't, so you can watch rows stream in.
      if (state.watching && !origin) state.stopWatch()
      if (!trimmed) {
        set((s) => ({ term: [...s.term, { id: ++termSeq, input: '', lines: [] }] }))
        return
      }
      const kubectl = await loadKubectl()
      watchRows = kubectl.watchRows
      const current = get()
      holdWatch = true
      const app = useApp.getState()
      const result = kubectl.run(current.sim, trimmed, {
        app: { name: app.design.name, message: app.design.message },
        appFor: (image, podUid) => {
          const d = podUid ? designForPod(app, podUid, image) : designFor(app, image)
          const fromEnv = podUid ? current.sim.cluster.pods[podUid]?.env?.APP_MESSAGE : undefined
          return fromEnv !== undefined && !(podUid && app.podEdits[podUid]) ? { ...d, message: fromEnv } : d
        },
        images: app.releases.map((r) => imageOf(r.tag)),
        workspace: {
          code: app.code ?? DEFAULT_CODE,
          build: (tag) => useApp.getState().build(tag),
          images: app.releases.map((r) => imageOf(r.tag)),
        },
      })
      if (result.editCode) useApp.getState().openCode(true)
      holdWatch = false
      if (result.clear) {
        set({ term: [], history: [...current.history, trimmed] })
        return
      }
      if (result.watch) {
        activeWatch = result.watch
        lastWatch = new Map(watchRows(current.sim, result.watch).map((row) => [row.key, row.signature]))
      }
      set((s) => ({
        term: [...s.term, { id: ++termSeq, input: trimmed, lines: result.lines, origin }],
        history: [...s.history, trimmed],
        watching: result.watch?.kind ?? (s.watching && origin ? s.watching : null),
        attention: result.focusUid ? { uid: result.focusUid, n: (s.attention?.n ?? 0) + 1 } : s.attention,
        editing: result.edit
          ? (() => {
              const dep = current.sim.findDeployment(result.edit.name)
              return dep ? { name: dep.name, yaml: deploymentEditYaml(dep), error: null } : null
            })()
          : s.editing,
      }))
      if (get().watching && !result.watch) appendWatchRows(current.sim)
    },

    stopWatch() {
      if (!get().watching) return
      activeWatch = null
      set((s) => ({ watching: null, term: [...s.term, { id: ++termSeq, lines: [[{ t: '^C', c: 'muted' }]] }] }))
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
    updateEditYaml: (yaml) => set((s) => ({ editing: s.editing ? { ...s.editing, yaml, error: null } : null })),
    async saveEdit() {
      const editor = get().editing
      if (!editor) return
      const { parseDeploymentEdit } = await import('../lib/deploymentEdit')
      if (get().editing !== editor) return
      const dep = get().sim.findDeployment(editor.name)
      if (!dep) {
        set({ editing: { ...editor, error: `Error from server (NotFound): deployments.apps "${editor.name}" not found` } })
        return
      }
      const parsed = parseDeploymentEdit(editor.yaml, dep)
      if ('error' in parsed) {
        set({ editing: { ...editor, error: parsed.error } })
        return
      }
      const scaleChanged = dep.replicas !== parsed.replicas
      holdWatch = true
      if (scaleChanged) get().sim.scale(dep.name, parsed.replicas, 'edit')
      const changed = get().sim.setImage(dep.name, 'backend', parsed.image, 'edit', parsed.labels)
      holdWatch = false
      const line: Line = !scaleChanged && changed === 'unchanged'
        ? [{ t: 'Edit cancelled, no changes made.', c: 'muted' }]
        : [{ t: `deployment.apps/${dep.name} edited`, c: 'success' }]
      set((s) => ({ editing: null, term: [...s.term, { id: ++termSeq, lines: [line] }] }))
      if (get().watching) appendWatchRows(get().sim)
    },
    cancelEdit() {
      if (!get().editing) return
      set((s) => ({ editing: null, term: [...s.term, { id: ++termSeq, lines: [[{ t: 'Edit cancelled, no changes made.', c: 'muted' }]] }] }))
    },
    markDone: (ids) => set((s) => ({ done: [...s.done, ...ids.filter((id) => !s.done.includes(id))] })),
    revealHint: (id) => set((s) => ({ hints: s.hints.includes(id) ? s.hints : [...s.hints, id] })),

    restart() {
      const lesson = getLesson(get().lessonId)
      unsub()
      sim = createSim(lesson)
      unsub = wire(sim)
      lastWatch = new Map()
      activeWatch = null
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
        watching: null,
        editing: null,
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
