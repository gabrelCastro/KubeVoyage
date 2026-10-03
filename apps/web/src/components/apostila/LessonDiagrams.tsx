import { motion } from 'motion/react'
import { ArrowDown, Check, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn, type PodVisual } from '../../lib/visual'
import { useSim } from '../../store/useSim'
import { KindIcon, StatusGlyph } from '../primitives'

/**
 * Diagrams for the apostilas of lessons 2–6. Same visual language as the stage (glyphs,
 * kind icons, colors), static enough to print, with motion only where it carries meaning.
 */

const box = 'rounded-xl border border-line-strong bg-bg/55 p-4'

function Figure({ label, caption, children }: { label: string; caption: ReactNode; children: ReactNode }) {
  return (
    <figure className={box} aria-label={label}>
      {children}
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

function Glyphs({ states }: { states: PodVisual[] }) {
  return (
    <span className="flex gap-1.5">
      {states.map((s, i) => (
        <span key={i} className="grid size-6 place-items-center rounded-md border border-line bg-panel-2">
          <StatusGlyph state={s} size={13} />
        </span>
      ))}
    </span>
  )
}

// ── Lesson 2 ───────────────────────────────────────────────────────────────

export function ScaleDiagram() {
  return (
    <Figure
      label="Escalar para cima e para baixo"
      caption="Para cima, os Pods novos passam por todo o ciclo de vida antes de contar como disponíveis. Para baixo, saem primeiro os que ainda não estão prontos e, entre os prontos, os mais novos."
    >
      <div className="grid gap-3 text-[12px]">
        <div className="grid grid-cols-[110px_1fr] items-center gap-3">
          <span className="font-mono text-fg-muted">
            replicas: 3 → <span className="text-deploy">5</span>
          </span>
          <Glyphs states={['ready', 'ready', 'ready', 'pending', 'creating']} />
        </div>
        <div className="grid grid-cols-[110px_1fr] items-center gap-3">
          <span className="font-mono text-fg-muted">
            replicas: 5 → <span className="text-deploy">2</span>
          </span>
          <Glyphs states={['ready', 'ready', 'terminating', 'terminating', 'terminating']} />
        </div>
      </div>
    </Figure>
  )
}

// ── Lesson 3 ───────────────────────────────────────────────────────────────

export function ServiceDiagram() {
  const pods: {
    name: string
    state: PodVisual
    endpoint: boolean
    note: string
  }[] = [
    { name: 'x7f2k', state: 'ready', endpoint: true, note: 'endpoint' },
    { name: 'q8ft5', state: 'ready', endpoint: true, note: 'endpoint' },
    {
      name: 'm6bjp',
      state: 'running',
      endpoint: false,
      note: 'Running, sem Ready',
    },
  ]
  return (
    <Figure
      label="Service e seus endpoints"
      caption="Os três Pods têm app=backend, mas só os Ready entram na lista de endpoints. O terceiro só passa a receber tráfego quando a readiness probe passar."
    >
      <div className="flex flex-col items-center gap-2 text-[12px]">
        <span className="inline-flex items-center gap-2 rounded-lg border border-svc/50 bg-panel-2 px-3 py-2 text-fg">
          <KindIcon kind="Service" size={15} /> Service <span className="font-mono text-fg-muted">backend · 10.96.0.12:80</span>
        </span>
        <span className="font-mono text-[10.5px] text-fg-faint">selector app=backend</span>
        <div className="grid w-full grid-cols-3 gap-2">
          {pods.map((p) => (
            <div key={p.name} className="flex flex-col items-center gap-1.5">
              <span className={cn('h-5 w-px', p.endpoint ? 'bg-svc' : 'border-l border-dashed border-fg-faint')} />
              <span
                className={cn(
                  'flex w-full flex-col items-center gap-1 rounded-lg border px-2 py-2',
                  p.endpoint ? 'border-ready/40 bg-panel-2' : 'border-dashed border-line-strong',
                )}
              >
                <StatusGlyph state={p.state} size={13} />
                <span className="font-mono text-fg">{p.name}</span>
                <span className={cn('text-[10.5px]', p.endpoint ? 'text-ready' : 'text-warn')}>{p.note}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </Figure>
  )
}

// ── Lesson 4 ───────────────────────────────────────────────────────────────

function Mark({ ok }: { ok: boolean }) {
  return ok ? (
    <Check size={14} strokeWidth={3} className="text-ready" aria-label="combina" />
  ) : (
    <X size={14} strokeWidth={3} className="text-fg-faint" aria-label="não combina" />
  )
}

export function SelectorDiagram() {
  const rows: {
    pod: string
    labels: string
    service: boolean
    replicaSet: boolean
  }[] = [
    {
      pod: 'backend-…-x7f2k',
      labels: 'app=backend, pod-template-hash=7c9f',
      service: true,
      replicaSet: true,
    },
    {
      pod: 'frontend',
      labels: 'app=frontend',
      service: false,
      replicaSet: false,
    },
    {
      pod: 'frontend (relabel)',
      labels: 'app=backend',
      service: true,
      replicaSet: false,
    },
    {
      pod: 'backend-…-q8ft5',
      labels: 'app=debug, pod-template-hash=7c9f',
      service: false,
      replicaSet: false,
    },
  ]
  return (
    <Figure
      label="Quais Pods cada selector escolhe"
      caption="O Service olha só app=backend. O ReplicaSet exige também o pod-template-hash da sua revisão — por isso um Pod de fora pode entrar no Service sem ser adotado pelo ReplicaSet."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] text-left text-[11.5px]">
          <thead className="text-[10px] tracking-[0.08em] text-fg-faint uppercase">
            <tr>
              <th className="pb-2 font-semibold">Pod</th>
              <th className="pb-2 font-semibold">Labels</th>
              <th className="pb-2 text-center font-semibold">Service</th>
              <th className="pb-2 text-center font-semibold">ReplicaSet</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pod} className="border-t border-line">
                <td className="py-2 pr-3 font-mono text-fg">{r.pod}</td>
                <td className="py-2 pr-3 font-mono text-fg-muted">{r.labels}</td>
                <td className="py-2 text-center">
                  <span className="inline-grid place-items-center">
                    <Mark ok={r.service} />
                  </span>
                </td>
                <td className="py-2 text-center">
                  <span className="inline-grid place-items-center">
                    <Mark ok={r.replicaSet} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Figure>
  )
}

// ── Lesson 5 ───────────────────────────────────────────────────────────────

export function DebugPathDiagram() {
  const steps = [
    {
      q: 'O Service existe, no namespace certo?',
      cmd: 'kubectl get svc backend',
    },
    {
      q: 'Ele tem endpoints?',
      cmd: 'kubectl get endpointslices -l kubernetes.io/service-name=backend',
    },
    { q: 'O selector encontra algum Pod?', cmd: 'kubectl get pods -l app=api' },
    { q: 'Esses Pods estão Ready?', cmd: 'kubectl get pods -o wide' },
    {
      q: 'O targetPort é a porta em que o container escuta?',
      cmd: 'kubectl describe svc backend',
    },
  ]
  return (
    <Figure
      label="Caminho de investigação de um Service"
      caption="Siga a requisição de fora para dentro. O primeiro “não” é onde está o problema — não há por que olhar o resto antes."
    >
      <ol className="flex flex-col items-stretch gap-1 text-[12px]">
        {steps.map((s, i) => (
          <li key={s.q} className="flex flex-col items-center">
            <div className="flex w-full items-start gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-full border border-accent/50 font-mono text-[10px] text-accent">{i + 1}</span>
              <div className="min-w-0">
                <div className="text-fg">{s.q}</div>
                <code className="mt-0.5 block truncate font-mono text-[10.5px] text-fg-faint">{s.cmd}</code>
              </div>
            </div>
            {i < steps.length - 1 && <ArrowDown size={13} className="my-0.5 text-fg-faint" aria-hidden />}
          </li>
        ))}
      </ol>
    </Figure>
  )
}

// ── Lesson 6 ───────────────────────────────────────────────────────────────

type Row = [old: number, next: number, note: string]

function RolloutTable({ title, rows, bad, reduced }: { title: string; rows: Row[]; bad?: boolean; reduced: boolean }) {
  return (
    <div className="min-w-0 flex-1">
      <div className={cn('mb-2 text-[11px] font-semibold', bad ? 'text-crash' : 'text-ready')}>{title}</div>
      <table className="w-full text-[11px]">
        <thead className="text-[9.5px] tracking-[0.08em] text-fg-faint uppercase">
          <tr>
            <th className="pb-1 text-left font-semibold">v1.4</th>
            <th className="pb-1 text-left font-semibold">nova</th>
            <th className="pb-1 text-left font-semibold">momento</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map(([o, n, note], i) => (
            <motion.tr
              key={i}
              className="border-t border-line"
              initial={reduced ? false : { opacity: 0, x: -4 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
            >
              <td className="py-1 text-fg">{o}</td>
              <td className={cn('py-1', bad && n > 0 ? 'text-crash' : 'text-fg')}>{n}</td>
              <td className="py-1 font-sans text-fg-muted">{note}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function RolloutDiagram() {
  const reduced = useSim((s) => s.reducedMotion)
  // [old v1.4, new] at each moment, with 3 replicas: maxSurge 1, maxUnavailable 0
  const healthy: Row[] = [
    [3, 0, 'início'],
    [3, 1, 'surge: +1 novo'],
    [2, 1, 'novo Ready → sai 1 antigo'],
    [2, 2, '+1 novo'],
    [1, 2, 'novo Ready → sai 1 antigo'],
    [1, 3, '+1 novo'],
    [0, 3, 'último antigo sai'],
  ]
  const broken: Row[] = [
    [3, 0, 'início'],
    [3, 1, 'surge: +1 novo'],
    [3, 1, 'novo nunca fica Ready'],
    [3, 1, 'travado — ninguém cai'],
  ]
  return (
    <Figure
      label="Rolling update com 3 réplicas"
      caption="Com 3 réplicas, maxSurge 25% vira 1 (arredonda para cima) e maxUnavailable 25% vira 0 (arredonda para baixo): pode existir 1 Pod a mais, e nenhum pode faltar. Por isso uma versão quebrada trava o rollout em vez de derrubar a aplicação."
    >
      <div className="flex flex-col gap-5 sm:flex-row">
        <RolloutTable title="Versão saudável" rows={healthy} reduced={reduced} />
        <RolloutTable title="Versão quebrada (v1.5)" rows={broken} bad reduced={reduced} />
      </div>
    </Figure>
  )
}
