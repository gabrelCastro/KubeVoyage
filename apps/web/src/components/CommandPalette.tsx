import { AnimatePresence, motion } from 'motion/react'
import { CornerDownLeft, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { short } from '../sim/engine'
import { cn, podVisual } from '../lib/visual'
import { isComplete, type LessonId } from '@kubelearn/shared'
import { LESSONS } from '../lessons'
import { useProgress } from '../progress/browser'
import { useSim } from '../store/useSim'
import { Kbd, KindIcon, StatusGlyph } from './primitives'

interface Item {
  id: string
  group: 'Run' | 'Lesson' | 'Lessons' | 'Simulation' | 'Resources'
  label: string
  hint?: string
  icon?: ReactNode
  keys?: string
  run: () => void
}

const GROUP_LABEL: Record<Item['group'], string> = { Run: 'Executar', Lesson: 'Lição', Lessons: 'Lições', Simulation: 'Simulação', Resources: 'Recursos' }

export function CommandPalette() {
  const open = useSim((s) => s.paletteOpen)
  const setPalette = useSim((s) => s.setPalette)
  return <AnimatePresence>{open && <Palette close={() => setPalette(false)} />}</AnimatePresence>
}

function Palette({ close }: { close: () => void }) {
  const cluster = useSim((s) => s.cluster)
  const paused = useSim((s) => s.paused)
  const reduced = useSim((s) => s.reducedMotion)
  const progress = useProgress((s) => s.progress)
  const s = useSim.getState()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const items = useMemo<Item[]>(() => {
    const run = (cmd: string) => () => s.exec(cmd, 'palette')
    const pods = Object.values(cluster.pods).filter((p) => p.deletedAt === null)
    const out: Item[] = [
      { id: 'pause', group: 'Simulation', label: paused ? 'Continuar simulação' : 'Pausar simulação', keys: 'Espaço', run: s.togglePause },
      { id: 'step', group: 'Simulation', label: 'Avançar um passo', keys: '.', run: s.step },
      { id: 'restart', group: 'Simulation', label: 'Reiniciar lição', run: s.restart },
      { id: 'slow', group: 'Simulation', label: 'Velocidade: 0,5× (câmera lenta)', run: () => s.setSpeed(0.5) },
      { id: 'normal', group: 'Simulation', label: 'Velocidade: 1×', run: () => s.setSpeed(1) },
      { id: 'fast', group: 'Simulation', label: 'Velocidade: 2×', run: () => s.setSpeed(2) },
      { id: 'docs', group: 'Simulation', label: 'Abrir a documentação', hint: '/doc', run: () => window.open('/doc', '_blank', 'noopener') },
      { id: 'motion', group: 'Simulation', label: `${reduced ? 'Desligar' : 'Ligar'} movimento reduzido`, run: () => s.setReducedMotion(!reduced) },
      ...(Object.keys(cluster.deployments).length ? [] : [{ id: 'apply', group: 'Lesson' as const, label: 'Aplicar backend.yaml', hint: 'kubectl apply -f backend.yaml', run: run('kubectl apply -f backend.yaml') }]),
      { id: 'get', group: 'Lesson', label: 'Listar Pods', hint: 'kubectl get pods -o wide', run: run('kubectl get pods -o wide') },
      { id: 'watch', group: 'Lesson', label: 'Acompanhar Pods', hint: 'kubectl get pods -w', run: run('kubectl get pods -w') },
      ...(pods.length
        ? [{ id: 'chaos', group: 'Lesson' as const, label: 'Apagar um Pod aleatório', hint: 'chaos monkey', run: () => s.exec(`kubectl delete pod ${pods[Math.floor(Math.random() * pods.length)].name}`, 'palette') }]
        : []),
      ...LESSONS.map((l) => ({
        id: `lesson-${l.id}`,
        group: 'Lessons' as const,
        label: `${l.number}. ${l.title}`,
        hint: isComplete(progress, l.id as LessonId) ? 'concluída' : l.track,
        run: () => s.openLesson(l.id),
      })),
      ...Object.values(cluster.services).map((v) => ({ id: v.uid, group: 'Resources' as const, label: `Service ${v.name}`, icon: <KindIcon kind="Service" />, run: () => s.select(v.uid) })),
      ...Object.values(cluster.deployments).map((d) => ({ id: d.uid, group: 'Resources' as const, label: `Deployment ${d.name}`, icon: <KindIcon kind="Deployment" />, run: () => s.select(d.uid) })),
      ...Object.values(cluster.replicaSets).map((r) => ({ id: r.uid, group: 'Resources' as const, label: `ReplicaSet ${r.name}`, icon: <KindIcon kind="ReplicaSet" />, run: () => s.select(r.uid) })),
      ...Object.values(cluster.daemonSets).map((d) => ({ id: d.uid, group: 'Resources' as const, label: `DaemonSet ${d.name}`, icon: <KindIcon kind="DaemonSet" />, run: () => s.select(d.uid) })),
      ...Object.values(cluster.pods).map((p) => ({
        id: p.uid,
        group: 'Resources' as const,
        label: `Pod ${short(p.name)}`,
        hint: p.name,
        icon: <StatusGlyph still state={podVisual(p)} size={13} />,
        run: () => s.select(p.uid),
      })),
    ]
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    const filtered = out.filter((i) => terms.every((t) => `${i.label} ${i.hint ?? ''} ${i.group}`.toLowerCase().includes(t)))
    if (/^(kubectl|k|cat|ls|help|clear)\b/.test(q.trim())) {
      filtered.unshift({ id: 'raw', group: 'Run', label: q.trim(), hint: 'executar no terminal', run: run(q.trim()) })
    }
    return filtered
  }, [cluster, paused, reduced, q, s, progress])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (i: Item | undefined) => {
    if (!i) return
    close()
    i.run()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(items.length - 1, a + 1)))
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)))
    else if (e.key === 'Enter') choose(items[active])
    else if (e.key === 'Escape') close()
  }

  let lastGroup = ''
  return (
    <motion.div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-[14vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} onClick={close}>
      <motion.div
        role="dialog"
        aria-label="Paleta de comandos"
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.99, transition: { duration: 0.1 } }}
        transition={{ type: 'spring', stiffness: 500, damping: 36 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] overflow-hidden rounded-xl border border-line-strong bg-panel shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={15} className="text-fg-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Busque ações e recursos, ou digite um comando kubectl…"
            className="h-12 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-faint"
            aria-label="Comando"
          />
          <Kbd>esc</Kbd>
        </div>
        <div ref={list} className="max-h-[min(420px,55vh)] overflow-auto p-1.5">
          {items.length === 0 && <div className="px-3 py-8 text-center text-[12.5px] text-fg-faint">Nada encontrado. Comandos que começam com “kubectl” rodam no terminal.</div>}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null
            lastGroup = item.group
            return (
              <div key={item.id}>
                {header && <div className="px-2.5 pt-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-fg-faint uppercase">{GROUP_LABEL[header]}</div>}
                <button
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(item)}
                  className={cn('relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px]', i === active ? 'text-fg' : 'text-fg-muted')}
                >
                  {i === active && <motion.span layoutId="palette-active" className="absolute inset-0 rounded-lg bg-raised" transition={{ type: 'spring', stiffness: 600, damping: 40 }} />}
                  <span className="relative grid w-4 place-items-center text-fg-faint">{item.icon ?? (item.group === 'Run' ? <span className="text-accent">❯</span> : null)}</span>
                  <span className={cn('relative', item.group === 'Run' && 'font-mono text-[12.5px]')}>{item.label}</span>
                  {item.hint && <span className="relative truncate font-mono text-[11px] text-fg-faint">{item.hint}</span>}
                  <span className="relative ml-auto">{item.keys ? <Kbd>{item.keys}</Kbd> : i === active ? <CornerDownLeft size={13} className="text-fg-faint" /> : null}</span>
                </button>
              </div>
            )
          })}
        </div>
      </motion.div>
    </motion.div>
  )
}
