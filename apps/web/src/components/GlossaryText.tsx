import { useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GLOSSARY_MATCHES, type GlossaryEntry } from '../lessons/glossary'
import { useApostila } from '../lessons/apostilas/store'

const escaped = GLOSSARY_MATCHES.map(({ alias }) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
const matcherSource = `(^|[^\\p{L}\\p{N}_])(${escaped.join('|')})(?=$|[^\\p{L}\\p{N}_])`

export function GlossaryText({ children }: { children: string }): ReactNode {
  const parts: ReactNode[] = []
  let cursor = 0
  for (const match of children.matchAll(new RegExp(matcherSource, 'giu'))) {
    const prefix = match[1]
    const value = match[2]
    const valueAt = (match.index ?? 0) + prefix.length
    if (valueAt > cursor) parts.push(children.slice(cursor, valueAt))
    const found = GLOSSARY_MATCHES.find(({ alias }) => alias.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR'))
    parts.push(found ? <GlossaryTerm key={`${valueAt}-${value}`} value={value} entry={found.entry} /> : value)
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
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const show = () => {
    clearTimeout(timer.current)
    const rect = trigger.current?.getBoundingClientRect()
    if (rect) setPosition({ left: rect.left + rect.width / 2, top: rect.top })
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
            className="fixed z-[80] w-60 -translate-x-1/2 -translate-y-full rounded-lg border border-line-strong bg-raised px-3 py-2 text-left text-[11.5px] leading-relaxed font-normal text-fg-muted shadow-xl shadow-black/50"
            style={{ left: position.left, top: position.top - 8 }}
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
