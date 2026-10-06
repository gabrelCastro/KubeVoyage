import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Palette } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/visual'
import { short, tag } from '../../sim/engine'
import { APP_COLORS, designFor, replyText, useApp, type AppDesign, type Visit } from '../../store/useApp'
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
export function AppPage({ design, compact, version }: { design: AppDesign; compact?: boolean; version?: string }) {
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
      {version && (
        <span className="ml-auto shrink-0 rounded-[4px] bg-panel-2 px-1.5 font-mono text-[10px] text-fg-muted ring-1 ring-line-strong" title="A versão que respondeu por último">
          {version}
        </span>
      )}
    </div>
  )
}

/**
 * What the outside world sees: visitors arrive through the app's Service, and each one is
 * answered by whichever Pod the Service picked — the same requests drawn on the stage.
 */
export function AppWindow() {
  const design = useApp((s) => s.design)
  const releases = useApp((s) => s.releases)
  const podEdits = useApp((s) => s.podEdits)
  const lostEdits = useApp((s) => s.lostEdits)
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
  const look = (image?: string) => (image ? designFor({ design, releases }, image) : design)
  const lastOk = [...visits].reverse().find((v) => v.ok)
  // what a visitor saw: the version's design, then what its code answered (or the message from the Pod's environment), then any hand edit
  const lookOf = (v: Pick<Visit, 'image' | 'edited' | 'configMessage' | 'reply'>) => {
    const d = { ...look(v.image), ...(v.reply ? { message: replyText(v.reply) } : v.configMessage !== undefined && { message: v.configMessage }) }
    return v.edited ? { ...d, emoji: v.edited.emoji, message: v.edited.message } : d
  }
  const showing = lastOk ? lookOf(lastOk) : design
  const editedLive = (svc?.endpoints ?? []).filter((uid) => podEdits[uid]).length

  // a Pod that's gone takes its hand edit with it
  useEffect(() => {
    useApp.getState().forgetGone(new Set(Object.keys(pods)))
  }, [pods])
  // which versions are answering right now: the Ready endpoints, grouped by image tag
  const live = new Map<string, number>()
  for (const uid of svc?.endpoints ?? []) {
    const image = pods[uid]?.image
    if (image) live.set(image, (live.get(image) ?? 0) + 1)
  }

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
    <section className="shrink-0 border-b border-line" aria-label="Janela do app" data-tour="app">
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
              <AnimatePresence>
                {lostEdits.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-2.5 overflow-hidden rounded-lg border border-warn/40 bg-warn/[0.07] px-3 py-2.5 text-[12px] leading-relaxed text-fg-muted"
                    role="status"
                  >
                    <div className="font-semibold text-warn">Cadê a sua mudança?</div>
                    <p className="mt-0.5">
                      “{lostEdits.at(-1)!.message}” foi feita dentro de {short(lostEdits.at(-1)!.podName)}, e sumiu com ele. O substituto nasceu do template do Deployment — que nunca
                      soube dela. Para mudar o app de verdade, publique uma versão e faça o rollout.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => openStudio(true)} className="rounded-md bg-warn/15 px-2 py-1 text-[11.5px] font-medium text-warn hover:bg-warn/25">
                        Publicar uma versão
                      </button>
                      <button onClick={() => useApp.getState().dismissLost()} className="rounded-md px-2 py-1 text-[11.5px] text-fg-muted hover:text-fg">
                        Entendi
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
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
                    <AppPage design={showing} compact version={lastOk?.image ? tag(lastOk.image) : undefined} />
                  )}
                  <div className="mt-2.5 grid grid-cols-8 gap-1" role="list" aria-label="Últimos visitantes">
                    {Array.from({ length: CELLS }, (_, i) => {
                      const v = visits[visits.length - CELLS + i]
                      if (!v) return <span key={`e${i}`} className="h-8 rounded-md border border-dashed border-line" />
                      const d = lookOf(v)
                      const appError = v.ok && v.reply && v.reply.status >= 400
                      return (
                        <motion.span
                          key={v.id}
                          role="listitem"
                          initial={{ scale: 0.4, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          onMouseEnter={() => v.podUid && pods[v.podUid] && hover(v.podUid)}
                          onMouseLeave={() => hover(null)}
                          title={
                            appError
                              ? `${v.podName} respondeu HTTP ${v.reply!.status}${v.image ? ` (versão ${tag(v.image)})` : ''} — o seu código devolveu um erro`
                              : v.ok
                                ? `Atendido por ${v.podName}${v.image ? ` (versão ${tag(v.image)})` : ''}${v.edited ? ' — editado à mão' : ''}`
                                : 'Recusado: o Service não tinha para quem mandar'
                          }
                          className={cn(
                            'flex h-8 flex-col items-center justify-center rounded-md leading-none',
                            (!v.ok || appError) && 'bg-crash/15 text-crash',
                            v.ok && v.edited && 'ring-1 ring-warn/70',
                          )}
                          style={v.ok && !appError ? { background: `color-mix(in oklab, ${APP_COLORS[d.color]} 18%, transparent)` } : undefined}
                        >
                          {appError ? (
                            <>
                              <span className="font-mono text-[11px] font-bold">{v.reply!.status}</span>
                              <span className="mt-0.5 font-mono text-[8.5px] opacity-70">{v.podName ? short(v.podName).slice(0, 4) : ''}</span>
                            </>
                          ) : v.ok ? (
                            <>
                              <span className="text-[13px]" aria-hidden>
                                {d.emoji}
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
                  {editedLive > 0 && (
                    <p className="mt-2 text-[11px] leading-relaxed text-warn">
                      ✎ {editedLive === 1 ? '1 Pod responde' : `${editedLive} Pods respondem`} com uma mudança feita à mão — os outros não. Visitantes diferentes veem apps diferentes.
                    </p>
                  )}
                  {live.size > 1 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted" aria-live="polite">
                      <span className="text-fg-faint">no ar agora:</span>
                      {[...live].map(([image, n]) => (
                        <span key={image} className="flex items-center gap-1 rounded-full border border-line px-1.5 py-[1px] font-mono">
                          <span aria-hidden>{look(image).emoji}</span>
                          {tag(image)} ×{n}
                        </span>
                      ))}
                    </div>
                  )}
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
