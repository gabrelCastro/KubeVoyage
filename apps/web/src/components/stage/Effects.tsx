import { AnimatePresence, motion } from 'motion/react'
import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Effect } from '../../sim/types'
import { edgePath, type Layout } from '../../lib/visual'
import { useSim } from '../../store/useSim'

type Live = Effect | { id: number; kind: 'attention'; uid: string }

const LIFETIME = 1900

/**
 * Transient, meaningful motion: a pulse travelling down an ownership chain means
 * "a controller is pushing intent to this resource"; a ring means "this just changed".
 */
export function Effects({ layout }: { layout: Layout }) {
  const effects = useSim((s) => s.effects)
  const attention = useSim((s) => s.attention)
  const epoch = useSim((s) => s.epoch)
  const reduced = useSim((s) => s.reducedMotion)
  const [live, setLive] = useState<Live[]>([])
  const seen = useRef(0)

  useEffect(() => {
    seen.current = 0
    setLive([])
  }, [epoch])

  useEffect(() => {
    const fresh = effects.filter((e) => e.id > seen.current)
    if (!fresh.length) return
    seen.current = Math.max(...fresh.map((e) => e.id))
    setLive((l) => [...l, ...fresh])
    // Not cleaned up on purpose: a newer effect must not cancel the expiry of an older one.
    setTimeout(() => setLive((l) => l.filter((x) => !fresh.includes(x as Effect))), LIFETIME)
  }, [effects])

  useEffect(() => {
    if (!attention) return
    const item: Live = { id: -attention.n, kind: 'attention', uid: attention.uid }
    setLive((l) => [...l, item])
    setTimeout(() => setLive((l) => l.filter((x) => x !== item)), LIFETIME)
  }, [attention])

  return (
    <div className="pointer-events-none absolute top-0 left-0" style={{ width: layout.width, height: layout.height }}>
      <AnimatePresence>
        {live.map((fx) => {
          if (fx.kind === 'pulse') {
            if (reduced) return null
            return fx.chain.slice(1).map((to, i) => {
              const a = layout.boxes[fx.chain[i]]
              const b = layout.boxes[to]
              if (!a || !b) return null
              return <Pulse key={`${fx.id}-${i}`} d={edgePath(a, b)} delay={i * 0.5} tone={fx.tone} />
            })
          }
          const box = layout.boxes[fx.uid]
          if (!box) return null
          const tone = fx.kind === 'attention' ? 'info' : fx.tone
          return (
            <Ring
              key={`${fx.kind}-${fx.id}`}
              box={box}
              tone={tone}
              badge={fx.kind === 'ping' && fx.tone === 'success' && box.kind === 'ReplicaSet'}
              reduced={reduced}
            />
          )
        })}
      </AnimatePresence>
    </div>
  )
}

function Pulse({ d, delay, tone }: { d: string; delay: number; tone: 'reconcile' | 'create' }) {
  const color = tone === 'reconcile' ? 'var(--color-accent)' : 'var(--color-ready)'
  const common = { offsetPath: `path("${d}")`, offsetRotate: '0deg', background: color }
  const transition = { duration: 0.62, delay, ease: [0.5, 0, 0.3, 1] as const }
  return (
    <>
      {/* faint comet tail, then the head */}
      <motion.span
        className="absolute top-0 left-0 size-1.5 rounded-full"
        style={{ ...common, opacity: 0 }}
        initial={{ offsetDistance: '0%' }}
        animate={{ offsetDistance: '100%', opacity: [0, 0.45, 0.45, 0] }}
        transition={{ ...transition, delay: delay + 0.06 }}
      />
      <motion.span
        className="absolute top-0 left-0 size-2.5 rounded-full"
        style={{ ...common, opacity: 0, boxShadow: `0 0 10px 1px ${color}` }}
        initial={{ offsetDistance: '0%' }}
        animate={{ offsetDistance: '100%', opacity: [0, 1, 1, 0] }}
        transition={transition}
      />
    </>
  )
}

function Ring({ box, tone, badge, reduced }: { box: Layout['boxes'][string]; tone: 'warn' | 'success' | 'info' | 'error'; badge: boolean; reduced: boolean }) {
  const color =
    tone === 'warn' ? 'var(--color-terminating)' : tone === 'error' ? 'var(--color-crash)' : tone === 'success' ? 'var(--color-ready)' : 'var(--color-accent)'
  return (
    <div className="absolute" style={{ left: box.x - box.w / 2, top: box.y - box.h / 2, width: box.w, height: box.h }}>
      {!reduced && (
        <motion.span
          className="absolute inset-0 rounded-xl border-2"
          style={{ borderColor: color }}
          initial={{ opacity: 0.85, scale: 1 }}
          animate={{ opacity: 0, scale: 1.13 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
      {badge && (
        <motion.span
          className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-ready/40 bg-panel px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-ready shadow-lg shadow-black/40"
          initial={{ opacity: 0, y: 6, scale: 0.9 }}
          animate={{ opacity: [0, 1, 1, 0], y: [6, -8, -10, -16], scale: 1 }}
          transition={{ duration: 1.8, times: [0, 0.15, 0.8, 1], ease: 'easeOut' }}
        >
          <Check size={11} strokeWidth={3} /> Reconciled
        </motion.span>
      )}
    </div>
  )
}
