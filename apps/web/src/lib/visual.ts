import clsx from 'clsx'
import { matches, NO_OWNER } from '../sim/engine'
import type { ClusterState, Pod } from '../sim/types'

export const cn = clsx

export type PodVisual = 'pending' | 'creating' | 'running' | 'ready' | 'crash' | 'terminating'

export const podVisual = (p: Pod): PodVisual =>
  p.phase === 'Terminating'
    ? 'terminating'
    : p.phase === 'Error' || p.phase === 'CrashLoopBackOff'
      ? 'crash'
      : p.phase === 'Pending'
        ? 'pending'
        : p.phase === 'ContainerCreating'
          ? 'creating'
          : p.ready
            ? 'ready'
            : 'running'

export const VISUAL: Record<PodVisual, { label: string; color: string; step: number; hint: string }> = {
  pending: { label: 'Pending', color: 'var(--color-pending)', step: 0, hint: 'Aceito pelo API server, esperando o scheduler escolher um node.' },
  creating: { label: 'ContainerCreating', color: 'var(--color-creating)', step: 1, hint: 'Já tem node. O kubelet está baixando a imagem e criando o container.' },
  running: { label: 'Running', color: 'var(--color-running)', step: 2, hint: 'O container iniciou, mas a readiness probe ainda não passou.' },
  ready: { label: 'Ready', color: 'var(--color-ready)', step: 3, hint: 'Rodando e passando na readiness probe. Conta como disponível e recebe tráfego.' },
  crash: { label: 'CrashLoopBackOff', color: 'var(--color-crash)', step: 2, hint: 'O container fica encerrando. O kubelet o reinicia com esperas cada vez maiores. Ele nunca fica Ready.' },
  terminating: { label: 'Terminating', color: 'var(--color-terminating)', step: -1, hint: 'Marcado para remoção. Não conta mais para o ReplicaSet nem recebe tráfego.' },
}

/** Text shown for a Pod's state: the real phase name for crashes (Error vs CrashLoopBackOff). */
export const podLabel = (p: Pod) => (podVisual(p) === 'crash' ? p.phase : VISUAL[podVisual(p)].label)

export const LIFECYCLE = ['Pending', 'Creating', 'Running', 'Ready'] as const

// ── Stage geometry (world coordinates, scaled to fit) ───────────────────────

export const SIZE = {
  Deployment: { w: 252, h: 78 },
  ReplicaSet: { w: 268, h: 96 },
  ReplicaSetCompact: { w: 196, h: 66 },
  Pod: { w: 158, h: 104 },
  Service: { w: 256, h: 96 },
} as const

const SLOT_W = 178
const ROW = { Deployment: 44, ReplicaSet: 176, Pod: 326, Service: 478 }
const PAD_X = 40
const GROUP_GAP = 36
const DEPLOY_GAP = 90

export type BoxKind = 'Deployment' | 'ReplicaSet' | 'Pod' | 'Service'

export interface Box {
  uid: string
  kind: BoxKind
  x: number // center
  y: number // center
  w: number
  h: number
  compact?: boolean
}

export interface Slot {
  slot: number
  ownerUid: string
  x: number
  y: number
}

