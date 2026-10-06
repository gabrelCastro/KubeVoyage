import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIMITS, type Profile, type RunParts } from '../program'
import { profileFor, setImageCode, setRunner } from '..'
import { runInWorker } from '../runner'

/** A stand-in for the browser's Worker: the test plays the Worker's side of the conversation. */
class FakeWorker {
  static last: FakeWorker
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string; preventDefault(): void }) => void) | null = null
  posted: unknown[] = []
  terminated = false
  constructor() {
    FakeWorker.last = this
  }
  postMessage(m: unknown) {
    this.posted.push(m)
  }
  terminate() {
    this.terminated = true
  }
  say(type: 'ready' | 'progress' | 'done', parts?: Partial<RunParts>) {
    this.onmessage?.({ data: { type, parts: parts && { code: 'c', loaded: false, logs: [], replies: {}, timedOut: false, ...parts } } })
  }
}

describe('runInWorker: the watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('a finished run becomes the profile and the Worker is thrown away', async () => {
    const p = runInWorker('function handle() {}', { A: '1' })
    const w = FakeWorker.last
    w.say('ready')
    expect(w.posted).toEqual([{ code: 'function handle() {}', env: { A: '1' } }])
    w.say('done', { loaded: true, isServer: true, replies: { '/': { status: 200, body: 'oi' }, '/healthz': { status: 200, body: 'ok' } } })
    expect((await p).replies['/']).toEqual({ status: 200, body: 'oi' })
    expect(w.terminated).toBe(true)
  })

  it('the load budget starts when the Worker is ready, and a stuck load times out', async () => {
    const p = runInWorker('while (true) {}', {})
    const w = FakeWorker.last
    vi.advanceTimersByTime(3000) // the Worker taking its time to start doesn't count
    w.say('ready')
    vi.advanceTimersByTime(LIMITS.loadMs + 1)
    const profile = await p
    expect(profile.timedOut).toBe(true)
    expect(w.terminated).toBe(true)
  })

  it('each answered request re-arms the clock; a stuck request times out on its own', async () => {
    const p = runInWorker('function handle() {}', {})
    const w = FakeWorker.last
    w.say('ready')
    w.say('progress', { loaded: true, isServer: true })
    vi.advanceTimersByTime(LIMITS.requestMs - 10)
    w.say('progress', { loaded: true, isServer: true, replies: { '/': { status: 200, body: 'oi' } } })
    vi.advanceTimersByTime(LIMITS.requestMs - 10)
    expect(w.terminated).toBe(false)
    vi.advanceTimersByTime(20)
    const profile: Profile = await p
    expect(profile.replies).toEqual({ '/': { status: 200, body: 'oi' }, '/healthz': { timedOut: true } })
    expect(profile.timedOut).toBeUndefined()
  })

  it('a Worker that never starts, or fails to, still settles', async () => {
    const never = runInWorker('x', {})
    vi.advanceTimersByTime(5001)
    expect((await never).timedOut).toBe(true)

    const broken = runInWorker('x', {})
    FakeWorker.last.onerror?.({ message: 'boom', preventDefault() {} })
    expect((await broken).error).toBe('Error: boom')
  })
})

describe('profileFor: the cache the engine reads', () => {
  afterEach(() => {
    setRunner(() => Promise.reject(new Error('no runner in tests')))
    setImageCode([])
  })

  const profile = (body: string): Profile => ({ kind: 'server', logs: [], replies: { '/': { status: 200, body }, '/healthz': { status: 200, body: 'ok' } } })
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('images without code are not its business', () => {
    setImageCode([['img:code', 'x']])
    expect(profileFor('img:other', {})).toBeNull()
  })

  it('runs each (code, environment) once: pending until done, cached after', async () => {
    const runner = vi.fn(async (code: string, env: Record<string, string>) => profile(`${code}:${env.A ?? ''}`))
    setRunner(runner)
    setImageCode([['img:1', 'c']])
    expect(profileFor('img:1', { A: '1' })).toBe('pending')
    expect(profileFor('img:1', { A: '1' })).toBe('pending')
    await flush()
    expect(profileFor('img:1', { A: '1' })).toEqual(profile('c:1'))
    // key order doesn't matter; a different value does
    expect(profileFor('img:1', { A: '2' })).toBe('pending')
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('a runner that fails becomes a crash, not a container stuck waiting', async () => {
    setRunner(() => Promise.reject(new Error('worker morreu')))
    setImageCode([['img:1', 'c']])
    profileFor('img:1', {})
    await flush()
    expect(profileFor('img:1', {})).toMatchObject({ error: 'Error: worker morreu' })
  })

  it('a run started before the runner was swapped does not fill the cache', async () => {
    let resolveOld!: (p: Profile) => void
    setRunner(() => new Promise((r) => (resolveOld = r)))
    setImageCode([['img:1', 'c']])
    profileFor('img:1', {})
    setRunner(async () => profile('novo'))
    resolveOld(profile('velho'))
    await flush()
    expect(profileFor('img:1', {})).toBe('pending')
    await flush()
    expect(profileFor('img:1', {})).toEqual(profile('novo'))
  })

  it('keeps the most recently used profiles', async () => {
    setRunner(async (code) => profile(code))
    setImageCode(Array.from({ length: 66 }, (_, i): [string, string] => [`img:${i}`, `c${i}`]))
    profileFor('img:0', {})
    await flush()
    for (let i = 1; i <= 64; i++) {
      profileFor('img:0', {}) // keep the first one in use
      profileFor(`img:${i}`, {})
      await flush()
    }
    expect(profileFor('img:0', {})).toEqual(profile('c0'))
    expect(profileFor('img:1', {})).toBe('pending')
  })
})

describe('assemble: a script stuck after loading', () => {
  it('is still running, not a clean exit', async () => {
    const { assemble } = await import('../program')
    expect(assemble({ code: 'x', loaded: true, isServer: false, logs: [], replies: {}, timedOut: true }).timedOut).toBe(true)
    expect(assemble({ code: 'x', loaded: true, isServer: false, logs: [], replies: {}, timedOut: false }).timedOut).toBeUndefined()
  })
})
