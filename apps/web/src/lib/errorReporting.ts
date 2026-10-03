import { api } from '../api/http'

/**
 * Sends browser errors to our own API, which writes them to its log. Nothing goes to a
 * third party, and nothing identifying is sent: the message, the stack and the lesson.
 */

const MAX_PER_PAGE = 10
const seen = new Set<string>()

// noise that says nothing about the app
const IGNORED = [/ResizeObserver loop/, /^Script error\.?$/, /chrome-extension:|moz-extension:|safari-extension:/]

export function reportError(error: unknown, kind: 'error' | 'rejection' | 'render') {
  const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500)
  const stack = error instanceof Error ? error.stack?.slice(0, 4000) : undefined
  if (!message.trim() || IGNORED.some((re) => re.test(message) || (stack && re.test(stack)))) return
  if (seen.has(message) || seen.size >= MAX_PER_PAGE) return
  seen.add(message)
  const lesson = /^#\/([a-z0-9-]{1,40})$/.exec(location.hash)?.[1]
  // reporting must never be the thing that breaks the page
  api('/api/client-errors', { method: 'POST', body: { message, stack, lesson, kind }, keepalive: true }).catch(() => {})
}

export function installErrorReporting() {
  if (!import.meta.env.PROD) return
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'error'))
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'rejection'))
}
