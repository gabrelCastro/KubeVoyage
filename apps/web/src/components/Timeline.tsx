import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown, Check, History } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
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
  you: 'você',
  cluster: 'antes de você chegar',
  'endpoints-controller': 'endpoints controller',
  'deployment-controller': 'deployment controller',
  'replicaset-controller': 'replicaset controller',
  'garbage-collector': 'garbage collector',
  'horizontal-pod-autoscaler': 'horizontal pod autoscaler',
  'job-controller': 'job controller',
  'daemonset-controller': 'daemonset controller',
  'node-controller': 'node controller',
  'default-scheduler': 'scheduler',
  kubelet: 'kubelet',
}

const plural = (n: string | number, one: string, many: string) => (Number(n) === 1 ? one : many)

/** Event messages stay in Kubernetes' own words (they're what kubectl shows); the timeline tells the story in Portuguese. */
function phrase(e: ClusterEvent): { lead: string; obj?: string; tail?: string } {
  const n = e.involved.kind === 'Pod' ? short(e.involved.name) : e.involved.name
  switch (e.reason) {
    case 'Existing':
      return { lead: e.involved.kind === 'Service' ? 'Service' : e.involved.kind, obj: n, tail: e.involved.kind === 'Service' ? 'já existia' : 'já estava rodando' }
    case 'Created':
      return { lead: 'Você criou', obj: `${e.involved.kind === 'Pod' ? 'pod' : 'service'}/${e.involved.name}` }
    case 'Labeled':
      return { lead: 'Você trocou a label de', obj: n, tail: e.message.split(`${e.involved.name} `)[1] }
    case 'SelectorChanged':
      return { lead: 'Você mudou o selector', tail: `→ ${e.message.split('→ ')[1]}` }
    case 'ImageChanged':
      return { lead: 'Você pediu', obj: e.message.split('→ ')[1] }
    case 'RolledBack':
      return { lead: 'Você fez rollback para', obj: e.message.split('back to ')[1] }
    case 'NewReplicaSet':
      return { lead: 'ReplicaSet novo para', obj: e.message.split(' for ')[1] }
    case 'RolloutComplete':
      return { lead: 'Rollout concluído', tail: `revisão ${e.message.match(/revision (\d+)/)?.[1] ?? ''}` }
    case 'Orphaned':
      return { lead: 'Pod', obj: n, tail: 'liberado pelo ReplicaSet' }
    case 'Adopted':
      return { lead: 'Pod', obj: n, tail: 'adotado pelo ReplicaSet' }
    case 'EndpointAdded':
      return { lead: 'Pod', obj: n, tail: 'agora recebe tráfego' }
    case 'EndpointRemoved':
      return { lead: 'Pod', obj: n, tail: 'parou de receber tráfego' }
    case 'BackOff':
      return { lead: 'Pod', obj: n, tail: 'quebrou — aguardando para reiniciar' }
    case 'Applied':
      return { lead: 'Você aplicou', obj: 'backend.yaml' }
    case 'Scaled':
      return { lead: 'Você mudou as réplicas', tail: e.message.split('replicas ')[1] }
    case 'Deleted':
      return { lead: 'Você apagou', obj: e.involved.kind === 'Pod' ? n : `${({ Service: 'service', Deployment: 'deployment', ReplicaSet: 'rs', ConfigMap: 'configmap', HorizontalPodAutoscaler: 'hpa', Secret: 'secret', Job: 'job' } as Record<string, string>)[e.involved.kind] ?? ''}/${n}` }
    case 'Restarted':
      return { lead: 'Você reiniciou', obj: `deployment/${n}`, tail: '— todos os Pods serão trocados' }
    case 'Paused':
      return { lead: 'Você pausou', obj: `deployment/${n}` }
    case 'Resumed':
      return { lead: 'Você retomou', obj: `deployment/${n}` }
    case 'ConfigCreated':
      return { lead: 'Você criou', obj: `configmap/${n}` }
    case 'ConfigUpdated':
      return { lead: 'Você mudou', obj: `configmap/${n}`, tail: '— os Pods rodando não percebem' }
    case 'TemplateChanged':
      return { lead: 'Template novo em', obj: `deployment/${n}`, tail: e.message.includes('configMapRef') ? '— agora lê um ConfigMap' : undefined }
    case 'Failed':
      return { lead: 'Pod', obj: n, tail: 'sem configuração — CreateContainerConfigError' }
    case 'Completed':
      return { lead: 'Job', obj: n, tail: 'concluído — todas as tarefas terminaram' }
    case 'JobCreated':
      return { lead: 'Você criou', obj: `job/${n}` }
    case 'DaemonSetCreated':
      return { lead: 'Você criou', obj: `daemonset/${n}`, tail: '— um Pod por node' }
    case 'NodeNotSchedulable':
      return { lead: 'Node', obj: n, tail: 'em cordon — SchedulingDisabled' }
    case 'NodeSchedulable':
      return { lead: 'Node', obj: n, tail: 'liberado para novos Pods' }
    case 'Evicted':
      return { lead: 'Pod', obj: n, tail: 'despejado para manutenção' }
    case 'TaskSucceeded':
      return { lead: 'Pod', obj: n, tail: 'terminou a tarefa — Completed' }
    case 'TaskFailed':
      return { lead: 'Pod', obj: n, tail: 'falhou — saiu com código 1' }
    case 'BackoffLimitExceeded':
      return { lead: 'Job', obj: n, tail: 'desistiu: backoffLimit atingido' }
    case 'SecretCreated':
      return { lead: 'Você criou', obj: `secret/${n}` }
    case 'HpaCreated':
      return { lead: 'Você criou um HPA para', obj: `deployment/${n}` }
    case 'SuccessfulRescale': {
      const m = e.message.match(/New size: (\d+)/)
      return { lead: 'HPA', obj: n, tail: `ajustou para ${m?.[1]} réplicas — CPU ${e.message.includes('above') ? 'acima' : 'abaixo'} da meta` }
    }
    case 'FailedGetResourceMetric':
      return { lead: 'HPA', obj: n, tail: 'não consegue medir: falta request de CPU' }
    case 'FailedScheduling':
      return { lead: 'Pod', obj: n, tail: 'sem node com CPU livre — Pending' }
    case 'GarbageCollecting':
      return { lead: 'Sem dono vivo:', obj: `rs/${n}`, tail: 'vai ser apagado, com os Pods' }
    case 'GarbageCollected':
      return { lead: 'ReplicaSet', obj: n, tail: 'removido' }
    case 'ScalingReplicaSet': {
      const count = e.message.split(' to ').pop() ?? ''
      return { lead: 'ReplicaSet ajustado para', obj: `${count} ${plural(count, 'réplica', 'réplicas')}` }
    }
    case 'Reconciling': {
      const m = e.message.match(/(creating|terminating) (\d+)/)
      const tail = m ? `${m[1] === 'creating' ? 'criando' : 'encerrando'} ${m[2]} ${plural(m[2], 'Pod', 'Pods')}` : undefined
      return { lead: 'Desired ≠ Actual', tail }
    }
    case 'SuccessfulCreate':
      return { lead: 'Pod', obj: n, tail: 'criado' }
    case 'Scheduled':
      return { lead: 'Pod', obj: n, tail: `→ ${e.message.split(' ').pop()}` }
    case 'Pulled':
      return { lead: 'Imagem pronta para', obj: n }
    case 'Started':
      return { lead: e.message.includes('restart') ? 'Container reiniciado em' : 'Container iniciado em', obj: n }
    case 'Ready':
      return { lead: 'Pod', obj: n, tail: 'está Ready' }
    case 'Killing':
      return { lead: 'Pod', obj: n, tail: 'encerrando' }
    case 'Removed':
      return { lead: 'Pod', obj: n, tail: 'removido' }
    case 'Reconciled': {
      const m = e.message.match(/(\d+)\/(\d+)/)
      return { lead: 'Reconciliado', tail: m ? `${m[1]}/${m[2]} Pods Ready` : undefined }
    }
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
    <li
      onMouseEnter={() => hover(e.involved.uid)}
      onMouseLeave={() => hover(null)}
      onClick={() => exists && select(e.involved.uid)}
      title={`${e.reason}: ${e.message}`}
      className={cn('anim-row-in group relative grid cursor-default grid-cols-[52px_14px_1fr] items-start gap-x-2 rounded-md px-2 py-[5px] transition-colors hover:bg-raised', exists && 'cursor-pointer')}
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
    </li>
  )
})

