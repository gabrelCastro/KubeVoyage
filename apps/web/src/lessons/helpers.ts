import { short } from '../sim/engine'
import type { ClusterEvent, ClusterState } from '../sim/types'
import type { StoryStep } from './types'

export const livePods = (c: ClusterState) =>
  Object.values(c.pods)
    .filter((p) => p.deletedAt === null && p.ready)
    .sort((a, b) => a.slot - b.slot)

export const ownedPods = (c: ClusterState) => livePods(c).filter((p) => p.ownerUid !== null)

export const ran = (history: string[], re: RegExp) => history.some((h) => re.test(h.replace(/^k\s/, 'kubectl ')))

export const ranServiceRequest = (history: string[], name: string) => {
  const host = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return ran(history, new RegExp(`^kubectl\\s+run\\b.*\\s--\\s+(?:wget|curl)\\b.*https?://${host}(?::\\d+)?(?:[/\\s]|$)`))
}

export const firstIndex = (events: ClusterEvent[], pred: (e: ClusterEvent) => boolean, from = 0) => {
  for (let i = Math.max(0, from); i < events.length; i++) if (pred(events[i])) return i
  return -1
}

export const deployment = (c: ClusterState) => Object.values(c.deployments).find((d) => d.name === 'backend') ?? Object.values(c.deployments)[0]

/** Build a story from an event window: pick a few reasons, in order, with a sentence each. */
export function storyFrom(
  events: ClusterEvent[],
  start: number,
  end: number,
  beats: { reason: string; text: (e: ClusterEvent) => string; pick?: 'first' | 'last'; match?: (e: ClusterEvent) => boolean }[],
): StoryStep[] {
  const window = events.slice(start, end + 1)
  const t0 = events[start].at
  const steps = beats
    .map((b) => {
      const list = window.filter((e) => e.reason === b.reason && (!b.match || b.match(e)))
      const e = b.pick === 'last' ? list.at(-1) : list[0]
      return e ? { t: (e.at - t0) / 1000, text: b.text(e), at: e.at } : null
    })
    .filter((s): s is StoryStep & { at: number } => !!s)
    .sort((a, b) => a.at - b.at)
  return steps.map(({ t, text }, i) => ({ t, text, tone: i === 0 ? 'start' : i === steps.length - 1 ? 'end' : undefined }))
}

export const podShort = (e: ClusterEvent) => short(e.involved.name)
