import { IMAGE } from '../sim/manifests'
import { firstIndex, ran, storyFrom } from './helpers'
import type { Lesson, LessonCtx } from './types'

const node = (ctx: LessonCtx, name: string) => ctx.cluster.nodes.find((item) => item.name === name)
const daemonSet = (ctx: LessonCtx) => Object.values(ctx.cluster.daemonSets).find((item) => item.name === 'log-agent')
const livePods = (ctx: LessonCtx) => Object.values(ctx.cluster.pods).filter((pod) => pod.deletedAt === null)

export const nodes: Lesson = {
  id: 'nodes',
  number: 12,
  track: 'Operação',
  title: 'Nodes e DaemonSets',
  tagline: 'Tire uma máquina de serviço sem derrubar o app — e mantenha um agente em cada node.',
  idea: {
    a: { label: 'Deployment', text: 'mantém N Pods no cluster' },
    b: { label: 'DaemonSet', text: 'mantém um Pod em cada node' },
    body: 'Para manter um app disponível, você pode mover suas réplicas entre nodes. Para tarefas ligadas à própria máquina — como coletar logs — o DaemonSet deixa um agente em cada uma.',
  },
  files: ['log-agent.yaml'],
  setup: {
    deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }],
    services: [{ name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 }],
  },
  objectives: [
    {
      id: 'daemonset',
      title: 'Cubra todos os nodes',
      detail: 'Aplique o agente de logs. O DaemonSet controller cria uma cópia em cada node — não uma quantidade fixa de réplicas.',
      suggest: () => 'kubectl apply -f log-agent.yaml',
      uiHint: 'confira com kubectl get daemonsets e kubectl get pods -o wide',
      done: (ctx) => {
        const ds = daemonSet(ctx)
        return !!ds && ctx.cluster.nodes.every((n) => livePods(ctx).some((pod) => pod.ownerUid === ds.uid && pod.nodeName === n.name && pod.ready))
      },
    },
    {
      id: 'drain-blocked',
      title: 'Tente esvaziar o node-2',
      detail: 'Faça o drain sem flags. O comando encontra o agente do DaemonSet e para — mas o node já fica em cordon, sem receber Pods novos.',
      suggest: () => 'kubectl drain node-2',
      done: (ctx) => ctx.events.some((event) => event.reason === 'NodeNotSchedulable' && event.involved.name === 'node-2') && ran(ctx.history, /^kubectl\s+drain\s+(node\/)?node-2\s*$/),
    },
    {
      id: 'drain',
      title: 'Esvazie o que pode sair',
      detail: 'Ignore os Pods do DaemonSet no drain. O agente fica; o Pod do backend sai e o ReplicaSet recupera as 3 réplicas nos outros nodes.',
      suggest: () => 'kubectl drain node-2 --ignore-daemonsets',
      uiHint: 'acompanhe os nodes e os Pods no rodapé do palco',
      done: (ctx) => {
        const ds = daemonSet(ctx)
        const pods = livePods(ctx)
        const backend = pods.filter((pod) => pod.labels.app === 'backend')
        return !!ds && backend.length === 3 && backend.every((pod) => pod.ready && pod.nodeName !== 'node-2') && pods.some((pod) => pod.ownerUid === ds.uid && pod.nodeName === 'node-2')
      },
    },
    {
      id: 'uncordon',
      title: 'Devolva o node à escala',
      detail: 'Terminada a manutenção, libere o node. Os Pods que foram movidos não voltam sozinhos; o node apenas pode receber novos Pods outra vez.',
      suggest: () => 'kubectl uncordon node-2',
      done: (ctx) => ran(ctx.history, /^kubectl\s+uncordon\s+(node\/)?node-2\s*$/) && node(ctx, 'node-2')?.unschedulable === false,
    },
  ],
  completion: {
    title: 'Manutenção sem apagar o papel de cada Pod.',
    summary: () =>
      'O node-2 saiu da escala, o drain moveu o backend para nodes disponíveis e preservou o agente local do DaemonSet. Depois do uncordon, a máquina voltou a aceitar Pods novos — sem puxar de volta os que já estavam saudáveis em outro lugar.',
    story: (events) => {
      const start = firstIndex(events, (event) => event.reason === 'DaemonSetCreated')
      const end = firstIndex(events, (event) => event.reason === 'NodeSchedulable', start)
      if (start < 0 || end < 0) return null
      return storyFrom(events, start, end, [
        { reason: 'DaemonSetCreated', text: () => 'Você criou o DaemonSet log-agent' },
        { reason: 'SuccessfulCreate', text: () => 'O controller distribuiu um agente em cada node', pick: 'last', match: (event) => event.source === 'daemonset-controller' },
        { reason: 'NodeNotSchedulable', text: () => 'O drain colocou o node-2 em cordon' },
        { reason: 'Evicted', text: () => 'O Pod do backend saiu do node-2' },
        { reason: 'Reconciled', text: () => 'O ReplicaSet recuperou 3 Pods Ready nos outros nodes', pick: 'last' },
        { reason: 'NodeSchedulable', text: () => 'Você liberou o node-2 para novos Pods' },
      ])
    },
    takeaway: 'Cordon impede agendamentos novos; drain despeja as cargas administráveis; uncordon reabre o node. DaemonSets continuam cobrindo a máquina durante a manutenção.',
    note: 'Em produção, o drain também respeita PodDisruptionBudgets. Se não houver capacidade ou se a política não permitir outra indisponibilidade, a operação espera em vez de forçar uma queda.',
  },
}
