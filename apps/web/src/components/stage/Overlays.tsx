import { AnimatePresence, motion } from 'motion/react'
import { CircleCheck, FileCode2, Lightbulb, Play, RefreshCw, Server, TriangleAlert } from 'lucide-react'
import { useRef, useState } from 'react'
import { MANIFEST_YAML } from '../../sim/kubectl'
import { labelString } from '../../sim/engine'
import type { ClusterState, ControllerPhase } from '../../sim/types'
import { cn, podVisual, VISUAL, type Layout, type PodVisual } from '../../lib/visual'
import { useSim } from '../../store/useSim'
import { StatusGlyph } from '../primitives'
import { PhasePill } from './Nodes'
import type { EdgeModel } from './Edges'
import { GlossaryText } from '../GlossaryText'

const panel = 'rounded-xl border border-line bg-panel/90 shadow-[0_12px_40px_-16px_rgb(0_0_0/0.8)] backdrop-blur-[6px]'

// ── Desired vs Actual ──────────────────────────────────────────────────────

export function ReconcileHud({ cluster, layout, replicaControl }: { cluster: ClusterState; layout: Layout; replicaControl: boolean }) {
  const dep = Object.values(cluster.deployments)[0]
  if (!dep) return null
  const rss = Object.values(cluster.replicaSets).filter((r) => r.ownerUid === dep.uid)
  const ids = new Set(rss.map((r) => r.uid))
  const pods = Object.values(cluster.pods).filter((p) => p.ownerUid && ids.has(p.ownerUid))
  const active = pods.filter((p) => p.deletedAt === null)
  const slots = layout.slots.filter((s) => ids.has(s.ownerUid))
  const phase: ControllerPhase = rss.some((r) => r.phase === 'reconciling') ? 'reconciling' : rss.some((r) => r.phase === 'diverged') ? 'diverged' : 'idle'

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className={cn(panel, 'w-[212px] px-3 py-2.5')}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-fg">{dep.name}</span>
        {dep.rollout === 'complete' ? <PhasePill phase={phase} /> : <RolloutPill stalled={dep.rollout === 'stalled'} />}
      </div>
      <div className="mt-2 flex items-end gap-2 font-mono">
        <Count label="Desired" value={dep.replicas} />
        <span className="pb-1 text-fg-faint">{active.length === dep.replicas ? '=' : '≠'}</span>
        <Count label="Actual" value={active.length} warn={active.length !== dep.replicas} />
      </div>
      <div className="mt-2.5 flex min-h-[18px] flex-wrap gap-1.5" aria-label="Slots de réplicas">
        {slots.map((s) => {
          const pod = pods.find((p) => p.ownerUid === s.ownerUid && p.slot === s.slot)
          return (
            <span key={`${s.ownerUid}:${s.slot}`} className="relative grid size-[18px] place-items-center">
              <AnimatePresence mode="popLayout" initial={false}>
                {pod ? (
                  <motion.span key={pod.uid} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0, opacity: 0 }} className="absolute inset-0 grid place-items-center">
                    <StatusGlyph state={podVisual(pod)} size={15} />
                  </motion.span>
                ) : (
                  <motion.span key="empty" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute inset-[2px] rounded-full border border-dashed border-fg-faint" />
                )}
              </AnimatePresence>
            </span>
          )
        })}
        {!slots.length && <span className="text-[11px] text-fg-faint">nenhum Pod</span>}
      </div>
      {replicaControl && <ReplicaControl name={dep.name} replicas={dep.replicas} />}
    </motion.div>
  )
}

