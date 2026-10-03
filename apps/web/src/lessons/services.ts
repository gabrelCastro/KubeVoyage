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
  track: 'Rede',
  title: 'Services e tráfego',
  tagline: 'Pods vêm e vão. Um Service dá a eles um endereço que fica.',
  idea: {
    a: { label: 'Service', text: 'nome e IP estáveis' },
    b: { label: 'Endpoints', text: 'os Pods Ready, agora' },
    body: 'Um Service nunca aponta para Pods pelo nome. Ele os seleciona por label, e só os que estão Ready recebem tráfego.',
  },
  files: ['backend.yaml', 'service.yaml'],
  setup: { deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }] },
  objectives: [
    {
      id: 'expose',
      title: 'Coloque um Service na frente',
      detail: 'Cada um dos três Pods tem seu próprio IP — e ele muda sempre que um Pod é substituído. Crie um Service para eles.',
      suggest: () => 'kubectl apply -f service.yaml',
      uiHint: 'kubectl expose deployment backend --port=80 também funciona',
      done: (ctx) => Object.values(ctx.cluster.services).some((s) => s.endpoints.length > 0),
    },
    {
      id: 'endpoints',
      title: 'Encontre os endpoints',
      detail: 'O Service mantém uma lista atualizada dos IPs dos Pods por trás dele. Veja essa lista — e compare com o palco.',
      suggest: () => 'kubectl get endpoints backend',
      uiHint: 'ou selecione o Service no palco',
      done: (ctx) => ran(ctx.history, /^kubectl\s+(get\s+(ep|endpoints?)|describe\s+(svc|service))\b/) || ctx.seen.some((u) => ctx.cluster.services[u]),
    },
    {
      id: 'reroute',
      title: 'Apague um Pod com tráfego',
      detail: 'Observe as requisições. O Pod em Terminating sai na hora; o substituto só recebe tráfego depois de ficar Ready.',
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
    title: 'Carga balanceada.',
    summary: () => 'As requisições continuaram chegando enquanto um Pod morria e outro nascia. O Service nunca precisou saber os nomes — só as labels e se estavam Ready.',
    story: (events) => {
      const i = firstIndex(events, (e) => e.source === 'you' && e.reason === 'Deleted' && e.involved.kind === 'Pod')
      const end = i < 0 ? -1 : firstIndex(events, (e) => e.reason === 'EndpointAdded', i)
      if (end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'Deleted', text: (e) => `Você apagou ${podShort(e)}` },
        { reason: 'EndpointRemoved', text: (e) => `${podShort(e)} saiu dos endpoints — sem mais tráfego` },
        { reason: 'SuccessfulCreate', text: (e) => `Um substituto foi criado: ${podShort(e)}` },
        { reason: 'Started', text: () => 'O container iniciou — ainda sem receber tráfego' },
        { reason: 'Ready', text: () => 'Ele passou na readiness probe' },
        { reason: 'EndpointAdded', text: (e) => `${podShort(e)} entrou nos endpoints e começou a receber requisições` },
      ])
    },
    takeaway: 'Um Service roteia por label, e só para Pods Ready.',
    note: 'Aqui as requisições são distribuídas em rodízio para ficar visível. O kube-proxy real escolhe endpoints aleatoriamente (iptables) ou por algoritmo (IPVS).',
  },
}
