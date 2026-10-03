import { isBroken, short } from '../sim/engine'
import { IMAGE } from '../sim/kubectl'
import { firstIndex, ran, storyFrom } from './helpers'
import type { Lesson, LessonCtx } from './types'

const crashing = (ctx: LessonCtx) => Object.values(ctx.cluster.pods).find((p) => p.deletedAt === null && isBroken(p.image))

export const failures: Lesson = {
  id: 'failures',
  number: 6,
  track: 'Troubleshooting',
  title: 'Failures & rollbacks',
  tagline: 'Ship a broken version. Nobody notices — and you roll it back.',
  idea: {
    a: { label: 'Rolling update', text: 'one Pod at a time' },
    b: { label: 'Readiness', text: 'the gate it must pass' },
    body: 'A Deployment only retires old Pods when new ones are Ready. A version that never gets Ready simply never takes over.',
  },
  files: ['backend.yaml', 'service.yaml'],
  setup: {
    deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }],
    services: [{ name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 }],
  },
  objectives: [
    {
      id: 'ship',
      title: 'Ship v1.5',
      detail: 'Roll out the new version. Watch a second ReplicaSet appear and the Deployment start moving Pods over.',
      suggest: () => 'kubectl set image deployment/backend backend=ghcr.io/kubelearn/backend:1.5',
      done: (ctx) => ctx.events.some((e) => e.reason === 'BackOff'),
    },
    {
      id: 'investigate',
      title: 'Find out why it crashes',
      detail: 'The new Pod restarts over and over. The cluster is fine — the container is not. Its logs will tell you why.',
      suggest: (ctx) => {
        const p = crashing(ctx)
        return p ? `kubectl logs ${p.name}` : null
      },
      uiHint: 'or select the crashing Pod and open its logs',
      done: (ctx) => ran(ctx.history, /^kubectl\s+(logs|describe\s+pods?)\s/) && ctx.events.some((e) => e.reason === 'BackOff'),
    },
    {
      id: 'rollback',
      title: 'Roll back',
      detail: 'v1.4 is still running and still serving every request. Go back to it.',
      suggest: () => 'kubectl rollout undo deployment/backend',
      done: (ctx) => {
        const i = firstIndex(ctx.events, (e) => e.reason === 'RolledBack')
        return i >= 0 && firstIndex(ctx.events, (e) => e.reason === 'RolloutComplete', i) >= 0
      },
    },
  ],
  completion: {
    title: 'Rolled back safely.',
    summary: () => 'v1.5 crashed on start, so it never became Ready — and the Deployment never took a single v1.4 Pod down for it. The Service kept sending every request to healthy Pods.',
    story: (events) => {
      const i = firstIndex(events, (e) => e.reason === 'ImageChanged')
      const end = i < 0 ? -1 : firstIndex(events, (e) => e.reason === 'RolloutComplete', i)
      if (end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'ImageChanged', text: () => 'You asked for v1.5' },
        { reason: 'NewReplicaSet', text: () => 'A new ReplicaSet was created for it' },
        { reason: 'SuccessfulCreate', text: (e) => `It started one surge Pod: ${short(e.involved.name)}` },
        { reason: 'BackOff', text: () => 'The container crashed — CrashLoopBackOff' },
        { reason: 'RolledBack', text: () => 'You rolled back to v1.4' },
        { reason: 'Killing', text: () => 'The broken Pod was removed', pick: 'last' },
        { reason: 'RolloutComplete', text: () => 'Rollout complete — 3/3 on v1.4' },
      ])
    },
    takeaway: 'Readiness is what makes rolling updates safe.',
    note: 'With 3 replicas, the defaults (25% maxSurge, 25% maxUnavailable) allow 1 extra Pod and 0 unavailable — so nothing old goes down until something new is Ready.',
  },
}
