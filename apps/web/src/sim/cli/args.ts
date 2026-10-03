/**
 * Command-line parsing for the simulated shell: quoting, pipes, kubectl flags and label
 * selectors. Pure functions, no knowledge of the cluster.
 */

export type Flags = Record<string, string | true>

export interface Parsed {
  args: string[]
  flags: Flags
  /** How each flag was typed (`-x`, `--foo`), for error messages. */
  spelled: Record<string, string>
}

/** Splits like a POSIX shell would for our purposes: quotes group, `|` separates stages. */
export function tokenize(input: string): { stages: string[][]; error?: string } {
  const stages: string[][] = [[]]
  let cur = ''
  let quote: '"' | "'" | null = null
  let started = false
  const push = () => {
    if (started) stages[stages.length - 1].push(cur)
    cur = ''
    started = false
  }
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (ch === '|') {
      push()
      stages.push([])
    } else if (/\s/.test(ch)) push()
    else {
      cur += ch
      started = true
    }
  }
  if (quote) return { stages: [], error: `unexpected EOF while looking for matching \`${quote}'` }
  push()
  return { stages }
}

/** Long flag aliases → the short name the commands look up. */
const ALIASES: Record<string, string> = {
  output: 'o',
  selector: 'l',
  namespace: 'n',
  filename: 'f',
  'label-columns': 'L',
  'all-namespaces': 'A',
  watch: 'w',
  previous: 'p',
  container: 'c',
  follow: 'f-follow',
  tty: 't',
  stdin: 'i',
}

/** Flags that take a value, so `--replicas 3` works like `--replicas=3`. */
export const TAKES_VALUE = new Set(['o', 'l', 'n', 'f', 'L', 'c', 'replicas', 'port', 'target-port', 'name', 'image', 'to-revision', 'sort-by', 'field-selector', 'tail', 'type', 'labels', 'restart', 'from-literal', 'patch', 'grace-period', 'timeout'])

/** Short flags that are booleans (everything else short takes the next token). */
const SHORT_BOOLEAN = new Set(['w', 'A', 'p', 'h', 'i', 't', 'it'])

export function parseArgs(tokens: string[], verb?: string): Parsed {
  const args: string[] = []
  const flags: Flags = {}
  const spelled: Record<string, string> = {}
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--') {
      args.push(...tokens.slice(i + 1))
      break
    }
    if (t.startsWith('--')) {
      const [rawKey, ...v] = t.slice(2).split('=')
      // `logs -f` follows; everywhere else -f is a file
      const key = rawKey === 'follow' || (rawKey === 'f' && verb === 'logs') ? 'follow' : (ALIASES[rawKey] ?? rawKey)
      spelled[key] = `--${rawKey}`
      if (v.length) flags[key] = v.join('=')
      else if (TAKES_VALUE.has(key) && tokens[i + 1] !== undefined && !tokens[i + 1].startsWith('-')) flags[key] = tokens[++i]
      else flags[key] = true
    } else if (t.startsWith('-') && t.length > 1 && !/^-\d/.test(t)) {
      let key = t.slice(1)
      let value: string | undefined
      // -lapp=backend, -owide
      if (key.length > 1 && TAKES_VALUE.has(key[0]) && !SHORT_BOOLEAN.has(key)) {
        value = key.slice(1).replace(/^=/, '')
        key = key[0]
      }
      if (key === 'f' && verb === 'logs') key = 'follow'
      // `patch -p` is the patch body; everywhere else -p is `logs --previous`
      if (key === 'p' && verb === 'patch') key = 'patch'
      spelled[key] = `-${t.slice(1, 2)}`
      if (value !== undefined) flags[key] = value
      else if (!SHORT_BOOLEAN.has(key) && TAKES_VALUE.has(key) && tokens[i + 1] !== undefined) flags[key] = tokens[++i]
      else flags[key] = true
    } else args.push(t)
  }
  return { args, flags, spelled }
}

// ── label selectors ────────────────────────────────────────────────────────

export type Requirement =
  | { key: string; op: '=' | '!='; value: string }
  | { key: string; op: 'in' | 'notin'; values: string[] }
  | { key: string; op: 'exists' | '!exists' }

const KEY = /^[a-zA-Z0-9]([-a-zA-Z0-9_./]*[a-zA-Z0-9])?$/
const VALUE = /^([a-zA-Z0-9]([-a-zA-Z0-9_.]*[a-zA-Z0-9])?)?$/

/** Splits on commas that are not inside `in (a,b)`. */
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((p) => p.trim())
}

/** Every selector form kubectl accepts: `a=b`, `a==b`, `a!=b`, `a in (x,y)`, `a notin (x)`, `a`, `!a`. */
export function parseSelector(input: string): Requirement[] | { error: string } {
  const reqs: Requirement[] = []
  for (const part of splitTopLevel(input)) {
    if (!part) return { error: `unable to parse requirement: found '', expected: identifier` }
    let m: RegExpMatchArray | null
    if ((m = part.match(/^(\S+?)\s+(in|notin)\s*\(([^)]*)\)$/))) {
      const values = m[3].split(',').map((v) => v.trim())
      if (!KEY.test(m[1]) || values.some((v) => !VALUE.test(v))) return { error: `unable to parse requirement: ${part}` }
      reqs.push({ key: m[1], op: m[2] as 'in' | 'notin', values })
    } else if ((m = part.match(/^([^=!\s]+)\s*(==|=|!=)\s*(\S*)$/))) {
      if (!KEY.test(m[1]) || !VALUE.test(m[3])) return { error: `unable to parse requirement: invalid label "${part}"` }
      reqs.push({ key: m[1], op: m[2] === '!=' ? '!=' : '=', value: m[3] })
    } else if ((m = part.match(/^!\s*(\S+)$/))) {
      if (!KEY.test(m[1])) return { error: `unable to parse requirement: ${part}` }
      reqs.push({ key: m[1], op: '!exists' })
    } else if (KEY.test(part)) reqs.push({ key: part, op: 'exists' })
    else return { error: `unable to parse requirement: ${part}` }
  }
  return reqs
}

export function selects(reqs: Requirement[], labels: Record<string, string>): boolean {
  return reqs.every((r) => {
    const v = labels[r.key]
    switch (r.op) {
      case '=':
        return v === r.value
      case '!=':
        return v !== r.value
      case 'in':
        return v !== undefined && r.values.includes(v)
      case 'notin':
        return v === undefined || !r.values.includes(v)
      case 'exists':
        return v !== undefined
      case '!exists':
        return v === undefined
    }
  })
}

// ── suggestions ────────────────────────────────────────────────────────────

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? d[i - 2][j - 2] + 1 : Infinity)
  return d[a.length][b.length]
}

/** Closest candidates within kubectl's own tolerance (2 edits), best first. */
export function suggest(word: string, candidates: string[]): string[] {
  return candidates
    .map((c) => ({ c, d: distance(word.toLowerCase(), c) }))
    .filter(({ c, d }) => d > 0 && d <= Math.min(2, Math.max(1, Math.floor(c.length / 3))))
    .sort((a, b) => a.d - b.d)
    .map(({ c }) => c)
}
