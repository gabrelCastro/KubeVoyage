import { ArrowRight, ArrowUp, ChevronDown, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Logo } from '../components/primitives'
import { cn } from '../lib/visual'
import { SECTIONS, type DocSection } from './content'
import { Anchor, H3 } from './ui'

/**
 * /doc — how to use KubeLearn, end to end. A page of its own (like /privacidade): no
 * simulation runs here, and every section has a link that can be shared.
 */

const CONTACT = import.meta.env.VITE_CONTACT_EMAIL || ''

const ALL_IDS = SECTIONS.flatMap((s) => [s.id, ...s.subs.map((x) => x.id)])

// accent- and case-insensitive, so "simulacao" finds "simulação"
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

interface Hit {
  id: string
  title: string
  section: string
  snippet: { before: string; match: string; after: string } | null
}

function goTo(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  history.replaceState(null, '', `#${id}`)
  el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  // keyboard users land on the heading, not at the top of the page
  el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
}

/** Which section is on screen, for the side index. */
function useActive() {
  const [active, setActive] = useState<string>(ALL_IDS[0])
  useEffect(() => {
    const onScroll = () => {
      // the last heading that has scrolled past the top bar
      let current = ALL_IDS[0]
      for (const id of ALL_IDS) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= 120) current = id
      }
      setActive(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return active
}

/** Full-text search over what's actually rendered, so it always matches the page. */
function useSearch(query: string) {
  const [index, setIndex] = useState<{ id: string; title: string; section: string; text: string; folded: string }[]>([])
  useEffect(() => {
    setIndex(
      SECTIONS.flatMap((s) =>
        s.subs.map((sub) => {
          const el = document.querySelector(`[data-doc-sub="${sub.id}"]`)
          // the body only: the title is matched (and shown) on its own
          // innerText: words in separate cells stay apart, and the hidden copy of a table (the one for the
          // other screen size) is left out
          const body = [...(el?.children ?? [])]
            .filter((c): c is HTMLElement => c instanceof HTMLElement && !c.matches('h3, :has(> h3)') && c.getClientRects().length > 0)
            .map((c) => c.innerText)
          const text = body.join(' ').replace(/\s+/g, ' ').trim()
          return { id: sub.id, title: sub.title, section: s.title, text, folded: fold(`${s.title} ${sub.title} ${text}`) }
        }),
      ),
    )
  }, [])
  return useMemo<Hit[]>(() => {
    const words = fold(query).split(/\s+/).filter(Boolean)
    if (!words.length) return []
    return index
      .filter((e) => words.every((w) => e.folded.includes(w)))
      .map((e) => {
        const titleHit = words.every((w) => fold(`${e.section} ${e.title}`).includes(w))
        // the snippet shows the first word that appears in the text itself
        const folded = fold(e.text)
        const word = words.find((w) => folded.includes(w)) ?? words[0]
        const at = folded.indexOf(word)
        const snippet =
          at < 0
            ? null
            : {
                before: (at > 50 ? '…' : '') + e.text.slice(Math.max(0, at - 50), at),
                match: e.text.slice(at, at + word.length),
                after: e.text.slice(at + word.length, at + word.length + 70) + '…',
              }
        return { hit: { id: e.id, title: e.title, section: e.section, snippet }, score: titleHit ? 0 : 1 }
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 8)
      .map((r) => r.hit)
  }, [index, query])
}

function SearchBox() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  // closing on blur waits a beat (so a click on a result lands); focusing again cancels it
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hits = useSearch(query)
  const listId = 'doc-search-results'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea')
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const choose = (hit: Hit) => {
    setOpen(false)
    setQuery('')
    input.current?.blur()
    goTo(hit.id)
  }

  return (
    <div className="relative w-full max-w-[420px]">
      <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" aria-hidden />
      <input
        ref={input}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setCursor(0)
          setOpen(true)
        }}
        onFocus={() => {
          clearTimeout(closing.current)
          setOpen(true)
        }}
        onBlur={() => {
          closing.current = setTimeout(() => setOpen(false), 120)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setCursor((c) => Math.min(c + 1, hits.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setCursor((c) => Math.max(c - 1, 0))
          } else if (e.key === 'Enter' && hits[cursor]) {
            e.preventDefault()
            choose(hits[cursor])
          } else if (e.key === 'Escape') {
            setQuery('')
            input.current?.blur()
          }
        }}
        placeholder="Buscar na documentação"
        aria-label="Buscar na documentação"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && hits[cursor] ? `doc-hit-${hits[cursor].id}` : undefined}
        autoComplete="off"
        className="h-9 w-full rounded-lg border border-line-strong bg-panel pr-10 pl-9 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-accent/60 [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery('')
            input.current?.focus()
          }}
          aria-label="Limpar a busca"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-fg-muted hover:text-fg"
        >
          <X size={13} />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-line-strong px-1.5 font-sans text-[10.5px] text-fg-muted sm:block">
          /
        </kbd>
      )}
      {/* how many results, said out loud as they change */}
      <span className="sr-only" role="status" aria-live="polite">
        {query ? (hits.length ? `${hits.length} ${hits.length === 1 ? 'resultado' : 'resultados'}` : `Nada encontrado para “${query}”`) : ''}
      </span>
      {open && query && hits.length === 0 && (
        <p className="absolute top-full right-0 left-0 z-50 mt-2 rounded-xl border border-line-strong bg-raised px-4 py-3 text-[12.5px] text-fg-muted shadow-[0_20px_50px_-12px_rgb(0_0_0/0.85)]">
          Nada encontrado para “{query}”.
        </p>
      )}
      <div
        id={listId}
        role="listbox"
        aria-label="Resultados"
        hidden={!(open && query && hits.length > 0)}
        className="absolute top-full right-0 left-0 z-50 mt-2 max-h-[min(440px,70vh)] overflow-auto rounded-xl border border-line-strong bg-raised p-1.5 shadow-[0_20px_50px_-12px_rgb(0_0_0/0.85)]"
      >
        {hits.map((h, i) => (
              <button
                key={h.id}
                id={`doc-hit-${h.id}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === cursor}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(h)}
                className={cn('block w-full rounded-lg px-3 py-2 text-left', i === cursor && 'bg-panel')}
              >
                <span className="block text-[11px] text-fg-muted">{h.section}</span>
                <span className="block text-[13px] font-medium text-fg">{h.title}</span>
                {h.snippet && (
                  <span className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-fg-muted">
                    {h.snippet.before}
                    <mark className="rounded-[3px] bg-accent/25 px-0.5 text-fg">{h.snippet.match}</mark>
                    {h.snippet.after}
                  </span>
                )}
              </button>
        ))}
      </div>
    </div>
  )
}

/** Close whatever was open first (the mobile index), then scroll — a layout change would cut a smooth scroll short. */
function pick(id: string, close?: () => void) {
  if (!close) return goTo(id)
  close()
  requestAnimationFrame(() => requestAnimationFrame(() => goTo(id)))
}

function Index({ active, onPick }: { active: string; onPick?: () => void }) {
  const activeSection = SECTIONS.find((s) => s.id === active || s.subs.some((x) => x.id === active))?.id
  return (
    <nav aria-label="Conteúdo da documentação">
      <ul className="space-y-5">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault()
                pick(s.id, onPick)
              }}
              className={cn('block text-[12.5px] font-semibold tracking-tight transition', activeSection === s.id ? 'text-fg' : 'text-fg-muted hover:text-fg')}
            >
              {s.title}
            </a>
            <ul className="mt-1.5 space-y-px border-l border-line">
              {s.subs.map((x) => (
                <li key={x.id}>
                  <a
                    href={`#${x.id}`}
                    aria-current={active === x.id ? 'location' : undefined}
                    onClick={(e) => {
                      e.preventDefault()
                      pick(x.id, onPick)
                    }}
                    className={cn(
                      '-ml-px block border-l py-1 pl-3 text-[12.5px] leading-snug transition',
                      active === x.id ? 'border-accent text-accent' : 'border-transparent text-fg-muted hover:border-line-strong hover:text-fg-muted',
                    )}
                  >
                    {x.title}
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Section({ section }: { section: DocSection }) {
  return (
    <section aria-labelledby={section.id} className="border-t border-line pt-12 first:border-0 first:pt-0">
      <div className="group flex items-baseline">
        <h2 id={section.id} className="scroll-mt-32 text-[24px] font-semibold tracking-tight text-fg lg:scroll-mt-24">
          {section.title}
        </h2>
        <Anchor id={section.id} label={section.title} />
      </div>
      <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{section.lead}</p>
      {section.subs.map((sub) => (
        <div key={sub.id} data-doc-sub={sub.id}>
          <H3 id={sub.id}>{sub.title}</H3>
          {sub.body}
        </div>
      ))}
    </section>
  )
}

/** The way in: the sections people come here for most. */
const START = [
  { id: 'primeira-licao', title: 'Sua primeira lição', text: 'Do primeiro kubectl apply ao primeiro Pod recriado.' },
  { id: 'comandos-kubectl', title: 'Comandos do terminal', text: 'Tudo o que o kubectl simulado entende, com exemplos.' },
  { id: 'seu-codigo', title: 'Seu código nos Pods', text: 'Escreva o app.js, gere uma imagem e veja o cluster rodar.' },
  { id: 'atalhos', title: 'Atalhos de teclado', text: 'Pausar, avançar um passo, buscar no histórico.' },
]

export function DocPage() {
  const active = useActive()
  const [menu, setMenu] = useState(false)
  const indexButton = useRef<HTMLButtonElement>(null)
  const [top, setTop] = useState(false)

  // arriving with a link to a section: the content renders after the browser tried to scroll
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (!id || !ALL_IDS.includes(id)) return
    const land = () => document.getElementById(id)?.scrollIntoView({ block: 'start' })
    requestAnimationFrame(land)
    // web fonts change line heights when they arrive: land again once they're in
    void document.fonts?.ready.then(() => requestAnimationFrame(land))
  }, [])
  useEffect(() => {
    const onScroll = () => setTop(window.scrollY > 900)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const current = SECTIONS.find((s) => s.id === active || s.subs.some((x) => x.id === active))

  return (
    <div className="min-h-screen bg-bg text-fg">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-raised focus:px-3 focus:py-2 focus:text-[13px]">
        Pular para o conteúdo
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-panel/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-3 px-4 sm:px-6">
          <a href="/" className="flex shrink-0 items-center gap-2" aria-label="KubeLearn — abrir o app">
            <Logo />
            <span className="hidden text-[14px] font-semibold tracking-tight min-[380px]:inline">KubeLearn</span>
          </a>
          <span className="hidden h-4 w-px bg-line-strong sm:block" aria-hidden />
          <span className="hidden text-[13px] text-fg-muted sm:inline">Documentação</span>
          <div className="ml-auto flex min-w-0 flex-1 justify-end sm:ml-6">
            <SearchBox />
          </div>
          <a
            href="/"
            className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-[#0b1020] transition hover:bg-accent/90 md:inline-flex"
          >
            Abrir o KubeLearn <ArrowRight size={13} />
          </a>
        </div>
        {/* small screens: the index folds under the bar */}
        <div className="border-t border-line lg:hidden">
          <button
            ref={indexButton}
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-expanded={menu}
            aria-controls="doc-mobile-index"
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[12.5px] sm:px-6"
          >
            <span className="text-fg-muted">Nesta página:</span>
            <span className="truncate text-fg">{current?.title}</span>
            <ChevronDown size={14} className={cn('ml-auto shrink-0 text-fg-muted transition-transform', menu && 'rotate-180')} />
          </button>
          {menu && (
            <div
              id="doc-mobile-index"
              ref={(el) => el?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true })}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return
                setMenu(false)
                indexButton.current?.focus()
              }}
              className="max-h-[60vh] overflow-auto border-t border-line px-4 py-4 sm:px-6"
            >
              <Index active={active} onPick={() => setMenu(false)} />
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto flex max-w-[1240px] gap-12 px-4 sm:px-6">
        <aside className="hidden w-[230px] shrink-0 lg:block">
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-auto py-10 pr-2">
            <Index active={active} />
          </div>
        </aside>

        <main id="conteudo" className="min-w-0 flex-1 pt-10 pb-24 lg:max-w-[760px]">
          <div className="mb-14">
            <p className="text-[12px] font-semibold tracking-[0.12em] text-accent uppercase">Documentação</p>
            <h1 id="doc-title" tabIndex={-1} className="mt-2 text-[32px] outline-none leading-tight font-semibold tracking-tight sm:text-[38px]">Como usar o KubeLearn</h1>
            <p className="mt-4 max-w-[620px] text-[16px] leading-relaxed text-fg-muted">
              Tudo o que a ferramenta faz: as lições, o palco, cada comando do terminal, o seu app e o código que você roda nos Pods — e onde a simulação difere
              de um cluster de verdade.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {START.map((c) => (
                <a
                  key={c.id}
                  href={`#${c.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    goTo(c.id)
                  }}
                  className="group rounded-xl border border-line bg-panel px-4 py-3.5 transition hover:border-accent/50 hover:bg-raised"
                >
                  <span className="flex items-center justify-between text-[14px] font-semibold text-fg">
                    {c.title}
                    <ArrowRight size={14} className="text-fg-muted transition group-hover:translate-x-0.5 group-hover:text-accent" />
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-relaxed text-fg-muted">{c.text}</span>
                </a>
              ))}
            </div>
          </div>

          <div className="space-y-16">
            {SECTIONS.map((s) => (
              <Section key={s.id} section={s} />
            ))}
          </div>

          <footer className="mt-20 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-6 text-[12.5px] text-fg-muted">
            <a href="/" className="hover:text-fg-muted">
              Abrir o KubeLearn
            </a>
            <a href="/privacidade" className="hover:text-fg-muted">
              Privacidade
            </a>
            {CONTACT && (
              <span className="ml-auto">
                Algo errado ou faltando nesta página?{' '}
                <a href={`mailto:${CONTACT}`} className="text-fg-muted underline decoration-line-strong underline-offset-[3px] hover:text-fg">
                  {CONTACT}
                </a>
              </span>
            )}
          </footer>
        </main>
      </div>

      {top && (
        <button
          type="button"
          onClick={() => {
            window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
            history.replaceState(null, '', location.pathname)
            document.getElementById('doc-title')?.focus({ preventScroll: true })
          }}
          aria-label="Voltar ao topo"
          className="fixed right-5 bottom-5 z-30 grid size-10 place-items-center rounded-full border border-line-strong bg-raised text-fg-muted shadow-lg transition hover:text-fg"
        >
          <ArrowUp size={16} />
        </button>
      )}
    </div>
  )
}
