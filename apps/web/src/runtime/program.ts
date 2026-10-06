/**
 * The learner's code, as a container would run it. This module is pure: it builds the program
 * and turns what happened into a Profile. Running it is someone else's job — a Web Worker in
 * the browser (runner.ts), node:vm in tests — so both run exactly the same thing.
 *
 * The contract, kept small on purpose:
 *  - the file is a script; `console.log` goes to the container's logs;
 *  - `process.env` / `env` hold the container's environment (ConfigMaps, Secrets);
 *  - if it defines `function handle(req, env)`, it's a server: each request calls it, and it
 *    returns a string or `{ status, body }` (it may be async);
 *  - otherwise it's a task: it runs once, and finishing without an error means exit code 0;
 *    `process.exit(n)` ends it with that code, like in Node.
 * Like a Node CommonJS file it isn't strict mode, and `require` only knows there are no packages.
 */

export type Reply = { status: number; body: string } | { error: string } | { timedOut: true }

export interface Profile {
  kind: 'server' | 'script'
  /** Everything the code printed, load and requests included. */
  logs: string[]
  /** Thrown while loading (or, for a script, while running): the container exits with an error. */
  error?: string
  /** Never finished loading: the process is up but stuck. */
  timedOut?: boolean
  /** For a server: what each probed path answered. */
  replies: Record<string, Reply>
}

/** What the cluster asks a server: the visitors' page and the health check the probes use. */
export const PROBE_PATHS = ['/', '/healthz'] as const

export const LIMITS = {
  /** Real milliseconds the code may take to load (or a script to run). */
  loadMs: 800,
  /** Real milliseconds each request may take. */
  requestMs: 300,
  logLines: 200,
  logChars: 400,
  bodyChars: 2000,
  codeChars: 16_000,
  /** After a script's last line, how long pending promises and timers may still finish. */
  settleMs: 150,
} as const

/** Wraps the file in a function: what Node would give a module comes in; `handle` (if any) comes out. */
export function buildProgram(code: string): string {
  // a trailing line comment in the learner's code must not swallow the closing lines
  return `(function (console, env, process, require, module, exports) {\n${code}\n;return typeof handle === 'function' ? handle : typeof module.exports === 'function' ? module.exports : typeof module.exports?.handle === 'function' ? module.exports.handle : undefined\n})`
}

/** Thrown by `process.exit(n)`: unwinds the code, then the run ends with exit code n. */
export class Exit {
  readonly code: number
  constructor(code: number) {
    this.code = code
  }
}

/** What the code sees as `process`, `require` and `module`. */
export function nodeGlobals(env: Record<string, string>) {
  const module = { exports: {} as unknown }
  return {
    process: {
      env: { ...env },
      exit: (code?: unknown) => {
        throw new Exit(typeof code === 'number' && Number.isInteger(code) ? code : 0)
      },
      argv: ['node', '/app/app.js'],
      platform: 'linux',
    },
    require: (name: unknown) => {
      throw Object.assign(new Error(`Cannot find module '${String(name)}' — neste curso, app.js roda sem pacotes (nem do npm, nem do Node)`), { code: 'MODULE_NOT_FOUND' })
    },
    module,
  }
}

/** A thrown value, as the run records it: process.exit(0) is a clean end, any other code an error. */
export const exitError = (e: unknown): string | null => (e instanceof Exit ? (e.code === 0 ? null : `process.exit(${e.code})`) : formatError(e))

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

// errors may come from another realm (a vm context, a Worker): recognize them by shape
const errorLike = (v: unknown): v is { name: string; message: string } =>
  !!v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string' && typeof (v as { message?: unknown }).message === 'string'

