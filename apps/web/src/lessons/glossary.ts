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
  {
    term: 'Service',
    aliases: ['Services'],
    definition: 'Endereço estável (nome e IP) na frente de um grupo de Pods escolhidos por label.',
    lessonId: 'services',
    anchor: 'o-que-e-um-service',
  },
  {
    term: 'endpoint',
    aliases: ['endpoints', 'EndpointSlice', 'EndpointSlices'],
    definition: 'Os Pods prontos que um Service está usando agora — a lista que recebe o tráfego.',
    lessonId: 'services',
    anchor: 'endpoints',
  },
  {
    term: 'kube-proxy',
    definition: 'Componente de cada node que transforma os endpoints dos Services em regras de rede.',
    lessonId: 'services',
    anchor: 'balanceamento',
  },
  {
    term: 'targetPort',
    definition: 'A porta do container para onde o Service encaminha as conexões.',
    lessonId: 'services',
    anchor: 'o-que-e-um-service',
  },
  {
    term: 'label',
    aliases: ['labels'],
    definition: 'Par chave-valor gravado num recurso para identificá-lo e agrupá-lo.',
    lessonId: 'labels',
    anchor: 'labels',
  },
  {
    term: 'selector',
    aliases: ['selectors'],
    definition: 'Consulta sobre labels que Services e ReplicaSets usam para encontrar seus Pods.',
    lessonId: 'labels',
    anchor: 'selectors',
  },
  {
    term: 'pod-template-hash',
    definition: 'Label que o Deployment adiciona para separar os Pods de cada revisão.',
    lessonId: 'labels',
    anchor: 'pod-template-hash',
  },
  {
    term: 'Horizontal Pod Autoscaler',
    aliases: ['HPA'],
    definition: 'Ajusta o número de réplicas sozinho, com base em métricas como uso de CPU.',
    lessonId: 'scaling',
    anchor: 'autoscaling',
  },
  {
    term: 'rolling update',
    aliases: ['rollout'],
    definition: 'Troca gradual dos Pods para uma nova versão, sem derrubar a aplicação.',
    lessonId: 'failures',
    anchor: 'rolling-update',
  },
  {
    term: 'maxSurge',
    definition: 'Quantos Pods a mais que o desejado podem existir durante um rolling update.',
    lessonId: 'failures',
    anchor: 'rolling-update',
  },
  {
    term: 'maxUnavailable',
    definition: 'Quantos Pods a menos que o desejado podem ficar indisponíveis durante um rolling update.',
    lessonId: 'failures',
    anchor: 'rolling-update',
  },
  {
    term: 'rollback',
    definition: 'Volta o template do Deployment para uma revisão anterior.',
    lessonId: 'failures',
    anchor: 'rollback',
  },
  {
    term: 'CrashLoopBackOff',
    definition: 'O container cai ao iniciar e o kubelet espera cada vez mais antes de reiniciá-lo.',
    lessonId: 'failures',
    anchor: 'crashloopbackoff',
  },
  {
    term: 'ConfigMap',
    aliases: ['ConfigMaps'],
    definition: 'Objeto que guarda configuração em pares chave-valor, fora da imagem do container.',
    lessonId: 'configmaps',
    anchor: 'configmap',
  },
  {
    term: 'envFrom',
    definition: 'Transforma cada chave de um ConfigMap em uma variável de ambiente do container.',
    lessonId: 'configmaps',
    anchor: 'envfrom',
  },
  {
    term: 'CreateContainerConfigError',
    definition: 'O kubelet não consegue montar a configuração do container — por exemplo, falta um ConfigMap — e nem chega a criá-lo.',
    lessonId: 'configmaps',
    anchor: 'createcontainerconfigerror',
  },
]

export const GLOSSARY_MATCHES = GLOSSARY.flatMap((entry) => [entry.term, ...(entry.aliases ?? [])].map((alias) => ({ alias, entry }))).sort(
  (a, b) => b.alias.length - a.alias.length,
)