/** "Drag replicas" — change the desired state directly, before learning the command for it. */
function ReplicaControl({ name, replicas }: { name: string; replicas: number }) {
  const exec = useSim((s) => s.exec)
  const [draft, setDraft] = useState<number | null>(null)
  const keyTimer = useRef<number | undefined>(undefined)
  const value = draft ?? replicas
  const commit = () => {
    clearTimeout(keyTimer.current)
    if (draft !== null && draft !== replicas) exec(`kubectl scale deployment ${name} --replicas=${draft}`, 'ui')
    setDraft(null)
  }
  return (
    <div className="mt-3 border-t border-line pt-2.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor="replica-control" className="text-[10px] font-semibold tracking-[0.08em] text-deploy uppercase">
          Arraste as réplicas
        </label>
        <span className="font-mono text-[11px] text-fg-muted">
          {draft !== null && draft !== replicas ? (
            <>
              {replicas} → <span className="text-deploy">{draft}</span>
            </>
          ) : (
            value
          )}
        </span>
      </div>
      <input
        id="replica-control"
        type="range"
        min={0}
        max={8}
        step={1}
        value={value}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={(e) => {
          // keyboard users get a short grace period, so 3 → 5 is one change, not two
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
            clearTimeout(keyTimer.current)
            keyTimer.current = window.setTimeout(commit, 650)
          }
        }}
        onBlur={commit}
        className="kl-range mt-1.5 w-full"
        style={{ '--fill': `${(value / 8) * 100}%` } as React.CSSProperties}
        aria-valuetext={`${value} réplicas`}
      />
      <div className="mt-0.5 flex justify-between font-mono text-[9.5px] text-fg-faint">
        <span>0</span>
        <span>8</span>
      </div>
    </div>
  )
}

function RolloutPill({ stalled }: { stalled: boolean }) {
  const color = stalled ? 'var(--color-crash)' : 'var(--color-accent)'
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[10.5px] font-medium"
      style={{ color, borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, background: `color-mix(in oklab, ${color} 9%, transparent)` }}
    >
      {stalled ? <span className="size-1.5 rounded-full bg-current" /> : <RefreshCw size={10.5} strokeWidth={2.5} className="anim-spin" />}
      {stalled ? 'Rollout travado' : 'Rollout em andamento'}
    </span>
  )
}

function Count({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="font-sans text-[9.5px] font-medium tracking-[0.08em] text-fg-faint uppercase">{label}</span>
      <motion.span
        key={value}
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1, color: warn ? 'var(--color-warn)' : 'var(--color-fg)' }}
        transition={{ type: 'spring', stiffness: 400, damping: 26 }}
        className="text-[24px] leading-none font-semibold tabular-nums"
      >
        {value}
      </motion.span>
    </div>
  )
}

// ── Contextual explanation ─────────────────────────────────────────────────

export function Narration() {
  const latest = useSim((s) => s.narration[s.narration.length - 1])
  if (!latest) return null
  const Icon = latest.tone === 'success' ? CircleCheck : latest.tone === 'warn' ? RefreshCw : latest.tone === 'error' ? TriangleAlert : Lightbulb
  const color =
    latest.tone === 'success' ? 'var(--color-ready)' : latest.tone === 'warn' ? 'var(--color-warn)' : latest.tone === 'error' ? 'var(--color-crash)' : 'var(--color-accent)'
  return (
    <div aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={latest.id}
          layout
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98, transition: { duration: 0.18 } }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          className={cn(panel, 'relative overflow-hidden px-3.5 py-2.5')}
        >
          <div className="flex items-center gap-2">
            <span className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold" style={{ color }}>
              <Icon size={14} strokeWidth={2.2} className={cn('shrink-0', latest.tone === 'warn' && latest.title === 'Reconciling' && 'anim-spin')} />
              <span className="truncate">{latest.title}</span>
            </span>
            {latest.metrics && (
              <span className="ml-auto flex shrink-0 gap-3 font-mono text-[11px]">
                <span>
                  <span className="text-fg-faint">desired </span>
                  <span className="text-fg">{latest.metrics.desired}</span>
                </span>
                <span>
                  <span className="text-fg-faint">actual </span>
                  <span style={{ color: latest.metrics.actual === latest.metrics.desired ? 'var(--color-ready)' : 'var(--color-warn)' }}>{latest.metrics.actual}</span>
                </span>
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] leading-[1.55] text-fg-muted"><GlossaryText>{latest.body}</GlossaryText></p>
          {latest.command && <NarrationCommand command={latest.command} />}
          {/* a thin timer bar, so it's clear this note belongs to *this* moment */}
          <motion.span
            className="absolute inset-x-0 bottom-0 h-px origin-left"
            style={{ background: color, opacity: 0.5 }}
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: 6, ease: 'linear' }}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** "Here's how you'd say that in kubectl" — offered after the concept, never before. */
function NarrationCommand({ command }: { command: string }) {
  const setDraft = useSim((s) => s.setDraft)
  return (
    <button
      onClick={() => setDraft(command)}
      className="group mt-2 flex w-full items-center gap-2 rounded-md border border-line bg-bg/50 px-2 py-1 text-left transition hover:border-accent/40"
      title="Colocar este comando no terminal"
    >
      <span className="shrink-0 text-[10.5px] text-fg-faint">em kubectl</span>
      <code className="min-w-0 truncate font-mono text-[11px] text-fg-muted group-hover:text-fg">{command}</code>
    </button>
  )
}

