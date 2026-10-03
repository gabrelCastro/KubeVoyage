import { short } from '../sim/engine'
import { IMAGE } from '../sim/manifests'
import { firstIndex, ran, storyFrom } from './helpers'
import type { Lesson, LessonCtx } from './types'

const job = (ctx: LessonCtx, name: string) => Object.values(ctx.cluster.jobs).find((j) => j.name === name && !j.deletedAt)

export const jobs: Lesson = {
  id: 'jobs',
  number: 11,
  track: 'Cargas de trabalho',
  title: 'Jobs',
  tagline: 'Nem todo Pod deve viver para sempre. Alguns só precisam terminar.',
  idea: {
    a: { label: 'Deployment', text: 'mantém Pods rodando' },
    b: { label: 'Job', text: 'roda até a tarefa terminar' },
    body: 'Um Deployment substitui o Pod que sai. Um Job conta quantas tarefas terminaram bem — e Pod que termina com sucesso não é substituído: o trabalho dele está feito.',
  },
  files: ['relatorio.yaml', 'relatorio-setembro.yaml'],
  setup: {
    deployments: [{ name: 'backend', replicas: 2, labels: { app: 'backend' }, image: IMAGE }],
  },
  objectives: [
    {
      id: 'run',
      title: 'Gere os relatórios',
      detail: 'O relatorio.yaml pede 5 tarefas, no máximo 2 de cada vez. Aplique e compare com o backend ao lado: os Pods do Job terminam e ficam em Completed.',
      suggest: () => 'kubectl apply -f relatorio.yaml',
      uiHint: 'acompanhe com kubectl get pods -w',
      done: (ctx) => job(ctx, 'relatorio')?.status === 'Complete',
    },
    {
      id: 'logs',
      title: 'Leia o resultado',
      detail: 'Os Pods terminaram, mas continuam lá — justamente para você ler o que eles fizeram.',
      suggest: () => 'kubectl logs job/relatorio',
      done: (ctx) => ran(ctx.history, /^kubectl\s+logs\s+(jobs?\/|relatorio-)/),
    },
    {
      id: 'fail',
      title: 'Rode o relatório de setembro',
      detail: 'Outro Job, com outra versão da imagem. Aplique e observe o que o Job controller faz quando a tarefa falha.',
      suggest: () => 'kubectl apply -f relatorio-setembro.yaml',
      done: (ctx) => job(ctx, 'relatorio-setembro')?.status === 'Failed',
    },
    {
      id: 'investigate',
      title: 'Descubra por que ele desistiu',
      detail: 'O Job tentou de novo, esperando mais a cada vez, e parou no backoffLimit. Os Pods que falharam guardam a explicação.',
      suggest: () => 'kubectl describe job relatorio-setembro',
      uiHint: 'e depois kubectl logs job/relatorio-setembro',
      done: (ctx) => {
        const i = firstIndex(ctx.events, (e) => e.reason === 'BackoffLimitExceeded')
        return i >= 0 && ran(ctx.history, /^kubectl\s+(describe\s+jobs?\s+relatorio-setembro|logs\s+(jobs?\/relatorio-setembro|relatorio-setembro-))/)
      },
    },
  ],
  completion: {
    title: 'Trabalho que termina.',
    summary: () =>
      'O Job de relatórios terminou 5 tarefas, 2 de cada vez, e parou — nenhum Pod foi recriado depois de concluir. O de setembro falhou, foi tentado de novo com esperas crescentes e desistiu no backoffLimit, deixando os Pods com os logs para investigar.',
    story: (events) => {
      const i = firstIndex(events, (e) => e.reason === 'JobCreated')
      const end = firstIndex(events, (e) => e.reason === 'BackoffLimitExceeded', i)
      if (i < 0 || end < 0) return null
      return storyFrom(events, i, end, [
        { reason: 'JobCreated', text: () => 'Você criou o Job relatorio' },
        { reason: 'TaskSucceeded', text: (e) => `${short(e.involved.name)} terminou a primeira tarefa` },
        { reason: 'Completed', text: () => '5 de 5 — o Job concluiu e parou' },
        { reason: 'TaskFailed', text: (e) => `${short(e.involved.name)} falhou: arquivo de entrada não encontrado` },
        { reason: 'BackoffLimitExceeded', text: () => 'Depois de 3 falhas, o relatorio-setembro desistiu' },
      ])
    },
    takeaway: 'Deployment mantém Pods vivos; Job conta tarefas concluídas. Escolha pelo que a carga de trabalho precisa: ficar no ar ou terminar.',
    note: 'Para rodar um Job de tempos em tempos (todo dia às 3h, por exemplo), existe o CronJob: ele cria um Job novo a cada horário da agenda.',
  },
}
