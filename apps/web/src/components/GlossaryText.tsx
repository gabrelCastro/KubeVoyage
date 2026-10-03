import { useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GLOSSARY_MATCHES, type GlossaryEntry } from '../lessons/glossary'
import { useApostila } from '../lessons/apostilas/store'
import { cn } from '../lib/visual'

const TOOLTIP_WIDTH = 240
const VIEWPORT_MARGIN = 8

const escaped = GLOSSARY_MATCHES.map(({ alias }) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
const matcherSource = `(^|[^\\p{L}\\p{N}_])(${escaped.join('|')})(?=$|[^\\p{L}\\p{N}_/])`

/**
 * Links glossary terms inside a block of text — only the first time each term appears,
 * so a paragraph full of "Pod" doesn't turn into a paragraph full of underlines.
 */
export function GlossaryText({ children }: { children: string }): ReactNode {
  const parts: ReactNode[] = []
  const linked = new Set<GlossaryEntry>()
  let cursor = 0
  for (const match of children.matchAll(new RegExp(matcherSource, 'giu'))) {
    const prefix = match[1]
    const value = match[2]
    const valueAt = (match.index ?? 0) + prefix.length
    const found = GLOSSARY_MATCHES.find(({ alias }) => alias.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR'))
    if (!found || linked.has(found.entry)) continue
    linked.add(found.entry)
    if (valueAt > cursor) parts.push(children.slice(cursor, valueAt))
    parts.push(<GlossaryTerm key={`${valueAt}-${value}`} value={value} entry={found.entry} />)
    cursor = valueAt + value.length
  }
  if (cursor < children.length) parts.push(children.slice(cursor))
  return parts.length ? parts : children
}

function GlossaryTerm({ value, entry }: { value: string; entry: GlossaryEntry }) {
  const openApostila = useApostila((s) => s.openApostila)
  const trigger = useRef<HTMLAnchorElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const tooltipId = useId()
  const [position, setPosition] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const show = () => {
    clearTimeout(timer.current)
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    // centered on the term, but never past the edges of the window
    const half = TOOLTIP_WIDTH / 2 + VIEWPORT_MARGIN
    const left = Math.min(Math.max(rect.left + rect.width / 2, half), window.innerWidth - half)
    // flip below the term when there's no room above it
    const below = rect.top < 140
    setPosition({ left, top: below ? rect.bottom + 8 : rect.top - 8, below })
  }
  const hide = () => {
    timer.current = window.setTimeout(() => setPosition(null), 120)
  }
  const open = (event: React.MouseEvent) => {
    event.preventDefault()
    setPosition(null)
    openApostila(entry.lessonId, entry.anchor)
  }
  return (
    <span className="relative inline" onMouseEnter={show} onMouseLeave={hide}>
      <a
        ref={trigger}
        href={`#${entry.anchor}`}
        onClick={open}
        onFocus={show}
        onBlur={hide}
        aria-describedby={position ? tooltipId : undefined}
        className="decoration-accent/60 decoration-dotted underline underline-offset-[3px] hover:text-accent focus:text-accent"
      >
        {value}
      </a>
      {position && typeof document !== 'undefined' &&
        createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            onMouseEnter={() => clearTimeout(timer.current)}
            onMouseLeave={hide}
            className={cn(
              'fixed z-[80] -translate-x-1/2 rounded-lg border border-line-strong bg-raised px-3 py-2 text-left text-[11.5px] leading-relaxed font-normal text-fg-muted shadow-xl shadow-black/50',
              !position.below && '-translate-y-full',
            )}
            style={{ left: position.left, top: position.top, width: TOOLTIP_WIDTH }}
          >
            <span className="block text-fg">{entry.definition}</span>
            <a href={`#${entry.anchor}`} onClick={open} onFocus={() => clearTimeout(timer.current)} onBlur={hide} className="mt-1 block font-medium text-accent hover:underline">
              Ler na apostila →
            </a>
          </span>,
          document.body,
        )}
    </span>
  )
}
