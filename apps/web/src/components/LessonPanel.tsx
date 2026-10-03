import { AnimatePresence, motion } from 'motion/react'
import { BookOpen, Check, CornerDownLeft, Lightbulb } from 'lucide-react'
import { cn } from '../lib/visual'
import { isComplete, lessonFraction, type LessonId } from '@kubelearn/shared'
import { LESSONS } from '../lessons'
import { useProgress } from '../progress/browser'
import { useLesson } from '../lessons/useLesson'
import { useSim } from '../store/useSim'
import { GlossaryText } from './GlossaryText'
import { hasApostila } from '../lessons/apostilas'
import { useApostila } from '../lessons/apostilas/store'

export function LessonPanel() {
  const { lesson, statuses, current, complete, ctx } = useLesson()
  const setDraft = useSim((s) => s.setDraft)
  const hints = useSim((s) => s.hints)
  const revealHint = useSim((s) => s.revealHint)
  const openApostila = useApostila((s) => s.openApostila)
  const apostilaId = hasApostila(lesson.id) ? lesson.id : null
  const required = statuses.filter((s) => !s.optional)
  const doneCount = required.filter((s) => s.isDone).length

  return (
    <aside className="flex min-h-0 flex-col overflow-auto lg:h-full">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={lesson.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="px-5 pt-5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10.5px] font-semibold tracking-[0.12em] text-fg-faint uppercase">
                {lesson.track} · Lição {lesson.number}
              </div>
              {apostilaId && (
                <button onClick={() => openApostila(apostilaId)} className="flex items-center gap-1.5 rounded-md border border-line-strong px-2 py-1 text-[11px] font-medium text-fg-muted transition hover:border-accent/50 hover:text-accent">
                  <BookOpen size={12} /> Apostila
                </button>
              )}
            </div>
            <h1 className="mt-1 text-[21px] font-semibold tracking-tight">{lesson.title}</h1>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{lesson.tagline}</p>
            {apostilaId && (
              <button onClick={() => openApostila(apostilaId)} className="mt-2 text-[11.5px] text-fg-faint transition hover:text-accent hover:underline">
                Apostila · leitura de ~5 min
              </button>
            )}

            <div className="mt-4 flex items-center gap-2">
              <div className="flex flex-1 gap-1">
                {required.map((s) => (
                  <span key={s.id} className="relative h-1 flex-1 overflow-hidden rounded-full bg-line">
                    <motion.span
                      className="absolute inset-0 origin-left bg-ready"
                      initial={false}
                      animate={{ scaleX: s.isDone ? 1 : 0 }}
                      transition={{ type: 'spring', stiffness: 160, damping: 22 }}
                    />
                  </span>
                ))}
              </div>
              <span className="font-mono text-[11px] text-fg-faint tabular-nums">
                {doneCount}/{required.length}
              </span>
            </div>
          </div>

          {/* the one idea this lesson is about */}
          <div className="mx-5 mt-5 rounded-xl border border-line bg-panel-2/60 p-3.5">
            <div className="text-[10px] font-semibold tracking-[0.1em] text-fg-faint uppercase">A ideia</div>
            <div className="mt-2.5 flex items-center gap-2 text-[12px]">
              <div className="flex-1 rounded-lg border border-deploy/30 bg-deploy/[0.06] px-2.5 py-2">
                <div className="text-[10px] text-deploy">{lesson.idea.a.label}</div>
                <div className="font-medium">{lesson.idea.a.text}</div>
              </div>
              <motion.span className="text-fg-faint" animate={{ x: [0, 3, 0] }} transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}>
                ⇄
              </motion.span>
              <div className="flex-1 rounded-lg border border-line-strong px-2.5 py-2">
                <div className="text-[10px] text-fg-muted">{lesson.idea.b.label}</div>
                <div className="font-medium">{lesson.idea.b.text}</div>
              </div>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-fg-faint"><GlossaryText>{lesson.idea.body}</GlossaryText></p>
          </div>

          <ol className="mt-4 flex flex-col gap-1 px-3">
            {statuses.map((o, i) => {
              const isCurrent = current?.id === o.id
              const hintShown = hints.includes(o.id)
              const suggestion = isCurrent ? (o.suggest?.(ctx) ?? (hintShown ? o.hint?.command : null)) : null
              return (
                <motion.li
                  key={o.id}
                  layout
                  className={cn('rounded-xl px-2.5 py-2 transition-colors', isCurrent && 'bg-panel-2 ring-1 ring-line-strong')}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                >
                  <div className="flex items-start gap-2.5">
                    <Bullet done={o.isDone} current={isCurrent} index={i + 1} optional={o.optional} />
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-[13px] font-medium', o.isDone ? 'text-fg-muted' : isCurrent ? 'text-fg' : 'text-fg-faint')}>{o.title}</div>
                      <AnimatePresence initial={false}>
                        {isCurrent && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <p className="pt-1 text-[12px] leading-relaxed text-fg-muted"><GlossaryText>{o.detail}</GlossaryText></p>
                            {o.hint && (
                              <AnimatePresence mode="wait" initial={false}>
                                {hintShown ? (
                                  <motion.p
                                    key="hint"
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="mt-2 flex gap-1.5 rounded-lg border border-warn/25 bg-warn/[0.06] px-2.5 py-2 text-[11.5px] leading-relaxed text-fg-muted"
                                  >
                                    <Lightbulb size={13} className="mt-[2px] shrink-0 text-warn" />
                                    <span><GlossaryText>{o.hint.text}</GlossaryText></span>
                                  </motion.p>
                                ) : (
                                  <motion.button
                                    key="ask"
                                    onClick={() => revealHint(o.id)}
                                    className="mt-2 flex items-center gap-1.5 text-[11.5px] text-fg-faint transition hover:text-warn"
                                  >
                                    <Lightbulb size={12} /> Travou? Mostrar uma dica
                                  </motion.button>
                                )}
                              </AnimatePresence>
                            )}
                            {suggestion && (
                              <button
                                onClick={() => setDraft(suggestion)}
                                className="group mt-2 flex w-full items-center gap-2 rounded-lg border border-line-strong bg-bg/60 px-2.5 py-1.5 text-left transition hover:border-accent/50"
                              >
                                <span className="text-accent">❯</span>
                                <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-muted group-hover:text-fg">{suggestion}</code>
                                <CornerDownLeft size={12} className="shrink-0 text-fg-faint" />
                              </button>
                            )}
                            {o.uiHint && <p className="mt-1.5 text-[11px] text-fg-faint"><GlossaryText>{o.uiHint}</GlossaryText></p>}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.li>
              )
            })}
          </ol>

          <AnimatePresence>
            {complete && (
              <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mx-5 mt-3 text-[12px] leading-relaxed text-fg-muted">
                Experimente pausar (<span className="font-mono text-fg">Espaço</span>) logo antes de algo acontecer e depois apertar <span className="font-mono text-fg">.</span> para avançar
                decisão por decisão dos controllers.
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>

      <Curriculum />
    </aside>
  )
}

/** Every lesson, with where you are and what you've finished. */
function Curriculum() {
  const lessonId = useSim((s) => s.lessonId)
  const progress = useProgress((s) => s.progress)
  const openLesson = useSim((s) => s.openLesson)
  let lastTrack = ''
  return (
    <nav className="mt-auto px-3 pt-8 pb-4" aria-label="Lições">
      {LESSONS.map((l) => {
        const header = l.track !== lastTrack ? l.track : null
        lastTrack = l.track
        const current = l.id === lessonId
        const id = l.id as LessonId
        const done = isComplete(progress, id)
        const fraction = lessonFraction(progress, id)
        const best = progress.lessons[id]?.bestMs
        return (
          <div key={l.id}>
            {header && <div className="mt-3 mb-1 px-2 text-[10px] font-semibold tracking-[0.1em] text-fg-faint uppercase">{header}</div>}
            <button
              onClick={() => !current && openLesson(l.id)}
              aria-current={current ? 'page' : undefined}
              className={cn('relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors', current ? 'text-fg' : 'text-fg-muted hover:bg-raised hover:text-fg')}
            >
              {current && <motion.span layoutId="curriculum-current" className="absolute inset-0 rounded-lg bg-panel-2 ring-1 ring-line-strong" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
              <ProgressRing fraction={fraction} done={done} current={current} number={l.number} />
              <span className="relative min-w-0 flex-1 truncate text-[12.5px]">{l.title}</span>
              {best ? (
                <span className="relative font-mono text-[10.5px] text-fg-faint tabular-nums" title="Seu melhor tempo">
                  {formatDuration(best)}
                </span>
              ) : null}
            </button>
          </div>
        )
      })}
    </nav>
  )
}

/** Done: a filled check. Started: an arc showing how far. Untouched: just the number. */
function ProgressRing({ fraction, done, current, number }: { fraction: number; done: boolean; current: boolean; number: number }) {
  if (done) {
    return (
      <motion.span initial={false} animate={{ scale: 1 }} className="relative grid size-[18px] shrink-0 place-items-center rounded-full bg-ready/90 text-bg">
        <Check size={10} strokeWidth={3.5} />
      </motion.span>
    )
  }
  const r = 8
  const c = 2 * Math.PI * r
  return (
    <span className={cn('relative grid size-[18px] shrink-0 place-items-center font-mono text-[10px]', current ? 'text-accent' : 'text-fg-faint')}>
      <svg viewBox="0 0 18 18" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="9" cy="9" r={r} fill="none" stroke={current ? 'var(--color-accent)' : 'var(--color-line-strong)'} strokeWidth="1" />
        {fraction > 0 && (
          <motion.circle
            cx="9"
            cy="9"
            r={r}
            fill="none"
            stroke="var(--color-ready)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={c}
            initial={false}
            animate={{ strokeDashoffset: c * (1 - fraction) }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          />
        )}
      </svg>
      <span className="relative">{number}</span>
    </span>
  )
}

export const formatDuration = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Bullet({ done, current, index, optional }: { done: boolean; current: boolean; index: number; optional?: boolean }) {
  return (
    <span className="relative mt-[1px] grid size-[18px] shrink-0 place-items-center">
      <AnimatePresence mode="popLayout" initial={false}>
        {done ? (
          <motion.span
            key="done"
            initial={{ scale: 0.3, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            className="grid size-[18px] place-items-center rounded-full bg-ready text-bg"
          >
            <Check size={11} strokeWidth={3.5} />
          </motion.span>
        ) : (
          <motion.span
            key="todo"
            exit={{ scale: 0.5, opacity: 0 }}
            className={cn(
              'grid size-[18px] place-items-center rounded-full border font-mono text-[10px]',
              current ? 'border-accent text-accent' : 'border-line-strong text-fg-faint',
              optional && 'border-dashed',
            )}
          >
            {optional ? '★' : index}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
