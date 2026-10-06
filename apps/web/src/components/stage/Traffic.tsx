import { AnimatePresence, motion } from 'motion/react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { Service } from '../../sim/types'
import type { Box, Layout } from '../../lib/visual'
import { BASE_TRAFFIC, codeProfile } from '../../sim/engine'
import { useApp, visitReply, type Visit } from '../../store/useApp'
import { useSim } from '../../store/useSim'

const INTERVAL = 460 // ms between simulated requests per Service, at 1×
const TRAVEL = 720
/** How often counters and the app window catch up with arrivals. */
const FLUSH_MS = 200

const addCounts = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a }
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n
  return out
}
const STUB = 30 // the "incoming requests" lead-in under each Service

/** Path a request takes: up through the Service, then along its edge into the Pod's bottom. */
function requestPath(svc: Box, pod: Box) {
  const x = svc.x
  const start = svc.y + svc.h / 2 + STUB
  const top = svc.y - svc.h / 2
  const px = pod.x
  const py = pod.y + pod.h / 2
  const my = (top + py) / 2
  return `M ${x} ${start} L ${x} ${top} C ${x} ${my} ${px} ${my} ${px} ${py}`
}

const failPath = (svc: Box) => `M ${svc.x} ${svc.y + svc.h / 2 + STUB} L ${svc.x} ${svc.y + svc.h / 2 - 6}`

/**
 * Simulated requests. Nothing real is sent: this is a picture of load balancing,
 * driven by the endpoints the simulation computed. Requests only ever reach Ready Pods.
 */
