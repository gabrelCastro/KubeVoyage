import type { Line } from '../kubectl'

/**
 * What can follow a `|`: the few filters people type by reflex. They work on the visible
 * text of each output line, like the real tools would on stdout.
 */

const text = (l: Line) => l.map((s) => s.t).join('')

export function pipe(lines: Line[], stage: string[]): Line[] | { error: string } {
  const [cmd, ...args] = stage
  if (!cmd) return { error: 'syntax error near unexpected token `|\'' }
  switch (cmd) {
    case 'grep': {
      const flags = new Set(args.filter((a) => /^-[a-zA-Z]+$/.test(a)).flatMap((a) => [...a.slice(1)]))
      const pattern = args.find((a) => !/^-[a-zA-Z]+$/.test(a))
      if (pattern === undefined) return { error: 'Usage: grep [-i] [-v] [-c] PATTERN' }
      const unknown = [...flags].find((f) => !'ivcEw'.includes(f))
      if (unknown) return { error: `grep: opção inválida -- '${unknown}' (aqui: -i, -v, -c, -E, -w)` }
      let re: RegExp
      try {
        const body = flags.has('E') ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        re = new RegExp(flags.has('w') ? `\\b(?:${body})\\b` : body, flags.has('i') ? 'i' : '')
      } catch {
        return { error: `grep: expressão inválida: ${pattern}` }
      }
      const kept = lines.filter((l) => re.test(text(l)) !== flags.has('v'))
      return flags.has('c') ? [[{ t: String(kept.length) }]] : kept
    }
    case 'head':
    case 'tail': {
      const n = Number((args.join(' ').match(/-n\s*(\d+)|-(\d+)/) ?? [])[1] ?? (args.join(' ').match(/-(\d+)/) ?? [])[1] ?? 10)
      return cmd === 'head' ? lines.slice(0, n) : lines.slice(Math.max(0, lines.length - n))
    }
    case 'wc':
      if (args[0] !== '-l') return { error: 'wc: aqui só `wc -l` (contar linhas) está disponível' }
      return [[{ t: String(lines.length) }]]
    case 'base64': {
      const decode = args.includes('-d') || args.includes('--decode')
      const input = lines.map(text).join('\n')
      try {
        if (!decode) return [[{ t: btoa(String.fromCharCode(...new TextEncoder().encode(input))) }]]
        const bytes = Uint8Array.from(atob(input.trim()), (ch) => ch.charCodeAt(0))
        return new TextDecoder().decode(bytes).split('\n').map((t) => [{ t }])
      } catch {
        return { error: 'base64: invalid input' }
      }
    }
    case 'sort':
      return [...lines].sort((a, b) => text(a).localeCompare(text(b)) * (args.includes('-r') ? -1 : 1))
    default:
      return { error: `${cmd}: este terminal só entende grep, head, tail, wc -l, sort e base64 depois de um |` }
  }
}
