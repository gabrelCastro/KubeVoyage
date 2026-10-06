import { emptyWorkspace, mergeWorkspace, parseDraft, parseRelease, winningRelease, type Release, type Workspace } from '@kubelearn/shared'
import { describe, expect, it } from 'vitest'
import { WorkspaceSync, type WorkspaceSyncStatus } from '../sync'

const design = { name: 'Raposa', emoji: '🦊', color: 'laranja', message: 'oi' }
const release = (tag: string, code: string, createdAt: string): Release => ({ tag, design, broken: false, code, createdAt })

/** A server that merges like the real one (same shared rules), plus a device around a WorkspaceSync. */
function setup(opts: { server?: Workspace; local?: Workspace } = {}) {
  const server = { ws: opts.server ?? emptyWorkspace(), calls: [] as string[], full: new Set<string>(), down: false, expired: false, now: null as string | null, rejectDraft: false }
  const device = { ws: opts.local ?? emptyWorkspace(), statuses: [] as WorkspaceSyncStatus[], unauthorized: 0, timers: [] as { fn: () => void; ms: number }[] }
  const guard = () => {
    if (server.expired) throw Object.assign(new Error('401'), { status: 401 })
    if (server.down) throw Object.assign(new Error('offline'), { status: 0 })
  }
  // pending replies the test can hold back, to change local state "while the request is in flight"
  let hold: Promise<void> | null = null
  const sync = new WorkspaceSync({
    local: () => device.ws,
    adopt: (next) => (device.ws = next),
    fetchAll: async () => {
      server.calls.push('GET')
      guard()
      return JSON.parse(JSON.stringify(server.ws))
    },
    putDraft: async (draft) => {
      server.calls.push('PUT draft')
      guard()
      if (server.rejectDraft) throw Object.assign(new Error('413'), { status: 413 })
      if (hold) await hold
      const incoming = parseDraft(draft)!
      // like the real API: a date ahead of the server's clock becomes the server's time
      const clamp = (t: string | null) => (t !== null && server.now !== null && t > server.now ? server.now : t)
      server.ws = mergeWorkspace(server.ws, { ...server.ws, draft: { ...incoming, designAt: clamp(incoming.designAt), codeAt: clamp(incoming.codeAt) } })
      return server.ws.draft
    },
    putRelease: async (r) => {
      server.calls.push(`PUT ${r.tag}`)
      guard()
      const incoming = parseRelease(r)!
      const existing = server.ws.releases.find((x) => x.tag === incoming.tag)
      if (!existing && server.full.has(incoming.tag)) throw Object.assign(new Error('full'), { status: 409, code: 'too_many_releases' })
      server.ws = mergeWorkspace(server.ws, { ...server.ws, releases: [incoming] })
      return existing ? winningRelease(existing, incoming) : incoming
    },
    schedule: (fn, ms) => {
      const t = { fn, ms }
      device.timers.push(t)
      return () => (device.timers = device.timers.filter((x) => x !== t))
    },
    isOnline: () => !server.down,
    onUnauthorized: () => device.unauthorized++,
    onStatus: (s) => device.statuses.push(s),
  })
  const tick = async () => {
    const due = device.timers.splice(0)
    for (const t of due) t.fn()
    await new Promise((r) => setTimeout(r, 0))
  }
  return { sync, server, device, tick, holdReplies: (p: Promise<void> | null) => (hold = p) }
}

