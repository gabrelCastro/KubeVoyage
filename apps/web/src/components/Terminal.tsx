import { AnimatePresence, motion } from 'motion/react'
import { CornerDownLeft, Eye, SquareTerminal } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { complete, type Line, type Tone } from '../sim/kubectl'
import { cn } from '../lib/visual'
import { useLesson } from '../lessons/useLesson'
import { useSim, type TermEntry } from '../store/useSim'
import { Kbd } from './primitives'

const TONE: Record<Tone, string> = {
  muted: 'text-fg-faint',
  error: 'text-terminating',
  success: 'text-ready',
  warn: 'text-warn',
  accent: 'text-accent',
  info: 'text-creating',
  strong: 'text-fg',
}

function Output({ lines }: { lines: Line[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="min-h-[1.55em] whitespace-pre">
          {line.map((s, j) => (
            <span key={j} className={s.c ? TONE[s.c] : 'text-fg-muted'}>
              {s.t}
            </span>
          ))}
        </div>
      ))}
    </>
  )
}

function Entry({ entry }: { entry: TermEntry }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }} className="mb-1.5">
      {entry.input !== undefined && (
        <div className="flex items-center gap-2">
          <span className="text-accent">❯</span>
          <span className="text-fg">{entry.input}</span>
          {entry.origin && (
            <span className="rounded border border-line-strong px-1 font-sans text-[9.5px] tracking-wide text-fg-faint uppercase">
              via {entry.origin === 'ui' ? 'palco' : 'paleta'}
            </span>
          )}
        </div>
      )}
      <Output lines={entry.lines} />
    </motion.div>
  )
}

export function Terminal() {
  const term = useSim((s) => s.term)
  const watching = useSim((s) => s.watching)
  const draft = useSim((s) => s.draft)
  const { exec, stopWatch } = useSim.getState()
  const history = useSim((s) => s.history)
  const { suggestion } = useLesson()
  const [value, setValue] = useState('')
  const [hIndex, setHIndex] = useState<number | null>(null)
  const [candidates, setCandidates] = useState<string[]>([])
  const [error, setError] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [term, candidates])

  useEffect(() => {
    if (!draft) return
    setValue(draft.text)
    input.current?.focus()
  }, [draft])

  useEffect(() => {
    const last = term[term.length - 1]
    if (last?.input !== undefined && last.lines.some((l) => l[0]?.c === 'error')) setError((n) => n + 1)
  }, [term])

  const submit = () => {
    exec(value)
    setValue('')
    setHIndex(null)
    setCandidates([])
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') return submit()
    if (e.key === 'Tab') {
      e.preventDefault()
      const r = complete(useSim.getState().sim, value)
      setValue(r.value)
      setCandidates(r.candidates)
      return
    }
    if ((e.key === 'c' && e.ctrlKey) || e.key === 'Escape') {
      if (watching) {
        e.preventDefault()
        stopWatch()
      } else if (e.ctrlKey) {
        e.preventDefault()
        setValue('')
      }
      return
    }
    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      exec('clear')
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (!history.length) return
      const next = e.key === 'ArrowUp' ? (hIndex === null ? history.length - 1 : Math.max(0, hIndex - 1)) : hIndex === null ? null : hIndex + 1
      if (next === null || next >= history.length) {
        setHIndex(null)
        setValue('')
      } else {
        setHIndex(next)
        setValue(history[next])
      }
    }
    setCandidates([])
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-panel" aria-label="Terminal" data-tour="terminal" onClick={() => input.current?.focus()}>
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-fg-muted">
          <SquareTerminal size={14} /> Terminal
        </span>
        <span className="hidden shrink-0 font-mono text-[11px] whitespace-nowrap text-fg-faint xl:inline">kubelearn-sandbox · default</span>
        <AnimatePresence>
          {watching && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-creating/10 px-2 py-0.5 text-[11px] whitespace-nowrap text-creating"
            >
              <Eye size={12} /> acompanhando pods <Kbd className="h-4 border-creating/30 bg-transparent text-creating">esc</Kbd>
            </motion.span>
          )}
        </AnimatePresence>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <AnimatePresence mode="popLayout">
            {suggestion && suggestion !== value && (
              <motion.button
                key={suggestion}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                onClick={(e) => {
                  e.stopPropagation()
                  setValue(suggestion)
                  input.current?.focus()
                }}
                className="group flex max-w-[460px] min-w-0 items-center gap-2 rounded-md border border-line-strong bg-panel-2 py-0.5 pr-1 pl-2 text-[11.5px] transition hover:border-accent/50"
                title="Colocar este comando no prompt"
              >
                <span className="text-fg-faint">tente</span>
                <code className="truncate font-mono text-fg-muted group-hover:text-fg">{suggestion}</code>
                <Kbd className="shrink-0">
                  <CornerDownLeft size={10} />
                </Kbd>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-3.5 pt-2.5 font-mono text-[12.5px] leading-[1.55]">
        {term.map((entry) => (
          <Entry key={entry.id} entry={entry} />
        ))}
        {candidates.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-x-4 text-fg-faint">
            {candidates.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        )}
        <motion.label
          key={error}
          className="flex items-center gap-2 pb-3"
          initial={error ? { x: -4 } : false}
          animate={{ x: 0 }}
          transition={{ type: 'spring', stiffness: 700, damping: 12 }}
        >
          <span className={cn('transition-colors', error && term[term.length - 1]?.lines.some((l) => l[0]?.c === 'error') ? 'text-terminating' : 'text-accent')}>❯</span>
          <input
            ref={input}
            value={value}
            onChange={(e) => (setValue(e.target.value), setCandidates([]))}
            onKeyDown={onKey}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label="Comando kubectl"
            placeholder={watching || term.length > 1 ? '' : (suggestion ?? '')}
            className="min-w-0 flex-1 bg-transparent text-fg caret-accent outline-none placeholder:text-fg-faint/60 focus-visible:outline-none"
            data-terminal-input
          />
        </motion.label>
      </div>
    </section>
  )
}
