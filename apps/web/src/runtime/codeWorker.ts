import { execute, exitError, LIMITS, type RunParts, type Sandbox } from './program'

/**
 * Runs one piece of the learner's code, then the page throws this Worker away. It has no DOM,
 * no storage and no session; on top of that, the network APIs are removed before the code runs
 * (and in production the Worker's own CSP allows no connections at all).
 */

type Scope = { postMessage(message: unknown): void; onmessage: ((e: { data: { code: string; env: Record<string, string> } }) => void) | null } & Record<string, unknown>
const scope = self as unknown as Scope
const post = scope.postMessage.bind(scope)

const BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'postMessage']

const hide = (target: object, name: string) => {
  try {
    Object.defineProperty(target, name, { value: undefined, configurable: false, writable: false })
  } catch {
    // already non-configurable in this engine: try a plain overwrite
    try {
      ;(target as Record<string, unknown>)[name] = undefined
    } catch {
      // nothing else to do — the CSP still blocks connections
    }
  }
}

function lockdown() {
  // fetch & co. live on the global scope's prototypes too (WorkerGlobalScope.prototype): hide them on
  // every level, or Object.getPrototypeOf(self).fetch would still reach them
  const levels: object[] = []
  for (let o: object | null = scope; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) levels.push(o)
  for (const name of BLOCKED) for (const level of levels) if (level === scope || Object.prototype.hasOwnProperty.call(level, name)) hide(level, name)
}

const sandbox: Sandbox = {
  // indirect eval: the program runs in the Worker's global scope, not this module's. Running the
  // learner's code is this file's whole job — it's contained by the Worker, the lockdown and the CSP.
  // oxlint-disable-next-line no-eval
  compile: (program) => (0, eval)(program),
  call: (fn, args) => (fn as (...a: unknown[]) => unknown)(...args),
}

scope.onmessage = ({ data }) => {
  scope.onmessage = null
  lockdown()
  let latest: RunParts | null = null
  // errors that escape the code later — a rejected promise, a throw inside a timer — end the
  // process just like a throw on the first line would (Node exits on both)
  const escaped = (reason: unknown) => {
    if (!latest || latest.loadError) return
    const message = exitError(reason)
    if (message === null && latest.loaded && !latest.isServer) return
    latest.loadError = message ?? 'process.exit(0) — o servidor saiu'
    post({ type: 'progress', parts: latest })
  }
  addEventListener('error', (e: ErrorEvent) => {
    e.preventDefault()
    escaped(e.error ?? new Error(e.message))
  })
  addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    e.preventDefault()
    escaped(e.reason)
  })
  void execute(sandbox, data.code, data.env, (parts: RunParts) => {
    latest = parts
    post({ type: 'progress', parts })
  }).then((parts) => {
    latest = parts
    // a script's pending promises and timers may still log, or fail: give them a moment
    if (parts.loaded && !parts.isServer && !parts.loadError) setTimeout(() => post({ type: 'done', parts }), LIMITS.settleMs)
    else post({ type: 'done', parts })
  })
}

post({ type: 'ready' })
