import { AnimatePresence, motion } from 'motion/react'
import { CornerDownLeft, Eye, SquareTerminal } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import type { Line, Seg, Tone } from '../sim/kubectl'
import { shellHistory } from '../lib/shellHistory'
import { cn } from '../lib/visual'
import { useLesson } from '../lessons/useLesson'
import { imageOf, useApp } from '../store/useApp'
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

/**
 * A resource name in the output, linked to the stage: hovering it lights the resource up,
 * clicking selects it — and hovering the resource on the stage lights the name up here.
 */
function RefSeg({ seg }: { seg: Seg }) {
  const uid = seg.ref!
  const alive = useSim((s) => !!(s.cluster.pods[uid] ?? s.cluster.replicaSets[uid] ?? s.cluster.deployments[uid] ?? s.cluster.services[uid]))
  const lit = useSim((s) => s.hovered === uid || s.selected === uid)
  const { hover, select } = useSim.getState()
  // trailing padding from table alignment stays outside the link
  const name = seg.t.trimEnd()
  const pad = seg.t.slice(name.length)
  const tone = seg.c ? TONE[seg.c] : 'text-fg-muted'
  if (!alive) return <span className={tone}>{seg.t}</span>
  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        onMouseEnter={() => hover(uid)}
        onMouseLeave={() => useSim.getState().hovered === uid && hover(null)}
        onClick={(e) => {
          e.stopPropagation()
          select(uid)
        }}
        title="Mostrar no palco"
        className={cn(
          'cursor-pointer rounded-[3px] underline decoration-transparent decoration-dotted underline-offset-[3px] transition-colors hover:decoration-current',
          tone,
          lit && 'bg-accent/15 decoration-current',
        )}
      >
        {name}
      </button>
      {pad && <span>{pad}</span>}
    </>
  )
}

function Output({ lines }: { lines: Line[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="min-h-[1.55em] whitespace-pre">
          {line.map((s, j) =>
            s.ref ? (
              <RefSeg key={j} seg={s} />
            ) : (
              <span key={j} className={s.c ? TONE[s.c] : 'text-fg-muted'}>
                {s.t}
              </span>
            ),
          )}
        </div>
      ))}
    </>
  )
}

// memo: the scrollback never changes once printed
const Entry = memo(function Entry({ entry }: { entry: TermEntry }) {
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
})

