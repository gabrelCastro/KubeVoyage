import { firstIndex, livePods, podShort, ran, storyFrom } from './helpers'
import type { Lesson, LessonCtx } from './types'

const firstDelete = (ctx: LessonCtx) =>
  firstIndex(ctx.events, (e) => e.source === 'you' && e.reason === 'Deleted')

export const selfHealing: Lesson = {
  id: 'self-healing',
  number: 1,
  track: 'Fundamentos',
  title: 'Self-healing',
  tagline: 'Você descreve o que quer. O Kubernetes trabalha para que continue sendo verdade.',
  idea: {
    a: { label: 'Desired', text: 'o que você pediu' },
    b: { label: 'Actual', text: 'o que está rodando' },
    body: 'Os controllers comparam os dois o tempo todo. Sempre que divergem, agem até ficarem iguais. Esse ciclo se chama reconciliação.',
  },
  files: ['backend.yaml'],
  objectives: [
    {
      id: 'apply',
      title: 'Declare o desired state',
      detail: 'Aplique o manifesto e veja o Deployment criar um ReplicaSet — e o ReplicaSet criar os Pods.',
      suggest: () => 'kubectl apply -f backend.yaml',
      uiHint: 'ou clique em “Aplicar backend.yaml” no palco',
      done: (ctx) => ctx.events.some((e) => e.reason === 'Reconciled'),
    },
    {
      id: 'get',
      title: 'Olhe os Pods',
      detail: 'Liste os Pods no terminal. Cada linha é um dos cards do palco — o mesmo estado, duas visões.',
      suggest: () => 'kubectl get pods',
      done: (ctx) => ran(ctx.history, /^kubectl\s+get\s+(po|pod|pods|all)\b/),
    },
    {
      id: 'delete',
      title: 'Quebre alguma coisa',
      detail: 'Apague qualquer Pod que esteja rodando. Escolha um com Tab no terminal, ou selecione no palco e aperte Delete.',
      suggest: (ctx) => {
        const pods = livePods(ctx.cluster)
        const pod = pods[1] ?? pods[0]
        return pod ? `kubectl delete pod ${pod.name}` : null
      },
      uiHint: 'ou selecione um Pod e use “Apagar Pod” no inspetor',
      done: (ctx) => firstDelete(ctx) >= 0,
    },
    {
      id: 'heal',
      title: 'Veja o cluster se curar',
      detail: 'Não mexa em nada. Acompanhe Desired vs Actual: o ReplicaSet percebe a falta e repõe sozinho.',
      done: (ctx) => {
        const i = firstDelete(ctx)
        return i >= 0 && firstIndex(ctx.events, (e) => e.reason === 'Reconciled', i) >= 0
      },
    },
    {
      id: 'chaos',
      optional: true,
      title: 'Bônus: dois de uma vez',
      detail: 'Passe dois nomes de Pod num único delete. O controller dá conta?',
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
    title: 'Self-healing, na prática.',
    summary: () => 'Ninguém mandou o Kubernetes substituir aquele Pod. O ReplicaSet viu que Desired ≠ Actual e fechou a diferença sozinho.',
    story: (events) => {
      const i = firstIndex(events, (e) => e.source === 'you' && e.reason === 'Deleted')
      const end = i < 0 ? -1 : firstIndex(events, (e) => e.reason === 'Reconciled', i)
      if (end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'Deleted', text: (e) => `Você apagou ${podShort(e)}` },
        { reason: 'Killing', text: () => 'Ele deixou de contar — o Actual ficou abaixo do Desired' },
        { reason: 'Reconciling', text: () => 'O ReplicaSet controller percebeu a diferença' },
        { reason: 'SuccessfulCreate', text: (e) => `Criou um substituto: ${podShort(e)}` },
        { reason: 'Scheduled', text: (e) => `O scheduler o colocou no ${e.message.split(' ').pop()}` },
        { reason: 'Ready', text: () => 'O Pod novo passou na readiness probe' },
        { reason: 'Reconciled', text: () => 'Desired state reconciliado' },
      ])
    },
    takeaway: 'Você não gerencia Pods. Você gerencia o desired state.',
    note: 'Num cluster real isso acontece em milissegundos — o substituto costuma ser criado antes de o Pod antigo terminar de encerrar. Deixamos mais lento para você conseguir ver.',
  },
}
