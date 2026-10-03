import { short } from '../sim/engine'
import { IMAGE } from '../sim/manifests'
import { firstIndex, storyFrom } from './helpers'
import type { Lesson, LessonCtx } from './types'

const CM = 'app-config'
const after = (ctx: LessonCtx, first: string, then: string) => {
  const i = firstIndex(ctx.events, (e) => e.reason === first)
  return i >= 0 && firstIndex(ctx.events, (e) => e.reason === then, i) >= 0
}
const configMap = (ctx: LessonCtx) => Object.values(ctx.cluster.configMaps).find((c) => c.name === CM)

export const configmaps: Lesson = {
  id: 'configmaps',
  number: 7,
  track: 'Configuração',
  title: 'ConfigMaps',
  tagline: 'A mesma imagem, outra configuração. E um detalhe que pega todo mundo.',
  idea: {
    a: { label: 'ConfigMap', text: 'configuração fora da imagem' },
    b: { label: 'Ambiente', text: 'lido quando o container inicia' },
    body: 'Um ConfigMap guarda valores que o app lê — sem reconstruir a imagem. Como variável de ambiente, o valor entra no container uma vez, na hora em que ele inicia.',
  },
  files: ['backend-config.yaml', 'configmap.yaml', 'service.yaml'],
  setup: {
    deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }],
    services: [{ name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 }],
  },
  objectives: [
    {
      id: 'missing',
      title: 'Faça o app ler um ConfigMap',
      detail: `O backend-config.yaml muda o template: o container passa a ler suas variáveis do ConfigMap ${CM}. Aplique — mesmo que esse ConfigMap ainda não exista.`,
      suggest: () => 'kubectl apply -f backend-config.yaml',
      uiHint: 'veja o manifesto antes com cat backend-config.yaml',
      done: (ctx) => ctx.events.some((e) => e.reason === 'Failed' && e.message.includes(`configmap "${CM}" not found`)),
    },
    {
      id: 'create',
      title: 'Crie a configuração que falta',
      detail: 'Os Pods novos param em CreateContainerConfigError — o container nem chega a ser criado. Os antigos continuam atendendo. Crie o ConfigMap e veja o rollout destravar.',
      suggest: () => 'kubectl apply -f configmap.yaml',
      uiHint: 'ou kubectl create configmap app-config --from-literal=APP_MESSAGE=…',
      done: (ctx) => !!configMap(ctx) && after(ctx, 'ConfigCreated', 'RolloutComplete'),
    },
    {
      id: 'change',
      title: 'Mude a mensagem',
      detail: 'Troque APP_MESSAGE no ConfigMap e olhe a janela do seu app. Os visitantes veem a mensagem nova?',
      suggest: () => `kubectl patch configmap ${CM} -p '{"data":{"APP_MESSAGE":"Mensagem nova!"}}'`,
      done: (ctx) => ctx.events.some((e) => e.reason === 'ConfigUpdated'),
    },
    {
      id: 'restart',
      title: 'Faça os Pods lerem de novo',
      detail: 'O ConfigMap mudou, mas cada container guardou o ambiente de quando iniciou. Para o valor novo valer, os Pods precisam ser recriados — sem derrubar o app.',
      suggest: () => 'kubectl rollout restart deployment/backend',
      hint: { text: 'Um rollout troca os Pods aos poucos. Dá para provocar um sem mudar a imagem.', command: 'kubectl rollout restart deployment/backend' },
      done: (ctx) => {
        const cm = configMap(ctx)
        const changed = firstIndex(ctx.events, (e) => e.reason === 'ConfigUpdated')
        const restarted = firstIndex(ctx.events, (e) => e.reason === 'Restarted', changed)
        if (!cm || changed < 0 || restarted < 0 || firstIndex(ctx.events, (e) => e.reason === 'RolloutComplete', restarted) < 0) return false
        const live = Object.values(ctx.cluster.pods).filter((p) => p.deletedAt === null && p.configMap === CM)
        return live.length > 0 && live.every((p) => p.env?.APP_MESSAGE === cm.data.APP_MESSAGE)
      },
    },
  ],
  completion: {
    title: 'Configuração fora da imagem.',
    summary: () =>
      'A imagem continuou a mesma do começo ao fim — só a configuração mudou. Quando ela faltou, os Pods novos nem iniciaram e os antigos seguraram o app. Quando mudou, ninguém percebeu até os Pods serem recriados.',
    story: (events) => {
      const i = firstIndex(events, (e) => e.reason === 'TemplateChanged')
      const end = i < 0 ? -1 : firstIndex(events, (e) => e.reason === 'RolloutComplete', firstIndex(events, (e) => e.reason === 'Restarted', i))
      if (end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'TemplateChanged', text: () => 'O template passou a ler o ConfigMap app-config' },
        { reason: 'Failed', text: (e) => `${short(e.involved.name)} não pôde iniciar: o ConfigMap não existia` },
        { reason: 'ConfigCreated', text: () => 'Você criou o ConfigMap — o rollout destravou' },
        { reason: 'ConfigUpdated', text: () => 'Você mudou APP_MESSAGE — e os Pods continuaram com o valor antigo' },
        { reason: 'Restarted', text: () => 'Você reiniciou o Deployment' },
        { reason: 'RolloutComplete', text: () => 'Pods novos, lendo o valor novo', pick: 'last' },
      ])
    },
    takeaway: 'Variável de ambiente é lida uma vez: mudar o ConfigMap não muda o Pod que já está rodando.',
    note: 'Montado como volume, um ConfigMap é atualizado dentro do container depois de algum tempo — mas o app ainda precisa reler o arquivo. Variáveis de ambiente, nunca.',
  },
}
