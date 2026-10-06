import { mergeDraft, mergeWorkspace, parseDraft, parseRelease, parseWorkspace, sameDesign, sameDraft, sameRelease, sameWorkspace, type Draft, type Workspace } from '@kubelearn/shared'

/**
 * "Your app" (design, app.js, published images), local-first like progress:
 *
 * - every change lands on this device first (store/useApp.ts); the network never blocks it;
 * - when signed in, the account is fetched and merged in on sign-in, on coming back to the
 *   tab and on reconnecting; local changes are pushed in small pieces — the draft, and each
 *   image the server doesn't have yet — so typing in the editor never resends everything;
 * - every reply is merged into whatever is local *now*, so an edit made while a request was
 *   in flight is never lost. The merge rules (packages/shared/src/workspace.ts) make retries
 *   and any order of requests safe.
 */

export type WorkspaceSyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error'

export interface WorkspaceSyncDeps {
  /** The app as it is on this device right now. */
  local(): Workspace
  /** Replace the device's app with this (already merged with local()). */
  adopt(next: Workspace): void
  fetchAll(): Promise<unknown>
  putDraft(draft: Workspace['draft'], opts: { keepalive: boolean }): Promise<unknown>
  putRelease(release: Workspace['releases'][number]): Promise<unknown>
  schedule(fn: () => void, ms: number): () => void
  isOnline(): boolean
  onUnauthorized(): void
  onStatus(status: WorkspaceSyncStatus): void
}

const DEBOUNCE_MS = 1500
const MAX_BACKOFF_MS = 60_000

type HttpError = { status?: number; code?: string }

export class WorkspaceSync {
  status: WorkspaceSyncStatus = 'local'

  /** What the server is known to have (null: not fetched since signing in). */
  private remote: Workspace | null = null
  /** Fetch again on the next pass (set while a pass may be running, so `remote` stays usable). */
  private stale = false
  /** Bumped on every sign-in/out: replies from an earlier session are ignored. */
  private session = 0
  private signedIn = false
  private inflight = false
  private again = false
  private attempt = 0
  private cancelTimer: (() => void) | null = null
  /** Tags the server refused for good (account full): not retried until the next full sync. */
  private refused = new Set<string>()
  /** A draft the server refused (4xx): not resent until it changes. */
  private refusedDraft: Draft | null = null
  /** The pass running now, if any (sign-out waits for it). */
  private current: Promise<void> = Promise.resolve()

  private readonly deps: WorkspaceSyncDeps

  constructor(deps: WorkspaceSyncDeps) {
    this.deps = deps
  }

  setSignedIn(signedIn: boolean): Promise<void> {
    if (signedIn === this.signedIn) return Promise.resolve()
    this.signedIn = signedIn
    this.session++
    this.cancel()
    this.attempt = 0
    this.remote = null
    this.stale = false
    this.refused.clear()
    this.refusedDraft = null
    if (!signedIn) {
      this.setStatus('local')
      return Promise.resolve()
    }
    return this.run()
  }

  /** Something changed on this device: push it soon. */
  changed() {
    if (this.signedIn) this.later(DEBOUNCE_MS)
  }

  /** Fetch everything again (focus, reconnect) and push what's missing. */
  refresh() {
    if (!this.signedIn) return Promise.resolve()
    this.stale = true
    // "try again" means everything, including what the server refused before
    this.refused.clear()
    this.refusedDraft = null
    return this.run()
  }

  /** The page is going away: send an unsynced draft with keepalive. Images wait for next time. */
  flush() {
    if (!this.signedIn || !this.remote) return
    const draft = this.deps.local().draft
    if (!sameDraft(draft, this.remote.draft) && !(this.refusedDraft && sameDraft(draft, this.refusedDraft))) void this.deps.putDraft(draft, { keepalive: true }).catch(() => {})
  }

  /**
   * Whether this device may have changes the account doesn't. Not knowing counts as yes (never
   * fetched, or the session just expired) — it decides whether signing out may wipe the app.
   */
  hasPending(): boolean {
    return !this.remote || this.pending()
  }

  /**
   * Before signing out: let the pass in flight finish and push what's left, for up to `ms`.
   * Resolves either way; hasPending() says whether anything stayed behind.
   */
  async settle(ms = 4000): Promise<void> {
    if (!this.signedIn) return
    const work = (async () => {
      await this.current
      // nothing fetched yet (offline at sign-in, say): one full pass may still upload it all
      if (this.signedIn && (!this.remote || this.pending())) await this.run()
    })()
    let stop = () => {}
    await Promise.race([work, new Promise<void>((resolve) => (stop = this.deps.schedule(resolve, ms)))])
    stop()
  }

  /** One pass: fetch if needed, then push whatever the server lacks. Serialized; extra calls coalesce. */
  run(): Promise<void> {
    if (!this.signedIn) return Promise.resolve()
    if (this.inflight) {
      this.again = true
      return this.current
    }
    this.current = this.pass()
    return this.current
  }

