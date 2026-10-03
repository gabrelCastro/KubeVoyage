import { short } from '../sim/engine'
import { IMAGE } from '../sim/kubectl'
import { firstIndex, ownedPods, ran, storyFrom, podShort } from './helpers'
import type { Lesson, LessonCtx } from './types'

const svc = (ctx: LessonCtx) => Object.values(ctx.cluster.services)[0]
const frontend = (ctx: LessonCtx) => Object.values(ctx.cluster.pods).find((p) => p.name === 'frontend')
const lastOrphan = (ctx: LessonCtx) => [...ctx.events].reverse().find((e) => e.reason === 'Orphaned')

export const labels: Lesson = {
  id: 'labels',
  number: 4,
  track: 'Networking',
  title: 'Labels & selectors',
  tagline: 'Nothing in Kubernetes is wired by name. Labels are the glue.',
  idea: {
    a: { label: 'Labels', text: 'tags on every Pod' },
    b: { label: 'Selectors', text: 'queries over tags' },
    body: 'Services and ReplicaSets both find their Pods with a selector. Change a label and you change who belongs to what — instantly.',
  },
  files: ['backend.yaml', 'service.yaml'],
  setup: {
    deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }],
    pods: [{ name: 'frontend', labels: { app: 'frontend' }, image: 'ghcr.io/kubelearn/frontend:2.0' }],
    services: [{ name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 }],
  },
  objectives: [
    {
      id: 'inspect',
      title: 'See what the Service selects',
      detail: 'Select the Service. Every Pod shows the one label that decides whether it matches app=backend.',
      uiHint: 'or list labels in the terminal',
      suggest: () => 'kubectl get pods --show-labels',
      done: (ctx) => ctx.seen.some((u) => ctx.cluster.services[u]) || ran(ctx.history, /--show-labels/),
    },
    {
      id: 'join',
      title: 'Make frontend match',
      detail: "frontend wasn't created by the Deployment. Give it app=backend anyway, and see whether the Service cares.",
      suggest: () => 'kubectl label pod frontend app=backend --overwrite',
      done: (ctx) => {
        const fe = frontend(ctx)
        return !!fe && !!svc(ctx)?.endpoints.includes(fe.uid)
      },
    },
    {
      id: 'quarantine',
      title: 'Pull a Pod out for debugging',
      detail: 'Relabel one backend Pod to app=debug. It leaves the Service and its ReplicaSet — which replaces it. The Pod itself keeps running.',
      suggest: (ctx) => {
        const pod = ownedPods(ctx.cluster)[1] ?? ownedPods(ctx.cluster)[0]
        return pod ? `kubectl label pod ${pod.name} app=debug --overwrite` : null
      },
      done: (ctx) => ctx.events.some((e) => e.reason === 'Orphaned'),
    },
    {
      id: 'return',
      optional: true,
      title: 'Bonus: put it back',
      detail: 'Give it app=backend again. The ReplicaSet adopts it — and now has one Pod too many.',
      suggest: (ctx) => {
        const o = lastOrphan(ctx)
        return o && ctx.cluster.pods[o.involved.uid] ? `kubectl label pod ${o.involved.name} app=backend --overwrite` : null
      },
      done: (ctx) => ctx.events.some((e) => e.reason === 'Adopted'),
    },
  ],
  completion: {
    title: 'Labels are the glue.',
    summary: (ctx) => {
      const o = lastOrphan(ctx)
      return `A Pod nobody owned joined the Service because of one label${o ? `, and ${short(o.involved.name)} left both its Service and its ReplicaSet because of another` : ''}. No names, no wiring — just selectors.`
    },
    story: (events) => {
      const i = firstIndex(events, (e) => e.reason === 'Labeled')
      const orphaned = i < 0 ? -1 : firstIndex(events, (e) => e.reason === 'Orphaned', i)
      const end = orphaned < 0 ? -1 : firstIndex(events, (e) => e.reason === 'Reconciled', orphaned)
      if (end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'Labeled', text: (e) => `You relabeled ${podShort(e)}` },
        { reason: 'EndpointAdded', text: (e) => `${podShort(e)} matched the Service and joined its endpoints` },
        { reason: 'Orphaned', text: (e) => `${podShort(e)} stopped matching — its ReplicaSet let go` },
        { reason: 'EndpointRemoved', text: (e) => `${podShort(e)} left the Service`, pick: 'last' },
        { reason: 'SuccessfulCreate', text: (e) => `The ReplicaSet created ${podShort(e)} to make up the count`, pick: 'last' },
        { reason: 'Reconciled', text: () => 'Desired state reconciled', pick: 'last' },
      ])
    },
    takeaway: 'Selectors, not names or owners, decide what belongs together.',
    note: 'Relabeling a misbehaving Pod out of its Service is a real debugging technique: it stops getting traffic, gets replaced, and stays alive for you to inspect.',
  },
}