// ── Worker nodes ───────────────────────────────────────────────────────────

export function NodeLane({ cluster }: { cluster: ClusterState }) {
  const select = useSim((s) => s.select)
  return (
    <div className={cn(panel, 'flex items-center gap-4 px-3 py-2')}>
      <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.1em] text-fg-faint uppercase">
        <Server size={11} /> Nodes
      </span>
      {cluster.nodes.map((n) => {
        const pods = Object.values(cluster.pods).filter((p) => p.nodeName === n.name)
        return (
          <div key={n.name} className="flex h-[18px] items-center gap-1.5">
            <span className="font-mono text-[11px] text-fg-muted">{n.name}</span>
            <div className="flex min-w-[14px] gap-0.5">
              <AnimatePresence initial={false}>
                {pods.map((p) => (
                  <motion.button
                    key={p.uid}
                    layout
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    onClick={() => select(p.uid)}
                    className="grid place-items-center"
                    aria-label={p.name}
                  >
                    <StatusGlyph state={podVisual(p)} size={13} />
                  </motion.button>
                ))}
              </AnimatePresence>
              {!pods.length && <span className="text-[10.5px] text-fg-faint">—</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function Legend() {
  const states: PodVisual[] = ['pending', 'creating', 'running', 'ready', 'crash', 'terminating']
  return (
    <div className="flex flex-col gap-1">
      {states.map((s) => (
        <span key={s} className="flex cursor-help items-center gap-1.5 text-[10.5px] text-fg-faint transition-colors hover:text-fg-muted" title={VISUAL[s].hint}>
          <StatusGlyph state={s} size={11} />
          {s === 'creating' ? 'Creating' : s === 'crash' ? 'Crash' : VISUAL[s].label}
        </span>
      ))}
    </div>
  )
}

// ── Edge tooltip ───────────────────────────────────────────────────────────

export function EdgeTooltip({ edge, cluster }: { edge: EdgeModel | null; cluster: ClusterState }) {
  const name = (uid: string) =>
    cluster.deployments[uid]?.name ?? cluster.replicaSets[uid]?.name ?? cluster.pods[uid]?.name ?? cluster.services[uid]?.name ?? '?'
  const content = (e: EdgeModel) => {
    if (e.kind === 'svc-pod') {
      const svc = cluster.services[e.from]
      return (
        <>
          <div className="text-fg">
            <span className="text-svc">Service</span> seleciona <span className="font-mono">{name(e.to)}</span>
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-fg-faint">o selector {svc ? labelString(svc.selector) : ''} combina com as labels dele</div>
          <div className="mt-1 text-[11px] text-fg-muted">
            {e.state === 'stable' ? 'Ele está Ready, então é um endpoint e recebe requisições.' : 'Ele combina, mas não está Ready — por isso ainda não recebe tráfego.'}
          </div>
        </>
      )
    }
    const owner = e.kind === 'dep-rs' ? 'Deployment' : 'ReplicaSet'
    return (
      <>
        <div className="text-fg">
          <span style={{ color: e.kind === 'dep-rs' ? 'var(--color-deploy)' : 'var(--color-rs)' }}>{owner}</span> é dono de <span className="font-mono">{name(e.to)}</span>
        </div>
        <div className="mt-0.5 font-mono text-[10.5px] text-fg-faint">
          ownerReferences → {owner}/{name(e.from)}
        </div>
        <div className="mt-1 text-[11px] text-fg-muted">
          {e.kind === 'dep-rs' ? 'O Deployment gerencia os Pods por meio deste ReplicaSet.' : 'Se este Pod sumir, o dono percebe e o substitui.'}
        </div>
      </>
    )
  }
  return (
    <AnimatePresence>
      {edge && (
        <motion.div
          key={edge.id}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          className="pointer-events-none absolute z-20 w-max max-w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line-strong bg-raised px-3 py-2 text-[12px] shadow-xl shadow-black/50"
          style={{ left: edge.mid.x, top: edge.mid.y }}
        >
          {content(edge)}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Empty & loading states ─────────────────────────────────────────────────

export function EmptyState() {
  const exec = useSim((s) => s.exec)
  const [showYaml, setShowYaml] = useState(false)
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 220, damping: 26 }}
      className="flex max-w-[440px] flex-col items-center px-6 text-center"
    >
      <div className="relative mb-5 flex gap-3">
        {['node-1', 'node-2', 'node-3'].map((n, i) => (
          <motion.div
            key={n}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.07 }}
            className="flex h-[54px] w-[78px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong"
          >
            <Server size={13} className="text-fg-faint" />
            <span className="font-mono text-[10px] text-fg-faint">{n}</span>
          </motion.div>
        ))}
      </div>
      <h2 className="text-[17px] font-semibold tracking-tight">O cluster está rodando — e vazio.</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
        Três nodes esperando trabalho. Descreva o que você quer — um Deployment com 3 réplicas — e veja os controllers tornarem isso real.
      </p>
      <div className="mt-5 flex items-center gap-2">
        <button
          onClick={() => exec('kubectl apply -f backend.yaml', 'ui')}
          className="group flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-[#0b1020] shadow-[0_6px_20px_-8px_var(--color-accent)] transition hover:brightness-110 active:scale-[0.98]"
        >
          <Play size={14} fill="currentColor" /> Aplicar backend.yaml
        </button>
        <button
          onClick={() => setShowYaml((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-[13px] text-fg-muted transition hover:border-fg-faint hover:text-fg"
        >
          <FileCode2 size={14} /> {showYaml ? 'Esconder' : 'Ver'} manifesto
        </button>
      </div>
      <p className="mt-3 text-[11.5px] text-fg-faint">
        ou digite <code className="font-mono text-fg-muted">kubectl apply -f backend.yaml</code> no terminal
      </p>
      <AnimatePresence>
        {showYaml && (
          <motion.pre
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 w-full overflow-hidden rounded-lg border border-line bg-panel text-left font-mono text-[11px] leading-[1.6] text-fg-muted"
          >
            <div className="max-h-[220px] overflow-auto p-3">
              {MANIFEST_YAML.split('\n').map((l, i) => (
                <div key={i} className={cn(/replicas|app: backend/.test(l) && 'text-accent')}>
                  {l || ' '}
                </div>
              ))}
            </div>
          </motion.pre>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export function BootSkeleton() {
  return (
    <motion.div exit={{ opacity: 0, transition: { duration: 0.25 } }} className="flex flex-col items-center gap-4">
      <div className="flex gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-[54px] w-[78px] rounded-lg" />
        ))}
      </div>
      <div className="skeleton h-3 w-56 rounded" />
      <div className="skeleton h-3 w-40 rounded" />
      <span className="mt-1 text-[11.5px] text-fg-faint">Preparando o cluster de treino…</span>
    </motion.div>
  )
}
