import { isBroken, short } from '../sim/engine'
import { IMAGE } from '../sim/manifests'
import { firstIndex, ran, storyFrom } from './helpers'
import type { Lesson, LessonCtx } from './types'

const crashing = (ctx: LessonCtx) => Object.values(ctx.cluster.pods).find((p) => p.deletedAt === null && isBroken(p.image))

export const failures: Lesson = {
  id: 'failures',
  number: 6,
  track: 'Troubleshooting',
  title: 'Falhas e rollbacks',
  tagline: 'Publique uma versão quebrada. Ninguém percebe — e você faz o rollback.',
  idea: {
    a: { label: 'Rolling update', text: 'um Pod de cada vez' },
    b: { label: 'Readiness', text: 'o portão que ele precisa passar' },
    body: 'Um Deployment só aposenta Pods antigos quando os novos estão Ready. Uma versão que nunca fica Ready simplesmente nunca assume.',
  },
  files: ['backend.yaml', 'service.yaml'],
  setup: {
    deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }],
    services: [{ name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 }],
  },
  objectives: [
    {
      id: 'ship',
      title: 'Publique a v1.5',
      detail: 'Faça o rollout da versão nova. Veja um segundo ReplicaSet aparecer e o Deployment começar a trocar os Pods.',
      suggest: () => 'kubectl set image deployment/backend backend=ghcr.io/kubelearn/backend:1.5',
      done: (ctx) => ctx.events.some((e) => e.reason === 'BackOff'),
    },
    {
      id: 'investigate',
      title: 'Descubra por que ele quebra',
      detail: 'O Pod novo reinicia sem parar. O cluster está bem — o container é que não está. Os logs vão dizer por quê.',
      suggest: (ctx) => {
        const p = crashing(ctx)
        return p ? `kubectl logs ${p.name}` : null
      },
      uiHint: 'ou selecione o Pod com problema e abra os logs',
      done: (ctx) => ran(ctx.history, /^kubectl\s+(logs|describe\s+pods?)\s/) && ctx.events.some((e) => e.reason === 'BackOff'),
    },
    {
      id: 'rollback',
      title: 'Faça o rollback',
      detail: 'A v1.4 continua rodando e atendendo todas as requisições. Volte para ela.',
      suggest: () => 'kubectl rollout undo deployment/backend',
      done: (ctx) => {
        const i = firstIndex(ctx.events, (e) => e.reason === 'RolledBack')
        return i >= 0 && firstIndex(ctx.events, (e) => e.reason === 'RolloutComplete', i) >= 0
      },
    },
  ],
  completion: {
    title: 'Rollback com segurança.',
    summary: () => 'A v1.5 quebrava ao iniciar, então nunca ficou Ready — e o Deployment não derrubou nenhum Pod da v1.4 por causa dela. O Service continuou mandando todas as requisições para Pods saudáveis.',
    story: (events) => {
      const i = firstIndex(events, (e) => e.reason === 'ImageChanged')
      const end = i < 0 ? -1 : firstIndex(events, (e) => e.reason === 'RolloutComplete', i)
      if (end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'ImageChanged', text: () => 'Você pediu a v1.5' },
        { reason: 'NewReplicaSet', text: () => 'Um ReplicaSet novo foi criado para ela' },
        { reason: 'SuccessfulCreate', text: (e) => `Ele subiu um Pod extra (surge): ${short(e.involved.name)}` },
        { reason: 'BackOff', text: () => 'O container quebrou — CrashLoopBackOff' },
        { reason: 'RolledBack', text: () => 'Você fez rollback para a v1.4' },
        { reason: 'Killing', text: () => 'O Pod quebrado foi removido', pick: 'last' },
        { reason: 'RolloutComplete', text: () => 'Rollout concluído — 3/3 na v1.4' },
      ])
    },
    takeaway: 'É a readiness que torna o rolling update seguro.',
    note: 'Com 3 réplicas, os padrões (25% de maxSurge, 25% de maxUnavailable) permitem 1 Pod extra e 0 indisponíveis — então nada antigo cai antes de algo novo estar Ready.',
  },
}
