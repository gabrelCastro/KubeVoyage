import { IMAGE } from '../sim/kubectl'
import { firstIndex, ran } from './helpers'
import type { Lesson, LessonCtx } from './types'

const svc = (ctx: LessonCtx) => Object.values(ctx.cluster.services)[0]

export const debugging: Lesson = {
  id: 'debugging',
  number: 5,
  track: 'Troubleshooting',
  title: 'Debugging: no endpoints',
  tagline: 'Everything is running. Nothing works. Find out why.',
  idea: {
    a: { label: 'Symptom', text: 'requests fail with 503' },
    b: { label: 'Cause', text: '…that’s for you to find' },
    body: 'Use the stage like a map: what is connected, and what isn’t? Then confirm with kubectl before you change anything.',
  },
  files: ['backend.yaml'],
  setup: {
    deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }],
    services: [{ name: 'backend', selector: { app: 'api' }, port: 80, targetPort: 8080 }],
  },
  objectives: [
    {
      id: 'notice',
      title: 'Ask the Service',
      detail: 'Requests to the backend Service are failing. What does the Service think it should be sending them to?',
      suggest: () => 'kubectl describe service backend',
      uiHint: 'or select the Service on the stage',
      done: (ctx) => ran(ctx.history, /^kubectl\s+(describe\s+(svc|service)|get\s+(ep|endpoints?|svc|services?))\b/) || ctx.seen.some((u) => ctx.cluster.services[u]),
    },
    {
      id: 'compare',
      title: 'Ask the Pods',
      detail: 'The Pods are Running and Ready. What labels do they actually carry?',
      suggest: () => 'kubectl get pods --show-labels',
      uiHint: 'or select one of the Pods',
      done: (ctx) => ran(ctx.history, /--show-labels|describe\s+pods?\b/) || ctx.seen.some((u) => ctx.cluster.pods[u]),
    },
    {
      id: 'fix',
      title: 'Fix it',
      detail: 'Make the Service and the Pods agree — without restarting or recreating anything.',
      hint: {
        text: "The Service selects app=api, but every Pod is labelled app=backend. Change the Service's selector.",
        command: 'kubectl set selector service backend app=backend',
      },
      done: (ctx) => (svc(ctx)?.endpoints.length ?? 0) > 0,
    },
  ],
  completion: {
    title: 'Fixed — traffic is flowing.',
    summary: (ctx) => {
      const fix = [...ctx.events].reverse().find((e) => e.reason === 'SelectorChanged' || e.reason === 'Labeled')
      return fix?.reason === 'SelectorChanged'
        ? 'The Pods were fine all along. The Service was asking for app=api, and nobody had that label. One selector change, and the endpoints appeared instantly.'
        : 'The Pods were fine all along — the Service was asking for a label nobody had. You made them agree, and the endpoints appeared instantly.'
    },
    story: (events) => {
      const end = firstIndex(events, (e) => e.reason === 'EndpointAdded')
      const fix = [...events.slice(0, end)].reverse().find((e) => e.source === 'you')
      if (end < 0 || !fix) return null
      return [
        { t: 0, text: 'Service selector: app=api — Pod labels: app=backend', tone: 'start' as const },
        { t: 0, text: 'Endpoints: <none> → every request answered 503' },
        { t: (events[end].at - fix.at) / 1000, text: `You changed ${fix.reason === 'SelectorChanged' ? 'the selector' : 'a label'}` },
        { t: (events[end].at - fix.at) / 1000, text: 'The endpoints controller found Ready Pods — traffic resumed', tone: 'end' as const },
      ]
    },
    takeaway: 'No endpoints? Compare the Service’s selector with the Pods’ labels.',
    note: 'This is one of the most common Kubernetes misconfigurations — usually a typo, or a label renamed on one side only.',
  },
}
