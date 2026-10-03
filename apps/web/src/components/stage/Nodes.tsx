import { AnimatePresence, motion, useAnimate } from 'motion/react'
import { RefreshCw, Check, Plus, X } from 'lucide-react'
import { memo, useEffect, useRef, type ReactNode } from 'react'
import { isBroken, short, tag } from '../../sim/engine'
import type { ControllerPhase, Deployment, Pod, ReplicaSet, Service } from '../../sim/types'
import { cn, LIFECYCLE, podLabel, podVisual, spring, VISUAL } from '../../lib/visual'
import { useSim } from '../../store/useSim'
import { KindBadge, LabelChip, Metric, Rolling, StatusGlyph } from '../primitives'

interface Geo {
  x: number
  y: number
  w: number
  h: number
}

interface Emphasis {
  dim: boolean
  selected: boolean
  hovered: boolean
}

/** Places a card in world space. Appear = fade + soft scale; move = spring; remove = fade + shrink. */
function Positioned({ x, y, w, h, children, exitY = 6 }: Geo & { children: ReactNode; exitY?: number }) {
  const left = x - w / 2
  const top = y - h / 2
  return (
    <motion.div
      className="absolute top-0 left-0"
      style={{ width: w, height: h }}
      initial={{ x: left, y: top + 10, opacity: 0, scale: 0.82 }}
      animate={{ x: left, y: top, opacity: 1, scale: 1 }}
      exit={{ y: top + exitY, opacity: 0, scale: 0.8, filter: 'blur(2px)', transition: { duration: 0.42, ease: [0.4, 0, 0.6, 1] } }}
      transition={{ x: spring, y: spring, scale: { type: 'spring', stiffness: 300, damping: 22 }, opacity: { duration: 0.28 } }}
    >
      {children}
    </motion.div>
  )
}

function Card({
  emphasis,
  tint,
  onClick,
  children,
  className,
  label,
  tour,
}: {
  emphasis: Emphasis
  tint: string
  onClick: () => void
  children: ReactNode
  className?: string
  label: string
  /** Marks the card for the onboarding tour. */
  tour?: string
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-pressed={emphasis.selected}
      data-tour={tour}
      onClick={(e) => (e.stopPropagation(), onClick())}
      animate={{ opacity: emphasis.dim ? 0.26 : 1 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ opacity: { duration: 0.25 }, y: { type: 'spring', stiffness: 500, damping: 30 } }}
      className={cn(
        'relative h-full w-full cursor-pointer rounded-xl border bg-panel text-left shadow-[0_1px_0_rgb(255_255_255/0.03)_inset,0_8px_24px_-12px_rgb(0_0_0/0.6)] transition-[border-color,box-shadow] duration-200',
        className,
      )}
      style={{
        borderColor: emphasis.selected ? 'var(--color-accent)' : `color-mix(in oklab, ${tint} 24%, var(--color-line))`,
        boxShadow: emphasis.selected
          ? '0 0 0 3px color-mix(in oklab, var(--color-accent) 22%, transparent), 0 10px 30px -12px rgb(0 0 0 / 0.7)'
          : emphasis.hovered
            ? `0 0 0 3px color-mix(in oklab, ${tint} 30%, transparent)`
            : undefined,
      }}
    >
      {/* hairline of the resource's color along the top edge */}
      <span
        className="pointer-events-none absolute inset-x-4 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${tint}, transparent)`, opacity: 0.55 }}
      />
      {children}
    </motion.button>
  )
}

// ── Deployment ─────────────────────────────────────────────────────────────

export const DeploymentNode = memo(function DeploymentNode({ dep, geo, ...e }: { dep: Deployment; geo: Geo } & Emphasis) {
  const select = useSim((s) => s.select)
  return (
    <Positioned {...geo}>
      <Card emphasis={e} tint="var(--color-deploy)" onClick={() => select(dep.uid)} label={`Deployment ${dep.name}${dep.paused ? ', pausado' : ''}`} className="px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <KindBadge kind="Deployment" />
          <span className="flex items-center gap-1.5">
            {dep.paused && (
              <span className="rounded-full border border-warn/35 bg-warn/10 px-1.5 py-[1px] text-[10px] font-medium text-warn" title="kubectl rollout resume para continuar">
                Pausado
              </span>
            )}
            <LabelChip k="app" v={dep.selector.app} />
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="text-[17px] font-semibold tracking-tight">{dep.name}</span>
          <span className="font-mono text-[12px] text-fg-muted">
            replicas: <Rolling value={dep.replicas} className="font-semibold text-fg" />
          </span>
        </div>
      </Card>
    </Positioned>
  )
})

