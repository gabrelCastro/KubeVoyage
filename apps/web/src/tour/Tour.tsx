import { AnimatePresence, motion } from 'motion/react'
import { Boxes, Check, GraduationCap, SquareTerminal } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/auth'
import { Logo } from '../components/primitives'
import { Modal } from '../components/ui/Modal'
import { useSim } from '../store/useSim'
import { toast } from '../ui/toast'
import { TOUR, type TourCtx } from './steps'
import { useTour } from './store'

const PAD = 6
const CARD_W = 320
const GAP = 14
const MARGIN = 12

/** Everything the tour shows: the welcome, the spotlight, and the logic that moves it forward. */
export function Tour() {
  useAutoStart()
  useAdvance()
  return (
    <>
      <Welcome />
      <Spotlight />
    </>
  )
}

/** First visit: offer the tour once the app has settled (and never over a sign-in link). */
function useAutoStart() {
  const status = useTour((s) => s.status)
  const pendingToken = useAuth((s) => s.pendingToken)
  const authStatus = useAuth((s) => s.status)
  useEffect(() => {
    if (status !== 'unseen' || pendingToken || authStatus === 'unknown') return
    const t = setTimeout(() => useTour.getState().showWelcome(), 900)
    return () => clearTimeout(t)
  }, [status, pendingToken, authStatus])
}

/** Moves to the next step when the learner has done what the current one asks. */
function useAdvance() {
  const status = useTour((s) => s.status)
  const step = useTour((s) => s.step)
  const cluster = useSim((s) => s.cluster)
  const events = useSim((s) => s.events)
  const history = useSim((s) => s.history)
  const selected = useSim((s) => s.selected)

  useEffect(() => {
    if (status !== 'running') return
    if (step >= TOUR.length) {
      useTour.getState().finish()
      toast({ tone: 'success', title: 'Tutorial concluído', body: 'Siga os objetivos da lição. O botão ? no topo traz o tutorial e os atalhos de volta.' })
      return
    }
    const current = TOUR[step]
    const ctx: TourCtx = { cluster, events, history, selected }
    if (current.done?.(ctx)) {
      // a short beat so the "done" check is seen before the spotlight moves on
      const t = setTimeout(() => useTour.getState().next(), 650)
      return () => clearTimeout(t)
    }
  }, [status, step, cluster, events, history, selected])
}

export function startTour() {
  // the tour rides on a fresh run of lesson 1
  const sim = useSim.getState()
  sim.select(null)
  if (sim.lessonId === 'self-healing') sim.restart()
  else sim.openLesson('self-healing')
  useTour.getState().start()
}

function Welcome() {
  const status = useTour((s) => s.status)
  const skip = useTour((s) => s.skip)
  const lessonId = useSim((s) => s.lessonId)
  const elsewhere = lessonId !== 'self-healing'
  return (
    <Modal open={status === 'welcome'} onClose={skip} label="Bem-vindo ao KubeLearn" className="w-[min(460px,100%)]">
      <div className="px-7 pt-8 pb-6">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[13px] font-semibold tracking-tight text-fg-muted">KubeLearn</span>
        </div>
        <h2 className="mt-5 text-[22px] font-semibold tracking-tight">Aprenda Kubernetes vendo acontecer</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">
          Um cluster simulado roda aqui no seu navegador e reage a tudo que você faz. Nada para instalar, nada para quebrar de verdade.
        </p>
        <ul className="mt-5 flex flex-col gap-3">
          {[
            { icon: Boxes, title: 'O palco', text: 'o cluster ao vivo — Pods nascendo, morrendo e sendo substituídos' },
            { icon: SquareTerminal, title: 'O terminal', text: 'o mesmo cluster, com comandos kubectl de verdade' },
            { icon: GraduationCap, title: 'As lições', text: 'objetivos curtos, com dicas e uma apostila para aprofundar' },
          ].map(({ icon: Icon, title, text }, i) => (
            <motion.li key={title} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.07 }} className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line-strong bg-panel-2 text-accent">
                <Icon size={15} />
              </span>
              <span className="pt-0.5 text-[13px] leading-snug">
                <span className="font-medium text-fg">{title}</span> <span className="text-fg-muted">— {text}</span>
              </span>
            </motion.li>
          ))}
        </ul>
        <div className="mt-7 flex items-center justify-between gap-3">
          <button onClick={skip} className="rounded-lg px-2 py-2 text-[13px] text-fg-muted transition hover:text-fg">
            Já conheço, pular
          </button>
          <button
            data-autofocus
            onClick={startTour}
            className="rounded-lg bg-accent px-4 py-2.5 text-[13px] font-semibold text-[#0b1020] shadow-[0_6px_20px_-8px_var(--color-accent)] transition hover:brightness-110 active:scale-[0.98]"
          >
            Fazer o tour · 2 min
          </button>
        </div>
        {elsewhere && <p className="mt-3 text-right text-[11.5px] text-fg-faint">O tour acontece na lição 1.</p>}
      </div>
    </Modal>
  )
}