/** A labelled region drawn behind a group of Pods (used for ownerless Pods). */
export interface Region {
  key: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

export interface Layout {
  boxes: Record<string, Box>
  slots: Slot[]
  regions: Region[]
  width: number
  height: number
}

export function computeLayout(c: ClusterState): Layout {
  const boxes: Record<string, Box> = {}
  const slots: Slot[] = []
  const regions: Region[] = []
  let cursor = PAD_X

  for (const dep of Object.values(c.deployments)) {
    const rss = Object.values(c.replicaSets)
      .filter((r) => r.ownerUid === dep.uid)
      .sort((a, b) => a.createdAt - b.createdAt)
    const start = cursor
    if (!rss.length) cursor += SIZE.Deployment.w
    rss.forEach((rs, i) => {
      if (i > 0) cursor += GROUP_GAP
      const pods = Object.values(c.pods).filter((p) => p.ownerUid === rs.uid)
      const vac = c.vacancies.filter((v) => v.ownerUid === rs.uid)
      const empty = rs.desired === 0 && !pods.length && !vac.length
      if (empty && rss.length > 1) {
        // an old revision kept for rollback — present, but small
        boxes[rs.uid] = { uid: rs.uid, kind: 'ReplicaSet', x: cursor + SIZE.ReplicaSetCompact.w / 2, y: ROW.ReplicaSet, ...SIZE.ReplicaSetCompact, compact: true }
        cursor += SIZE.ReplicaSetCompact.w
        return
      }
      const slotCount = Math.max(rs.desired, ...pods.map((p) => p.slot + 1), ...vac.map((v) => v.slot + 1), 1)
      const groupW = Math.max(slotCount * SLOT_W, SIZE.ReplicaSet.w + 20)
      const cx = cursor + groupW / 2
      const rowLeft = cx - (slotCount * SLOT_W) / 2
      boxes[rs.uid] = { uid: rs.uid, kind: 'ReplicaSet', x: cx, y: ROW.ReplicaSet, ...SIZE.ReplicaSet }
      for (let s = 0; s < slotCount; s++) slots.push({ slot: s, ownerUid: rs.uid, x: rowLeft + s * SLOT_W + SLOT_W / 2, y: ROW.Pod })
      for (const p of pods) boxes[p.uid] = { uid: p.uid, kind: 'Pod', x: rowLeft + p.slot * SLOT_W + SLOT_W / 2, y: ROW.Pod, ...SIZE.Pod }
      cursor += groupW
    })
    boxes[dep.uid] = { uid: dep.uid, kind: 'Deployment', x: (start + cursor) / 2, y: ROW.Deployment, ...SIZE.Deployment }
    cursor += DEPLOY_GAP
  }

  const loners = Object.values(c.pods).filter((p) => p.ownerUid === null)
  if (loners.length) {
    const count = Math.max(...loners.map((p) => p.slot + 1))
    const w = count * SLOT_W
    regions.push({ key: NO_OWNER, label: 'Sem dono', x: cursor - 8, y: ROW.Pod - SIZE.Pod.h / 2 - 30, w: w + 16, h: SIZE.Pod.h + 42 })
    for (const p of loners) boxes[p.uid] = { uid: p.uid, kind: 'Pod', x: cursor + p.slot * SLOT_W + SLOT_W / 2, y: ROW.Pod, ...SIZE.Pod }
    cursor += w + DEPLOY_GAP
  }

  const width = Math.max(cursor - DEPLOY_GAP + PAD_X, 640)
  const services = Object.values(c.services)
  services.forEach((svc, i) => {
    // sit under the Pods it selects; slide along when that changes
    const xs = Object.values(c.pods)
      .filter((p) => p.deletedAt === null && matches(svc.selector, p.labels) && boxes[p.uid])
      .map((p) => boxes[p.uid].x)
    const fallback = Object.values(boxes).find((b) => b.kind === 'Deployment')?.x ?? width / 2
    const x = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback
    boxes[svc.uid] = { uid: svc.uid, kind: 'Service', x: x + i * (SIZE.Service.w + 30), y: ROW.Service, ...SIZE.Service }
  })

  const height = services.length ? ROW.Service + SIZE.Service.h / 2 + 34 : ROW.Pod + SIZE.Pod.h / 2 + 14
  return { boxes, slots, regions, width, height }
}

/**
 * Edge geometry as a soft S-curve. Ownership flows downward (parent bottom → child top);
 * Service edges flow upward (Service top → Pod bottom).
 */
export function edgePath(a: Box, b: Box) {
  const down = b.y >= a.y
  const x1 = a.x
  const y1 = down ? a.y + a.h / 2 : a.y - a.h / 2
  const x2 = b.x
  const y2 = down ? b.y - b.h / 2 : b.y + b.h / 2
  const my = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${my} ${x2} ${my} ${x2} ${y2}`
}

/** Everything connected to a resource: owners up, owned things down, and Services ↔ the Pods they select. */
export function relatedTo(c: ClusterState, uid: string | null): Set<string> | null {
  if (!uid || !kindOf(c, uid)) return null
  const set = new Set<string>([uid])
  const svc = c.services[uid]
  if (svc) {
    for (const p of Object.values(c.pods)) if (p.deletedAt === null && matches(svc.selector, p.labels)) set.add(p.uid)
    return set
  }
  const ownerOf = (id: string) => c.replicaSets[id]?.ownerUid ?? c.pods[id]?.ownerUid ?? null
  for (let o = ownerOf(uid); o; o = ownerOf(o)) set.add(o)
  const down = (id: string) => {
    for (const rs of Object.values(c.replicaSets)) if (rs.ownerUid === id && !set.has(rs.uid)) (set.add(rs.uid), down(rs.uid))
    for (const p of Object.values(c.pods)) if (p.ownerUid === id) set.add(p.uid)
  }
  down(uid)
  for (const s of Object.values(c.services)) {
    if ([...set].some((id) => c.pods[id] && c.pods[id].deletedAt === null && matches(s.selector, c.pods[id].labels))) set.add(s.uid)
  }
  return set
}

export const kindOf = (c: ClusterState, uid: string): BoxKind | null =>
  c.deployments[uid] ? 'Deployment' : c.replicaSets[uid] ? 'ReplicaSet' : c.pods[uid] ? 'Pod' : c.services[uid] ? 'Service' : null

export const spring = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 } as const
export const softSpring = { type: 'spring', stiffness: 170, damping: 24 } as const
