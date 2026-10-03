import { BookOpen, Printer } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { getLesson } from '../../lessons'
import { APOSTILAS } from '../../lessons/apostilas'
import { useApostila } from '../../lessons/apostilas/store'
import { Modal } from '../ui/Modal'

const sections = [
  ['o-que-voce-vai-entender', 'O que você vai entender'],
  ['conceitos', 'Conceitos'],
  ['no-mundo-real', 'No mundo real'],
  ['o-que-simplificamos', 'O que simplificamos'],
  ['erros-comuns', 'Erros comuns'],
  ['teste-rapido', 'Teste rápido'],
  ['para-ir-alem', 'Para ir além'],
] as const

export function ApostilaPanel() {
  const lessonId = useApostila((s) => s.lessonId)
  const anchor = useApostila((s) => s.anchor)
  const close = useApostila((s) => s.closeApostila)
  const scroll = useRef<HTMLDivElement>(null)
  const Content = lessonId ? APOSTILAS[lessonId] : null
  const lesson = lessonId ? getLesson(lessonId) : null

  useEffect(() => {
    if (!lessonId) return
    const frame = requestAnimationFrame(() => {
      if (anchor) scroll.current?.querySelector<HTMLElement>(`#${anchor}`)?.scrollIntoView({ block: 'start' })
      else scroll.current?.scrollTo({ top: 0 })
    })
    return () => cancelAnimationFrame(frame)
  }, [lessonId, anchor])

  return (
    <Modal open={!!Content} onClose={close} label={`Apostila: ${lesson?.title ?? ''}`} className="apostila-print-root w-[min(760px,calc(100vw-2rem))] overflow-hidden">
      <header className="apostila-controls flex items-center gap-3 border-b border-line px-5 py-3.5 pr-12">
        <span className="grid size-8 place-items-center rounded-lg border border-accent/25 bg-accent/10 text-accent"><BookOpen size={16} /></span>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-[0.1em] text-fg-faint uppercase">Apostila · Lição {lesson?.number}</div>
          <h1 className="truncate text-[15px] font-semibold">{lesson?.title}</h1>
        </div>
        <button onClick={() => window.print()} className="ml-auto flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-[12px] text-fg-muted transition hover:text-fg"><Printer size={13} /> Imprimir</button>
      </header>
      <div ref={scroll} className="apostila-scroll max-h-[calc(100vh-8rem)] overflow-y-auto">
        <div className="grid items-start md:grid-cols-[170px_minmax(0,1fr)]">
          <nav className="apostila-index sticky top-0 z-10 border-b border-line bg-panel/95 px-4 py-4 backdrop-blur md:border-r md:border-b-0" aria-label="Índice da apostila">
            <div className="mb-2 text-[10px] font-semibold tracking-[0.1em] text-fg-faint uppercase">Nesta apostila</div>
            <ol className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
              {sections.map(([id, label]) => (
                <li key={id} className="shrink-0"><a href={`#${id}`} className="block rounded-md px-2 py-1 text-[11.5px] leading-snug text-fg-muted transition hover:bg-raised hover:text-fg">{label}</a></li>
              ))}
            </ol>
          </nav>
          <article className="apostila-content min-w-0 px-5 py-6 sm:px-7">{Content && <Content />}</article>
        </div>
      </div>
    </Modal>
  )
}
