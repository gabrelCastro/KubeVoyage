import { emptyProgress, mergeProgress, parseProgress, sameProgress, type Progress } from '@kubelearn/shared'

/**
 * Local-first progress.
 *
 * - Every change is written to this device first, synchronously. The app never waits on
 *   the network and works the same signed out.
 * - When signed in, the whole document is sent to the server, which merges and returns
 *   the union. Because merging only ever grows, the order and number of syncs never matter:
 *   retries are safe, two devices can't conflict, a lost response loses nothing.
 * - Failures back off exponentially and resume when the browser comes back online.
 */

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error'

export interface SyncState {
  status: SyncStatus
  lastSyncedAt: number | null
}

export interface SyncDeps {
  storage: { read(): unknown; write(value: unknown): void; clear(): void }
  /** PUT the document; resolves with the server's merged copy. */
  push(progress: Progress, opts: { keepalive: boolean }): Promise<unknown>
  schedule(fn: () => void, ms: number): () => void
  now(): number
  isOnline(): boolean
  /** The server says the session is gone (expired, signed out elsewhere, account deleted). */
  onUnauthorized(): void
  onChange(progress: Progress, state: SyncState): void
}

const DEBOUNCE_MS = 800
const MAX_BACKOFF_MS = 30_000

export class ProgressSync {
  progress: Progress
  state: SyncState = { status: 'local', lastSyncedAt: null }

  private signedIn = false
  private dirty = false
  private inflight = false
  private again = false
  private attempt = 0
  private cancelTimer: (() => void) | null = null

  private readonly deps: SyncDeps

  constructor(deps: SyncDeps) {
    this.deps = deps
    this.progress = loadStored(deps.storage.read())
  }

  /** Fold new progress in (it can only grow). Saved locally at once; pushed soon if signed in. */
  record(delta: Progress) {
    // same rules as the server: unknown lessons/objectives never even enter local state
    const clean = parseProgress(delta)
    if (!clean) return
    const next = mergeProgress(this.progress, clean)
    if (sameProgress(next, this.progress)) return
    this.progress = next
    this.save()
    this.emit()
    if (this.signedIn) {
      this.dirty = true
      this.later(DEBOUNCE_MS)
    }
  }

  /** Resolves once the first sync after signing in has settled (successfully or not). */
  setSignedIn(signedIn: boolean): Promise<void> {
    if (signedIn === this.signedIn) return Promise.resolve()
    this.signedIn = signedIn
    this.cancel()
    this.attempt = 0
    if (signedIn) {
      // first sync after signing in uploads whatever this device learned while signed out
      this.dirty = true
      return this.syncNow()
    } else {
      this.dirty = false
      this.setState({ status: 'local' })
      return Promise.resolve()
    }
  }

  /** Push and pull right now (also used on focus / reconnect to pick up other devices). */
  async syncNow() {
    if (!this.signedIn) return
    if (this.inflight) {
      this.again = true
      return
    }
    if (!this.deps.isOnline()) {
      this.setState({ status: 'offline' })
      return
    }
    this.cancel()
    this.inflight = true
    this.setState({ status: 'syncing' })
    const sent = this.progress
    try {
      const reply = parseProgress(await this.deps.push(sent, { keepalive: false }))
      if (!reply) throw Object.assign(new Error('Malformed progress from server'), { status: 500 })
      if (!this.signedIn) return
      // still pending only if this device learned something *while* the request was in flight.
      // (Comparing with the reply instead could loop forever on anything the server declines.)
      this.dirty = !sameProgress(this.progress, sent)
      // merge, not replace: keep what was learned meanwhile, add what other devices knew
      const merged = mergeProgress(this.progress, reply)
      if (!sameProgress(merged, this.progress)) {
        this.progress = merged
        this.save()
      }
      this.attempt = 0
      this.setState({ status: 'synced', lastSyncedAt: this.deps.now() })
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status === 401) {
        this.signedIn = false
        this.setState({ status: 'local' })
        this.deps.onUnauthorized()
        return
      }
      this.dirty = true
      this.setState({ status: status === 0 || !this.deps.isOnline() ? 'offline' : 'error' })
      this.attempt++
      const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.attempt - 1))
      this.later(backoff * (0.5 + Math.random() * 0.5))
    } finally {
      this.inflight = false
      if (this.signedIn && (this.again || (this.dirty && this.state.status === 'synced'))) {
        this.again = false
        this.later(0)
      }
    }
  }

  /** Page is going away: send unsynced progress with keepalive so it survives the unload. */
  flush() {
    if (!this.signedIn || !this.dirty) return
    void this.deps.push(this.progress, { keepalive: true }).catch(() => {})
  }

  /** Another tab saved progress: take it in. That tab is responsible for pushing it. */
  absorb(stored: unknown) {
    const other = parseStoredProgress(stored)
    if (!other) return
    const merged = mergeProgress(this.progress, other)
    if (sameProgress(merged, this.progress)) return
    this.progress = merged
    this.emit()
  }

  /** Signing out forgets this device's copy (it's safe in the account). */
  /** Whether this device has progress the account may not have yet. */
  hasPending(): boolean {
    return this.dirty || this.inflight
  }

  /**
   * Before signing out: push what's pending (the debounce hasn't fired yet, say), for up to `ms`.
   * Resolves either way; hasPending() says whether anything stayed behind.
   */
  async settle(ms = 4000): Promise<void> {
    const deadline = this.deps.now() + ms
    while (this.signedIn && this.hasPending() && this.deps.now() < deadline) {
      if (this.inflight) await new Promise<void>((resolve) => this.deps.schedule(resolve, 50))
      else {
        await this.syncNow()
        // offline or failing: waiting longer won't help
        if (this.state.status === 'offline' || this.state.status === 'error') return
      }
    }
  }

  clearLocal() {
    this.cancel()
    this.signedIn = false
    this.dirty = false
    this.progress = emptyProgress()
    this.deps.storage.clear()
    this.setState({ status: 'local', lastSyncedAt: null })
  }

  private later(ms: number) {
    this.cancel()
    this.cancelTimer = this.deps.schedule(() => {
      this.cancelTimer = null
      void this.syncNow()
    }, ms)
  }

  private cancel() {
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  private save() {
    this.deps.storage.write({ v: 2, progress: this.progress })
  }

  private setState(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch }
    this.emit()
  }

  private emit() {
    this.deps.onChange(this.progress, this.state)
  }
}

/** Stored documents are untrusted too (old versions, other tabs, hand edits). */
export function parseStoredProgress(raw: unknown): Progress | null {
  if (raw && typeof raw === 'object' && 'v' in raw && raw.v === 2 && 'progress' in raw) return parseProgress(raw.progress)
  return null
}

function loadStored(raw: unknown): Progress {
  return parseStoredProgress(raw) ?? emptyProgress()
}
