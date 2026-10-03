import { IMAGE } from '../sim/manifests'
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
  track: 'Fundamentos',
  title: 'Scaling',
  tagline: 'Mude um número. Veja o cluster fazer a conta.',
  idea: {
    a: { label: 'replicas: 5', text: 'um campo que você edita' },
    b: { label: 'Pods', text: 'criados ou removidos' },
    body: 'Escalar não é uma operação especial. É uma mudança no desired state; o ReplicaSet cria ou encerra a diferença.',
  },
  files: ['backend.yaml'],
  setup: { deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }] },
  replicaControl: true,
  objectives: [
    {
      id: 'drag',
      title: 'Peça 5 réplicas',
      detail: 'Arraste o controle de réplicas no palco até 5. Nada de comandos ainda — só mude o que você quer e observe.',
      uiHint: 'o controle fica no painel do canto superior esquerdo, abaixo de Desired vs Actual',
      done: (ctx) => settledAt(ctx, (n) => n >= 5),
    },
    {
      id: 'command',
      title: 'Agora diga isso em kubectl',
      detail: 'O que você acabou de fazer é um único comando. Use-o para reduzir para 2 e veja quais Pods são escolhidos para sair.',
      suggest: () => 'kubectl scale deployment backend --replicas=2',
      done: (ctx) => ran(ctx.history, /^kubectl\s+scale\b.*--replicas[=\s]2\b/) && settledAt(ctx, (n) => n === 2),
    },
    {
      id: 'zero',
      optional: true,
      title: 'Bônus: escale para zero',
      detail: 'Peça 0. Os Pods vão embora — mas o Deployment e o ReplicaSet ficam, prontos para escalar de novo.',
      suggest: () => 'kubectl scale deployment backend --replicas=0',
      done: (ctx) => deployment(ctx.cluster)?.replicas === 0 && !Object.values(ctx.cluster.pods).length,
    },
  ],
  completion: {
    title: 'Scaling, entendido.',
    summary: () => 'Você mudou um número. O ReplicaSet criou Pods quando Actual < Desired e encerrou Pods quando Actual > Desired — os mais novos e menos prontos primeiro.',
    story: (events) => {
      const i = firstIndex(events, (e) => e.reason === 'Scaled')
      if (i < 0) return null
      let end = -1
      for (let j = events.length - 1; j > i; j--) if (events[j].reason === 'Reconciled') (end = j), (j = 0)
      if (end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'Scaled', text: (e) => `Você mudou as réplicas: ${e.message.split('replicas ')[1]}` },
        { reason: 'ScalingReplicaSet', text: (e) => `O Deployment avisou o ReplicaSet: ${e.message.split(' to ').pop()}` },
        { reason: 'SuccessfulCreate', text: () => 'Pods novos foram criados para cobrir a diferença' },
        { reason: 'Killing', text: () => 'Pods excedentes foram encerrados', pick: 'last' },
        { reason: 'Reconciled', text: (e) => `Reconciliado — ${e.message.split('— ')[1]}`, pick: 'last' },
      ])
    },
    takeaway: 'Escalar é só uma mudança no desired state.',
    note: 'O Horizontal Pod Autoscaler faz exatamente o que você fez — só que muda o campo replicas por você, de acordo com a carga.',
  },
}