// ── ReplicaSet ─────────────────────────────────────────────────────────────

const PHASE_PILL: Record<ControllerPhase, { label: string; color: string }> = {
  idle: { label: 'Em sincronia', color: 'var(--color-ready)' },
  diverged: { label: 'Divergente', color: 'var(--color-warn)' },
  reconciling: { label: 'Reconciliando', color: 'var(--color-accent)' },
}

export function PhasePill({ phase }: { phase: ControllerPhase }) {
  const p = PHASE_PILL[phase]
  return (
    <motion.span
      layout
      className="inline-flex items-center gap-1 overflow-hidden rounded-full border px-2 py-[1px] text-[10.5px] font-medium"
      style={{ color: p.color, borderColor: `color-mix(in oklab, ${p.color} 35%, transparent)`, background: `color-mix(in oklab, ${p.color} 9%, transparent)` }}
      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={phase}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="inline-flex items-center gap-1"
        >
          {phase === 'idle' && <Check size={11} strokeWidth={2.5} />}
          {phase === 'reconciling' && <RefreshCw size={10.5} strokeWidth={2.5} className="anim-spin" />}
          {phase === 'diverged' && <span className="size-1.5 rounded-full bg-current" />}
          {p.label}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  )
}

export const ReplicaSetNode = memo(function ReplicaSetNode({
  rs,
  geo,
  actual,
  ready,
  compact,
  current,
  deleting,
  ...e
}: { rs: ReplicaSet; geo: Geo; actual: number; ready: number; compact?: boolean; current: boolean; deleting?: boolean } & Emphasis) {
  const select = useSim((s) => s.select)
  const diverged = actual !== rs.desired
  const broken = isBroken(rs.image)
  const version = (
    <span
      className={cn('shrink-0 rounded-[4px] px-1 font-mono text-[10px] ring-1', broken ? 'bg-crash/10 text-crash ring-crash/30' : 'bg-panel-2 text-fg-muted ring-line-strong')}
      title={rs.image}
    >
      {tag(rs.image)}
    </span>
  )
  if (compact) {
    return (
      <Positioned {...geo}>
        <Card emphasis={{ ...e, dim: e.dim }} tint="var(--color-rs)" onClick={() => select(rs.uid)} label={`ReplicaSet ${rs.name}, escalado para 0`} className="px-3 py-2 opacity-70">
          <div className="flex items-center justify-between gap-2">
            <KindBadge kind="ReplicaSet" />
            {version}
          </div>
          <div className="mt-1 flex items-baseline justify-between font-mono text-[11px]">
            <span className="text-fg-faint">-{rs.hash}</span>
            <span className="text-fg-faint">0 réplicas</span>
          </div>
        </Card>
      </Positioned>
    )
  }
  return (
    <Positioned {...geo}>
      <Card
        emphasis={e}
        tint="var(--color-rs)"
        onClick={() => select(rs.uid)}
        label={`ReplicaSet ${rs.name}${deleting ? ', sendo excluído' : ''}`}
        className={cn('overflow-hidden px-3.5 py-2.5 transition-opacity', deleting && 'opacity-60')}
      >
        <div className="flex items-center justify-between">
          <KindBadge kind="ReplicaSet" />
          {deleting ? (
            <span className="rounded-full bg-terminating/10 px-1.5 py-0.5 text-[10px] font-medium text-terminating">Excluindo</span>
          ) : (
            <PhasePill phase={rs.phase} />
          )}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[12.5px] text-fg">
            {rs.name.split('-')[0]}
            <span className="text-fg-faint">-{rs.hash}</span>
          </span>
          <span className="flex items-center gap-1">
            {!current && <span className="text-[9.5px] tracking-wide text-fg-faint uppercase">antigo</span>}
            {version}
          </span>
        </div>
        <div className="mt-2 flex gap-5">
          <Metric label="Desired" value={rs.desired} />
          <Metric label="Actual" value={actual} tone={diverged ? 'warn' : 'neutral'} />
          <Metric label="Ready" value={ready} tone={ready === rs.desired ? 'ok' : 'neutral'} />
        </div>
        {/* while reconciling, a soft sweep along the base says "the controller is working" */}
        <AnimatePresence>
          {rs.phase === 'reconciling' && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden"
            >
              <span className="anim-sweep absolute inset-y-0 w-2/5" style={{ background: 'linear-gradient(90deg, transparent, var(--color-accent), transparent)' }} />
            </motion.span>
          )}
        </AnimatePresence>
      </Card>
    </Positioned>
  )
})

