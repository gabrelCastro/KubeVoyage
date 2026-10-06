/**
 * Scrollback, as in a real terminal: the newest lines stay, the oldest go. Without a limit a long
 * session (a `-w` streaming for minutes, say) kept every line on the page and slowed everything.
 */
export const SCROLLBACK_LINES = 2000

export function pushTerm<T extends { lines: readonly unknown[] }>(term: readonly T[], entry: T): T[] {
  const out = [...term, entry]
  let lines = 0
  for (let i = out.length - 1; i >= 0; i--) {
    lines += Math.max(1, out[i].lines.length)
    // the newest entry always stays, even when it alone is longer than the limit
    if (lines > SCROLLBACK_LINES) return out.slice(Math.min(i + 1, out.length - 1))
  }
  return out
}
