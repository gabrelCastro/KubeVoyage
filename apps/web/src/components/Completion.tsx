import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Check, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { nextLesson } from '../lessons'
import { useLesson, useRun } from '../lessons/useLesson'
import { useAuth } from '../auth/auth'
import { formatDuration } from './LessonPanel'
import { useSim } from '../store/useSim'

/** Shown once per run, a beat after the lesson completes — so the learner sees the cluster settle first. */
export function Completion() {
  const { lesson, complete, ctx } = useLesson()
  const epoch = useSim((s) => s.epoch)
  const openLesson = useSim((s) => s.openLesson)
  const restart = useSim((s) => s.restart)
  const [open, setOpen] = useState(false)
  const [shownFor, setShownFor] = useState(-1)

  useEffect(() => {
    if (!complete || shownFor === epoch) return
    const t = setTimeout(() => {
      setOpen(true)
      setShownFor(epoch)
    }, 1500)
    return () => clearTimeout(t)
  }, [complete, epoch, shownFor])

  useEffect(() => setOpen(false), [epoch])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const story = open ? lesson.completion.story?.(ctx.events) : null
  const next = nextLesson(lesson.id)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 overflow-y-auto bg-bg/60 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          {/* min-h-full + flex centering: centered when it fits, scrolls from the top when it doesn't */}
          <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
            <motion.div
              role="dialog"
              aria-labelledby="completion-title"
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-[min(480px,100%)] overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-[0_30px_80px_-20px_rgb(0_0_0/0.85)]"
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ready/70 to-transparent" />
              <div className="px-6 pt-6">
                <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-ready uppercase">
                  <motion.span
                    initial={{ scale: 0, rotate: -40 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 14, delay: 0.15 }}
                    className="grid size-5 place-items-center rounded-full bg-ready text-bg"
                  >
                    <Check size={12} strokeWidth={3.5} />
                  </motion.span>
                  Lesson {lesson.number} complete
                </div>
                <h2 id="completion-title" className="mt-3 text-[22px] font-semibold tracking-tight">
                  {lesson.completion.title}
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{lesson.completion.summary(ctx)}</p>
              </div>

              {story && story.length > 0 && (
                <ol className="mx-6 mt-5 border-l border-line pl-4">
                  {story.map((s, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.25 + i * 0.09 }}
                      className="relative flex items-baseline gap-3 py-[3px] text-[12.5px]"
                    >
                      <span
                        className="absolute top-[8px] -left-[20.5px] size-[8px] rounded-full"
                        style={{ background: s.tone === 'end' ? 'var(--color-ready)' : s.tone === 'start' ? 'var(--color-terminating)' : 'var(--color-line-strong)' }}
                      />
                      <span className="w-11 shrink-0 font-mono text-[11px] text-fg-faint tabular-nums">+{s.t.toFixed(1)}s</span>
                      <span className={s.tone === 'end' ? 'font-medium text-ready' : 'text-fg-muted'}>{s.text}</span>
                    </motion.li>
                  ))}
                </ol>
              )}

              <RunStats lessonId={lesson.id} />


              <div className="mx-6 mt-5 rounded-xl border border-line bg-panel-2/70 px-4 py-3">
                <p className="text-[13px] font-medium">{lesson.completion.takeaway}</p>
                {lesson.completion.note && <p className="mt-1 text-[11.5px] leading-relaxed text-fg-faint">{lesson.completion.note}</p>}
              </div>

              <SaveNudge onSignIn={() => setOpen(false)} />


              <div className="mt-5 flex items-center justify-between gap-2 border-t border-line bg-panel-2/40 px-6 py-3.5">
                <div className="flex gap-2">
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-line-strong px-3 py-1.5 text-[12.5px] text-fg-muted transition hover:text-fg"
                  >
                    Keep exploring
                  </button>
                  <button
                    onClick={restart}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-fg-faint transition hover:text-fg"
                    title="Restart this lesson"
                  >
                    <RotateCcw size={13} /> Again
                  </button>
                </div>
                {next ? (
                  <button
                    onClick={() => openLesson(next.id)}
                    autoFocus
                    className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-[#0b1020] transition hover:brightness-110 active:scale-[0.98]"
                  >
                    Next: {next.title} <ArrowRight size={13} />
                  </button>
                ) : (
                  <span className="text-[12px] text-fg-faint">That's every lesson — for now.</span>
                )}
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function RunStats({ lessonId }: { lessonId: string }) {
  const run = useRun()
  const epoch = useSim((s) => s.epoch)
  if (run.lessonId !== lessonId || run.epoch !== epoch || run.elapsedMs === null) return null
  const best = run.previousBestMs
  const record = best !== null && run.elapsedMs < best
  return (
    <div className="mx-6 mt-4 flex items-center gap-3 text-[12px] text-fg-muted">
      <span>
        Finished in <span className="font-mono text-fg">{formatDuration(run.elapsedMs)}</span>
      </span>
      {record ? (
        <motion.span
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6, type: 'spring', stiffness: 400, damping: 18 }}
          className="rounded-full border border-ready/40 bg-ready/10 px-2 py-0.5 text-[11px] font-medium text-ready"
        >
          New best · was {formatDuration(best)}
        </motion.span>
      ) : best !== null ? (
        <span className="text-fg-faint">best {formatDuration(best)}</span>
      ) : null}
    </div>
  )
}

/** Only for signed-out learners, only here — the moment progress feels worth keeping. */
function SaveNudge({ onSignIn }: { onSignIn: () => void }) {
  const status = useAuth((s) => s.status)
  const openSignIn = useAuth((s) => s.openSignIn)
  if (status !== 'anonymous') return null
  return (
    <div className="mx-6 mt-3 flex items-center justify-between gap-3 rounded-xl border border-dashed border-line-strong px-4 py-2.5">
      <p className="text-[12px] leading-relaxed text-fg-muted">This progress lives on this device only.</p>
      <button
        onClick={() => {
          onSignIn()
          openSignIn()
        }}
        className="shrink-0 text-[12px] font-medium text-accent transition hover:underline"
      >
        Keep it — sign in
      </button>
    </div>
  )
}
