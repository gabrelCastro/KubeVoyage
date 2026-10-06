import { Check, Copy, Info, Lightbulb, Link2, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '../lib/visual'

/** Building blocks of /doc: one look for every page of documentation. */

export function Anchor({ id, label }: { id: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <a
      href={`#${id}`}
      onClick={() => {
        try {
          void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#${id}`)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        } catch {
          // the link still navigates
        }
      }}
      aria-label={`Link para “${label}”`}
      className="ml-2 inline-flex translate-y-[1px] items-center text-fg-faint opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:text-accent"
    >
      {copied ? <Check size={14} /> : <Link2 size={14} />}
    </a>
  )
}

export function H3({ id, children }: { id: string; children: string }) {
  return (
    <h3 id={id} className="group mt-10 scroll-mt-32 lg:scroll-mt-24 text-[17px] font-semibold tracking-tight text-fg">
      {children}
      <Anchor id={id} label={children} />
    </h3>
  )
}

export function H4({ children }: { children: ReactNode }) {
  return <h4 className="mt-6 text-[14px] font-semibold text-fg">{children}</h4>
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('mt-3 text-[14.5px] leading-[1.75] text-fg-muted', className)}>{children}</p>
}

/** Text that matters in a paragraph. */
export const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-fg">{children}</strong>

/** Inline code: commands, flags, file names, field names. */
export function C({ children }: { children: ReactNode }) {
  return <code className="rounded-[5px] border border-line bg-panel-2 px-[5px] py-[1px] font-mono text-[12.5px] text-fg [font-variant-ligatures:none] [overflow-wrap:anywhere]">{children}</code>
}

export function Ul({ children }: { children: ReactNode }) {
  return <ul className="mt-3 space-y-2 pl-5 text-[14.5px] leading-[1.7] text-fg-muted marker:text-fg-faint [&>li]:list-disc [&>li]:pl-1">{children}</ul>
}

export function Ol({ children }: { children: ReactNode }) {
  return <ol className="mt-3 space-y-2 pl-5 text-[14.5px] leading-[1.7] text-fg-muted marker:font-medium marker:text-fg-faint [&>li]:list-decimal [&>li]:pl-1">{children}</ol>
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[21px] min-w-[21px] items-center justify-center rounded-[5px] border border-b-2 border-line-strong bg-panel-2 px-1.5 font-sans text-[11.5px] font-medium text-fg">
      {children}
    </kbd>
  )
}

/** A block of commands or code, with a copy button. `$`-free: what you see is what you paste. */
export function Code({ children, lang = 'shell', caption }: { children: string; lang?: 'shell' | 'js' | 'yaml' | 'text'; caption?: string }) {
  const [copied, setCopied] = useState(false)
  const text = children.replace(/^\n+|\s+$/g, '')
  return (
    <figure className="group/code mt-4">
      <div className="relative overflow-hidden rounded-xl border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-3.5 py-1.5">
          <span className="font-mono text-[10.5px] tracking-wide text-fg-faint uppercase">{lang === 'shell' ? 'terminal' : lang === 'js' ? 'app.js' : lang}</span>
          <button
            type="button"
            onClick={() => {
              try {
                void navigator.clipboard?.writeText(text)
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
              } catch {
                // nothing to do: the text is selectable
              }
            }}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-fg-faint transition hover:bg-raised hover:text-fg"
            aria-label="Copiar"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        {/* no ligatures: what's shown is exactly what gets typed (=== stays three characters) */}
        <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-[1.7] text-fg [font-variant-ligatures:none]">
          <code>{lang === 'shell' ? text.split('\n').map((l, i) => <ShellLine key={i} line={l} />) : text}</code>
        </pre>
      </div>
      {caption && <figcaption className="mt-1.5 text-[12px] text-fg-faint">{caption}</figcaption>}
    </figure>
  )
}

/** Comments (#) dimmed, commands bright — just enough to read a sequence at a glance. */
function ShellLine({ line }: { line: string }) {
  if (line.trimStart().startsWith('#')) return <span className="block text-fg-faint">{line}</span>
  return <span className="block">{line || ' '}</span>
}

const NOTE = {
  info: { icon: Info, box: 'border-accent/30 bg-accent/[0.06]', title: 'text-accent' },
  tip: { icon: Lightbulb, box: 'border-ready/30 bg-ready/[0.06]', title: 'text-ready' },
  warn: { icon: TriangleAlert, box: 'border-warn/35 bg-warn/[0.07]', title: 'text-warn' },
} as const

export function Note({ kind = 'info', title, children }: { kind?: keyof typeof NOTE; title: string; children: ReactNode }) {
  const n = NOTE[kind]
  return (
    <aside className={cn('mt-5 rounded-xl border px-4 py-3.5', n.box)}>
      <div className={cn('flex items-center gap-2 text-[13px] font-semibold', n.title)}>
        <n.icon size={15} aria-hidden /> {title}
      </div>
      <div className="mt-1.5 text-[13.5px] leading-[1.7] text-fg-muted [&_p]:mt-2 [&_p:first-child]:mt-0">{children}</div>
    </aside>
  )
}

/** A reference table. On small screens each row becomes a card, so no column hides off-screen. */
export function Table({ head, rows, mono = [] }: { head: string[]; rows: ReactNode[][]; mono?: number[] }) {
  return (
    <>
      <div className="mt-4 space-y-2 sm:hidden">
        {rows.map((r, i) => (
          <dl key={i} className="rounded-xl border border-line px-3.5 py-3 text-[13px]">
            {r.map((cell, j) =>
              j === 0 ? (
                <dt key={j} className={cn('font-medium text-fg', mono.includes(j) && 'font-mono text-[12px]')}>
                  {cell}
                </dt>
              ) : (
                <dd key={j} className="mt-1.5 leading-relaxed text-fg-muted">
                  {head.length > 2 && <span className="mr-1.5 text-[10.5px] font-semibold tracking-wide text-fg-faint uppercase">{head[j]}</span>}
                  <span className={cn(mono.includes(j) && 'font-mono text-[12px] [overflow-wrap:anywhere]')}>{cell}</span>
                </dd>
              ),
            )}
          </dl>
        ))}
      </div>
      <TableWide head={head} rows={rows} mono={mono} />
    </>
  )
}

function TableWide({ head, rows, mono }: { head: string[]; rows: ReactNode[][]; mono: number[] }) {
  return (
    <div className="mt-4 hidden overflow-x-auto rounded-xl border border-line sm:block">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-line bg-panel">
            {head.map((h) => (
              <th key={h} scope="col" className="px-3.5 py-2.5 text-[11px] font-semibold tracking-wide text-fg-faint uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line align-top last:border-0">
              {r.map((cell, j) => (
                <td key={j} className={cn('px-3.5 py-2.5 leading-relaxed', j === 0 ? 'text-fg' : 'text-fg-muted', mono.includes(j) && 'font-mono text-[12px]')}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** "Do this in the tool": opens the app on a lesson. */
export function TryIt({ lesson, children }: { lesson: string; children: ReactNode }) {
  return (
    <a
      href={`/#/${lesson}`}
      className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/[0.08] px-3 py-1.5 text-[12.5px] font-medium text-accent transition hover:bg-accent/15"
    >
      {children} →
    </a>
  )
}

/** A link to another place in this documentation. */
export function See({ id, children }: { id: string; children: ReactNode }) {
  return (
    <a href={`#${id}`} className="text-accent underline decoration-accent/30 underline-offset-[3px] transition hover:decoration-accent">
      {children}
    </a>
  )
}
