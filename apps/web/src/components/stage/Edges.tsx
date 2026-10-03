import { AnimatePresence, motion } from 'motion/react'
import { memo } from 'react'
import { spring } from '../../lib/visual'

export interface EdgeModel {
  id: string
  d: string
  end: { x: number; y: number }
  mid: { x: number; y: number }
  kind: 'dep-rs' | 'rs-pod' | 'svc-pod'
  /** svc-pod: 'stable' = endpoint (gets traffic), 'forming' = matched but not Ready (no traffic). */
  state: 'stable' | 'forming' | 'terminating'
  dim: boolean
  active: boolean
  from: string
  to: string
}

const COLOR = {
  'dep-rs': 'var(--color-deploy)',
  'rs-pod': 'var(--color-rs)',
  'svc-pod': 'var(--color-svc)',
}

/**
 * Ownership links. They draw themselves in when an owner creates something, carry a
 * marching dash while the child is still coming up, and fade when the child is going away.
 */
const Edge = memo(function Edge({ e, onHover }: { e: EdgeModel; onHover: (e: EdgeModel | null) => void }) {
  const color = e.state === 'terminating' ? 'var(--color-terminating)' : COLOR[e.kind]
  const baseOpacity = e.state === 'terminating' ? 0.35 : e.active ? 0.95 : e.kind === 'svc-pod' && e.state === 'forming' ? 0.18 : 0.45
  return (
    <motion.g initial={{ opacity: 0 }} animate={{ opacity: e.dim ? 0.12 : 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }} transition={{ duration: 0.25 }}>
      <motion.path
        fill="none"
        stroke={color}
        strokeLinecap="round"
        initial={{ pathLength: 0, d: e.d }}
        animate={{ pathLength: 1, d: e.d, strokeOpacity: baseOpacity, strokeWidth: e.active ? 2 : 1.5 }}
        transition={{ pathLength: { duration: 0.55, ease: [0.22, 1, 0.36, 1] }, d: spring, strokeOpacity: { duration: 0.3 } }}
      />
      {e.state === 'forming' && (
        <motion.path
          className="anim-march"
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeOpacity={0.9}
          initial={{ opacity: 0, d: e.d }}
          animate={{ opacity: 1, d: e.d }}
          exit={{ opacity: 0 }}
          transition={{ d: spring, opacity: { delay: 0.4 } }}
        />
      )}
      <motion.circle r={3} fill="var(--color-bg)" stroke={color} strokeWidth={1.5} initial={{ cx: e.end.x, cy: e.end.y, scale: 0 }} animate={{ cx: e.end.x, cy: e.end.y, scale: 1 }} transition={{ cx: spring, cy: spring, scale: { delay: 0.45 } }} />
      {/* generous invisible hit area so thin edges are easy to hover */}
      <path d={e.d} fill="none" stroke="transparent" strokeWidth={14} className="cursor-help" style={{ pointerEvents: 'stroke' }} onMouseEnter={() => onHover(e)} onMouseLeave={() => onHover(null)} />
    </motion.g>
  )
})

export function Edges({ edges, width, height, onHover }: { edges: EdgeModel[]; width: number; height: number; onHover: (e: EdgeModel | null) => void }) {
  return (
    <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={width} height={height}>
      <AnimatePresence>
        {edges.map((e) => (
          <Edge key={e.id} e={e} onHover={onHover} />
        ))}
      </AnimatePresence>
    </svg>
  )
}
