import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown, Check, History } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { short } from '../sim/engine'
import type { ClusterEvent, EventTone } from '../sim/types'
import { cn } from '../lib/visual'
import { clockTime, useSim } from '../store/useSim'

const TONE: Record<EventTone, string> = {
  user: 'var(--color-fg)',
  create: 'var(--color-rs)',
  schedule: 'var(--color-creating)',
  progress: 'var(--color-running)',
  ready: 'var(--color-ready)',
  reconcile: 'var(--color-accent)',
  success: 'var(--color-ready)',
  delete: 'var(--color-terminating)',
  warning: 'var(--color-crash)',
}

const SOURCE: Record<ClusterEvent['source'], string> = {
  you: 'you',
  cluster: 'before you arrived',
  'endpoints-controller': 'endpoints controller',
  'deployment-controller': 'deployment controller',
  'replicaset-controller': 'replicaset controller',
  'default-scheduler': 'scheduler',
  kubelet: 'kubelet',
}

function phrase(e: ClusterEvent): { lead: string; obj?: string; tail?: string } {
  const n = e.involved.kind === 'Pod' ? short(e.involved.name) : e.involved.name
  switch (e.reason) {
    case 'Existing':
      return { lead: e.message.split(' ')[0], tail: e.message.split(' ').slice(1).join(' ') }
    case 'Created':
      return { lead: 'You created', obj: `service/${e.involved.name}` }
    case 'Labeled':
      return { lead: 'You relabeled', obj: n, tail: e.message.split(`${e.involved.name} `)[1] }
    case 'SelectorChanged':
      return { lead: 'You changed the selector', tail: `→ ${e.message.split('→ ')[1]}` }
    case 'ImageChanged':
      return { lead: 'You requested', obj: e.message.split('→ ')[1] }
    case 'RolledBack':
      return { lead: 'You rolled back to', obj: e.message.split('back to ')[1] }
    case 'NewReplicaSet':
      return { lead: 'New ReplicaSet for', obj: e.message.split(' for ')[1] }
    case 'RolloutComplete':
      return { lead: 'Rollout complete', tail: `revision ${e.message.match(/revision (\d+)/)?.[1] ?? ''}` }
    case 'Orphaned':
      return { lead: 'Pod', obj: n, tail: 'released by its ReplicaSet' }
    case 'Adopted':
      return { lead: 'Pod', obj: n, tail: 'adopted by the ReplicaSet' }
    case 'EndpointAdded':
      return { lead: 'Pod', obj: n, tail: 'now receives traffic' }
    case 'EndpointRemoved':
      return { lead: 'Pod', obj: n, tail: 'stopped receiving traffic' }
    case 'BackOff':
      return { lead: 'Pod', obj: n, tail: 'crashed — backing off' }
    case 'Applied':
      return { lead: 'You applied', obj: 'backend.yaml' }
    case 'Scaled':
      return { lead: 'You changed replicas', tail: e.message.split('replicas ')[1] }
    case 'Deleted':
      return { lead: 'You deleted', obj: e.involved.kind === 'Service' ? `service/${n}` : n }
    case 'ScalingReplicaSet':
      return { lead: 'ReplicaSet set to', obj: `${e.message.split(' to ').pop()} replicas` }
    case 'Reconciling':
      return { lead: 'Desired ≠ Actual', tail: e.message.split('— ')[1] }
    case 'SuccessfulCreate':
      return { lead: 'Pod', obj: n, tail: 'created' }
    case 'Scheduled':
      return { lead: 'Pod', obj: n, tail: `→ ${e.message.split(' ').pop()}` }
    case 'Pulled':
      return { lead: 'Image ready for', obj: n }
    case 'Started':
      return { lead: e.message.includes('restart') ? 'Container restarted in' : 'Container started in', obj: n }
    case 'Ready':
      return { lead: 'Pod', obj: n, tail: 'is Ready' }
    case 'Killing':
      return { lead: 'Pod', obj: n, tail: 'terminating' }
    case 'Removed':
      return { lead: 'Pod', obj: n, tail: 'removed' }
    case 'Reconciled':
      return { lead: 'Reconciled', tail: e.message.split('— ')[1] }
    default:
      return { lead: e.reason, tail: e.message }
  }
}