export const Traffic = memo(function Traffic({ layout, services }: { layout: Layout; services: Service[] }) {
  const paused = useSim((s) => s.paused)
  const speed = useSim((s) => s.speed)
  const reduced = useSim((s) => s.reducedMotion)
  const epoch = useSim((s) => s.epoch)
  const host = useRef<HTMLDivElement>(null)
  const live = useRef(new Set<Animation>())
  const rr = useRef<Record<string, number>>({})
  const [served, setServed] = useState<Record<string, number>>({})
  const [failed, setFailed] = useState<Record<string, number>>({})
  const latest = useRef({ layout, services })
  latest.current = { layout, services }

  // Arrivals are counted in bursts: under load, one React update per request (dozens a second, each
  // remeasuring the stage) cost more than the whole simulation. The picture moves per request; the
  // numbers catch up a few times a second.
  const pending = useRef({ served: {} as Record<string, number>, failed: {} as Record<string, number>, visits: [] as Omit<Visit, 'id'>[], timer: 0 })
  const flush = useCallback(() => {
    const p = pending.current
    p.timer = 0
    const { served: sv, failed: fl, visits } = p
    p.served = {}
    p.failed = {}
    p.visits = []
    if (Object.keys(sv).length) setServed((s) => addCounts(s, sv))
    if (Object.keys(fl).length) setFailed((f) => addCounts(f, fl))
    useApp.getState().visitMany(visits)
  }, [])
  const later = useCallback(() => {
    if (!pending.current.timer) pending.current.timer = window.setTimeout(flush, FLUSH_MS)
  }, [flush])
  useEffect(() => () => clearTimeout(pending.current.timer), [])

  useEffect(() => {
    // a restarted lesson is a new cluster: whatever was still being counted belongs to the old one
    clearTimeout(pending.current.timer)
    pending.current = { served: {}, failed: {}, visits: [], timer: 0 }
    setServed({})
    setFailed({})
    useApp.getState().resetVisits()
  }, [epoch])

  // freeze in-flight requests with the rest of the cluster
  useEffect(() => {
    live.current.forEach((a) => (paused ? a.pause() : a.play()))
  }, [paused])

  const hasServices = services.length > 0
  useEffect(() => {
    if (paused || !hasServices) return
    const spawn = () => {
      const { layout, services } = latest.current
      // the app window shows what visitors of the app's Service get
      const appSvc = services.find((s) => s.name === 'backend') ?? services[0]
      // a request still in flight when the lesson restarts belongs to the old run: don't count it
      const run = useSim.getState().epoch
      const current = () => useSim.getState().epoch === run
      const visit = (v: Omit<Visit, 'id'>) => {
        pending.current.visits.push(v)
        later()
      }
      for (const svc of services) {
        const sBox = layout.boxes[svc.uid]
        if (!sBox) continue
        const targets = svc.endpoints.filter((uid) => layout.boxes[uid])
        if (!targets.length) {
          fly(failPath(sBox), true, () => {
            if (!current()) return
            pending.current.failed[svc.uid] = (pending.current.failed[svc.uid] ?? 0) + 1
            later()
            if (svc === appSvc) visit({ ok: false })
          })
          continue
        }
        const i = (rr.current[svc.uid] = ((rr.current[svc.uid] ?? -1) + 1) % targets.length)
        const pod = targets[i]
        fly(requestPath(sBox, layout.boxes[pod]), false, () => {
          if (!current()) return
          pending.current.served[pod] = (pending.current.served[pod] ?? 0) + 1
          later()
          const served = useSim.getState().cluster.pods[pod]
          if (svc === appSvc) {
            // a Pod running the learner's code answers with what the code returned for /
            const code = served ? codeProfile(served.image, served.env) : null
            const reply = code && code !== 'pending' ? visitReply(code.replies['/']) : undefined
            visit({ ok: true, podUid: pod, podName: served?.name, image: served?.image, edited: useApp.getState().podEdits[pod], configMessage: served?.env?.APP_MESSAGE, ...(reply && { reply }) })
          }
        })
      }
    }
    const fly = (d: string, fail: boolean, done: () => void) => {
      if (reduced || !host.current) return done()
      const el = document.createElement('span')
      el.className = fail ? 'traffic-dot traffic-dot--fail' : 'traffic-dot'
      el.style.offsetPath = `path("${d}")`
      host.current.appendChild(el)
      const anim = el.animate(
        fail
          ? [{ offsetDistance: '0%', opacity: 0 }, { offsetDistance: '60%', opacity: 1, offset: 0.6 }, { offsetDistance: '100%', opacity: 0, transform: 'scale(2.2)' }]
          : [{ offsetDistance: '0%', opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.9 }, { offsetDistance: '100%', opacity: 0 }],
        { duration: (fail ? TRAVEL * 0.5 : TRAVEL) / speed, easing: 'cubic-bezier(0.45, 0, 0.35, 1)', fill: 'forwards' },
      )
      live.current.add(anim)
      anim.onfinish = () => {
        live.current.delete(anim)
        el.remove()
        done()
      }
    }
    // a load generator makes the stream visibly heavier (capped, so the picture stays readable)
    let t = 0
    const tick = () => {
      spawn()
      const { services } = latest.current
      const app = services.find((x) => x.name === 'backend') ?? services[0]
      const factor = app ? Math.min(4, useSim.getState().sim.trafficTo(app.name) / BASE_TRAFFIC) : 1
      t = window.setTimeout(tick, INTERVAL / speed / factor)
    }
    t = window.setTimeout(tick, INTERVAL / speed)
    return () => clearTimeout(t)
  }, [paused, speed, reduced, hasServices, later])

  return (
    <div className="pointer-events-none absolute top-0 left-0" style={{ width: layout.width, height: layout.height }}>
      {/* incoming lead-in under each Service */}
      {services.map((svc) => {
        const b = layout.boxes[svc.uid]
        if (!b) return null
        const none = !svc.endpoints.length
        return (
          <motion.div
            key={svc.uid}
            className="absolute flex flex-col items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, left: b.x, top: b.y + b.h / 2 }}
            style={{ x: '-50%' }}
          >
            <span className="h-[30px] w-px" style={{ background: `linear-gradient(to top, transparent, ${none ? 'var(--color-crash)' : 'var(--color-svc)'})`, opacity: 0.6 }} />
            <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] whitespace-nowrap text-fg-faint">
              requisições
              <AnimatePresence>
                {none && (failed[svc.uid] ?? 0) > 0 && (
                  <motion.span key="fail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-crash">
                    · recusadas × {failed[svc.uid]}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </motion.div>
        )
      })}
      <div ref={host} className="absolute inset-0" />
      {/* per-Pod request counters: load balancing, made countable */}
      {Object.entries(served).map(([uid, n]) => {
        const b = layout.boxes[uid]
        if (!b) return null
        const receiving = services.some((s) => s.endpoints.includes(uid))
        return (
          <motion.span
            key={uid}
            className="absolute flex items-center gap-1 rounded-full border border-svc/30 bg-panel px-1.5 font-mono text-[10px] text-svc tabular-nums"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: receiving ? 1 : 0.4, scale: 1, left: b.x + b.w / 2, top: b.y + b.h / 2 + 4 }}
            style={{ x: '-100%' }}
            title="Requisições que este Pod recebeu"
          >
            <motion.span key={n} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="inline-block">
              ↑
            </motion.span>
            {n}
          </motion.span>
        )
      })}
    </div>
  )
})
