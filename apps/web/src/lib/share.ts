/**
 * Structural sharing for derived render data. The stage rebuilds its geometry from the cluster
 * on every change; most of it comes out identical. Keeping the previous object when the content
 * is the same lets `memo` children (Pods, edges…) skip rendering — otherwise every Pod re-renders
 * whenever any one of them changes.
 */

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype

/** Equal own keys and values; plain-object values (like `{ x, y }`) are compared one level deeper. */
export function sameShape(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!isPlain(a) || !isPlain(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    const x = a[k]
    const y = b[k]
    if (x === y) continue
    if (!isPlain(x) || !isPlain(y)) return false
    const kx = Object.keys(x)
    if (kx.length !== Object.keys(y).length || kx.some((j) => x[j] !== y[j])) return false
  }
  return true
}

/** `next`, with every element equal to the one at the same id in `prev` replaced by it — or `prev` itself if nothing changed. */
export function shareList<T>(prev: readonly T[] | null, next: T[], id: (t: T) => string): T[] {
  if (!prev) return next
  const old = new Map(prev.map((t) => [id(t), t]))
  let changed = prev.length !== next.length
  const out = next.map((t, i) => {
    const before = old.get(id(t))
    if (before !== undefined && sameShape(before, t)) {
      if (prev[i] !== before) changed = true
      return before
    }
    changed = true
    return t
  })
  return changed ? out : (prev as T[])
}

/** The same for a record: equal entries keep their previous object; an unchanged record is `prev`. */
export function shareRecord<T>(prev: Readonly<Record<string, T>> | null, next: Record<string, T>): Record<string, T> {
  if (!prev) return next
  const keys = Object.keys(next)
  let changed = keys.length !== Object.keys(prev).length
  const out: Record<string, T> = {}
  for (const k of keys) {
    const before = prev[k]
    if (before !== undefined && sameShape(before, next[k])) out[k] = before
    else {
      out[k] = next[k]
      changed = true
    }
  }
  return changed ? out : (prev as Record<string, T>)
}

/**
 * A function that shares each value it's given with the previous one (see shareList/shareLayout).
 * Create one per component (`useState(() => sharer(...))`) and call it inside `useMemo`; calling it
 * twice with equal input (StrictMode) returns the same object.
 */
export function sharer<T>(share: (prev: T | null, next: T) => T): (next: T) => T {
  let prev: T | null = null
  return (next) => (prev = share(prev, next))
}