const Row = memo(function Row({ e, time, exists, showTime, isLast }: { e: ClusterEvent; time: string; exists: boolean; showTime: boolean; isLast: boolean }) {
  const { hover, select } = useSim.getState()
  const color = TONE[e.tone]
  const p = phrase(e)
  const big = e.source === 'you' || e.reason === 'Reconciled' || e.reason === 'RolloutComplete'
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      onMouseEnter={() => hover(e.involved.uid)}
      onMouseLeave={() => hover(null)}
      onClick={() => exists && select(e.involved.uid)}
      title={`${e.reason}: ${e.message}`}
      className={cn('group relative grid cursor-default grid-cols-[52px_14px_1fr] items-start gap-x-2 rounded-md px-2 py-[5px] transition-colors hover:bg-raised', exists && 'cursor-pointer')}
    >
      <span className={cn('pt-[1px] font-mono text-[10.5px] tabular-nums text-fg-faint transition-opacity', !showTime && 'opacity-0 group-hover:opacity-100')}>{time}</span>
      <span className="relative flex h-full justify-center">
        {!isLast && <span className="absolute top-[13px] -bottom-[11px] w-px bg-line" />}
        {e.reason === 'Reconciled' || e.reason === 'RolloutComplete' ? (
          <span className="relative mt-[2px] grid size-[13px] place-items-center rounded-full bg-ready text-bg">
            <Check size={9} strokeWidth={3.5} />
          </span>
        ) : (
          <span
            className="relative mt-[4px] size-[8px] rounded-full"
            style={e.source === 'you' ? { background: 'var(--color-bg)', boxShadow: `0 0 0 1.5px ${color}` } : { background: color }}
          />
        )}
      </span>
      <span className="min-w-0">
        <span className={cn('block text-[12px] leading-[1.45]', big ? 'font-medium text-fg' : 'text-fg-muted')}>
          {p.lead}{' '}
          {p.obj && <span className={cn('font-mono text-[11.5px] text-fg', !exists && e.involved.kind === 'Pod' && 'text-fg-faint line-through decoration-fg-faint/50')}>{p.obj}</span>}
          {p.tail && <span className={cn(e.reason === 'Reconciled' ? 'text-ready' : e.type === 'Warning' ? 'text-crash' : 'text-fg-muted')}> {p.tail}</span>}
        </span>
        <span className="block text-[10px] text-fg-faint">{SOURCE[e.source]}</span>
      </span>
    </motion.li>
  )
})

export function Timeline() {
  const events = useSim((s) => s.events)
  const cluster = useSim((s) => s.cluster)
  const wallStart = useSim((s) => s.wallStart)
  const ref = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const prevLen = useRef(events.length)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (pinned) el.scrollTop = el.scrollHeight
    else if (events.length > prevLen.current) setUnseen((n) => n + events.length - prevLen.current)
    prevLen.current = events.length
  }, [events, pinned])

  useEffect(() => {
    if (pinned) setUnseen(0)
  }, [pinned])

  const exists = (uid: string) => !!(cluster.pods[uid] || cluster.replicaSets[uid] || cluster.deployments[uid] || cluster.services[uid])

  return (
    <section className="relative flex min-h-0 flex-1 flex-col" aria-label="Cluster history">
      <header className="flex h-10 shrink-0 items-center gap-2 px-4">
        <History size={14} className="text-fg-faint" />
        <h2 className="text-[12px] font-semibold tracking-tight">Cluster history</h2>
        <span className="ml-auto rounded-full bg-panel-2 px-1.5 font-mono text-[10.5px] text-fg-faint tabular-nums">{events.length}</span>
      </header>
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) setPinned(true)
        }}
        onWheel={(e) => e.deltaY < 0 && setPinned(false)}
        onTouchMove={() => setPinned(false)}
        className="min-h-0 flex-1 overflow-auto px-2 pb-4"
      >
        {events.length === 0 ? (
          <div className="mx-2 mt-2 rounded-lg border border-dashed border-line px-4 py-6 text-center">
            <p className="text-[12px] text-fg-muted">No history yet.</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-fg-faint">Every change to the cluster — yours and the controllers' — will show up here, in order.</p>
          </div>
        ) : (
          <ol>
            {events.map((e, i) => {
              const time = clockTime(wallStart, e.at)
              const prevTime = i > 0 ? clockTime(wallStart, events[i - 1].at) : ''
              return <Row key={e.id} e={e} time={time} showTime={time !== prevTime} exists={exists(e.involved.uid)} isLast={i === events.length - 1} />
            })}
          </ol>
        )}
      </div>
      <AnimatePresence>
        {!pinned && unseen > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            onClick={() => ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line-strong bg-raised px-2.5 py-1 text-[11px] text-fg shadow-lg shadow-black/40"
          >
            <ArrowDown size={12} /> {unseen} new
          </motion.button>
        )}
      </AnimatePresence>
    </section>
  )
}
