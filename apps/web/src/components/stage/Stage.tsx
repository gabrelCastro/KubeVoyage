import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getLesson } from '../../lessons'
import { matches, NO_OWNER } from '../../sim/engine'
import { computeLayout, edgePath, relatedTo, spring, type Layout } from '../../lib/visual'
import { useSim } from '../../store/useSim'
import { Edges, type EdgeModel } from './Edges'
import { Effects } from './Effects'
import { DeploymentNode, PodNode, ReplicaSetNode, ServiceNode, SlotPlaceholder, type Probe } from './Nodes'
import { BootSkeleton, EdgeTooltip, EmptyState, Legend, Narration, NodeLane, ReconcileHud } from './Overlays'
import { Traffic } from './Traffic'

const RESERVE = { top: 18, bottom: 100, x: 28 }
/** Footprint of the top-left HUD and top-right legend, which the graph's top row must not sit under. */
const HUD = { w: 236, h: 140, withControl: 196 }
const LEGEND_W = 112

/**
 * Fit the world into the stage around the overlays: center it if there's room, otherwise
 * slide it right of the HUD, shrink it a little, or — on narrow screens — drop it below the HUD.
 */
function fitWorld(W: number, H: number, layout: Layout, avoidHud: boolean, hudH: number) {
  const scaleAt = (top: number) => Math.min(1.12, (W - RESERVE.x * 2) / layout.width, (H - top - RESERVE.bottom) / layout.height)
  const place = (top: number, s: number, x = (W - layout.width * s) / 2) => ({
    scale: s,
    x,
    y: top + Math.max(0, (H - top - RESERVE.bottom - layout.height * s) / 2),
  })
  const s = scaleAt(RESERVE.top)
  const dep = Object.values(layout.boxes).find((b) => b.kind === 'Deployment')
  if (!avoidHud || !dep) return place(RESERVE.top, s)

  const left = dep.x - dep.w / 2
  const right = dep.x + dep.w / 2
  const fits = (x: number, sc: number) => x + left * sc >= HUD.w && x + right * sc <= W - LEGEND_W
  const centered = (W - layout.width * s) / 2
  if (fits(centered, s)) return place(RESERVE.top, s)

  const shifted = HUD.w - left * s
  if (shifted + layout.width * s <= W - RESERVE.x && fits(shifted, s)) return place(RESERVE.top, s, shifted)

  const shrunk = (W - RESERVE.x - HUD.w) / (layout.width - left)
  if (shrunk >= s * 0.8 && fits(HUD.w - left * shrunk, shrunk)) return place(RESERVE.top, shrunk, HUD.w - left * shrunk)

  return place(hudH, scaleAt(hudH))
}

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return size
}

