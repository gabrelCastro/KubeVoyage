import type { ClusterEvent, ClusterState } from '../sim/types'

export interface TourCtx {
  cluster: ClusterState
  events: ClusterEvent[]
  history: string[]
  selected: string | null
}

export interface TourStep {
  id: string
  /** The `data-tour` area to highlight; null shows a centered card. */
  target: string | null
  title: string
  body: string
  /**
   * When the step is done. Steps with a condition wait for the learner to *do* it;
   * steps without one are read-and-continue ("Entendi").
   */
  done?: (ctx: TourCtx) => boolean
  /** Shown under the text while waiting for the action. */
  waiting?: string
}

/**
 * The guided first run. It rides on lesson 1: by the end the learner has used every part
 * of the screen *and* done half of the lesson.
 */
export const TOUR: TourStep[] = [
  {
    id: 'licao',
    target: 'licao',
    title: 'Seu roteiro',
    body: 'Cada lição tem objetivos aqui, na ordem. O objetivo atual mostra o que fazer e, quando ajuda, um comando pronto que você pode clicar.',
  },
  {
    id: 'aplicar',
    target: 'aplicar',
    title: 'Crie seu primeiro Deployment',
    body: 'O cluster está vazio. Clique para aplicar o manifesto — é o mesmo que rodar kubectl apply no terminal.',
    done: (c) => Object.keys(c.cluster.deployments).length > 0,
    waiting: 'Clique em “Aplicar backend.yaml” para continuar',
  },
  {
    id: 'palco',
    target: 'palco',
    title: 'O cluster ao vivo',
    body: 'Observe sem mexer: o Deployment cria um ReplicaSet, que cria os Pods. Cada Pod passa por Pending, ContainerCreating e Running até ficar Ready.',
    done: (c) => c.events.some((e) => e.reason === 'Reconciled'),
    waiting: 'Aguardando os Pods ficarem Ready…',
  },
  {
    id: 'pod',
    target: 'pod',
    title: 'Tudo é clicável',
    body: 'Clique em um Pod. A cadeia de quem é dono dele acende, e o resto fica em segundo plano.',
    done: (c) => !!c.selected && !!c.cluster.pods[c.selected],
    waiting: 'Clique em qualquer Pod para continuar',
  },
  {
    id: 'inspetor',
    target: 'inspetor',
    title: 'O inspetor',
    body: 'Aqui aparece tudo sobre o que você selecionou: estado, ciclo de vida, labels e o YAML. Termos sublinhados abrem a apostila.',
  },
  {
    id: 'terminal',
    target: 'terminal',
    title: 'O mesmo cluster, pelo terminal',
    body: 'Digite kubectl get pods e aperte Enter (ou clique na sugestão “tente”). Cada linha da resposta é um dos cards do palco.',
    done: (c) => c.history.some((h) => /^(kubectl|k)\s+get\s+(po|pod|pods|all)\b/.test(h)),
    waiting: 'Rode kubectl get pods para continuar',
  },
  {
    id: 'timeline',
    target: 'timeline',
    title: 'A história do cluster',
    body: 'Tudo o que acontece aparece aqui, em ordem — o que você fez e o que os controllers fizeram. Passe o mouse num evento para ver o recurso no palco.',
  },
  {
    id: 'playback',
    target: 'playback',
    title: 'Câmera lenta',
    body: 'Pause com Espaço e avance uma decisão de cada vez com ponto (.). Também dá para mudar a velocidade ou reiniciar a lição.',
  },
  {
    id: 'fim',
    target: 'ajuda',
    title: 'Agora é com você',
    body: 'Siga a lição: apague um Pod e veja o cluster se curar sozinho. Para rever este tutorial ou ver os atalhos, use este botão.',
  },
]
