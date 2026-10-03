import { IMAGE } from '../sim/kubectl'
import { firstIndex, livePods, podShort, ran, storyFrom } from './helpers'
import type { Lesson, LessonCtx } from './types'

const deleteUnderService = (ctx: LessonCtx) => {
  const created = firstIndex(ctx.events, (e) => e.involved.kind === 'Service' && (e.reason === 'Created' || e.reason === 'Existing'))
  return created < 0 ? -1 : firstIndex(ctx.events, (e) => e.source === 'you' && e.reason === 'Deleted' && e.involved.kind === 'Pod', created)
}

export const services: Lesson = {
  id: 'services',
  number: 3,
  track: 'Networking',
  title: 'Services & traffic',
  tagline: 'Pods come and go. A Service gives them one address that stays.',
  idea: {
    a: { label: 'Service', text: 'stable name and IP' },
    b: { label: 'Endpoints', text: 'Ready Pods, right now' },
    body: 'A Service never points at Pods by name. It selects them by label, and only Ready ones receive traffic.',
  },
  files: ['backend.yaml', 'service.yaml'],
  setup: { deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }] },
  objectives: [
    {
      id: 'expose',
      title: 'Put a Service in front',
      detail: 'Your three Pods each have their own IP — and it changes whenever a Pod is replaced. Create a Service for them.',
      suggest: () => 'kubectl apply -f service.yaml',
      uiHint: 'kubectl expose deployment backend --port=80 works too',
      done: (ctx) => Object.values(ctx.cluster.services).some((s) => s.endpoints.length > 0),
    },
    {
      id: 'endpoints',
      title: 'Find the endpoints',
      detail: 'The Service keeps a live list of the Pod IPs behind it. Look at that list — then compare it with the stage.',
      suggest: () => 'kubectl get endpoints backend',
      uiHint: 'or select the Service on the stage',
      done: (ctx) => ran(ctx.history, /^kubectl\s+(get\s+(ep|endpoints?)|describe\s+(svc|service))\b/) || ctx.seen.some((u) => ctx.cluster.services[u]),
    },
    {
      id: 'reroute',
      title: 'Delete a Pod under load',
      detail: 'Watch the requests. The terminating Pod drops out at once; its replacement only gets traffic after it is Ready.',
      suggest: (ctx) => {
        const pod = livePods(ctx.cluster)[0]
        return pod ? `kubectl delete pod ${pod.name}` : null
      },
      done: (ctx) => {
        const i = deleteUnderService(ctx)
        return i >= 0 && firstIndex(ctx.events, (e) => e.reason === 'EndpointAdded', i) >= 0
      },
    },
  ],
  completion: {
    title: 'Load balanced.',
    summary: () => 'Requests kept flowing while a Pod died and another was born. The Service never needed to know their names — only their labels and readiness.',
    story: (events) => {
      const i = firstIndex(events, (e) => e.source === 'you' && e.reason === 'Deleted' && e.involved.kind === 'Pod')
      const end = i < 0 ? -1 : firstIndex(events, (e) => e.reason === 'EndpointAdded', i)
      if (end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'Deleted', text: (e) => `You deleted ${podShort(e)}` },
        { reason: 'EndpointRemoved', text: (e) => `${podShort(e)} was removed from the endpoints — no more traffic` },
        { reason: 'SuccessfulCreate', text: (e) => `A replacement was created: ${podShort(e)}` },
        { reason: 'Started', text: () => 'Its container started — still not receiving traffic' },
        { reason: 'Ready', text: () => 'It passed its readiness probe' },
        { reason: 'EndpointAdded', text: (e) => `${podShort(e)} joined the endpoints and started getting requests` },
      ])
    },
    takeaway: 'A Service routes by label, and only to Ready Pods.',
    note: 'Here requests are spread round-robin to make it visible. Real kube-proxy picks endpoints at random (iptables) or by algorithm (IPVS).',
  },
}