export function Stage() {
  const cluster = useSim((s) => s.cluster)
  const selected = useSim((s) => s.selected)
  const hovered = useSim((s) => s.hovered)
  const select = useSim((s) => s.select)
  const epoch = useSim((s) => s.epoch)
  const paused = useSim((s) => s.paused)
  const lessonId = useSim((s) => s.lessonId)
  const lesson = getLesson(lessonId)
  const [booted, setBooted] = useState(false)
  const [hoverEdge, setHoverEdge] = useState<EdgeModel | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const size = useSize(ref)

  useEffect(() => {
    const t = setTimeout(() => setBooted(true), 850)
    return () => clearTimeout(t)
  }, [])

  const layout = useMemo(() => computeLayout(cluster), [cluster])
  const related = useMemo(() => relatedTo(cluster, selected), [cluster, selected])
  const empty = Object.keys(cluster.deployments).length === 0 && Object.keys(cluster.pods).length === 0
  const services = useMemo(() => Object.values(cluster.services), [cluster.services])

  const edges = useMemo<EdgeModel[]>(() => {
    const out: EdgeModel[] = []
    const link = (from: string, to: string, kind: EdgeModel['kind'], state: EdgeModel['state']) => {
      const a = layout.boxes[from]
      const b = layout.boxes[to]
      if (!a || !b) return
      const inChain = !!related && related.has(from) && related.has(to)
      const up = b.y < a.y
      const start = { x: a.x, y: up ? a.y - a.h / 2 : a.y + a.h / 2 }
      const end = { x: b.x, y: up ? b.y + b.h / 2 : b.y - b.h / 2 }
      out.push({
        id: `${from}>${to}`,
        d: edgePath(a, b),
        end,
        mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
        kind,
        state,
        dim: !!related && !inChain,
        active: inChain,
        from,
        to,
      })
    }
    for (const rs of Object.values(cluster.replicaSets)) link(rs.ownerUid, rs.uid, 'dep-rs', 'stable')
    for (const p of Object.values(cluster.pods))
      if (p.ownerUid) link(p.ownerUid, p.uid, 'rs-pod', p.deletedAt !== null ? 'terminating' : p.ready ? 'stable' : 'forming')
    for (const svc of services)
      for (const p of Object.values(cluster.pods))
        if (p.deletedAt === null && matches(svc.selector, p.labels)) link(svc.uid, p.uid, 'svc-pod', svc.endpoints.includes(p.uid) ? 'stable' : 'forming')
    return out
  }, [cluster, layout, related, services])

  // Selecting a Service turns every Pod into a little "does my label match?" readout.
  const probeSvc = selected ? cluster.services[selected] : undefined
  const probeKey = probeSvc ? Object.keys(probeSvc.selector)[0] : undefined
  const probeFor = (labels: Record<string, string>): Probe | null =>
    probeSvc && probeKey ? { key: probeKey, value: labels[probeKey], match: matches(probeSvc.selector, labels) } : null

  const { scale, x: offsetX, y: offsetY } = size.w
    ? fitWorld(size.w, size.h, layout, !empty, lesson.replicaControl ? HUD.withControl : HUD.h)
    : { scale: 1, x: 0, y: 0 }

  const dimmed = (uid: string) => !!related && !related.has(uid)
  const podsBySlot = new Map(Object.values(cluster.pods).map((p) => [`${p.ownerUid ?? NO_OWNER}:${p.slot}`, p]))

  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden" onClick={() => select(null)}>
      <div className="stage-grid pointer-events-none absolute inset-0" />
      {/* frozen time: a quiet amber frame instead of a modal */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-20 ring-1 ring-warn/40 ring-inset"
        initial={false}
        animate={{ opacity: paused ? 1 : 0 }}
        transition={{ duration: 0.25 }}
      />

      {!empty && (
        <motion.div
          key={epoch}
          className="absolute top-0 left-0"
          style={{ originX: 0, originY: 0, width: layout.width, height: layout.height }}
          initial={{ opacity: 0, x: offsetX, y: offsetY, scale }}
          animate={{ opacity: 1, x: offsetX, y: offsetY, scale }}
          transition={{ ...spring, opacity: { duration: 0.35 } }}
        >
          <AnimatePresence>
            {layout.regions.map((r) => (
              <motion.div
                key={r.key}
                className="pointer-events-none absolute rounded-2xl border border-dashed border-line-strong"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, left: r.x, top: r.y, width: r.w, height: r.h }}
                exit={{ opacity: 0 }}
                transition={spring}
              >
                <span className="absolute top-2 left-3 text-[10px] font-semibold tracking-[0.1em] text-fg-faint uppercase">{r.label}</span>
              </motion.div>
            ))}
          </AnimatePresence>

          <Edges edges={edges} width={layout.width} height={layout.height} onHover={setHoverEdge} />
          <Traffic layout={layout} services={services} />

          <AnimatePresence>
            {layout.slots
              .filter((s) => !podsBySlot.has(`${s.ownerUid}:${s.slot}`))
              .map((s) => {
                const vacancy = cluster.vacancies.find((v) => v.ownerUid === s.ownerUid && v.slot === s.slot)
                return (
                  <SlotPlaceholder
                    key={`slot-${s.ownerUid}-${s.slot}`}
                    geo={{ x: s.x, y: s.y, w: 158, h: 104 }}
                    ghost={vacancy?.podName ?? null}
                    reconciling={cluster.replicaSets[s.ownerUid]?.phase === 'reconciling'}
                    dim={dimmed(s.ownerUid)}
                  />
                )
              })}
          </AnimatePresence>

          <AnimatePresence>
            {Object.values(cluster.deployments).map((d) => {
              const b = layout.boxes[d.uid]
              return <DeploymentNode key={d.uid} dep={d} geo={b} dim={dimmed(d.uid)} selected={selected === d.uid} hovered={hovered === d.uid} />
            })}
            {Object.values(cluster.replicaSets).map((rs) => {
              const b = layout.boxes[rs.uid]
              const dep = cluster.deployments[rs.ownerUid]
              const active = Object.values(cluster.pods).filter((p) => p.ownerUid === rs.uid && p.deletedAt === null)
              return (
                <ReplicaSetNode
                  key={rs.uid}
                  rs={rs}
                  geo={b}
                  compact={b.compact}
                  current={!dep || dep.template.image === rs.image}
                  actual={active.length}
                  ready={active.filter((p) => p.ready).length}
                  dim={dimmed(rs.uid)}
                  selected={selected === rs.uid}
                  hovered={hovered === rs.uid}
                />
              )
            })}
            {Object.values(cluster.pods).map((p) => {
              const b = layout.boxes[p.uid]
              if (!b) return null
              return (
                <PodNode
                  key={p.uid}
                  pod={p}
                  geo={b}
                  probe={p.deletedAt === null ? probeFor(p.labels) : null}
                  dim={dimmed(p.uid)}
                  selected={selected === p.uid}
                  hovered={hovered === p.uid}
                />
              )
            })}
            {services.map((svc) => {
              const b = layout.boxes[svc.uid]
              const matched = Object.values(cluster.pods).filter((p) => p.deletedAt === null && matches(svc.selector, p.labels)).length
              return <ServiceNode key={svc.uid} svc={svc} geo={b} matched={matched} dim={dimmed(svc.uid)} selected={selected === svc.uid} hovered={hovered === svc.uid} />
            })}
          </AnimatePresence>

          <Effects layout={layout} />
          <EdgeTooltip edge={hoverEdge} cluster={cluster} />
        </motion.div>
      )}

      {/* overlays */}
      <div className="pointer-events-none absolute inset-0" onClick={(e) => e.stopPropagation()}>
        {!empty && (
          <>
            <div className="pointer-events-auto absolute top-3 left-3">
              <ReconcileHud cluster={cluster} layout={layout} replicaControl={!!lesson.replicaControl} />
            </div>
            <div className="pointer-events-auto absolute top-4 right-4 hidden sm:block">
              <Legend />
            </div>
          </>
        )}
        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
          <div className="pointer-events-auto min-w-0 max-w-[460px] flex-1">
            <Narration />
          </div>
          {!empty && (
            <div className="pointer-events-auto hidden shrink-0 sm:block">
              <NodeLane cluster={cluster} />
            </div>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {empty && (
          <div key={booted ? 'empty' : 'boot'} className="absolute inset-0 grid place-items-center" onClick={(e) => e.stopPropagation()}>
            {booted ? <EmptyState /> : <BootSkeleton />}
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
