/**
 * The terminal's own command history, like ~/.bash_history: kept on this device across
 * reloads and lessons. (The lesson's history in the store is separate — objectives read it.)
 */

const KEY = 'kubelearn.shell-history.v1'
const MAX = 200

function load(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(-MAX) : []
  } catch {
    return []
  }
}

let entries = typeof localStorage === 'undefined' ? [] : load()

export const shellHistory = {
  all: () => entries,
  push(command: string) {
    const c = command.trim()
    if (!c || entries[entries.length - 1] === c) return
    entries = [...entries, c].slice(-MAX)
    try {
      localStorage.setItem(KEY, JSON.stringify(entries))
    } catch {
      // storage full or blocked: history just won't survive a reload
    }
  },
  /** Most recent command that extends what's typed (fish-style autosuggestion). */
  suggest(prefix: string): string | null {
    if (!prefix.trim()) return null
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].startsWith(prefix) && entries[i] !== prefix) return entries[i]
    return null
  },
  /** Reverse search, like Ctrl+R: the `skip`-th most recent command containing `query`. */
  search(query: string, skip = 0): string | null {
    if (!query) return null
    const seen = new Set<string>()
    for (let i = entries.length - 1; i >= 0; i--) {
      if (!entries[i].includes(query) || seen.has(entries[i])) continue
      if (seen.size === skip) return entries[i]
      seen.add(entries[i])
    }
    return null
  },
}
