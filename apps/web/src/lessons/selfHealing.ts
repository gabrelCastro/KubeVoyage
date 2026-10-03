import { firstIndex, livePods, podShort, ran, storyFrom } from './helpers'
import type { Lesson, LessonCtx } from './types'

const firstDelete = (ctx: LessonCtx) =>
  firstIndex(ctx.events, (e) => e.source === 'you' && e.reason === 'Deleted')

export const selfHealing: Lesson = {
  id: 'self-healing',
  number: 1,
  track: 'Fundamentals',
  title: 'Self-healing',
  tagline: 'You describe what you want. Kubernetes keeps making it true.',
  idea: {
    a: { label: 'Desired', text: 'what you asked for' },
    b: { label: 'Actual', text: 'what is running' },
    body: 'Controllers compare the two in a loop. Whenever they differ, they act until they match. That loop is called reconciliation.',
  },
  files: ['backend.yaml'],
  objectives: [
    {
      id: 'apply',
      title: 'Declare the desired state',
      detail: 'Apply the manifest, then watch the Deployment create a ReplicaSet — and the ReplicaSet create Pods.',
      suggest: () => 'kubectl apply -f backend.yaml',
      uiHint: 'or press “Apply backend.yaml” on the stage',
      done: (ctx) => ctx.events.some((e) => e.reason === 'Reconciled'),
    },
    {
      id: 'get',
      title: 'Look at the Pods',
      detail: 'List them from the terminal. Every row is one of the cards on the stage — same state, two views.',
      suggest: () => 'kubectl get pods',
      done: (ctx) => ran(ctx.history, /^kubectl\s+get\s+(po|pod|pods|all)\b/),
    },
    {
      id: 'delete',
      title: 'Break something',
      detail: 'Delete any running Pod. Pick one with Tab completion, or select it on the stage and press Delete.',
      suggest: (ctx) => {
        const pods = livePods(ctx.cluster)
        const pod = pods[1] ?? pods[0]
        return pod ? `kubectl delete pod ${pod.name}` : null
      },
      uiHint: 'or select a Pod and use “Delete Pod” in the inspector',
      done: (ctx) => firstDelete(ctx) >= 0,
    },
    {
      id: 'heal',
      title: 'Watch it heal',
      detail: 'Hands off. Follow Desired vs Actual: the ReplicaSet notices the gap and fills it on its own.',
      done: (ctx) => {
        const i = firstDelete(ctx)
        return i >= 0 && firstIndex(ctx.events, (e) => e.reason === 'Reconciled', i) >= 0
      },
    },
    {
      id: 'chaos',
      optional: true,
      title: 'Bonus: two at once',
      detail: 'Pass two Pod names to a single delete. Does the controller keep up?',
      suggest: (ctx) => {
        const pods = livePods(ctx.cluster)
        return pods.length >= 2 ? `kubectl delete pod ${pods[0].name} ${pods[2]?.name ?? pods[1].name}` : null
      },
      done: (ctx) => {
        const byTime = new Map<number, number>()
        for (const e of ctx.events) if (e.source === 'you' && e.reason === 'Deleted') byTime.set(e.at, (byTime.get(e.at) ?? 0) + 1)
        return [...byTime.values()].some((n) => n >= 2)
      },
    },
  ],
  completion: {
    title: 'Self-healing, observed.',
    summary: () => 'Nobody told Kubernetes to replace that Pod. The ReplicaSet saw Desired ≠ Actual and closed the gap on its own.',
    story: (events) => {
      const i = firstIndex(events, (e) => e.source === 'you' && e.reason === 'Deleted')
      const end = i < 0 ? -1 : firstIndex(events, (e) => e.reason === 'Reconciled', i)
      if (end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'Deleted', text: (e) => `You deleted ${podShort(e)}` },
        { reason: 'Killing', text: () => 'It stopped counting — Actual fell below Desired' },
        { reason: 'Reconciling', text: () => 'The ReplicaSet controller noticed the gap' },
        { reason: 'SuccessfulCreate', text: (e) => `It created a replacement: ${podShort(e)}` },
        { reason: 'Scheduled', text: (e) => `The scheduler placed it on ${e.message.split(' ').pop()}` },
        { reason: 'Ready', text: () => 'The new Pod passed its readiness probe' },
        { reason: 'Reconciled', text: () => 'Desired state reconciled' },
      ])
    },
    takeaway: "You don't manage Pods. You manage desired state.",
    note: 'In a real cluster this happens in milliseconds — the replacement is often created before the old Pod finishes terminating. We slowed it down so you could watch.',
  },
}