interface Hole {
  top: number
  left: number
  width: number
  height: number
}

/** Follows a `data-tour` area every frame (cards move with springs), reporting only real changes. */
function useTargetRect(target: string | null, active: boolean): Hole | null {
  const [hole, setHole] = useState<Hole | null>(null)
  useEffect(() => {
    if (!active || !target) {
      setHole(null)
      return
    }
    const selector = `[data-tour="${target}"]`
    document.querySelector(selector)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    let raf = 0
    let last = ''
    const tick = () => {
      const r = document.querySelector(selector)?.getBoundingClientRect()
      const visible = !!r && r.width > 0 && r.height > 0
      const next = visible ? { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 } : null
      const sig = next ? `${Math.round(next.top)}|${Math.round(next.left)}|${Math.round(next.width)}|${Math.round(next.height)}` : 'none'
      if (sig !== last) {
        last = sig
        setHole(next)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [target, active])
  return hole
}

function Spotlight() {
  const status = useTour((s) => s.status)
  const step = useTour((s) => s.step)
  const reduced = useSim((s) => s.reducedMotion)
  const running = status === 'running' && step < TOUR.length
  const current = running ? TOUR[step] : null
  const hole = useTargetRect(current?.target ?? null, running)
  const cluster = useSim((s) => s.cluster)
  const events = useSim((s) => s.events)
  const history = useSim((s) => s.history)
  const selected = useSim((s) => s.selected)
  const complete = !!current?.done?.({ cluster, events, history, selected })

  useEffect(() => {
    if (!running) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      useTour.getState().skip()
      toast({ tone: 'info', title: 'Tutorial pulado', body: 'Quando quiser, ele está no botão ? no topo.' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running])

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  const shade = 'rgb(5 7 10 / 0.62)'
  const transition = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 320, damping: 34 }
  // the four panels around the hole block clicks elsewhere; the hole itself stays usable
  const panels = hole
    ? [
        { top: 0, left: 0, width: vw, height: Math.max(0, hole.top) },
        { top: hole.top + hole.height, left: 0, width: vw, height: Math.max(0, vh - hole.top - hole.height) },
        { top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height },
        { top: hole.top, left: hole.left + hole.width, width: Math.max(0, vw - hole.left - hole.width), height: hole.height },
      ]
    : [{ top: 0, left: 0, width: vw, height: vh }]

  return (
    <AnimatePresence>
      {current && (
        <motion.div key="tour" className="fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ pointerEvents: 'none' }}>
          {panels.map((p, i) => (
            <motion.div key={i} className="absolute" style={{ background: shade, pointerEvents: 'auto' }} initial={false} animate={p} transition={transition} />
          ))}
          {hole && (
            <motion.div
              className="absolute rounded-xl"
              style={{ boxShadow: '0 0 0 2px var(--color-accent), 0 0 0 7px color-mix(in oklab, var(--color-accent) 22%, transparent)' }}
              initial={false}
              animate={{ ...hole }}
              transition={transition}
            />
          )}
          <StepCard hole={hole} index={step} complete={complete} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function StepCard({ hole, index, complete }: { hole: Hole | null; index: number; complete: boolean }) {
  const step = TOUR[index]
  const { next, skip } = useTour.getState()
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(180)
  const last = index === TOUR.length - 1

  useLayoutEffect(() => {
    if (ref.current) setHeight(ref.current.offsetHeight)
  }, [index, complete])

  const pos = place(hole, height)
  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-live="polite"
      aria-label={`Tutorial, passo ${index + 1} de ${TOUR.length}: ${step.title}`}
      className="absolute rounded-2xl border border-line-strong bg-panel shadow-[0_24px_60px_-16px_rgb(0_0_0/0.9)]"
      style={{ width: CARD_W, pointerEvents: 'auto' }}
      initial={false}
      animate={{ top: pos.top, left: pos.left }}
      transition={{ type: 'spring', stiffness: 300, damping: 32 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={index} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }} className="px-5 pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-1" aria-hidden>
              {TOUR.map((s, i) => (
                <span key={s.id} className="h-1 w-4 rounded-full transition-colors" style={{ background: i < index || (i === index && complete) ? 'var(--color-ready)' : i === index ? 'var(--color-accent)' : 'var(--color-line-strong)' }} />
              ))}
            </div>
            <button onClick={skip} className="text-[11.5px] text-fg-faint transition hover:text-fg">
              Pular tutorial
            </button>
          </div>
          <h3 className="mt-3 text-[15px] font-semibold tracking-tight">{step.title}</h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-muted">{step.body}</p>
          {step.done && !complete && (
            <p className="mt-3 flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/[0.07] px-2.5 py-2 text-[11.5px] text-accent">
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative size-2 rounded-full bg-accent" />
              </span>
              {step.waiting}
            </p>
          )}
          <div className="mt-3 flex min-h-8 items-center justify-between gap-3">
            <span className="font-mono text-[10.5px] whitespace-nowrap text-fg-faint">
              {index + 1} de {TOUR.length}
            </span>
            {step.done ? (
              complete ? (
                <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-1.5 text-[12px] font-medium text-ready">
                  <Check size={14} strokeWidth={3} /> Isso!
                </motion.span>
              ) : null
            ) : (
              <button
                autoFocus
                onClick={next}
                className="rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-[#0b1020] transition hover:brightness-110 active:scale-[0.98]"
              >
                {last ? 'Começar' : 'Entendi'}
              </button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}

/** Put the card beside the highlighted area — wherever there's room — and always on screen. */
function place(hole: Hole | null, h: number) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampX = (x: number) => Math.min(Math.max(x, MARGIN), vw - CARD_W - MARGIN)
  const clampY = (y: number) => Math.min(Math.max(y, MARGIN), vh - h - MARGIN)
  if (!hole) return { left: (vw - CARD_W) / 2, top: (vh - h) / 2 }
  const room = {
    right: vw - (hole.left + hole.width),
    left: hole.left,
    bottom: vh - (hole.top + hole.height),
    top: hole.top,
  }
  if (room.right >= CARD_W + GAP + MARGIN) return { left: hole.left + hole.width + GAP, top: clampY(hole.top) }
  if (room.left >= CARD_W + GAP + MARGIN) return { left: hole.left - CARD_W - GAP, top: clampY(hole.top) }
  if (room.bottom >= h + GAP + MARGIN) return { left: clampX(hole.left + hole.width / 2 - CARD_W / 2), top: hole.top + hole.height + GAP }
  if (room.top >= h + GAP + MARGIN) return { left: clampX(hole.left + hole.width / 2 - CARD_W / 2), top: hole.top - h - GAP }
  // the area fills the screen: float over its lower corner
  return { left: clampX(hole.left + hole.width - CARD_W - MARGIN), top: clampY(hole.top + hole.height - h - MARGIN) }
}
