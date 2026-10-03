import { motion } from 'motion/react'
import { Check, RotateCw, X } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { cn } from '../../lib/visual'
import { useSim } from '../../store/useSim'
import { KindIcon, StatusGlyph, type Kind } from '../primitives'
import { LifecycleBar } from '../stage/Nodes'

const box = 'rounded-xl border border-line-strong bg-bg/55 p-4'

export function DesiredActualDiagram() {
  const reduced = useSim((s) => s.reducedMotion)
  return (
    <figure className={box} aria-label="Diagrama do desired state e do actual state">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <StateBox label="Desired" detail="3 Pods" color="var(--color-deploy)" />
        <motion.span className="font-mono text-lg text-accent" animate={reduced ? undefined : { x: [-2, 2, -2] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }} aria-hidden>
          ⇄
        </motion.span>
        <StateBox label="Actual" detail="2 → 3 Pods" color="var(--color-ready)" />
      </div>
      <figcaption>O controller trabalha até o estado observado corresponder ao estado declarado.</figcaption>
    </figure>
  )
}

function StateBox({ label, detail, color }: { label: string; detail: string; color: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-3 text-center">
      <div className="text-[10px] font-semibold tracking-[0.12em] uppercase" style={{ color }}>{label}</div>
      <div className="mt-1 font-mono text-[13px] text-fg">{detail}</div>
    </div>
  )
}

export function OwnershipDiagram() {
  return (
    <figure className={box} aria-label="Cadeia de ownership do Deployment até os Pods">
      <div className="flex flex-wrap items-center justify-center gap-2 text-[12px]">
        <Resource kind="Deployment" />
        <OwnerArrow />
        <Resource kind="ReplicaSet" />
        <OwnerArrow />
        <div className="flex gap-1.5">
          {[0, 1, 2].map((n) => (
            <motion.span key={n} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: n * 0.08 }}>
              <Resource kind="Pod" compact />
            </motion.span>
          ))}
        </div>
      </div>
      <figcaption><code>ownerReferences</code> liga cada recurso ao controller que cuida dele.</figcaption>
    </figure>
  )
}

function Resource({ kind, compact }: { kind: Kind; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-panel-2 text-fg', compact ? 'p-2' : 'px-3 py-2')}>
      <KindIcon kind={kind} size={15} />
      {!compact && kind}
      {compact && <span className="sr-only">Pod</span>}
    </span>
  )
}

function OwnerArrow() {
  return (
    <span className="text-center font-mono text-[10px] leading-tight text-fg-faint" aria-label="é dono de">
      ownerReferences
      <span className="block text-accent">→</span>
    </span>
  )
}

const lifecycle = [
  { label: 'Pending', visual: 'pending' as const, color: 'var(--color-pending)' },
  { label: 'ContainerCreating', visual: 'creating' as const, color: 'var(--color-creating)' },
  { label: 'Running', visual: 'running' as const, color: 'var(--color-running)' },
  { label: 'Ready', visual: 'ready' as const, color: 'var(--color-ready)' },
]

export function PodLifecycleDiagram() {
  const reduced = useSim((s) => s.reducedMotion)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (reduced) return
    const timer = window.setInterval(() => setStep((value) => (value + 1) % lifecycle.length), 1400)
    return () => window.clearInterval(timer)
  }, [reduced])

  const visibleStep = reduced ? 3 : step
  const current = lifecycle[visibleStep]
  return (
    <figure className={box} aria-label="Ciclo de vida do Pod">
      <div className="grid gap-2 sm:grid-cols-4">
        {lifecycle.map((item, index) => (
          <div key={item.label} className={cn('flex items-center gap-1.5 rounded-lg border px-2 py-2 text-[10.5px]', index === visibleStep ? 'border-current bg-panel-2 text-fg' : 'border-line text-fg-faint')}>
            <StatusGlyph state={item.visual} size={13} />
            <span className="truncate">{item.label}</span>
          </div>
        ))}
      </div>
      <LifecycleBar step={visibleStep} color={current.color} className="mt-4" />
      <figcaption>Running diz que o container está executando; Ready diz que já pode receber tráfego.</figcaption>
    </figure>
  )
}

export function ReconciliationDiagram() {
  const reduced = useSim((s) => s.reducedMotion)
  return (
    <figure className={box} aria-label="Loop de reconciliação: observar, comparar e agir">
      <div className="flex items-center justify-center gap-2 text-[11.5px] font-medium">
        {['Observar', 'Comparar', 'Agir'].map((label, index) => (
          <span key={label} className="contents">
            {index > 0 && <span className="text-accent">→</span>}
            <span className="rounded-full border border-line-strong bg-panel-2 px-3 py-1.5">{label}</span>
          </span>
        ))}
        <motion.span animate={reduced ? undefined : { rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: 'linear' }} className="ml-1 text-accent" aria-hidden>
          <RotateCw size={16} />
        </motion.span>
      </div>
      <figcaption>Depois de agir, o controller volta a observar. O loop nunca “termina”.</figcaption>
    </figure>
  )
}

export interface QuizOption {
  label: string
  correct?: boolean
  explanation: string
}

export function QuickQuestion({ question, options }: { question: string; options: QuizOption[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  const id = useId()
  const answer = selected === null ? null : options[selected]
  return (
    <fieldset className="rounded-xl border border-line bg-panel-2/50 p-4">
      <legend className="px-1 text-[13px] font-semibold text-fg">{question}</legend>
      <div className="mt-2 grid gap-2">
        {options.map((option, index) => {
          const active = selected === index
          return (
            <label key={option.label} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[12px] transition', active ? (option.correct ? 'border-ready/60 bg-ready/10' : 'border-terminating/60 bg-terminating/10') : 'border-line-strong hover:border-fg-faint')}>
              <input className="mt-0.5 accent-[var(--color-accent)]" type="radio" name={id} checked={active} onChange={() => setSelected(index)} />
              <span>{option.label}</span>
            </label>
          )
        })}
      </div>
      {answer && (
        <p role="status" className={cn('mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed', answer.correct ? 'text-ready' : 'text-terminating')}>
          {answer.correct ? <Check size={14} className="mt-0.5 shrink-0" /> : <X size={14} className="mt-0.5 shrink-0" />}
          <span>{answer.explanation}</span>
        </p>
      )}
    </fieldset>
  )
}

export function Callout({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-accent/25 bg-accent/[0.06] px-4 py-3 text-[12px] leading-relaxed text-fg-muted">{children}</div>
}