// ── Pod ────────────────────────────────────────────────────────────────────

/** When a Service is selected, every Pod shows the one label that decides whether it matches. */
export interface Probe {
  key: string
  value: string | undefined
  match: boolean
}

export const PodNode = memo(function PodNode({ pod, geo, probe, ...e }: { pod: Pod; geo: Geo; probe: Probe | null } & Emphasis) {
  const select = useSim((s) => s.select)
  const reduced = useSim((s) => s.reducedMotion)
  const v = podVisual(pod)
  const meta = VISUAL[v]
  const terminating = v === 'terminating'
  const crash = v === 'crash'
  const prefix = pod.name.slice(0, pod.name.length - short(pod.name).length)
  const [scope, animate] = useAnimate()
  const restarts = useRef(pod.restarts)

  // A crash is announced once, briefly — then the card simply stays visibly broken.
  useEffect(() => {
    if (pod.restarts > restarts.current && scope.current && !reduced) {
      animate(scope.current, { x: [0, -5, 5, -3, 3, 0] }, { duration: 0.42, ease: 'easeOut' })
    }
    restarts.current = pod.restarts
  }, [pod.restarts, animate, scope, reduced])

  return (
    <Positioned {...geo} exitY={14}>
      <motion.div
        ref={scope}
        className="h-full w-full"
        animate={{ scale: terminating ? 0.95 : 1, filter: terminating ? 'saturate(0.4)' : 'saturate(1)' }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      >
        <Card
          tour="pod"
          emphasis={e}
          tint={meta.color}
          onClick={() => select(pod.uid)}
          label={`Pod ${pod.name}, ${podLabel(pod)}`}
          className={cn('px-3 pt-2.5 pb-2.5', terminating && 'border-dashed', crash && 'bg-crash/[0.04]')}
        >
          <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium" style={{ color: meta.color }}>
            <StatusGlyph state={v} size={14} />
            <Rolling value={podLabel(pod)} className="truncate" />
          </span>

          <div className="mt-2 truncate font-mono text-[9.5px] leading-tight text-fg-faint">{prefix}</div>
          <div className="flex items-center justify-between gap-2">
            <span className={cn('font-mono text-[16px] leading-tight font-semibold tracking-tight', terminating ? 'text-fg-muted line-through decoration-terminating/60' : 'text-fg')}>
              {short(pod.name)}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <AnimatePresence>
                {pod.restarts > 0 && (
                  <motion.span
                    key="restarts"
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-0.5 rounded-[4px] bg-crash/10 px-1 font-mono text-[9.5px] text-crash ring-1 ring-crash/30"
                    title={`${pod.restarts} reinícios`}
                  >
                    ↻<Rolling value={pod.restarts} />
                  </motion.span>
                )}
                {pod.nodeName && (
                  <motion.span
                    key="node"
                    initial={{ opacity: 0, x: -6, scale: 0.9 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 26 }}
                    className="rounded-[4px] bg-panel-2 px-1 font-mono text-[9.5px] text-fg-muted ring-1 ring-line-strong"
                  >
                    {pod.nodeName}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </div>

          <LifecycleBar step={meta.step} color={meta.color} stalled={crash} />
        </Card>
        <AnimatePresence>
          {probe && (
            <motion.span
              key={`${probe.key}=${probe.value}`}
              initial={{ opacity: 0, y: -4, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
              className={cn(
                'pointer-events-none absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-panel px-2 py-[1px] font-mono text-[10.5px] whitespace-nowrap shadow-md shadow-black/40',
                probe.match ? 'border-svc/60 text-svc' : 'border-line-strong text-fg-faint',
              )}
            >
              {probe.key}={probe.value ?? '∅'} {probe.match ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </Positioned>
  )
})

// ── Service ────────────────────────────────────────────────────────────────

export const ServiceNode = memo(function ServiceNode({ svc, geo, matched, ...e }: { svc: Service; geo: Geo; matched: number } & Emphasis) {
  const select = useSim((s) => s.select)
  const none = svc.endpoints.length === 0
  const tint = none ? 'var(--color-crash)' : 'var(--color-svc)'
  return (
    <Positioned {...geo}>
      <Card emphasis={e} tint={tint} onClick={() => select(svc.uid)} label={`Service ${svc.name}, ${svc.endpoints.length} endpoints`} className="px-3.5 py-2.5">
        <div className="flex items-center justify-between">
          <KindBadge kind="Service" />
          <motion.span
            layout
            className="inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[10.5px] font-medium"
            style={{ color: tint, borderColor: `color-mix(in oklab, ${tint} 35%, transparent)`, background: `color-mix(in oklab, ${tint} 9%, transparent)` }}
          >
            {none ? <X size={11} strokeWidth={2.6} /> : <span className="size-1.5 rounded-full bg-current" />}
            <Rolling value={none ? 'Sem endpoints' : `${svc.endpoints.length} endpoint${svc.endpoints.length === 1 ? '' : 's'}`} />
          </motion.span>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-semibold tracking-tight">{svc.name}</span>
          <span className="font-mono text-[10.5px] text-fg-faint">
            {svc.clusterIP}:{svc.port}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[10px] text-fg-faint">selector</span>
          {Object.entries(svc.selector).map(([k, v]) => (
            <LabelChip key={k} k={k} v={v} tone={none ? 'neutral' : 'match'} />
          ))}
          {none && matched > 0 && <span className="text-[10px] text-warn">{matched} sem Ready</span>}
        </div>
      </Card>
    </Positioned>
  )
})

/** Four segments that fill as the Pod moves through its lifecycle — and drain when it is terminated. */
export function LifecycleBar({ step, color, className, stalled }: { step: number; color: string; className?: string; stalled?: boolean }) {
  return (
    <div className={cn('mt-2.5 flex gap-1', className)} aria-hidden>
      {LIFECYCLE.map((s, i) => {
        const filled = i <= step
        const current = i === step && step < 3 && !stalled
        return (
          <span key={s} className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-line">
            <motion.span
              className="absolute inset-0 origin-left rounded-full"
              initial={false}
              animate={{ scaleX: filled ? 1 : 0, backgroundColor: color }}
              transition={{ scaleX: { type: 'spring', stiffness: 180, damping: 24, delay: step < 0 ? (3 - i) * 0.05 : 0 }, backgroundColor: { duration: 0.3 } }}
            />
            {current && <span className="anim-sweep absolute inset-y-0 w-1/2 bg-white/35" />}
          </span>
        )
      })}
    </div>
  )
}

// ── Empty slot ─────────────────────────────────────────────────────────────

/**
 * A slot the ReplicaSet wants filled but which has no Pod. After a deletion it remembers
 * who used to live there — the visible "hole" that self-healing closes.
 */
export const SlotPlaceholder = memo(function SlotPlaceholder({
  geo,
  ghost,
  reconciling,
  dim,
}: {
  geo: Geo
  ghost: string | null
  reconciling: boolean
  dim: boolean
}) {
  return (
    <motion.div
      className="pointer-events-none absolute top-0 left-0"
      style={{ width: geo.w, height: geo.h }}
      initial={{ x: geo.x - geo.w / 2, y: geo.y - geo.h / 2, opacity: 0, scale: 0.92 }}
      animate={{ x: geo.x - geo.w / 2, y: geo.y - geo.h / 2, opacity: dim ? 0.2 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.04, transition: { duration: 0.2 } }}
      transition={{ x: spring, y: spring, opacity: { duration: 0.35, delay: ghost ? 0.15 : 0 } }}
    >
      <div
        className={cn(
          'flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed transition-colors duration-500',
          ghost ? 'border-warn/70 bg-warn/[0.06]' : 'border-line-strong bg-white/[0.01]',
        )}
      >
        <motion.span
          animate={reconciling ? { scale: [1, 1.15, 1] } : { scale: 1 }}
          transition={reconciling ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : undefined}
          className={cn('grid size-6 place-items-center rounded-full border border-dashed', ghost ? 'border-warn/60 text-warn' : 'border-fg-faint text-fg-faint')}
        >
          <Plus size={12} strokeWidth={2.2} />
        </motion.span>
        {ghost ? (
          <>
            <span className="font-mono text-[12px] text-fg-muted line-through decoration-warn/60">{short(ghost)}</span>
            <span className="text-[10px] text-warn/90">{reconciling ? 'substituto a caminho…' : 'desejado, não está rodando'}</span>
          </>
        ) : (
          <span className="text-[10px] text-fg-faint">aguardando Pod</span>
        )}
      </div>
    </motion.div>
  )
})
