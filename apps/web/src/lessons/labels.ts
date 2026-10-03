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
  track: 'Rede',
  title: 'Labels e selectors',
  tagline: 'Nada no Kubernetes é ligado pelo nome. As labels são a cola.',
  idea: {
    a: { label: 'Labels', text: 'etiquetas em cada Pod' },
    b: { label: 'Selectors', text: 'consultas sobre as etiquetas' },
    body: 'Services e ReplicaSets encontram seus Pods com um selector. Mude uma label e você muda quem pertence a quem — na hora.',
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
      title: 'Veja o que o Service seleciona',
      detail: 'Selecione o Service. Cada Pod mostra a label que decide se ele combina com app=backend.',
      uiHint: 'ou liste as labels no terminal',
      suggest: () => 'kubectl get pods --show-labels',
      done: (ctx) => ctx.seen.some((u) => ctx.cluster.services[u]) || ran(ctx.history, /--show-labels/),
    },
    {
      id: 'join',
      title: 'Faça o frontend combinar',
      detail: 'O frontend não foi criado pelo Deployment. Dê a ele app=backend mesmo assim e veja se o Service se importa.',
      suggest: () => 'kubectl label pod frontend app=backend --overwrite',
      done: (ctx) => {
        const fe = frontend(ctx)
        return !!fe && !!svc(ctx)?.endpoints.includes(fe.uid)
      },
    },
    {
      id: 'quarantine',
      title: 'Isole um Pod para depurar',
      detail: 'Troque a label de um Pod do backend para app=debug. Ele sai do Service e do ReplicaSet — que o substitui. O Pod em si continua rodando.',
      suggest: (ctx) => {
        const pod = ownedPods(ctx.cluster)[1] ?? ownedPods(ctx.cluster)[0]
        return pod ? `kubectl label pod ${pod.name} app=debug --overwrite` : null
      },
      done: (ctx) => ctx.events.some((e) => e.reason === 'Orphaned'),
    },
    {
      id: 'return',
      optional: true,
      title: 'Bônus: devolva o Pod',
      detail: 'Dê app=backend a ele de novo. O ReplicaSet o adota — e passa a ter um Pod a mais.',
      suggest: (ctx) => {
        const o = lastOrphan(ctx)
        return o && ctx.cluster.pods[o.involved.uid] ? `kubectl label pod ${o.involved.name} app=backend --overwrite` : null
      },
      done: (ctx) => ctx.events.some((e) => e.reason === 'Adopted'),
    },
  ],
  completion: {
    title: 'As labels são a cola.',
    summary: (ctx) => {
      const o = lastOrphan(ctx)
      return `Um Pod sem dono entrou no Service por causa de uma label${o ? `, e ${short(o.involved.name)} saiu do Service e do ReplicaSet por causa de outra` : ''}. Sem nomes, sem fios — só selectors.`
    },
    story: (events) => {
      const i = firstIndex(events, (e) => e.reason === 'Labeled')
      const orphaned = i < 0 ? -1 : firstIndex(events, (e) => e.reason === 'Orphaned', i)
      const end = orphaned < 0 ? -1 : firstIndex(events, (e) => e.reason === 'Reconciled', orphaned)
      if (end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'Labeled', text: (e) => `Você trocou a label de ${podShort(e)}` },
        { reason: 'EndpointAdded', text: (e) => `${podShort(e)} combinou com o Service e entrou nos endpoints` },
        { reason: 'Orphaned', text: (e) => `${podShort(e)} deixou de combinar — o ReplicaSet o soltou` },
        { reason: 'EndpointRemoved', text: (e) => `${podShort(e)} saiu do Service`, pick: 'last' },
        { reason: 'SuccessfulCreate', text: (e) => `O ReplicaSet criou ${podShort(e)} para completar a conta`, pick: 'last' },
        { reason: 'Reconciled', text: () => 'Desired state reconciliado', pick: 'last' },
      ])
    },
    takeaway: 'São os selectors — não nomes nem donos — que decidem o que pertence a quê.',
    note: 'Tirar um Pod problemático do Service trocando a label é uma técnica real de depuração: ele para de receber tráfego, é substituído e continua vivo para você investigar.',
  },
}
