import { IMAGE } from '../sim/kubectl'
import { deployment, firstIndex, ran, storyFrom } from './helpers'
import type { Lesson, LessonCtx } from './types'

const settledAt = (ctx: LessonCtx, pred: (n: number) => boolean) => {
  const dep = deployment(ctx.cluster)
  if (!dep || !pred(dep.replicas)) return false
  const pods = Object.values(ctx.cluster.pods).filter((p) => p.deletedAt === null && p.ownerUid)
  return pods.length === dep.replicas && pods.every((p) => p.ready)
}

export const scaling: Lesson = {
  id: 'scaling',
  number: 2,
  track: 'Fundamentals',
  title: 'Scaling',
  tagline: 'Change one number. Watch the cluster do the arithmetic.',
  idea: {
    a: { label: 'replicas: 5', text: 'one field you edit' },
    b: { label: 'Pods', text: 'created or removed' },
    body: 'Scaling is not a special operation. It is a change to desired state; the ReplicaSet creates or terminates the difference.',
  },
  files: ['backend.yaml'],
  setup: { deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }] },
  replicaControl: true,
  objectives: [
    {
      id: 'drag',
      title: 'Ask for 5 replicas',
      detail: 'Drag the replicas control on the stage to 5. No commands yet — just change what you want and watch.',
      uiHint: 'the control is in the top-left panel, under Desired vs Actual',
      done: (ctx) => settledAt(ctx, (n) => n >= 5),
    },
    {
      id: 'command',
      title: 'Now say it in kubectl',
      detail: 'What you just did is a single command. Use it to scale down to 2, and watch which Pods are chosen to go.',
      suggest: () => 'kubectl scale deployment backend --replicas=2',
      done: (ctx) => ran(ctx.history, /^kubectl\s+scale\b.*--replicas=2\b/) && settledAt(ctx, (n) => n === 2),
    },
    {
      id: 'zero',
      optional: true,
      title: 'Bonus: scale to zero',
      detail: 'Ask for 0. The Pods go away — but the Deployment and ReplicaSet stay, ready to scale back up.',
      suggest: () => 'kubectl scale deployment backend --replicas=0',
      done: (ctx) => deployment(ctx.cluster)?.replicas === 0 && !Object.values(ctx.cluster.pods).length,
    },
  ],
  completion: {
    title: 'Scaling, understood.',
    summary: () => 'You changed one number. The ReplicaSet created Pods when Actual < Desired and terminated them when Actual > Desired — newest and least-ready first.',
    story: (events) => {
      const i = firstIndex(events, (e) => e.reason === 'Scaled')
      if (i < 0) return null
      let end = -1
      for (let j = events.length - 1; j > i; j--) if (events[j].reason === 'Reconciled') (end = j), (j = 0)
      if (end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'Scaled', text: (e) => `You changed replicas ${e.message.split('replicas ')[1]}` },
        { reason: 'ScalingReplicaSet', text: (e) => `The Deployment told its ReplicaSet: ${e.message.split(' to ').pop()}` },
        { reason: 'SuccessfulCreate', text: () => 'New Pods were created to fill the gap' },
        { reason: 'Killing', text: () => 'Surplus Pods were terminated', pick: 'last' },
        { reason: 'Reconciled', text: (e) => `Reconciled — ${e.message.split('— ')[1]}`, pick: 'last' },
      ])
    },
    takeaway: 'Scaling is just a change to desired state.',
    note: 'Horizontal Pod Autoscalers do exactly what you did — they just change the replicas field for you, based on load.',
  },
}
