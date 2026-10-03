import { IMAGE } from '../sim/manifests'
import { firstIndex, ran, storyFrom } from './helpers'
import type { Lesson, LessonCtx } from './types'

const NAME = 'db-credentials'
const URL = 'postgres://app:s3cret@db:5432/app'
const secret = (ctx: LessonCtx) => Object.values(ctx.cluster.secrets).find((s) => s.name === NAME)

export const secrets: Lesson = {
  id: 'secrets',
  number: 8,
  track: 'Configuração',
  title: 'Secrets',
  tagline: 'A v1.5 da lição 6 só precisava de uma senha. Entregue — e veja como ela é guardada.',
  idea: {
    a: { label: 'Secret', text: 'valores sensíveis fora da imagem' },
    b: { label: 'base64', text: 'codificado, não criptografado' },
    body: 'Um Secret funciona como um ConfigMap, para senhas e tokens. Mas, por padrão, ele não esconde nada: os valores ficam só em base64, que qualquer um com acesso decodifica.',
  },
  files: ['backend-secret.yaml', 'service.yaml'],
  setup: {
    deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }],
    services: [{ name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 }],
  },
  objectives: [
    {
      id: 'create',
      title: 'Guarde a senha do banco',
      detail: 'A v1.5 quebrava porque faltava DATABASE_URL. Ela tem senha — então vai num Secret, não num ConfigMap.',
      suggest: () => `kubectl create secret generic ${NAME} --from-literal=DATABASE_URL=${URL}`,
      done: (ctx) => !!secret(ctx)?.data.DATABASE_URL,
    },
    {
      id: 'reveal',
      title: 'Veja o quanto ele esconde',
      detail: 'O describe não mostra o valor. Mas peça o objeto à API e decodifique o base64 — sem precisar de chave nenhuma.',
      suggest: () => `kubectl get secret ${NAME} -o jsonpath='{.data.DATABASE_URL}' | base64 -d`,
      uiHint: 'compare com kubectl describe secret db-credentials',
      done: (ctx) => ran(ctx.history, /\bbase64\s+(-d|--decode)\b/),
    },
    {
      id: 'ship',
      title: 'Corrija a v1.5 para frente',
      detail: 'Publique a v1.5 lendo a senha do Secret. Desta vez, o container encontra DATABASE_URL e não quebra.',
      suggest: () => 'kubectl apply -f backend-secret.yaml',
      uiHint: 'veja o envFrom com cat backend-secret.yaml',
      done: (ctx) => {
        const d = Object.values(ctx.cluster.deployments).find((x) => x.name === 'backend')
        if (!d || d.template.secret !== NAME || !d.template.image.endsWith(':1.5') || d.rollout !== 'complete') return false
        const pods = Object.values(ctx.cluster.pods).filter((p) => p.deletedAt === null)
        return pods.length > 0 && pods.every((p) => p.ready && p.image.endsWith(':1.5') && !!p.env?.DATABASE_URL)
      },
    },
  ],
  completion: {
    title: 'A v1.5, enfim no ar.',
    summary: () =>
      'A mesma imagem que quebrava na lição 6 agora roda: faltava só a configuração, e ela veio de um Secret. E você viu o limite dele — sem criptografia em repouso e controle de acesso, um Secret é só base64.',
    story: (events) => {
      const i = firstIndex(events, (e) => e.reason === 'SecretCreated')
      const end = i < 0 ? -1 : firstIndex(events, (e) => e.reason === 'RolloutComplete', firstIndex(events, (e) => e.reason === 'TemplateChanged', i))
      if (i < 0 || end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'SecretCreated', text: () => `Você guardou DATABASE_URL no Secret ${NAME}` },
        { reason: 'TemplateChanged', text: () => 'A v1.5 passou a ler o Secret' },
        { reason: 'RolloutComplete', text: () => 'Rollout concluído — sem nenhum crash', pick: 'last' },
      ])
    },
    takeaway: 'Secret não é cofre: é um lugar separado, com permissões separadas. A proteção vem do RBAC e da criptografia em repouso.',
    note: 'Por padrão, os Secrets ficam sem criptografia no etcd, e quem pode criar Pods num namespace consegue ler os Secrets dele.',
  },
}