export function Terminal() {
  const term = useSim((s) => s.term)
  const watching = useSim((s) => s.watching)
  const draft = useSim((s) => s.draft)
  const { exec, stopWatch } = useSim.getState()
  const { suggestion } = useLesson()
  const [value, setValue] = useState('')
  const [hIndex, setHIndex] = useState<number | null>(null)
  const [candidates, setCandidates] = useState<string[]>([])
  const [error, setError] = useState(0)
  // Ctrl+R: what's being searched, and how many older matches to skip
  const [search, setSearch] = useState<{ query: string; skip: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  // The scrollback scrolls from the bottom (column-reverse): at the end it stays there as output
  // arrives, with no layout read on every change (that read forced a full-page layout mid-render).
  // Running a command, or asking for completions, brings you back to the prompt.
  const atEnd = useRef(true)
  const lastInput = term.findLast((e) => e.input !== undefined)?.id
  useEffect(() => {
    if (!atEnd.current && scroller.current) scroller.current.scrollTop = 0
  }, [lastInput, candidates])

  useEffect(() => {
    if (!draft) return
    setValue(draft.text)
    setSearch(null)
    input.current?.focus()
  }, [draft])

  useEffect(() => {
    const last = term[term.length - 1]
    if (last?.input !== undefined && last.lines.some((l) => l[0]?.c === 'error')) setError((n) => n + 1)
  }, [term])

  const found = search ? shellHistory.search(search.query, search.skip) : null
  // fish-style: the rest of the latest command that starts with what's typed
  const ghost = !search && value ? (shellHistory.suggest(value)?.slice(value.length) ?? '') : ''

  const submit = (command: string) => {
    shellHistory.push(command)
    exec(command)
    setValue('')
    setHIndex(null)
    setCandidates([])
    setSearch(null)
  }

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!search) return false
    if (e.key === 'r' && e.ctrlKey) {
      e.preventDefault()
      if (shellHistory.search(search.query, search.skip + 1)) setSearch({ ...search, skip: search.skip + 1 })
      return true
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      submit(found ?? search.query)
      return true
    }
    if (e.key === 'Escape' || (e.key === 'g' && e.ctrlKey) || (e.key === 'c' && e.ctrlKey)) {
      e.preventDefault()
      setSearch(null)
      setValue('')
      return true
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'End', 'Home'].includes(e.key)) {
      // leave search with the match in the prompt, ready to edit
      e.preventDefault()
      setValue(found ?? search.query)
      setSearch(null)
      return true
    }
    return false
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (onSearchKey(e)) return
    if (e.key === 'Enter') return submit(value)
    if (e.key === 'r' && e.ctrlKey) {
      e.preventDefault()
      setSearch({ query: '', skip: 0 })
      setCandidates([])
      return
    }
    const atEnd = e.currentTarget.selectionStart === value.length
    if ((e.key === 'ArrowRight' || e.key === 'End' || (e.key === 'e' && e.ctrlKey)) && ghost && atEnd) {
      e.preventDefault()
      setValue(value + ghost)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const before = value
      void import('../sim/kubectl').then(({ complete }) => {
        if (input.current?.value !== before) return
        const result = complete(useSim.getState().sim, before, useApp.getState().releases.map((r) => imageOf(r.tag)))
        setValue(result.value)
        setCandidates(result.candidates)
      })
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
      const history = shellHistory.all()
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
              <Eye size={12} /> acompanhando {watching} <Kbd className="h-4 border-creating/30 bg-transparent text-creating">esc</Kbd>
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

      <div
        ref={scroller}
        onScroll={(e) => (atEnd.current = Math.abs(e.currentTarget.scrollTop) < 4)}
        className="flex min-h-0 flex-1 flex-col-reverse overflow-auto px-3.5 pt-2.5 font-mono text-[12.5px] leading-[1.55]"
      >
        <div>
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
          {search ? (
            <span className="shrink-0 text-creating">(busca-reversa)</span>
          ) : (
            <span className={cn('transition-colors', error && term[term.length - 1]?.lines.some((l) => l[0]?.c === 'error') ? 'text-terminating' : 'text-accent')}>❯</span>
          )}
          <span className={cn('relative min-w-0', search ? 'flex-none' : 'flex-1')} style={search ? { width: `${Math.max(search.query.length, 1) + 1}ch` } : undefined}>
            {/* the gray rest of a remembered command, drawn exactly behind the typed text */}
            {ghost && (
              <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre">
                <span className="invisible">{value}</span>
                <span className="text-fg-faint/70">{ghost}</span>
              </span>
            )}
            <input
              ref={input}
              value={search ? search.query : value}
              onChange={(e) => {
                if (search) setSearch({ query: e.target.value, skip: 0 })
                else setValue(e.target.value)
                setCandidates([])
              }}
              onKeyDown={onKey}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              aria-label={search ? 'Buscar no histórico de comandos' : 'Comando kubectl'}
              placeholder={search ? 'digite parte de um comando' : watching || term.length > 1 ? '' : (suggestion ?? '')}
              className="relative w-full bg-transparent text-fg caret-accent outline-none placeholder:text-fg-faint/60 focus-visible:outline-none"
              data-terminal-input
            />
          </span>
          {!search && value.trim() && !value.trim().startsWith('explicar') && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                // explains without running, and keeps the command in the prompt
                exec(`explicar ${value.trim()}`)
                input.current?.focus()
              }}
              title="Explicar este comando, parte por parte, sem executar"
              className="shrink-0 rounded border border-line-strong px-1.5 font-sans text-[10.5px] text-fg-faint transition hover:border-accent/50 hover:text-fg"
            >
              ? explicar
            </button>
          )}
          {search && (
            <span className={cn('min-w-0 flex-1 truncate', found ? 'text-fg-muted' : 'text-terminating')}>
              {found ? `→ ${found}` : search.query ? 'nada encontrado' : ''}
            </span>
          )}
        </motion.label>
        {(search || ghost) && (
          <div className="-mt-2 pb-2 font-sans text-[10.5px] text-fg-faint">
            {search ? 'Enter executa · Ctrl+R mais antigo · → edita · Esc cancela' : '→ aceita a sugestão do histórico'}
          </div>
        )}
        </div>
      </div>
    </section>
  )
}
