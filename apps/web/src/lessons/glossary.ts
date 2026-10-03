import type { ApostilaId } from './apostilas/store'

export interface GlossaryEntry {
  term: string
  aliases?: string[]
  definition: string
  lessonId: ApostilaId
  anchor: string
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: 'readiness probe',
    definition: 'Verificação que indica quando um container está pronto para receber tráfego.',
    lessonId: 'self-healing',
    anchor: 'ciclo-de-vida-do-pod',
  },
  {
    term: 'desired state',
    aliases: ['Desired'],
    definition: 'O estado que você declarou e que os controllers tentam manter.',
    lessonId: 'self-healing',
    anchor: 'desired-state-e-actual-state',
  },
  {
    term: 'actual state',
    aliases: ['Actual'],
    definition: 'O estado que o cluster observa neste momento.',
    lessonId: 'self-healing',
    anchor: 'desired-state-e-actual-state',
  },
  {
    term: 'ownerReferences',
    definition: 'Metadado que registra qual recurso é dono de outro recurso no Kubernetes.',
    lessonId: 'self-healing',
    anchor: 'deployment-replicaset-e-pods',
  },
  {
    term: 'reconciliação',
    aliases: ['reconciliar', 'reconciliado'],
    definition: 'Loop de observar, comparar e agir até Actual voltar a ser igual a Desired.',
    lessonId: 'self-healing',
    anchor: 'loop-de-reconciliacao',
  },
  {
    term: 'ReplicaSet',
    definition: 'Controller que mantém a quantidade desejada de Pods equivalentes.',
    lessonId: 'self-healing',
    anchor: 'deployment-replicaset-e-pods',
  },
  {
    term: 'Deployment',
    definition: 'Recurso que declara e atualiza uma aplicação por meio de ReplicaSets.',
    lessonId: 'self-healing',
    anchor: 'deployment-replicaset-e-pods',
  },
  {
    term: 'scheduler',
    definition: 'Componente que escolhe em qual node cada Pod será executado.',
    lessonId: 'self-healing',
    anchor: 'ciclo-de-vida-do-pod',
  },
  {
    term: 'kubelet',
    definition: 'Agente do node que inicia containers e reporta seu estado ao cluster.',
    lessonId: 'self-healing',
    anchor: 'ciclo-de-vida-do-pod',
  },
  {
    term: 'controller',
    aliases: ['controllers'],
    definition: 'Loop de controle que conduz o estado atual em direção ao estado desejado.',
    lessonId: 'self-healing',
    anchor: 'loop-de-reconciliacao',
  },
  {
    term: 'Pod',
    aliases: ['Pods'],
    definition: 'Menor unidade executável do Kubernetes, com um ou mais containers.',
    lessonId: 'self-healing',
    anchor: 'deployment-replicaset-e-pods',
  },
]

export const GLOSSARY_MATCHES = GLOSSARY.flatMap((entry) => [entry.term, ...(entry.aliases ?? [])].map((alias) => ({ alias, entry }))).sort(
  (a, b) => b.alias.length - a.alias.length,
)