describe('WorkspaceSync', () => {
  it('signing in merges the account in and uploads what only this device had', async () => {
    const fromPhone = release('2.0', 'console.log("celular")', '2026-01-01T00:00:00.000Z')
    const fromLaptop = release('2.1', 'console.log("notebook")', '2026-01-02T00:00:00.000Z')
    const { sync, server, device } = setup({
      server: { draft: { ...emptyWorkspace().draft, code: 'velho', codeAt: '2026-01-01T00:00:00.000Z' }, releases: [fromPhone] },
      local: { draft: { ...emptyWorkspace().draft, code: 'novo', codeAt: '2026-01-03T00:00:00.000Z' }, releases: [fromLaptop] },
    })
    await sync.setSignedIn(true)
    expect(server.calls).toEqual(['GET', 'PUT draft', 'PUT 2.1'])
    expect(device.ws.releases.map((r) => r.tag)).toEqual(['2.0', '2.1'])
    expect(device.ws.draft.code).toBe('novo')
    expect(server.ws).toEqual(device.ws)
    expect(sync.status).toBe('synced')
  })

  it('pushes only what changed, in small pieces — never everything again', async () => {
    const { sync, server, device, tick } = setup()
    await sync.setSignedIn(true)
    server.calls.length = 0
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'a', codeAt: '2026-01-05T00:00:00.000Z' } }
    sync.changed()
    await tick()
    expect(server.calls).toEqual(['PUT draft'])
    server.calls.length = 0
    device.ws = { ...device.ws, releases: [release('2.0', 'a', '2026-01-05T00:00:01.000Z')] }
    sync.changed()
    await tick()
    expect(server.calls).toEqual(['PUT 2.0'])
    server.calls.length = 0
    sync.changed()
    await tick()
    expect(server.calls).toEqual([])
  })

  it('an edit made while a request is in flight is kept, and pushed next', async () => {
    const { sync, server, device, tick, holdReplies } = setup()
    await sync.setSignedIn(true)
    let release!: () => void
    holdReplies(new Promise<void>((r) => (release = r)))
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'primeiro', codeAt: '2026-01-05T00:00:00.000Z' } }
    sync.changed()
    const pass = tick()
    // the learner keeps typing before the server answers
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'segundo', codeAt: '2026-01-05T00:00:02.000Z' } }
    holdReplies(null)
    release()
    await pass
    expect(device.ws.draft.code).toBe('segundo')
    await tick()
    expect(server.ws.draft.code).toBe('segundo')
  })

  it('the same tag published elsewhere first: this device takes the image the account has', async () => {
    const theirs = release('2.0', 'deles', '2026-01-01T00:00:00.000Z')
    const mine = release('2.0', 'meu', '2026-01-02T00:00:00.000Z')
    const { sync, device } = setup({ server: { ...emptyWorkspace(), releases: [theirs] }, local: { ...emptyWorkspace(), releases: [mine] } })
    await sync.setSignedIn(true)
    expect(device.ws.releases).toEqual([theirs])
  })

  it('an image the account refuses (full) is skipped, not retried forever', async () => {
    const { sync, server, device, tick } = setup({ local: { ...emptyWorkspace(), releases: [release('extra', 'x', '2026-01-09T00:00:00.000Z')] } })
    server.full.add('extra')
    await sync.setSignedIn(true)
    expect(sync.status).toBe('synced')
    server.calls.length = 0
    sync.changed()
    await tick()
    expect(server.calls).toEqual([])
    expect(device.ws.releases).toHaveLength(1) // still on this device
  })

  it('offline: backs off and catches up later; an expired session hands over to the auth layer', async () => {
    const { sync, server, device, tick } = setup()
    server.down = true
    await sync.setSignedIn(true)
    expect(sync.status).toBe('offline')
    server.down = false
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'x', codeAt: '2026-01-05T00:00:00.000Z' } }
    await sync.refresh()
    expect(server.ws.draft.code).toBe('x')

    server.expired = true
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'y', codeAt: '2026-01-06T00:00:00.000Z' } }
    sync.changed()
    await tick()
    expect(device.unauthorized).toBe(1)
    expect(sync.status).toBe('local')
    // the work stays on the device
    expect(device.ws.draft.code).toBe('y')
  })

  it('a device whose clock runs ahead settles on the server time instead of pushing forever', async () => {
    const { sync, server, device, tick } = setup()
    server.now = '2026-01-01T00:00:00.000Z'
    await sync.setSignedIn(true)
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'do futuro', codeAt: '2030-01-01T00:00:00.000Z' } }
    sync.changed()
    await tick()
    expect(device.ws.draft).toEqual(server.ws.draft)
    expect(device.ws.draft.codeAt).toBe('2026-01-01T00:00:00.000Z')
    server.calls.length = 0
    await tick()
    sync.changed()
    await tick()
    expect(server.calls).toEqual([])
  })

  it('coming back to the tab while a request is in flight neither breaks the pass nor loses anything', async () => {
    const { sync, server, device, tick, holdReplies } = setup()
    await sync.setSignedIn(true)
    let release!: () => void
    holdReplies(new Promise<void>((r) => (release = r)))
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'a', codeAt: '2026-01-05T00:00:00.000Z' }, releases: [{ tag: '2.0', design, broken: false, code: 'a', createdAt: '2026-01-05T00:00:00.000Z' }] }
    sync.changed()
    const pass = tick()
    void sync.refresh()
    holdReplies(null)
    release()
    await pass
    await tick()
    await tick()
    expect(sync.status).toBe('synced')
    expect(server.ws.draft.code).toBe('a')
    expect(server.ws.releases.map((r) => r.tag)).toEqual(['2.0'])
  })

  it('signing out and back in while a request is in flight starts clean', async () => {
    const { sync, server, device, tick, holdReplies } = setup()
    await sync.setSignedIn(true)
    let release!: () => void
    holdReplies(new Promise<void>((r) => (release = r)))
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'b', codeAt: '2026-01-05T00:00:00.000Z' } }
    sync.changed()
    const pass = tick()
    void sync.setSignedIn(false)
    const again = sync.setSignedIn(true)
    holdReplies(null)
    release()
    await pass
    await again
    await tick()
    expect(sync.status).toBe('synced')
    expect(server.ws.draft.code).toBe('b')
  })

  it('sign-out waits for what was just typed; hasPending tells if anything stayed behind', async () => {
    const { sync, server, device } = setup()
    await sync.setSignedIn(true)
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'última linha', codeAt: '2026-01-05T00:00:00.000Z' } }
    sync.changed() // debounced: would go up only later
    expect(sync.hasPending()).toBe(true)
    await sync.settle()
    expect(server.ws.draft.code).toBe('última linha')
    expect(sync.hasPending()).toBe(false)

    server.down = true
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'offline', codeAt: '2026-01-06T00:00:00.000Z' } }
    await sync.settle()
    expect(sync.hasPending()).toBe(true)
  })

  it('a part edited while its draft was in flight keeps the edit; the untouched part takes the server time', async () => {
    const { sync, server, device, tick, holdReplies } = setup()
    server.now = '2026-01-01T00:00:00.000Z'
    await sync.setSignedIn(true)
    let release!: () => void
    holdReplies(new Promise<void>((r) => (release = r)))
    // design stamped by a clock running ahead; code edited again during the request
    device.ws = { ...device.ws, draft: { ...device.ws.draft, design: { ...design, name: 'Futuro' }, designAt: '2030-01-01T00:00:00.000Z', code: 'v1', codeAt: '2025-12-31T00:00:00.000Z' } }
    sync.changed()
    const pass = tick()
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'v2', codeAt: '2025-12-31T00:00:01.000Z' } }
    holdReplies(null)
    release()
    await pass
    expect(device.ws.draft.designAt).toBe('2026-01-01T00:00:00.000Z') // no future date survives to win later
    expect(device.ws.draft.code).toBe('v2')
    await tick()
    expect(server.ws.draft.code).toBe('v2')
  })

  it('signing out after the session already expired keeps the unsent work on the device', async () => {
    const { sync, server, device } = setup()
    await sync.setSignedIn(true)
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'não enviado', codeAt: '2026-01-05T00:00:00.000Z' } }
    server.expired = true
    await sync.settle()
    expect(server.ws.draft.code).toBeNull()
    expect(sync.hasPending()).toBe(true)
  })

  it('a draft the server refuses is not resent until it changes, and the status says so', async () => {
    const { sync, server, device, tick } = setup()
    await sync.setSignedIn(true)
    server.rejectDraft = true
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'grande demais', codeAt: '2026-01-05T00:00:00.000Z' } }
    sync.changed()
    await tick()
    await tick()
    expect(sync.status).toBe('error')
    server.calls.length = 0
    await tick()
    await tick()
    expect(server.calls).toEqual([])
    server.rejectDraft = false
    device.ws = { ...device.ws, draft: { ...device.ws.draft, code: 'menor', codeAt: '2026-01-06T00:00:00.000Z' } }
    sync.changed()
    await tick()
    expect(server.ws.draft.code).toBe('menor')
    expect(sync.status).toBe('synced')
  })

  it('signed out, nothing goes anywhere', async () => {
    const { sync, server, tick } = setup()
    sync.changed()
    await tick()
    sync.flush()
    expect(server.calls).toEqual([])
  })
})