/** Events on screen at once; older ones load on request. */
const WINDOW = 200

export function Timeline() {
  const events = useSim((s) => s.events)
  const cluster = useSim((s) => s.cluster)
  const wallStart = useSim((s) => s.wallStart)
  const ref = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const prevLen = useRef(events.length)
  // how many of the latest events are on screen: a long session has thousands, and rendering them
  // all made every update slower the longer you used the app
  const [shown, setShown] = useState(WINDOW)
  const visible = events.length > shown ? events.slice(-shown) : events
  const hidden = events.length - visible.length

  // the list scrolls from the bottom (column-reverse): at the bottom it stays there as events
  // arrive, without reading the layout; scrolled up, it stays put and counts what's new
  useEffect(() => {
    // read the difference now: the updater runs later, after prevLen has moved on
    const arrived = events.length - prevLen.current
    if (!pinned && arrived > 0) setUnseen((n) => n + arrived)
    prevLen.current = events.length
  }, [events, pinned])

  useEffect(() => {
    if (pinned) setUnseen(0)
  }, [pinned])

  const exists = (uid: string) => !!(cluster.pods[uid] || cluster.replicaSets[uid] || cluster.deployments[uid] || cluster.services[uid])

  return (
    <section className="relative flex min-h-0 flex-1 flex-col" aria-label="Histórico do cluster" data-tour="timeline">
      <header className="flex h-10 shrink-0 items-center gap-2 px-4">
        <History size={14} className="text-fg-faint" />
        <h2 className="text-[12px] font-semibold tracking-tight">Histórico do cluster</h2>
        <span className="ml-auto rounded-full bg-panel-2 px-1.5 font-mono text-[10.5px] text-fg-faint tabular-nums">{events.length}</span>
      </header>
      <div
        ref={ref}
        onScroll={(e) => {
          // column-reverse: 0 is the bottom, scrolling up goes negative
          const atBottom = Math.abs(e.currentTarget.scrollTop) < 24
          if (atBottom !== pinned) setPinned(atBottom)
        }}
        className="flex min-h-0 flex-1 flex-col-reverse overflow-auto px-2 pb-4"
      >
        <div>
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShown((n) => n + WINDOW)}
            className="mx-2 mb-1 rounded-md px-2 py-1 text-[11px] text-fg-muted transition hover:bg-raised hover:text-fg"
          >
            Mostrar {Math.min(hidden, WINDOW)} eventos anteriores ({hidden} ocultos)
          </button>
        )}
        {events.length === 0 ? (
          <div className="mx-2 mt-2 rounded-lg border border-dashed border-line px-4 py-6 text-center">
            <p className="text-[12px] text-fg-muted">Nenhum histórico ainda.</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-fg-faint">Toda mudança no cluster — as suas e as dos controllers — aparece aqui, em ordem.</p>
          </div>
        ) : (
          <ol>
            {visible.map((e, i) => {
              const time = clockTime(wallStart, e.at)
              const prevTime = i > 0 ? clockTime(wallStart, visible[i - 1].at) : ''
              return <Row key={e.id} e={e} time={time} showTime={time !== prevTime} exists={exists(e.involved.uid)} isLast={i === visible.length - 1} />
            })}
          </ol>
        )}
        </div>
      </div>
      <AnimatePresence>
        {!pinned && unseen > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            onClick={() => {
              // straight to the newest, pinned at once: a smooth scroll gets cut short while events keep arriving
              setPinned(true)
              if (ref.current) ref.current.scrollTop = 0
            }}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line-strong bg-raised px-2.5 py-1 text-[11px] text-fg shadow-lg shadow-black/40"
          >
            <ArrowDown size={12} /> {unseen} {unseen === 1 ? 'novo' : 'novos'}
          </motion.button>
        )}
      </AnimatePresence>
    </section>
  )
}
