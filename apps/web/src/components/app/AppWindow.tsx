import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Palette } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../../lib/visual'
import { short } from '../../sim/engine'
import { APP_COLORS, useApp, type AppDesign } from '../../store/useApp'
import { useSim } from '../../store/useSim'

const CELLS = 32
const COLLAPSED_KEY = 'kubelearn.app-window.collapsed'

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/** The app's "home page", as a visitor would see it. */
export function AppPage({ design, compact }: { design: AppDesign; compact?: boolean }) {
  const color = APP_COLORS[design.color]
  return (
    <div
      className={cn('flex items-center gap-3 rounded-lg border px-3', compact ? 'py-2' : 'py-3.5')}
      style={{ borderColor: `color-mix(in oklab, ${color} 40%, transparent)`, background: `color-mix(in oklab, ${color} 10%, transparent)` }}
    >
      <span className={compact ? 'text-[22px]' : 'text-[30px]'} aria-hidden>
        {design.emoji}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold" style={{ color }}>
          {design.name}
        </div>
        <div className="truncate text-[12px] text-fg-muted">{design.message || ' '}</div>
      </div>
    </div>
  )
}

/**
 * What the outside world sees: visitors arrive through the app's Service, and each one is
 * answered by whichever Pod the Service picked — the same requests drawn on the stage.
 */
export function AppWindow() {
  const design = useApp((s) => s.design)
  const customized = useApp((s) => s.customized)
  const visits = useApp((s) => s.visits)
  const served = useApp((s) => s.served)
  const failed = useApp((s) => s.failed)
  const openStudio = useApp((s) => s.openStudio)
  const services = useSim((s) => s.cluster.services)
  const pods = useSim((s) => s.cluster.pods)
  const hover = useSim((s) => s.hover)
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const svc = Object.values(services).find((s) => s.name === 'backend') ?? Object.values(services)[0]
  const running = Object.values(pods).filter((p) => p.ready && p.image.includes('kubelearn/backend')).length
  const last = visits.at(-1)
  const down = !!svc && !!last && !last.ok
  const color = APP_COLORS[design.color]

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1')
      } catch {
        // just for this session
      }
      return !c
    })
  }

  return (
    <section className="shrink-0 border-b border-line" aria-label="Janela do app">
      <header className="flex items-center gap-2 px-4 pt-3 pb-2">
        <button onClick={toggle} aria-expanded={!collapsed} className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold text-fg">
          <ChevronDown size={14} className={cn('text-fg-faint transition-transform', collapsed && '-rotate-90')} />
          <span aria-hidden>{design.emoji}</span>
          <span className="truncate">Seu app</span>
        </button>
        {svc && (
          <span className="truncate font-mono text-[10.5px] text-fg-faint" title="O endereço que os visitantes usam: o nome do Service">
            http://{svc.name}
          </span>
        )}
        <button
          onClick={() => openStudio(true)}
          className={cn(
            'ml-auto flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition',
            customized ? 'border-line text-fg-muted hover:text-fg' : 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/15',
          )}
        >
          <Palette size={12} /> {customized ? 'Editar' : 'Criar seu app'}
        </button>
      </header>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-3.5">
              {!svc ? (
                <p className="rounded-lg border border-dashed border-line-strong px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
                  {running
                    ? `Seu app roda em ${running} Pod${running === 1 ? '' : 's'}, mas ninguém de fora consegue chegar até ele: falta um Service, o endereço estável que os visitantes usam.`
                    : 'Seu app ainda não está rodando. Quando houver Pods e um Service na frente deles, os visitantes aparecem aqui.'}
                </p>
              ) : (
                <>
                  {down ? (
                    <div className="rounded-lg border border-crash/40 bg-crash/[0.06] px-3 py-3">
                      <div className="text-[13px] font-semibold text-crash">Não foi possível conectar</div>
                      <div className="mt-0.5 text-[12px] text-fg-muted">O Service {svc.name} existe, mas não tem nenhum Pod Ready para atender.</div>
                    </div>
                  ) : (
                    <AppPage design={design} compact />
                  )}
                  <div className="mt-2.5 grid grid-cols-8 gap-1" role="list" aria-label="Últimos visitantes">
                    {Array.from({ length: CELLS }, (_, i) => {
                      const v = visits[visits.length - CELLS + i]
                      if (!v) return <span key={`e${i}`} className="h-8 rounded-md border border-dashed border-line" />
                      return (
                        <motion.span
                          key={v.id}
                          role="listitem"
                          initial={{ scale: 0.4, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          onMouseEnter={() => v.podUid && pods[v.podUid] && hover(v.podUid)}
                          onMouseLeave={() => hover(null)}
                          title={v.ok ? `Atendido por ${v.podName}` : 'Recusado: o Service não tinha para quem mandar'}
                          className={cn('flex h-8 flex-col items-center justify-center rounded-md leading-none', !v.ok && 'bg-crash/15 text-crash')}
                          style={v.ok ? { background: `color-mix(in oklab, ${color} 16%, transparent)` } : undefined}
                        >
                          {v.ok ? (
                            <>
                              <span className="text-[13px]" aria-hidden>
                                {design.emoji}
                              </span>
                              <span className="mt-0.5 font-mono text-[8.5px] text-fg-faint">{v.podName ? short(v.podName).slice(0, 4) : ''}</span>
                            </>
                          ) : (
                            <span className="text-[13px] font-bold">✕</span>
                          )}
                        </motion.span>
                      )
                    })}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-fg-faint">
                    <span>
                      <span className="text-ready tabular-nums">{served}</span> atendidos
                      {failed > 0 && (
                        <>
                          {' · '}
                          <span className="text-crash tabular-nums">{failed}</span> recusados
                        </>
                      )}
                    </span>
                    <span>cada quadrado é um visitante</span>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
