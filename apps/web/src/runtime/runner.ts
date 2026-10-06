import { assemble, LIMITS, type Profile, type RunParts } from './program'

/**
 * Runs the learner's code in a fresh Web Worker and watches the clock from the outside: if a
 * step takes too long, the Worker is killed and whatever it reported so far becomes the
 * profile (a stuck load → timedOut; a stuck request → that reply timed out).
 */
export function runInWorker(code: string, env: Record<string, string>): Promise<Profile> {
  return new Promise((resolve) => {
    let latest: RunParts = { code, loaded: false, logs: [], replies: {}, timedOut: false }
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // the built file is assets/codeWorker-<hash>.js, which deploy/Caddyfile gives its own CSP
    const worker = new Worker(new URL('./codeWorker.ts', import.meta.url), { type: 'module', name: 'kubelearn-runtime' })
    const finish = (timedOut: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      resolve(assemble({ ...latest, timedOut: timedOut || latest.timedOut }))
    }
    const arm = (ms: number) => {
      clearTimeout(timer)
      timer = setTimeout(() => finish(true), ms)
    }
    worker.onmessage = (e: MessageEvent<{ type: 'ready' | 'progress' | 'done'; parts?: RunParts }>) => {
      if (e.data.type === 'ready') {
        // the budget starts now, not while the Worker itself was loading
        arm(LIMITS.loadMs)
        worker.postMessage({ code, env })
        return
      }
      if (e.data.parts) latest = e.data.parts
      if (e.data.type === 'done') finish(false)
      else arm(latest.loaded ? LIMITS.requestMs : LIMITS.loadMs)
    }
    worker.onerror = (e) => {
      e.preventDefault()
      latest = { ...latest, loadError: latest.loaded ? latest.loadError : `Error: ${e.message || 'o runtime não iniciou'}` }
      finish(false)
    }
    // the Worker itself must come up in reasonable time, too
    arm(5000)
  })
}
