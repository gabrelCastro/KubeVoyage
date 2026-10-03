import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight, FileText, Minus, MousePointerClick, Plus, ScrollText, Trash2, Wrench, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { isBroken, matches, rsSelector, sameTemplate, short } from '../sim/engine'
import type { ClusterEvent, ClusterState, Deployment, Labels, Pod, ReplicaSet, Service } from '../sim/types'
import { cn, kindOf, podLabel, podVisual, VISUAL } from '../lib/visual'
import { APP_EMOJIS, designForPod, LIMITS, useApp } from '../store/useApp'
import { clockTime, useSim } from '../store/useSim'
import { KindBadge, LabelChip, StatusGlyph } from './primitives'
import { PhasePill } from './stage/Nodes'
import { GlossaryText } from './GlossaryText'

export function Inspector() {
  const selected = useSim((s) => s.selected)
  const cluster = useSim((s) => s.cluster)
  const kind = selected ? kindOf(cluster, selected) : null
  const [tab, setTab] = useState<'overview' | 'yaml'>('overview')

  return (
    <section className="flex max-h-[58%] min-h-0 shrink-0 flex-col border-b border-line" aria-label="Inspetor" data-tour="inspetor">
      <AnimatePresence mode="wait" initial={false}>
        {!selected || !kind ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-start gap-3 px-4 py-4"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-dashed border-line-strong text-fg-faint">
              <MousePointerClick size={15} />
            </span>
            <div>
              <p className="text-[12.5px] font-medium text-fg-muted">Nada selecionado</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-faint"><GlossaryText>Clique em qualquer recurso no palco. A cadeia de ownership dele acende; o resto fica em segundo plano.</GlossaryText></p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={selected}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="flex min-h-0 flex-col"
          >
            <Header uid={selected} cluster={cluster} tab={tab} setTab={setTab} />
            <div className="min-h-0 overflow-auto px-4 pt-1 pb-4">
              {tab === 'yaml' ? (
                <Yaml cluster={cluster} uid={selected} />
              ) : kind === 'Pod' ? (
                <PodView pod={cluster.pods[selected]} cluster={cluster} />
              ) : kind === 'ReplicaSet' ? (
                <RSView rs={cluster.replicaSets[selected]} cluster={cluster} />
              ) : kind === 'Service' ? (
                <ServiceView svc={cluster.services[selected]} cluster={cluster} />
              ) : (
                <DeploymentView dep={cluster.deployments[selected]} cluster={cluster} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function Header({ uid, cluster, tab, setTab }: { uid: string; cluster: ClusterState; tab: string; setTab: (t: 'overview' | 'yaml') => void }) {
  const select = useSim((s) => s.select)
  const kind = kindOf(cluster, uid)!
  const r = cluster.pods[uid] ?? cluster.replicaSets[uid] ?? cluster.deployments[uid] ?? cluster.services[uid]
  return (
    <div className="px-4 pt-3">
      <div className="flex items-center justify-between">
        <KindBadge kind={kind} />
        <button onClick={() => select(null)} className="rounded p-0.5 text-fg-faint transition hover:bg-raised hover:text-fg" aria-label="Fechar inspetor">
          <X size={14} />
        </button>
      </div>
      <div className="mt-1 truncate font-mono text-[13.5px] font-medium text-fg" title={r.name}>
        {r.name}
      </div>
      <Breadcrumb uid={uid} cluster={cluster} />
      <div className="mt-2.5 flex gap-4 border-b border-line text-[11.5px]">
        {(['overview', 'yaml'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('relative pb-1.5 capitalize transition-colors', tab === t ? 'text-fg' : 'text-fg-faint hover:text-fg-muted')}>
            {t === 'yaml' ? 'YAML' : 'Visão geral'}
            {tab === t && <motion.span layoutId="inspector-tab" className="absolute inset-x-0 -bottom-px h-px bg-accent" />}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Ownership as a path you can walk: Deployment › ReplicaSet › Pod. */
function Breadcrumb({ uid, cluster }: { uid: string; cluster: ClusterState }) {
  const select = useSim((s) => s.select)
  const chain: { uid: string; label: string }[] = []
  let cur: string | null = uid
  while (cur) {
    const r = (cluster.pods[cur] ?? cluster.replicaSets[cur] ?? cluster.deployments[cur]) as Deployment | ReplicaSet | Pod | undefined
    if (!r) break
    chain.unshift({ uid: cur, label: r.kind === 'Pod' ? short(r.name) : r.kind === 'ReplicaSet' ? `rs/${r.hash}` : `deploy/${r.name}` })
    cur = r.kind === 'Deployment' ? null : r.ownerUid
  }
  if (chain.length < 2) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-0.5 font-mono text-[10.5px] text-fg-faint">
      {chain.map((c, i) => (
        <span key={c.uid} className="flex items-center gap-0.5">
          {i > 0 && <ChevronRight size={10} />}
          <button onClick={() => select(c.uid)} className={cn('rounded px-0.5 transition hover:bg-raised hover:text-fg', c.uid === uid && 'text-fg-muted')}>
            {c.label}
          </button>
        </span>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="mb-1.5 text-[10px] font-semibold tracking-[0.1em] text-fg-faint uppercase">{title}</h3>
      {children}
    </div>
  )
}

function Props({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[88px_1fr] gap-y-1 text-[12px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-faint">{k}</dt>
          <dd className="min-w-0 truncate font-mono text-[11.5px] text-fg-muted">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function LabelList({ labels, highlight }: { labels: Labels; highlight?: Labels }) {
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(labels).map(([k, v]) => (
        <LabelChip key={k} k={k} v={v} tone={highlight?.[k] === v ? 'match' : 'neutral'} />
      ))}
    </div>
  )
}

// ── Pod ────────────────────────────────────────────────────────────────────

function PodView({ pod, cluster }: { pod: Pod; cluster: ClusterState }) {
  const events = useSim((s) => s.events)
  const wallStart = useSim((s) => s.wallStart)
  const exec = useSim((s) => s.exec)
  const v = podVisual(pod)
  const meta = VISUAL[v]
  const rs = pod.ownerUid ? cluster.replicaSets[pod.ownerUid] : undefined
  const mine = events.filter((e) => e.involved.uid === pod.uid)
  const at = (reason: string) => mine.find((e) => e.reason === reason)

  const steps: { label: string; e?: ClusterEvent; detail?: string }[] = [
    { label: 'Criado', e: at('SuccessfulCreate'), detail: 'pelo ReplicaSet' },
    { label: 'Agendado', e: at('Scheduled'), detail: pod.nodeName ?? undefined },
    { label: 'Iniciado', e: at('Started'), detail: pod.ip ?? undefined },
    { label: 'Ready', e: at('Ready'), detail: 'readiness probe passou' },
  ]
  const created = steps[0].e?.at ?? pod.createdAt

  return (
    <>
      <div className="mt-3 flex items-start gap-2.5 rounded-lg border px-3 py-2.5" style={{ borderColor: `color-mix(in oklab, ${meta.color} 25%, var(--color-line))`, background: `color-mix(in oklab, ${meta.color} 5%, transparent)` }}>
        <span className="mt-0.5">
          <StatusGlyph state={v} size={16} />
        </span>
        <div>
          <div className="text-[13px] font-semibold" style={{ color: meta.color }}>
            {podLabel(pod)}
          </div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-muted">
            {pod.waiting
              ? `O kubelet não consegue criar o container: o ConfigMap ${pod.configMap} não existe. Ele tenta de novo sozinho — crie o ConfigMap e o Pod segue.`
              : pod.hung
                ? pod.liveness
                  ? 'Travou: o processo está vivo, mas não responde. A liveness probe vai falhar e o kubelet vai reiniciar o container.'
                  : 'Travou: o processo está vivo, mas não responde. A readiness o tirou do Service — e sem liveness probe, nada vai reiniciá-lo.'
                : meta.hint}
          </p>
        </div>
      </div>

      <Section title="Ciclo de vida">
        <ol className="relative ml-1">
          {steps.map((s, i) => {
            const done = !!s.e
            const current = !done && (i === 0 || !!steps[i - 1].e) && v !== 'terminating'
            return (
              <li key={s.label} className="relative flex items-start gap-2.5 pb-2 last:pb-0">
                {i < steps.length - 1 && <span className={cn('absolute top-3 left-[4.5px] h-full w-px', done ? 'bg-ready/40' : 'bg-line')} />}
                <motion.span
                  className="relative mt-[3px] size-[10px] shrink-0 rounded-full border"
                  initial={false}
                  animate={{
                    backgroundColor: done ? 'var(--color-ready)' : 'rgba(0,0,0,0)',
                    borderColor: done ? 'var(--color-ready)' : current ? meta.color : 'var(--color-line-strong)',
                    scale: current ? [1, 1.25, 1] : 1,
                  }}
                  transition={current ? { scale: { repeat: Infinity, duration: 1.2 } } : { duration: 0.3 }}
                />
                <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2 text-[12px]">
                  <span className={cn(done ? 'text-fg' : current ? 'text-fg-muted' : 'text-fg-faint')}>
                    {s.label}
                    {done && s.detail && <span className="ml-1.5 font-mono text-[10.5px] text-fg-faint">{s.detail}</span>}
                  </span>
                  <span className="font-mono text-[10.5px] text-fg-faint tabular-nums">{s.e ? `+${((s.e.at - created) / 1000).toFixed(1)}s` : ''}</span>
                </div>
              </li>
            )
          })}
          {v === 'terminating' && (
            <motion.li initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="relative mt-2 flex items-center gap-2.5 text-[12px] text-terminating">
              <span className="size-[10px] rounded-full border border-dashed border-terminating" /> Terminating
            </motion.li>
          )}
        </ol>
      </Section>

      <Section title="Detalhes">
        <Props
          rows={[
            ['Node', pod.nodeName ?? '—'],
            ['Pod IP', pod.ip ?? '—'],
            ['Criado em', clockTime(wallStart, pod.createdAt)],
            ['Reinícios', String(pod.restarts)],
            ['Imagem', pod.image.split('/').pop()],
          ]}
        />
      </Section>

      <HandEdit pod={pod} />

      <Section title="Labels">
        <EditableLabels
          labels={pod.labels}
          highlight={rs ? rsSelector(rs) : undefined}
          disabled={v === 'terminating'}
          onCommit={(k, val) => exec(`kubectl label pod ${pod.name} ${k}=${val} --overwrite`, 'ui')}
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-fg-faint">
          {rs
            ? 'As labels destacadas combinam com o selector do ReplicaSet — é assim que ele reconhece este Pod como seu. Clique num valor para mudar.'
            : 'Este Pod não tem dono. Se ele morrer, nada o substitui. Clique num valor para mudar.'}
        </p>
      </Section>

      <div className="mt-4 flex gap-2">
        <button
          disabled={v === 'terminating'}
          onClick={() => exec(`kubectl delete pod ${pod.name}`, 'ui')}
          className="flex items-center gap-1.5 rounded-lg border border-terminating/35 bg-terminating/10 px-2.5 py-1.5 text-[12px] font-medium text-terminating transition hover:bg-terminating/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 size={13} /> {v === 'terminating' ? 'Encerrando…' : 'Apagar Pod'}
        </button>
        <button
          onClick={() => exec(`kubectl describe pod ${pod.name}`, 'ui')}
          className="flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-[12px] text-fg-muted transition hover:text-fg"
        >
          <FileText size={13} /> Describe
        </button>
        <button
          disabled={v === 'pending' || v === 'creating'}
          onClick={() => exec(`kubectl logs ${pod.name}`, 'ui')}
          className={cn(
            'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition disabled:opacity-40',
            v === 'crash' ? 'border-crash/40 text-crash hover:bg-crash/10' : 'border-line-strong text-fg-muted hover:text-fg',
          )}
        >
          <ScrollText size={13} /> Logs
        </button>
      </div>
    </>
  )
}

// ── Service ────────────────────────────────────────────────────────────────

function ServiceView({ svc, cluster }: { svc: Service; cluster: ClusterState }) {
  const exec = useSim((s) => s.exec)
  const select = useSim((s) => s.select)
  const pods = Object.values(cluster.pods).filter((p) => p.deletedAt === null)
  const matched = pods.filter((p) => matches(svc.selector, p.labels))
  const none = svc.endpoints.length === 0
  return (
    <>
      <div
        className="mt-3 rounded-lg border px-3 py-2.5"
        style={{
          borderColor: `color-mix(in oklab, ${none ? 'var(--color-crash)' : 'var(--color-svc)'} 28%, var(--color-line))`,
          background: `color-mix(in oklab, ${none ? 'var(--color-crash)' : 'var(--color-svc)'} 5%, transparent)`,
        }}
      >
        <div className="text-[13px] font-semibold" style={{ color: none ? 'var(--color-crash)' : 'var(--color-svc)' }}>
          {none ? 'Sem endpoints' : `${svc.endpoints.length} endpoint${svc.endpoints.length === 1 ? '' : 's'}`}
        </div>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-fg-muted">
          {none
            ? matched.length
              ? `${matched.length} Pod${matched.length === 1 ? '' : 's'} ${matched.length === 1 ? 'combina' : 'combinam'} com o selector, mas nenhum está Ready.`
              : 'Nenhum Pod tem as labels que este selector pede. Toda requisição falha.'
            : 'As requisições para este Service são distribuídas entre estes Pods Ready.'}
        </p>
      </div>

      <Section title="Selector">
        <EditableLabels labels={svc.selector} highlight={svc.selector} onCommit={(k, val) => exec(`kubectl set selector service ${svc.name} ${k}=${val}`, 'ui')} />
        <p className="mt-1.5 text-[11px] leading-relaxed text-fg-faint"><GlossaryText>O Service manda tráfego para todo Pod Ready com estas labels. Clique num valor para mudar.</GlossaryText></p>
      </Section>

      <Section title="Detalhes">
        <Props
          rows={[
            ['Type', 'ClusterIP'],
            ['Cluster IP', svc.clusterIP],
            ['Porta', `${svc.port} → ${svc.targetPort}`],
          ]}
        />
      </Section>

      <Section title={`Pods · ${pods.length}`}>
        <ul className="flex flex-col gap-0.5">
          {pods
            .sort((a, b) => Number(matches(svc.selector, b.labels)) - Number(matches(svc.selector, a.labels)))
            .map((p) => {
              const isMatch = matches(svc.selector, p.labels)
              const isEndpoint = svc.endpoints.includes(p.uid)
              const key = Object.keys(svc.selector)[0]
              return (
                <li key={p.uid}>
                  <button onClick={() => select(p.uid)} className={cn('flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition hover:bg-raised', !isMatch && 'opacity-55')}>
                    <StatusGlyph state={podVisual(p)} size={12} />
                    <span className="font-mono text-[11.5px] text-fg">{short(p.name)}</span>
                    <span className={cn('font-mono text-[10.5px]', isMatch ? 'text-svc' : 'text-fg-faint')}>
                      {key}={p.labels[key] ?? '∅'}
                    </span>
                    <span className={cn('ml-auto text-[11px]', isEndpoint ? 'text-ready' : isMatch ? 'text-warn' : 'text-fg-faint')}>
                      {isEndpoint ? 'endpoint' : isMatch ? 'sem Ready' : 'não combina'}
                    </span>
                  </button>
                </li>
              )
            })}
        </ul>
      </Section>
    </>
  )
}

/** Label chips you can edit in place. Every edit is sent as the kubectl command it equals. */
function EditableLabels({
  labels,
  highlight,
  onCommit,
  disabled,
}: {
  labels: Labels
  highlight?: Labels
  onCommit: (key: string, value: string) => void
  disabled?: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const valid = /^[a-z0-9]([a-z0-9.-]{0,61}[a-z0-9])?$/i.test(value)
  const commit = (k: string) => {
    if (valid && value !== labels[k]) onCommit(k, value)
    setEditing(null)
  }
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(labels).map(([k, v]) =>
        editing === k ? (
          <form
            key={k}
            onSubmit={(e) => (e.preventDefault(), commit(k))}
            className={cn('inline-flex items-center rounded-[5px] border font-mono text-[11px] leading-[18px]', valid ? 'border-accent/60' : 'border-terminating/60')}
          >
            <span className="px-1.5 text-fg-muted">{k}=</span>
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEditing(null))}
              onBlur={() => setEditing(null)}
              size={Math.max(4, value.length + 1)}
              spellCheck={false}
              aria-label={`Novo valor para ${k}`}
              className="bg-transparent pr-1.5 text-fg outline-none focus-visible:outline-none"
            />
          </form>
        ) : (
          <button
            key={k}
            disabled={disabled}
            onClick={() => (setEditing(k), setValue(v))}
            className="group relative rounded-[5px] transition hover:brightness-125 disabled:pointer-events-none"
            title={`Editar ${k}`}
          >
            <LabelChip k={k} v={v} tone={highlight?.[k] === v ? 'match' : 'neutral'} />
          </button>
        ),
      )}
    </div>
  )
}

// ── ReplicaSet ─────────────────────────────────────────────────────────────

function RSView({ rs, cluster }: { rs: ReplicaSet; cluster: ClusterState }) {
  const select = useSim((s) => s.select)
  const pods = Object.values(cluster.pods)
    .filter((p) => p.ownerUid === rs.uid)
    .sort((a, b) => a.slot - b.slot)
  const active = pods.filter((p) => p.deletedAt === null)
  return (
    <>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-5 font-mono">
          {[
            ['Desired', rs.desired],
            ['Actual', active.length],
            ['Ready', active.filter((p) => p.ready).length],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="font-sans text-[9.5px] tracking-[0.08em] text-fg-faint uppercase">{k}</div>
              <div className="text-[18px] font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <PhasePill phase={rs.phase} />
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-fg-faint"><GlossaryText>Um ReplicaSet roda um único ciclo para sempre: conta os Pods que combinam com o selector, compara com o desired state, cria ou apaga a diferença.</GlossaryText></p>
      <Section title="Detalhes">
        <Props rows={[['Imagem', <span key="image" className={cn(isBroken(rs.image) && 'text-crash')}>{rs.image.split('/').pop()}</span>], ['Revisão', String(rs.revision)]]} />
      </Section>
      <Section title="Selector">
        <LabelList labels={rsSelector(rs)} highlight={rs.selector} />
      </Section>
      <Section title={`Pods dele · ${pods.length}`}>
        <ul className="flex flex-col gap-0.5">
          {pods.map((p) => (
            <li key={p.uid}>
              <button onClick={() => select(p.uid)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition hover:bg-raised">
                <StatusGlyph state={podVisual(p)} size={12} />
                <span className="font-mono text-[11.5px] text-fg">{short(p.name)}</span>
                <span className="ml-auto text-[11px] text-fg-faint">{VISUAL[podVisual(p)].label}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}

// ── Deployment ─────────────────────────────────────────────────────────────

function DeploymentView({ dep, cluster }: { dep: Deployment; cluster: ClusterState }) {
  const exec = useSim((s) => s.exec)
  const rs = Object.values(cluster.replicaSets).find((r) => r.ownerUid === dep.uid && !r.deletedAt && sameTemplate(r, dep.template))
  const set = (n: number) => exec(`kubectl scale deployment ${dep.name} --replicas=${n}`, 'ui')
  return (
    <>
      <Section title="Réplicas desejadas">
        <div className="flex items-center gap-3">
          <button disabled={dep.replicas <= 0} onClick={() => set(dep.replicas - 1)} className="grid size-7 place-items-center rounded-md border border-line-strong text-fg-muted transition hover:text-fg disabled:opacity-30" aria-label="Menos réplicas">
            <Minus size={13} />
          </button>
          <div className="flex flex-1 items-center gap-1" role="meter" aria-valuenow={dep.replicas} aria-valuemin={1} aria-valuemax={8}>
            {Array.from({ length: 8 }, (_, i) => (
              <button key={i} onClick={() => set(i + 1)} className="group flex h-7 flex-1 items-center" aria-label={`${i + 1} réplicas`}>
                <motion.span
                  className="h-1.5 w-full rounded-full"
                  initial={false}
                  animate={{ backgroundColor: i < dep.replicas ? 'var(--color-deploy)' : 'var(--color-line)', scaleY: i === dep.replicas - 1 ? 1.6 : 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                />
              </button>
            ))}
          </div>
          <button disabled={dep.replicas >= 8} onClick={() => set(dep.replicas + 1)} className="grid size-7 place-items-center rounded-md border border-line-strong text-fg-muted transition hover:text-fg disabled:opacity-30" aria-label="Mais réplicas">
            <Plus size={13} />
          </button>
          <span className="w-4 text-right font-mono text-[15px] font-semibold">{dep.replicas}</span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-fg-faint"><GlossaryText>Você está editando o desired state. Você nunca cria Pods diretamente — quem cria são os controllers.</GlossaryText></p>
      </Section>
      <Section title="Detalhes">
        <Props
          rows={[
            ['Imagem', <span key="image" className={cn(isBroken(dep.template.image) && 'text-crash')}>{dep.template.image.split('/').pop()}</span>],
            ['Revisão', String(dep.revision)],
            ['Rollout', <span key="rollout" className={cn(dep.rollout === 'stalled' ? 'text-crash' : dep.rollout === 'progressing' ? 'text-accent' : 'text-ready')}>{{ complete: 'concluído', progressing: 'em andamento', stalled: 'travado' }[dep.rollout]}</span>],
            ['Estratégia', 'RollingUpdate 25% / 25%'],
            ['ReplicaSet', rs ? rs.name : '—'],
          ]}
        />
      </Section>
      <Section title="Selector">
        <LabelList labels={dep.selector} highlight={dep.selector} />
      </Section>
    </>
  )
}

// ── YAML ───────────────────────────────────────────────────────────────────

function Yaml({ cluster, uid }: { cluster: ClusterState; uid: string }) {
  const setDraft = useSim((s) => s.setDraft)
  const lines = toYaml(cluster, uid)
  const kind = cluster.pods[uid] ? 'pod' : cluster.replicaSets[uid] ? 'rs' : cluster.services[uid] ? 'svc' : 'deploy'
  const name = (cluster.pods[uid] ?? cluster.replicaSets[uid] ?? cluster.services[uid] ?? cluster.deployments[uid])?.name
  const command = `kubectl get ${kind} ${name} -o yaml`
  return (
    <>
      <p className="mt-3 text-[11.5px] leading-relaxed text-fg-faint">Resumo com os campos que importam agora; os destacados mudam com o que acontece no palco.</p>
      <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-bg/60 p-3 font-mono text-[11px] leading-[1.65]">
        {lines.map((l, i) => (
          <div key={i} className={cn(l.hl ? 'text-accent' : 'text-fg-muted', l.hl && '-mx-3 bg-accent/[0.06] px-3')}>
            {l.t || ' '}
          </div>
        ))}
      </pre>
      <button
        onClick={() => setDraft(command)}
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-left text-[11.5px] text-fg-muted transition hover:border-accent/40 hover:text-fg"
      >
        O objeto completo, como a API devolve: <code className="font-mono text-accent">{command}</code>
      </button>
    </>
  )
}

function toYaml(c: ClusterState, uid: string): { t: string; hl?: boolean }[] {
  const L = (t: string, hl = false) => ({ t, hl })
  const labels = (l: Labels, indent: string) => Object.entries(l).map(([k, v]) => L(`${indent}${k}: ${v}`))
  const pod = c.pods[uid]
  if (pod) {
    const rs = pod.ownerUid ? c.replicaSets[pod.ownerUid] : undefined
    return [
      L('apiVersion: v1'),
      L('kind: Pod'),
      L('metadata:'),
      L(`  name: ${pod.name}`),
      L('  labels:'),
      ...labels(pod.labels, '    '),
      ...(pod.deletedAt !== null ? [L('  deletionTimestamp: set', true)] : []),
      ...(rs ? [L('  ownerReferences:', true), L('    - kind: ReplicaSet', true), L(`      name: ${rs.name}`, true), L('      controller: true', true)] : []),
      L('spec:'),
      L(`  nodeName: ${pod.nodeName ?? '""'}`),
      L('  containers:'),
      L('    - name: backend'),
      L(`      image: ${pod.image}`),
      L('status:'),
      L(`  phase: ${pod.phase === 'ContainerCreating' ? 'Pending' : pod.phase === 'Pending' ? 'Pending' : 'Running'}`),
      ...(pod.phase === 'Error' || pod.phase === 'CrashLoopBackOff'
        ? [L('  containerStatuses:', true), L(`    - restartCount: ${pod.restarts}`, true), L(`      state: { waiting: { reason: ${pod.phase} } }`, true)]
        : []),
      L(`  podIP: ${pod.ip ?? '""'}`),
      L('  conditions:'),
      L('    - type: Ready'),
      L(`      status: "${pod.ready ? 'True' : 'False'}"`, true),
    ]
  }
  const rs = c.replicaSets[uid]
  if (rs) {
    const dep = c.deployments[rs.ownerUid]
    const active = Object.values(c.pods).filter((p) => p.ownerUid === rs.uid && p.deletedAt === null)
    return [
      L('apiVersion: apps/v1'),
      L('kind: ReplicaSet'),
      L('metadata:'),
      L(`  name: ${rs.name}`),
      ...(dep ? [L('  ownerReferences:', true), L('    - kind: Deployment', true), L(`      name: ${dep.name}`, true)] : []),
      L('spec:'),
      L(`  replicas: ${rs.desired}`, true),
      L('  selector:'),
      L('    matchLabels:'),
      ...labels({ ...rs.selector, 'pod-template-hash': rs.hash }, '      '),
      L('status:'),
      L(`  replicas: ${active.length}`, true),
      L(`  readyReplicas: ${active.filter((p) => p.ready).length}`),
    ]
  }
  const svc = c.services[uid]
  if (svc) {
    return [
      L('apiVersion: v1'),
      L('kind: Service'),
      L('metadata:'),
      L(`  name: ${svc.name}`),
      L('spec:'),
      L('  type: ClusterIP'),
      L(`  clusterIP: ${svc.clusterIP}`),
      L('  selector:', true),
      ...Object.entries(svc.selector).map(([k, v]) => L(`    ${k}: ${v}`, true)),
      L('  ports:'),
      L(`    - port: ${svc.port}`),
      L(`      targetPort: ${svc.targetPort}`),
      L('# endpoints (managed by the endpoints controller):'),
      ...(svc.endpoints.length ? svc.endpoints.map((u) => L(`#   - ${c.pods[u]?.ip}:${svc.targetPort}`)) : [L('#   <none>', true)]),
    ]
  }
  const dep = c.deployments[uid]
  if (!dep) return []
  return [
    L('apiVersion: apps/v1'),
    L('kind: Deployment'),
    L('metadata:'),
    L(`  name: ${dep.name}`),
    L('spec:'),
    L(`  replicas: ${dep.replicas}`, true),
    L('  selector:'),
    L('    matchLabels:'),
    ...labels(dep.selector, '      '),
    L('  template:'),
    L('    metadata:'),
    L('      labels:'),
    ...labels(dep.template.labels, '        '),
    L('    spec:'),
    L('      containers:'),
    L('        - name: backend'),
    L(`          image: ${dep.template.image}`),
  ]
}

/**
 * "Editar direto no container": the shortcut everyone tries once — and the lesson of why
 * not. The change is real but lives only in this Pod; no Kubernetes object records it.
 */
function HandEdit({ pod }: { pod: Pod }) {
  const edit = useApp((s) => s.podEdits[pod.uid])
  // select stable pieces of state; building the design here keeps the selector referentially stable
  const design = useApp((s) => s.design)
  const releases = useApp((s) => s.releases)
  const current = designForPod({ design, releases, podEdits: edit ? { [pod.uid]: edit } : {} }, pod.uid, pod.image)
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [emoji, setEmoji] = useState('')
  const editable = pod.image.includes('kubelearn/backend') && !isBroken(pod.image) && pod.deletedAt === null && (pod.phase === 'Running' || !!edit)
  if (!editable) return null

  if (edit)
    return (
      <Section title="Mexido à mão">
        <div className="rounded-lg border border-warn/35 bg-warn/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-fg-muted">
          <div className="text-fg">
            <span aria-hidden>{edit.emoji}</span> “{edit.message}”
          </div>
          <p className="mt-1">
            Só este Pod responde assim. Nada no Deployment, no ReplicaSet ou no <code className="font-mono">-o yaml</code> do Pod registra a mudança. Agora apague este Pod — ou
            faça um rollout — e veja o que acontece com ela.
          </p>
        </div>
      </Section>
    )

  return (
    <Section title="Dentro do container">
      {!open ? (
        <>
          <button
            onClick={() => {
              setMessage(current.message)
              setEmoji(current.emoji)
              setOpen(true)
            }}
            className="flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-[12px] text-fg-muted transition hover:border-warn/50 hover:text-fg"
          >
            <Wrench size={13} /> Editar direto no container…
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-fg-faint">Como entrar com kubectl exec e trocar um arquivo do app lá dentro.</p>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            useApp.getState().editPod(pod.uid, { podName: pod.name, emoji, message: message.trim().slice(0, LIMITS.message) || current.message })
            setOpen(false)
          }}
          className="rounded-lg border border-line-strong px-3 py-2.5"
        >
          <label className="block text-[11px] font-medium text-fg-muted">
            Mensagem nova
            <input
              value={message}
              maxLength={LIMITS.message}
              onChange={(e) => setMessage(e.target.value)}
              autoFocus
              className="mt-1 w-full rounded-md border border-line-strong bg-bg px-2 py-1.5 text-[12.5px] text-fg outline-none focus:border-warn/60"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Ícone">
            {APP_EMOJIS.slice(0, 8).map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={emoji === e}
                onClick={() => setEmoji(e)}
                className={cn('grid size-7 place-items-center rounded-md border text-[14px]', emoji === e ? 'border-warn bg-warn/10' : 'border-line')}
              >
                {e}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">Vale só para este Pod, e só enquanto ele existir.</p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-[12px] text-fg-muted hover:text-fg">
              Cancelar
            </button>
            <button type="submit" className="rounded-md bg-warn/15 px-2.5 py-1 text-[12px] font-medium text-warn hover:bg-warn/25">
              Aplicar só neste Pod
            </button>
          </div>
        </form>
      )}
    </Section>
  )
}
