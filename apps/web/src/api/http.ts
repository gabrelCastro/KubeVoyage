/**
 * The one way the web app talks to the API: same-origin cookies, JSON in and out,
 * the CSRF double-submit header on writes, and errors as typed ApiErrors.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfterSeconds?: number
  readonly fields?: { field: string; message: string }[]

  constructor(status: number, code: string, message: string, extra: { retryAfterSeconds?: number; fields?: ApiError['fields'] } = {}) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfterSeconds = extra.retryAfterSeconds
    this.fields = extra.fields
  }

  /** The request never got an answer (offline, server down, CORS…). */
  get network() {
    return this.status === 0
  }
}

const CSRF_COOKIE = 'XSRF-TOKEN'

function cookie(name: string): string | null {
  const hit = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null
}

async function ensureCsrf(force = false) {
  if (!force && cookie(CSRF_COOKIE)) return
  // the response is irrelevant: asking for it makes the server set the cookie
  await fetch('/api/auth/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  /** Lets the request outlive the page (used to flush progress on tab close). */
  keepalive?: boolean
  signal?: AbortSignal
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const p = await res.json()
    return new ApiError(res.status, p.code ?? 'error', p.detail ?? res.statusText, { retryAfterSeconds: p.retryAfterSeconds, fields: p.errors })
  } catch {
    return new ApiError(res.status, 'error', res.statusText || `HTTP ${res.status}`)
  }
}

export async function api<T = void>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  const write = method !== 'GET'
  const send = async () => {
    if (write) await ensureCsrf()
    return fetch(path, {
      method,
      credentials: 'same-origin',
      keepalive: opts.keepalive,
      signal: opts.signal,
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(write && { 'X-XSRF-TOKEN': cookie(CSRF_COOKIE) ?? '' }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  }

  let res: Response
  try {
    res = await send()
    if (write && res.status === 403) {
      const err = await toError(res.clone())
      if (err.code === 'csrf') {
        // token rotated or expired: get a fresh one and try exactly once more
        await ensureCsrf(true)
        res = await send()
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'network', 'Could not reach the server.')
  }
  if (!res.ok) throw await toError(res)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
