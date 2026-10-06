import type { Profile } from './program'
import { runInWorker } from './runner'

/**
 * Which images carry the learner's code, and what that code does with each environment.
 * The simulation asks synchronously; the first ask starts a run and answers 'pending' (the
 * container waits, like an image being pulled), later asks get the cached profile.
 */

type Runner = (code: string, env: Record<string, string>) => Promise<Profile>

const images = new Map<string, string>()
const cache = new Map<string, Profile>()
const inflight = new Set<string>()
let runner: Runner = runInWorker
// runs started under a previous runner must not fill the cache (tests swap runners)
let generation = 0
const MAX_CACHE = 64

const keyOf = (code: string, env: Record<string, string>) =>
  `${code}\u0000${JSON.stringify(Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))}`

/** The images built from the learner's code: image → the code it was built from. */
export function setImageCode(entries: Iterable<[image: string, code: string]>) {
  images.clear()
  for (const [image, code] of entries) images.set(image, code)
}

export const imageCode = (image: string) => images.get(image)

/** Swap how code runs (tests use node:vm). */
export function setRunner(next: Runner) {
  runner = next
  generation++
  cache.clear()
  inflight.clear()
}

/** Run some code once, outside any Pod — the editor's "Testar". */
export const tryCode = (code: string, env: Record<string, string> = {}) => runner(code, env)

export function profileFor(image: string, env: Record<string, string>): Profile | 'pending' | null {
  const code = images.get(image)
  if (code === undefined) return null
  const key = keyOf(code, env)
  const hit = cache.get(key)
  if (hit) {
    // least recently used goes first: refresh this one
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  if (!inflight.has(key)) {
    inflight.add(key)
    const started = generation
    void runner(code, env)
      .catch((e: unknown): Profile => ({ kind: 'script', logs: [], error: `Error: ${e instanceof Error ? e.message : 'o runtime falhou'}`, replies: {} }))
      .then((profile) => {
        if (started !== generation) return
        inflight.delete(key)
        cache.set(key, profile)
        if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!)
      })
  }
  return 'pending'
}