export function formatValue(v: unknown): string {
  if (typeof v === 'string') return v
  if (errorLike(v)) return `${v.name}: ${v.message}`
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

export function formatError(e: unknown): string {
  if (errorLike(e)) return `${e.name}: ${e.message}`
  return `Uncaught ${formatValue(e)}`
}

/** A console whose output lands in `logs`, bounded so a chatty loop can't fill the memory. */
export function makeConsole(logs: string[]) {
  const write =
    (prefix = '') =>
    (...args: unknown[]) => {
      if (logs.length >= LIMITS.logLines) return
      logs.push(clip(prefix + args.map(formatValue).join(' '), LIMITS.logChars))
      if (logs.length === LIMITS.logLines) logs.push('… (saída cortada: limite de linhas)')
    }
  return { log: write(), info: write(), debug: write(), warn: write('warn: '), error: write('error: ') }
}

/** Whatever `handle` returned, as an HTTP reply. */
export function normalizeReply(value: unknown): Reply {
  if (value === undefined || value === null) return { status: 204, body: '' }
  if (typeof value === 'string') return { status: 200, body: clip(value, LIMITS.bodyChars) }
  if (typeof value === 'object' && ('body' in value || 'status' in value)) {
    const v = value as { status?: unknown; body?: unknown }
    const status = typeof v.status === 'number' && Number.isInteger(v.status) && v.status >= 100 && v.status <= 599 ? v.status : 200
    const body = v.body === undefined ? '' : formatValue(v.body)
    return { status, body: clip(body, LIMITS.bodyChars) }
  }
  return { status: 200, body: clip(formatValue(value), LIMITS.bodyChars) }
}

export const okReply = (r: Reply | undefined): r is { status: number; body: string } => !!r && 'status' in r && r.status >= 200 && r.status < 400

/** A guess for when the code never loaded: does it look like a server? (only for wording) */
export const looksLikeServer = (code: string) => /\bhandle\b/.test(code)

export const request = (path: string) => ({ method: 'GET', path, headers: { host: 'backend' } })

/** Steps reported by a runner, assembled into a Profile — partial runs (timeouts) included. */
export interface RunParts {
  code: string
  loaded: boolean
  loadError?: string
  isServer?: boolean
  logs: string[]
  replies: Record<string, Reply>
  timedOut: boolean
}

export function assemble(parts: RunParts): Profile {
  const kind = parts.isServer ?? looksLikeServer(parts.code) ? 'server' : 'script'
  if (!parts.loaded) {
    return parts.timedOut ? { kind, logs: parts.logs, timedOut: true, replies: {} } : { kind, logs: parts.logs, error: parts.loadError ?? 'erro desconhecido', replies: {} }
  }
  const replies = { ...parts.replies }
  if (kind === 'server') for (const p of PROBE_PATHS) replies[p] ??= { timedOut: true }
  // a script that loaded but never finished (stuck after an await, say) is still running
  const stuck = kind === 'script' && parts.timedOut && !parts.loadError
  return { kind, logs: parts.logs, replies, ...(parts.loadError && { error: parts.loadError }), ...(stuck && { timedOut: true }) }
}

/** Thrown by a sandbox when the code ran out of time (node:vm); the browser runner kills the Worker instead. */
export class Timeout extends Error {}

/** Where the code actually runs: compile the program, call a function inside the sandbox. */
export interface Sandbox {
  compile(program: string): unknown
  call(fn: unknown, args: unknown[]): unknown
}

const isThenable = (v: unknown): v is PromiseLike<unknown> => !!v && typeof (v as { then?: unknown }).then === 'function'

/**
 * Load the code, then (for a server) ask each probe path. `report` is called after every step,
 * so a runner that has to kill a stuck run still knows how far it got.
 */
export async function execute(sandbox: Sandbox, code: string, env: Record<string, string>, report: (parts: RunParts) => void = () => {}): Promise<RunParts> {
  const parts: RunParts = { code, loaded: false, logs: [], replies: {}, timedOut: false }
  const console = makeConsole(parts.logs)
  const node = nodeGlobals(env)
  let handle: unknown
  try {
    const outer = sandbox.compile(buildProgram(code))
    handle = sandbox.call(outer, [console, { ...env }, node.process, node.require, node.module, node.module.exports])
  } catch (e) {
    if (e instanceof Timeout) parts.timedOut = true
    else if (e instanceof Exit && e.code === 0) {
      // a script that ended itself cleanly
      parts.loaded = true
      parts.isServer = false
    } else parts.loadError = exitError(e) ?? undefined
    report(parts)
    return parts
  }
  parts.loaded = true
  parts.isServer = typeof handle === 'function'
  report(parts)
  if (!parts.isServer) return parts
  for (const path of PROBE_PATHS) {
    try {
      let value = sandbox.call(handle, [request(path), { ...env }])
      if (isThenable(value)) value = await value
      parts.replies[path] = normalizeReply(value)
    } catch (e) {
      if (e instanceof Exit) {
        // a server that exits while answering: the container is gone
        parts.loadError = e.code === 0 ? 'process.exit(0) — o servidor saiu' : `process.exit(${e.code})`
        report(parts)
        return parts
      }
      parts.replies[path] = e instanceof Timeout ? { timedOut: true } : { error: formatError(e) }
    }
    report(parts)
  }
  return parts
}
