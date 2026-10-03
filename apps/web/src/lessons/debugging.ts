import { IMAGE } from '../sim/kubectl'
import { firstIndex, ran } from './helpers'
import type { Lesson, LessonCtx } from './types'

const svc = (ctx: LessonCtx) => Object.values(ctx.cluster.services)[0]

export const debugging: Lesson = {
  id: 'debugging',
  number: 5,
  track: 'Troubleshooting',
  title: 'Depuração: sem endpoints',
  tagline: 'Tudo está rodando. Nada funciona. Descubra por quê.',
  idea: {
    a: { label: 'Sintoma', text: 'requisições falham com 503' },
    b: { label: 'Causa', text: '…é você quem vai descobrir' },
    body: 'Use o palco como um mapa: o que está conectado, e o que não está? Depois confirme com kubectl antes de mudar qualquer coisa.',
  },
  files: ['backend.yaml'],
  setup: {
    deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }],
    services: [{ name: 'backend', selector: { app: 'api' }, port: 80, targetPort: 8080 }],
  },
  objectives: [
    {
      id: 'notice',
      title: 'Pergunte ao Service',
      detail: 'As requisições para o Service backend estão falhando. Para onde o Service acha que deveria mandá-las?',
      suggest: () => 'kubectl describe service backend',
      uiHint: 'ou selecione o Service no palco',
      done: (ctx) => ran(ctx.history, /^kubectl\s+(describe\s+(svc|service)|get\s+(ep|endpoints?|svc|services?))\b/) || ctx.seen.some((u) => ctx.cluster.services[u]),
    },
    {
      id: 'compare',
      title: 'Pergunte aos Pods',
      detail: 'Os Pods estão Running e Ready. Que labels eles realmente têm?',
      suggest: () => 'kubectl get pods --show-labels',
      uiHint: 'ou selecione um dos Pods',
      done: (ctx) => ran(ctx.history, /--show-labels|describe\s+pods?\b/) || ctx.seen.some((u) => ctx.cluster.pods[u]),
    },
    {
      id: 'fix',
      title: 'Conserte',
      detail: 'Faça o Service e os Pods concordarem — sem reiniciar nem recriar nada.',
      hint: {
        text: 'O Service seleciona app=api, mas todos os Pods têm a label app=backend. Mude o selector do Service.',
        command: 'kubectl set selector service backend app=backend',
      },
      done: (ctx) => (svc(ctx)?.endpoints.length ?? 0) > 0,
    },
  ],
  completion: {
    title: 'Consertado — o tráfego voltou.',
    summary: (ctx) => {
      const fix = [...ctx.events].reverse().find((e) => e.reason === 'SelectorChanged' || e.reason === 'Labeled')
      return fix?.reason === 'SelectorChanged'
        ? 'Os Pods estavam bem o tempo todo. O Service pedia app=api, e ninguém tinha essa label. Uma mudança no selector e os endpoints apareceram na hora.'
        : 'Os Pods estavam bem o tempo todo — o Service pedia uma label que ninguém tinha. Você fez os dois concordarem, e os endpoints apareceram na hora.'
    },
    story: (events) => {
      const end = firstIndex(events, (e) => e.reason === 'EndpointAdded')
      const fix = [...events.slice(0, end)].reverse().find((e) => e.source === 'you')
      if (end < 0 || !fix) return null
      return [
        { t: 0, text: 'Selector do Service: app=api — labels dos Pods: app=backend', tone: 'start' as const },
        { t: 0, text: 'Endpoints: <none> → toda requisição respondida com 503' },
        { t: (events[end].at - fix.at) / 1000, text: `Você mudou ${fix.reason === 'SelectorChanged' ? 'o selector' : 'uma label'}` },
        { t: (events[end].at - fix.at) / 1000, text: 'O endpoints controller encontrou Pods Ready — o tráfego voltou', tone: 'end' as const },
      ]
    },
    takeaway: 'Sem endpoints? Compare o selector do Service com as labels dos Pods.',
    note: 'Este é um dos erros de configuração mais comuns no Kubernetes — geralmente um erro de digitação, ou uma label renomeada de um lado só.',
  },
}