  private async pass(): Promise<void> {
    if (!this.deps.isOnline()) {
      this.setStatus('offline')
      return
    }
    this.cancel()
    this.inflight = true
    this.setStatus('syncing')
    const session = this.session
    const gone = () => session !== this.session
    try {
      if (!this.remote || this.stale) {
        this.stale = false
        const fetched = parseWorkspace(await this.deps.fetchAll())
        if (!fetched) throw Object.assign(new Error('Malformed workspace from server'), { status: 500 })
        if (gone()) return
        this.remote = fetched
        this.take(fetched)
      }
      const local = this.deps.local()
      if (!sameDraft(local.draft, this.remote.draft) && !(this.refusedDraft && sameDraft(local.draft, this.refusedDraft))) {
        const sent = local.draft
        let reply: unknown
        try {
          reply = await this.deps.putDraft(sent, { keepalive: false })
        } catch (e) {
          // the server won't take this draft (too big, invalid): don't hammer it; a new edit tries again
          const status = (e as HttpError).status ?? 0
          if (status >= 400 && status < 500 && status !== 401 && status !== 429) this.refusedDraft = sent
          throw e
        }
        const draft = parseDraft(reply)
        if (!draft) throw Object.assign(new Error('Malformed draft from server'), { status: 500 })
        if (gone()) return
        this.remote = { ...this.remote, draft }
        this.adoptReply(sent, draft)
      }
      for (const release of local.releases) {
        if (this.refused.has(release.tag) || this.remote.releases.some((r) => sameRelease(r, release))) continue
        try {
          const kept = parseRelease(await this.deps.putRelease(release))
          if (!kept) throw Object.assign(new Error('Malformed release from server'), { status: 500 })
          if (gone()) return
          this.remote = { ...this.remote, releases: mergeWorkspace(this.remote, { ...this.remote, releases: [kept] }).releases }
          this.take({ ...this.deps.local(), releases: [kept] })
        } catch (e) {
          // a 4xx about this one image (the account is full, a tag it won't take): skip it, keep the rest going
          const status = (e as HttpError).status ?? 0
          if (status >= 400 && status < 500 && status !== 401 && status !== 429) this.refused.add(release.tag)
          else throw e
        }
      }
      this.attempt = 0
      // a refused draft isn't retried, but it isn't "synced" either
      const stuck = this.refusedDraft !== null && sameDraft(this.deps.local().draft, this.refusedDraft)
      this.setStatus(stuck ? 'error' : 'synced')
    } catch (e) {
      if (gone()) return
      const status = (e as HttpError).status
      if (status === 401) {
        this.signedIn = false
        this.remote = null
        this.session++
        this.setStatus('local')
        this.deps.onUnauthorized()
        return
      }
      this.setStatus(status === 0 || !this.deps.isOnline() ? 'offline' : 'error')
      this.attempt++
      const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.attempt - 1))
      this.later(backoff * (0.5 + Math.random() * 0.5))
    } finally {
      this.inflight = false
      if (this.signedIn && this.again) {
        this.again = false
        this.later(0)
      } else if (this.signedIn && this.status === 'synced' && this.remote && this.pending()) {
        // the learner kept typing while this pass ran
        this.later(DEBOUNCE_MS)
      }
    }
  }

  private pending() {
    const local = this.deps.local()
    const remote = this.remote!
    const draftPending = !sameDraft(local.draft, remote.draft) && !(this.refusedDraft && sameDraft(local.draft, this.refusedDraft))
    return draftPending || local.releases.some((r) => !this.refused.has(r.tag) && !remote.releases.some((x) => sameRelease(x, r)))
  }

  /**
   * The server's answer to a draft we sent. For each part (design, code) that hasn't changed here
   * since sending, the answer *is* that part — the server may have moved a date from a clock
   * running ahead back to its own time, and merging would undo that forever. A part edited
   * meanwhile is merged as usual.
   */
  private adoptReply(sent: Draft, reply: Draft) {
    const now = this.deps.local()
    const d = now.draft
    const merged = mergeDraft(d, reply)
    const designSame = sameDesign(d.design, sent.design) && d.designAt === sent.designAt
    const codeSame = d.code === sent.code && d.codeAt === sent.codeAt
    const next: Draft = {
      design: designSame ? reply.design : merged.design,
      designAt: designSame ? reply.designAt : merged.designAt,
      code: codeSame ? reply.code : merged.code,
      codeAt: codeSame ? reply.codeAt : merged.codeAt,
      customized: merged.customized,
    }
    if (!sameDraft(next, d)) this.deps.adopt({ ...now, draft: next })
  }

  /** Merge something from the server into what's local now, and keep it if it changes anything. */
  private take(incoming: Workspace) {
    const local = this.deps.local()
    const merged = mergeWorkspace(local, incoming)
    if (!sameWorkspace(merged, local)) this.deps.adopt(merged)
  }

  private later(ms: number) {
    this.cancel()
    this.cancelTimer = this.deps.schedule(() => {
      this.cancelTimer = null
      void this.run()
    }, ms)
  }

  private cancel() {
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  private setStatus(status: WorkspaceSyncStatus) {
    if (status === this.status) return
    this.status = status
    this.deps.onStatus(status)
  }
}
