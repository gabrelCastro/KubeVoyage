import { AnimatePresence, motion } from 'motion/react'
import { Lightbulb, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { hasApostila } from '../lessons/apostilas'
import { useSim } from '../store/useSim'
import { useTour } from './store'

/**
 * One-time tips for the features the guided first run leaves out, each shown at the
 * moment it becomes useful — and never twice.
 */
const TIPS: Record<string, { target: string; title: string; body: string }> = {
  pausa: {
    target: 'playback',
    title: 'Quer ver em câmera lenta?',
    body: 'Pause com Espaço logo depois de uma ação e avance com ponto (.) — uma decisão dos controllers por vez.',
  },
  apostila: {
    target: 'apostila',
    title: 'Travou?',
    body: 'A apostila explica os conceitos desta lição. Os termos sublinhados no texto levam direto ao trecho certo.',
  },
  paleta: {
    target: 'paleta',
    title: 'Atalho para tudo',
    body: 'Ctrl+K (⌘K no Mac) abre a paleta: mude de lição, controle a simulação ou rode um comando sem tirar a mão do teclado.',
  },
}

const exists = (target: string) => {
  const r = document.querySelector(`[data-tour="${target}"]`)?.getBoundingClientRect()
  return !!r && r.width > 0
}

const STUCK_MS = 75_000
const AFTER_TOUR_MS = 4_000

export function Tips() {
  const tourStatus = useTour((s) => s.status)
  const endedAt = useTour((s) => s.endedAt)
  const events = useSim((s) => s.events)
  const history = useSim((s) => s.history)
  const done = useSim((s) => s.done)
  const lessonId = useSim((s) => s.lessonId)
  const epoch = useSim((s) => s.epoch)
  const show = useTour((s) => s.showTip)
  const quiet = tourStatus === 'running' || tourStatus === 'welcome' || tourStatus === 'unseen'

  // tied to an action: the moment you break something is the moment slow motion helps
  useEffect(() => {
    if (quiet) return
    const deleted = events.some((e) => e.source === 'you' && e.reason === 'Deleted')
    if (deleted && exists('playback')) show('pausa')
  }, [quiet, events, show])

  useEffect(() => {
    if (quiet || history.length < 6 || Date.now() - endedAt < AFTER_TOUR_MS) return
    if (exists('paleta')) show('paleta')
  }, [quiet, history, endedAt, show])

  // the apostila tip waits for signs of being stuck: no new objective for a while
  useEffect(() => {
    if (quiet || !hasApostila(lessonId)) return
    const t = setTimeout(() => exists('apostila') && show('apostila'), STUCK_MS)
    return () => clearTimeout(t)
  }, [quiet, lessonId, epoch, done.length, show])

  return <TipBubble />
}

function TipBubble() {
  const id = useTour((s) => s.tip)
  const dismiss = useTour((s) => s.dismissTip)
  const paused = useSim((s) => s.paused)
  const tip = id ? TIPS[id] : null
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!tip) return
    setAnchor(document.querySelector(`[data-tour="${tip.target}"]`)?.getBoundingClientRect() ?? null)
    const t = setTimeout(dismiss, 10_000)
    return () => clearTimeout(t)
  }, [tip, dismiss])

  // the pause tip has done its job the moment you pause
  useEffect(() => {
    if (id === 'pausa' && paused) dismiss()
  }, [id, paused, dismiss])

  const width = 290
  const left = anchor ? Math.min(Math.max(anchor.left + anchor.width / 2 - width / 2, 12), window.innerWidth - width - 12) : 0
  const arrow = anchor ? Math.min(Math.max(anchor.left + anchor.width / 2 - left, 18), width - 18) : 0
  return (
    <AnimatePresence>
      {tip && anchor && (
        <motion.div
          key={id}
          role="status"
          initial={{ opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          className="fixed z-40 rounded-xl border border-accent/40 bg-raised px-3.5 py-3 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.85)]"
          style={{ top: anchor.bottom + 10, left, width }}
        >
          <span className="absolute -top-[6px] size-2.5 rotate-45 border-t border-l border-accent/40 bg-raised" style={{ left: arrow - 5 }} />
          <div className="flex items-start gap-2.5">
            <Lightbulb size={15} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-fg">{tip.title}</div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-fg-muted">{tip.body}</p>
            </div>
            <button onClick={dismiss} className="rounded p-0.5 text-fg-faint transition hover:text-fg" aria-label="Fechar dica">
              <X size={13} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
