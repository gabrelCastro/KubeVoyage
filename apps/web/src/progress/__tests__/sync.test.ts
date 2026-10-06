import { emptyProgress, mergeProgress, parseProgress, type Progress } from '@kubelearn/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgressSync, type SyncDeps } from '../sync'

/** A fake server that merges like the real one, and a clock we drive by hand. */
function setup(opts: { online?: boolean } = {}) {
  let server: Progress = emptyProgress()
  let stored: unknown = null
  const timers: { at: number; fn: () => void }[] = []
  let now = 0
  const calls: Progress[] = []
  let failNext: { status: number } | null = null
  let gate: Promise<void> | null = null
  const deps: SyncDeps = {
    storage: { read: () => stored, write: (v) => (stored = JSON.parse(JSON.stringify(v))), clear: () => (stored = null) },
    push: async (p) => {
      calls.push(p)
      if (gate) await gate
      if (failNext) {
        const e = Object.assign(new Error('fail'), failNext)
        failNext = null
        throw e
      }
      server = mergeProgress(server, parseProgress(JSON.parse(JSON.stringify(p)))!)
      return JSON.parse(JSON.stringify(server))
    },
    schedule: (fn, ms) => {
      const t = { at: now + ms, fn }
      timers.push(t)
      return () => timers.splice(timers.indexOf(t), 1)
    },
    now: () => now,
    isOnline: () => opts.online ?? true,
    onUnauthorized: vi.fn(),
    onChange: vi.fn(),
  }
  const sync = new ProgressSync(deps)
  return {
    sync,
    deps,
    calls,
    get server() {
      return server
    },
    setServer: (p: Progress) => (server = p),
    get stored() {
      return stored
    },
    failNext: (status: number) => (failNext = { status }),
    hold: () => {
      let release!: () => void
      gate = new Promise((r) => (release = r))
      return () => {
        gate = null
        release()
      }
    },
    /** advance the fake clock, running due timers and letting promises settle */
    async tick(ms: number) {
      now += ms
      for (;;) {
        const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers.splice(timers.indexOf(due), 1)
        due.fn()
        await flush()
      }
      await flush()
    },
    pendingTimers: () => timers.length,
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

const lesson = (id: string, objectives: string[], completedAt: string | null = null): Progress =>
  parseProgress({ lessons: { [id]: { objectives, completedAt, bestMs: completedAt ? 5000 : null } }, last: null })!

describe('ProgressSync', () => {
  beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(1))

  it('saves locally at once and never touches the network while signed out', async () => {
    const t = setup()
    t.sync.record(lesson('scaling', ['drag']))
    expect(t.sync.progress.lessons.scaling?.objectives).toEqual(['drag'])
    expect(t.stored).toMatchObject({ v: 2 })
    await t.tick(10_000)
    expect(t.calls).toHaveLength(0)
    expect(t.sync.state.status).toBe('local')
  })

  it('uploads what was learned signed out as soon as you sign in, and pulls the account', async () => {
    const t = setup()
    t.setServer(lesson('labels', ['inspect']))
    t.sync.record(lesson('scaling', ['drag']))
    t.sync.setSignedIn(true)
    await t.tick(0)
    expect(Object.keys(t.server.lessons).sort()).toEqual(['labels', 'scaling'])
    expect(Object.keys(t.sync.progress.lessons).sort()).toEqual(['labels', 'scaling'])
    expect(t.sync.state.status).toBe('synced')
  })

  it('debounces bursts of changes into one request', async () => {
    const t = setup()
    t.sync.setSignedIn(true)
    await t.tick(0)
    const before = t.calls.length
    t.sync.record(lesson('self-healing', ['apply']))
    t.sync.record(lesson('self-healing', ['get']))
    t.sync.record(lesson('self-healing', ['delete']))
    await t.tick(799)
    expect(t.calls.length).toBe(before)
    await t.tick(1)
    expect(t.calls.length).toBe(before + 1)
    expect(t.server.lessons['self-healing']?.objectives).toEqual(['apply', 'delete', 'get'])
  })

  it('keeps what was learned while a request was in flight, and sends it next', async () => {
    const t = setup()
    t.sync.setSignedIn(true)
    await t.tick(0)
    t.sync.record(lesson('services', ['expose']))
    const release = t.hold()
    await t.tick(800) // request in flight, held
    t.sync.record(lesson('services', ['endpoints']))
    release()
    await t.tick(0)
    await t.tick(800)
    expect(t.sync.progress.lessons.services?.objectives).toEqual(['endpoints', 'expose'])
    expect(t.server.lessons.services?.objectives).toEqual(['endpoints', 'expose'])
  })

  it('backs off on server errors and recovers', async () => {
    const t = setup()
    t.sync.setSignedIn(true)
    await t.tick(0)
    t.failNext(500)
    t.sync.record(lesson('debugging', ['notice']))
    await t.tick(800)
    expect(t.sync.state.status).toBe('error')
    await t.tick(999)
    expect(t.server.lessons.debugging).toBeUndefined()
    await t.tick(1)
    expect(t.server.lessons.debugging?.objectives).toEqual(['notice'])
    expect(t.sync.state.status).toBe('synced')
  })

  it('reports offline and waits instead of hammering', async () => {
    const t = setup({ online: false })
    t.sync.setSignedIn(true)
    await t.tick(0)
    expect(t.sync.state.status).toBe('offline')
    expect(t.calls).toHaveLength(0)
  })

  it('treats a 401 as "signed out": stops syncing and tells the auth layer', async () => {
    const t = setup()
    t.sync.setSignedIn(true)
    await t.tick(0)
    t.failNext(401)
    t.sync.record(lesson('failures', ['ship']))
    await t.tick(800)
    expect(t.deps.onUnauthorized).toHaveBeenCalledOnce()
    expect(t.sync.state.status).toBe('local')
    await t.tick(60_000)
    expect(t.calls).toHaveLength(2)
    expect(t.sync.progress.lessons.failures?.objectives).toEqual(['ship']) // nothing lost locally
  })

  it('does not loop when the server declines something', async () => {
    const t = setup()
    t.sync.setSignedIn(true)
    await t.tick(0)
    t.sync.record({ lessons: { scaling: { objectives: ['drag', 'not-a-real-objective'], completedAt: null, bestMs: null } }, last: null } as Progress)
    await t.tick(60_000)
    expect(t.calls.length).toBeLessThanOrEqual(2)
    expect(t.pendingTimers()).toBe(0)
  })

  it('takes in progress saved by another tab', () => {
    const t = setup()
    t.sync.absorb({ v: 2, progress: lesson('labels', ['join']) })
    expect(t.sync.progress.lessons.labels?.objectives).toEqual(['join'])
    t.sync.absorb('garbage')
    expect(t.sync.progress.lessons.labels?.objectives).toEqual(['join'])
  })

  it('forgets the local copy on sign-out', async () => {
    const t = setup()
    t.sync.setSignedIn(true)
    t.sync.record(lesson('scaling', ['drag'], '2026-10-01T00:00:00Z'))
    t.sync.clearLocal()
    expect(t.sync.progress).toEqual(emptyProgress())
    expect(t.stored).toBeNull()
  })

  it('ignores corrupted local storage instead of crashing', () => {
    for (const bad of [null, 'x', { v: 2, progress: { lessons: 5 } }, { v: 99 }]) {
      const t = setup()
      ;(t.deps.storage as { read: () => unknown }).read = () => bad
      expect(new ProgressSync(t.deps).progress).toEqual(emptyProgress())
    }
  })
})

describe('settle (signing out)', () => {
  const delta = (o: string): Progress => ({ lessons: { scaling: { objectives: [o], completedAt: null, bestMs: null } }, last: null })

  it('pushes what the debounce was still holding, so signing out loses nothing', async () => {
    const t = setup()
    await t.sync.setSignedIn(true)
    t.sync.record(delta('drag'))
    expect(t.sync.hasPending()).toBe(true)
    await t.sync.settle()
    expect(t.server.lessons.scaling?.objectives).toEqual(['drag'])
    expect(t.sync.hasPending()).toBe(false)
  })

  it('offline, it gives up at once and says something stayed behind', async () => {
    const t = setup({ online: false })
    await t.sync.setSignedIn(true)
    t.sync.record(delta('drag'))
    await t.sync.settle()
    expect(t.sync.hasPending()).toBe(true)
  })
})
