import { AnimatePresence, motion } from 'motion/react'
import { Pause, Play, RotateCcw, Search, StepForward, Waves } from 'lucide-react'
import { getLesson } from '../lessons'
import { HelpMenu } from '../tour/HelpMenu'
import { AccountButton } from './account/AccountButton'
import { cn } from '../lib/visual'
import { useSim, type Speed } from '../store/useSim'
import { Kbd, Logo, MOD, Tooltip } from './primitives'

export function TopBar() {
  const paused = useSim((s) => s.paused)
  const speed = useSim((s) => s.speed)
  const reduced = useSim((s) => s.reducedMotion)
  const next = useSim((s) => s.pending[0])
  const lesson = getLesson(useSim((s) => s.lessonId))
  const hasNext = !!next
  const { togglePause, step, restart, setSpeed, setPalette, setReducedMotion } = useSim.getState()

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3.5">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="hidden text-[14px] font-semibold tracking-tight min-[420px]:inline">KubeLearn</span>
      </div>
      <span className="hidden h-4 w-px bg-line-strong sm:block" />
      <nav className="hidden items-center gap-1.5 text-[12.5px] sm:flex" aria-label="Navegação">
        <span className="text-fg-faint">{lesson.track}</span>
        <span className="text-fg-faint">/</span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={lesson.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="text-fg-muted">
            {lesson.title}
          </motion.span>
        </AnimatePresence>
      </nav>

      <div data-tour="playback" className="ml-auto flex items-center gap-1 rounded-lg border border-line bg-bg/50 p-0.5 md:absolute md:left-1/2 md:ml-0 md:-translate-x-1/2">
        <Tooltip label={<>{paused ? 'Continuar' : 'Pausar'} simulação <Kbd className="ml-1">Espaço</Kbd></>}>
          <button onClick={togglePause} className={cn('grid size-7 place-items-center rounded-md transition', paused ? 'bg-warn/15 text-warn' : 'text-fg-muted hover:bg-raised hover:text-fg')} aria-label={paused ? 'Continuar' : 'Pausar'}>
            <motion.span key={String(paused)} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              {paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
            </motion.span>
          </button>
        </Tooltip>
        <Tooltip label={<>Avançar um passo <Kbd className="ml-1">.</Kbd></>}>
          <button onClick={step} disabled={!hasNext} className="grid size-7 place-items-center rounded-md text-fg-muted transition hover:bg-raised hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent" aria-label="Avançar um passo">
            <StepForward size={14} />
          </button>
        </Tooltip>
        <Tooltip label={<>Reiniciar lição <Kbd className="ml-1">R</Kbd></>}>
          <button onClick={restart} className="grid size-7 place-items-center rounded-md text-fg-muted transition hover:bg-raised hover:text-fg" aria-label="Reiniciar">
            <RotateCcw size={13.5} />
          </button>
        </Tooltip>
        <span className="mx-1 hidden h-4 w-px bg-line-strong sm:block" />
        <div className="relative hidden sm:flex" role="radiogroup" aria-label="Velocidade da simulação">
          {([0.5, 1, 2] as Speed[]).map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={speed === s}
              onClick={() => setSpeed(s)}
              className={cn('relative h-7 rounded-md px-2 font-mono text-[11px] transition-colors', speed === s ? 'text-fg' : 'text-fg-faint hover:text-fg-muted')}
            >
              {speed === s && <motion.span layoutId="speed" className="absolute inset-0 rounded-md bg-raised ring-1 ring-line-strong" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
              <span className="relative">{s}×</span>
            </button>
          ))}
        </div>
        {/* While paused, say what the cluster will do next — the heart of step-through learning. */}
        <AnimatePresence initial={false}>
          {paused && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 38 }}
              className="overflow-hidden"
            >
              <div className="flex h-7 items-center gap-2 border-l border-line-strong pr-2 pl-2.5 text-[11.5px] whitespace-nowrap">
                <span className="font-medium text-warn">Pausado</span>
                <span className="text-fg-faint">próximo:</span>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={next?.id ?? 'idle'}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="max-w-[300px] truncate text-fg-muted"
                  >
                    {next ? next.label : 'nada — o cluster está em repouso'}
                  </motion.span>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2 md:ml-auto">
        <HelpMenu />
        <AccountButton />
        <Tooltip label={reduced ? 'Movimento reduzido: ligado' : 'Movimento reduzido: desligado'}>
          <button
            onClick={() => setReducedMotion(!reduced)}
            className={cn('grid size-8 place-items-center rounded-lg transition', reduced ? 'bg-raised text-fg' : 'text-fg-faint hover:bg-raised hover:text-fg-muted')}
            aria-pressed={reduced}
            aria-label="Alternar movimento reduzido"
          >
            <Waves size={15} />
          </button>
        </Tooltip>
        <button
          data-tour="paleta"
          onClick={() => setPalette(true)}
          className="hidden h-8 items-center gap-2 rounded-lg border border-line bg-bg/50 pr-1.5 pl-2.5 text-[12px] text-fg-faint transition hover:border-line-strong hover:text-fg-muted lg:flex"
        >
          <Search size={13} />
          <span className="pr-6">Buscar ou executar…</span>
          <Kbd>{MOD} K</Kbd>
        </button>
      </div>
    </header>
  )
}
