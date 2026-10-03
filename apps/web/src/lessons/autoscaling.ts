import { short } from '../sim/engine'
import { IMAGE } from '../sim/manifests'
import { firstIndex, ran, storyFrom } from './helpers'
import type { Lesson, LessonCtx } from './types'

const LOAD = 'kubectl run load-generator --image=busybox:1.36 --restart=Never -- /bin/sh -c "while sleep 0.01; do wget -q -O- http://backend; done"'
const hpa = (ctx: LessonCtx) => Object.values(ctx.cluster.hpas).find((h) => h.target === 'backend')
const rescaled = (ctx: LessonCtx, why: 'above' | 'below', from = 0) => firstIndex(ctx.events, (e) => e.reason === 'SuccessfulRescale' && e.message.includes(`${why} target`), from)

export const autoscaling: Lesson = {
  id: 'autoscaling',
  number: 10,
  track: 'Escala',
  title: 'Recursos e autoscaling',
  tagline: 'Quanto cada Pod pede, quanto ele usa — e quem decide quantos Pods existem.',
  idea: {
    a: { label: 'Requests', text: 'o que cada container reserva' },
    b: { label: 'HPA', text: 'réplicas pela CPU, como % das requests' },
    body: 'O HorizontalPodAutoscaler mede a CPU dos Pods como porcentagem do que eles pedem. Sem requests não há porcentagem — e sem porcentagem, ele não age.',
  },
  files: ['backend-resources.yaml', 'service.yaml'],
  setup: {
    deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }],
    services: [{ name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 }],
  },
  objectives: [
    {
      id: 'measure',
      title: 'Meça o consumo',
      detail: 'Antes de escalar qualquer coisa, olhe quanto cada Pod usa agora. Os números vêm do metrics-server.',
      suggest: () => 'kubectl top pods',
      done: (ctx) => ran(ctx.history, /^kubectl\s+top\s+(po|pods?)\b/),
    },
    {
      id: 'autoscale',
      title: 'Crie um HPA',
      detail: 'Peça ao Kubernetes para manter a CPU média em 50%, com no mínimo 2 e no máximo 8 réplicas. Depois, olhe a coluna TARGETS.',
      suggest: () => 'kubectl autoscale deployment backend --cpu=50% --min=2 --max=8',
      uiHint: 'e depois kubectl get hpa',
      done: (ctx) => !!hpa(ctx),
    },
    {
      id: 'requests',
      title: 'Dê uma base para a porcentagem',
      detail: 'O TARGETS mostra <unknown>: 50% de quê? Os containers não declaram requests. Aplique o manifesto que declara — e veja o HPA começar a medir.',
      suggest: () => 'kubectl apply -f backend-resources.yaml',
      uiHint: 'veja os requests com cat backend-resources.yaml',
      done: (ctx) => {
        const h = hpa(ctx)
        return !!h && h.current !== null
      },
    },
    {
      id: 'load',
      title: 'Mande tráfego de verdade',
      detail: 'Suba um gerador de carga — um Pod que faz requisições sem parar, como no tutorial oficial do HPA. Acompanhe a CPU subir e as réplicas virem atrás.',
      suggest: () => LOAD,
      uiHint: 'acompanhe com kubectl get hpa -w',
      done: (ctx) => rescaled(ctx, 'above') >= 0,
    },
    {
      id: 'calm',
      title: 'Desligue a carga',
      detail: 'Apague o gerador. A CPU cai na hora — mas o HPA espera a carga se manter baixa antes de reduzir. Repare quanto tempo ele espera.',
      suggest: () => 'kubectl delete pod load-generator',
      done: (ctx) => {
        const up = rescaled(ctx, 'above')
        const gens = Object.values(ctx.cluster.pods).some((p) => p.loadTarget && p.deletedAt === null)
        return up >= 0 && !gens && rescaled(ctx, 'below', up) >= 0
      },
    },
  ],
  completion: {
    title: 'Escala pela CPU.',
    summary: () =>
      'Com requests declaradas, o HPA passou a medir a CPU como porcentagem do que cada Pod pede. A carga subiu, a porcentagem subiu, e ele pediu mais réplicas. Quando a carga sumiu, ele esperou estabilizar antes de devolver.',
    story: (events) => {
      const i = firstIndex(events, (e) => e.reason === 'HpaCreated')
      const up = firstIndex(events, (e) => e.reason === 'SuccessfulRescale' && e.message.includes('above target'), i)
      const end = up < 0 ? -1 : firstIndex(events, (e) => e.reason === 'SuccessfulRescale' && e.message.includes('below target'), up)
      if (i < 0 || end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'HpaCreated', text: () => 'Você criou o HPA — meta de CPU em 50%' },
        { reason: 'FailedGetResourceMetric', text: () => 'Sem requests, ele não conseguiu medir' },
        { reason: 'TemplateChanged', text: () => 'Você declarou requests e limits' },
        { reason: 'Created', text: (e) => `Você subiu o gerador de carga ${short(e.involved.name)}`, match: (e) => e.message.includes('load-generator') || e.involved.kind === 'Pod' },
        { reason: 'SuccessfulRescale', text: (e) => `A CPU subiu e o HPA escalou para ${e.message.match(/New size: (\d+)/)?.[1]} réplicas`, pick: 'last', match: (e) => e.message.includes('above target') },
        { reason: 'SuccessfulRescale', text: (e) => `A carga sumiu e, depois de estabilizar, ele reduziu para ${e.message.match(/New size: (\d+)/)?.[1]}`, pick: 'last', match: (e) => e.message.includes('below target') },
      ])
    },
    takeaway: 'Requests são a régua do HPA: sem elas, não existe porcentagem para comparar com a meta.',
    note: 'No cluster real o HPA mede a cada 15 s e espera 5 minutos de carga baixa antes de reduzir. Aqui os tempos foram encurtados.',
  },
}
