import { hangs, short } from '../sim/engine'
import { IMAGE } from '../sim/manifests'
import { firstIndex, ran, storyFrom } from './helpers'
import type { Lesson, LessonCtx } from './types'

const V16 = 'ghcr.io/kubelearn/backend:1.6'
const live = (ctx: LessonCtx) => Object.values(ctx.cluster.pods).filter((p) => p.deletedAt === null)
const backend = (ctx: LessonCtx) => Object.values(ctx.cluster.deployments).find((d) => d.name === 'backend')
const livenessRestart = (e: { reason: string; message: string }) => e.reason === 'Killing' && e.message.includes('failed liveness probe')

export const probes: Lesson = {
  id: 'probes',
  number: 8,
  track: 'Configuração',
  title: 'Probes',
  tagline: 'Vivo não é o mesmo que funcionando. O kubelet precisa perguntar.',
  idea: {
    a: { label: 'Readiness', text: 'falhou? sai do Service' },
    b: { label: 'Liveness', text: 'falhou? o container reinicia' },
    body: 'O kubelet testa cada container de tempos em tempos. A readiness decide se ele recebe tráfego; a liveness decide se ele precisa ser reiniciado. São perguntas diferentes.',
  },
  files: ['backend-liveness.yaml', 'service.yaml'],
  setup: {
    deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }],
    services: [{ name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 }],
  },
  objectives: [
    {
      id: 'ship',
      title: 'Publique a v1.6',
      detail: 'Uma versão nova, que passa em todos os testes. Faça o rollout e veja tudo ficar Ready.',
      suggest: () => `kubectl set image deployment/backend backend=${V16}`,
      done: (ctx) => {
        const i = firstIndex(ctx.events, (e) => e.reason === 'ImageChanged' && e.message.includes('→ v1.6'))
        return i >= 0 && firstIndex(ctx.events, (e) => e.reason === 'RolloutComplete', i) >= 0
      },
    },
    {
      id: 'notice',
      title: 'Descubra o que está acontecendo',
      detail: 'Espere um pouco e olhe a janela do seu app. Os Pods continuam Running, sem nenhum restart — mas algo mudou. Investigue um deles.',
      suggest: (ctx) => {
        const p = live(ctx).find((x) => x.hung)
        return p ? `kubectl describe pod ${p.name}` : 'kubectl get pods'
      },
      uiHint: 'ou selecione um Pod que deixou de ficar Ready',
      done: (ctx) =>
        ctx.events.some((e) => e.reason === 'Unhealthy' && e.message.startsWith('Readiness')) && ran(ctx.history, /^kubectl\s+(describe\s+pods?|logs)\s/),
    },
    {
      id: 'liveness',
      title: 'Ensine o kubelet a reiniciar',
      detail: 'A readiness só tira o Pod do Service. Para o kubelet reiniciar um container travado, ele precisa de uma liveness probe. Aplique o manifesto que a adiciona — e espere a próxima trava.',
      suggest: () => 'kubectl apply -f backend-liveness.yaml',
      uiHint: 'veja a diferença com cat backend-liveness.yaml',
      done: (ctx) => ctx.events.some(livenessRestart),
    },
    {
      id: 'fix',
      title: 'Corrija de verdade',
      detail: 'A liveness segura o app, mas a v1.6 continua travando — o RESTARTS só sobe. Volte para a v1.4 sem perder a probe.',
      suggest: () => `kubectl set image deployment/backend backend=${IMAGE}`,
      hint: {
        text: 'Cuidado com o rollout undo: a revisão anterior é a v1.6 sem a liveness probe. Trocar só a imagem mantém o resto do template.',
        command: `kubectl set image deployment/backend backend=${IMAGE}`,
      },
      done: (ctx) => {
        const d = backend(ctx)
        if (!d || d.template.image !== IMAGE || !d.template.liveness || d.rollout !== 'complete' || !ctx.events.some(livenessRestart)) return false
        const pods = live(ctx)
        return pods.length > 0 && pods.every((p) => p.ready && !hangs(p.image) && p.liveness)
      },
    },
  ],
  completion: {
    title: 'Vivo e funcionando.',
    summary: () =>
      'A v1.6 travava depois de um tempo: o processo continuava vivo, mas não respondia. A readiness tirou cada Pod do Service — e sem liveness, ninguém os reiniciou. Com a liveness, o kubelet reiniciou cada container travado. E a correção de verdade foi trocar a versão.',
    story: (events) => {
      const i = firstIndex(events, (e) => e.reason === 'ImageChanged' && e.message.includes('→ v1.6'))
      const fixed = firstIndex(events, (e) => e.reason === 'ImageChanged' && e.message.includes('→ v1.4'), i)
      const end = fixed < 0 ? -1 : firstIndex(events, (e) => e.reason === 'RolloutComplete', fixed)
      if (i < 0 || end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'ImageChanged', text: () => 'Você publicou a v1.6 — tudo Ready' },
        { reason: 'Unhealthy', text: (e) => `${short(e.involved.name)} travou e saiu do Service` },
        { reason: 'TemplateChanged', text: () => 'Você adicionou uma liveness probe' },
        { reason: 'Killing', text: (e) => `O kubelet reiniciou ${short(e.involved.name)}: falhou na liveness`, pick: 'last' },
        { reason: 'RolloutComplete', text: () => 'De volta à v1.4, com a probe', pick: 'last' },
      ])
    },
    takeaway: 'Readiness tira do tráfego; liveness reinicia. Nenhuma das duas conserta o código.',
    note: 'Uma liveness probe que depende de outra coisa (o banco de dados, outro serviço) pode reiniciar todos os Pods de uma vez quando essa coisa cai. Teste só o próprio processo.',
  },
}
