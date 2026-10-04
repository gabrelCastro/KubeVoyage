export const KIND_IDS = [
  'pods',
  'deployments',
  'replicasets',
  'services',
  'endpoints',
  'endpointslices',
  'events',
  'nodes',
  'configmaps',
  'horizontalpodautoscalers',
  'secrets',
  'jobs',
  'daemonsets',
] as const

export type KindId = (typeof KIND_IDS)[number]

export const KIND_ALIASES: Record<string, KindId | 'all'> = {
  po: 'pods', pod: 'pods', pods: 'pods',
  deploy: 'deployments', deployment: 'deployments', deployments: 'deployments', 'deployment.apps': 'deployments', 'deployments.apps': 'deployments',
  rs: 'replicasets', replicaset: 'replicasets', replicasets: 'replicasets', 'replicaset.apps': 'replicasets', 'replicasets.apps': 'replicasets',
  svc: 'services', service: 'services', services: 'services',
  ep: 'endpoints', endpoint: 'endpoints', endpoints: 'endpoints',
  endpointslice: 'endpointslices', endpointslices: 'endpointslices', 'endpointslice.discovery.k8s.io': 'endpointslices', 'endpointslices.discovery.k8s.io': 'endpointslices',
  ev: 'events', event: 'events', events: 'events',
  cm: 'configmaps', configmap: 'configmaps', configmaps: 'configmaps',
  secret: 'secrets', secrets: 'secrets',
  job: 'jobs', jobs: 'jobs', 'job.batch': 'jobs', 'jobs.batch': 'jobs',
  ds: 'daemonsets', daemonset: 'daemonsets', daemonsets: 'daemonsets', 'daemonset.apps': 'daemonsets',
  hpa: 'horizontalpodautoscalers', horizontalpodautoscaler: 'horizontalpodautoscalers', horizontalpodautoscalers: 'horizontalpodautoscalers', 'horizontalpodautoscaler.autoscaling': 'horizontalpodautoscalers',
  no: 'nodes', node: 'nodes', nodes: 'nodes',
  all: 'all',
}

/** Real kinds this cluster doesn't simulate: say so instead of "no such type". */
export const UNSIMULATED_KINDS = ['namespaces', 'ns', 'ingress', 'ingresses', 'ing', 'statefulsets', 'sts', 'cronjobs', 'cj', 'persistentvolumeclaims', 'pvc', 'persistentvolumes', 'pv', 'serviceaccounts', 'sa', 'namespace']

export const ALL_KINDS: KindId[] = ['pods', 'services', 'deployments', 'replicasets']

// Keep this order stable: it controls which completions learners see first.
export const KIND_WORDS = ['pods', 'deployments', 'replicasets', 'services', 'endpoints', 'endpointslices', 'events', 'nodes', 'configmaps', 'secrets', 'jobs', 'daemonsets', 'hpa', 'all', 'po', 'deploy', 'rs', 'svc', 'ep', 'no', 'cm', 'ds']

export const KIND_DOCS: Record<KindId | 'all', string> = {
  pods: 'Pods — os containers rodando',
  deployments: 'Deployments — descrevem o app e cuidam das versões',
  replicasets: 'ReplicaSets — mantêm N cópias idênticas de um Pod',
  services: 'Services — nome e IP estáveis na frente de um grupo de Pods',
  endpoints: 'Endpoints — os IPs por trás de um Service (API antiga)',
  endpointslices: 'EndpointSlices — os IPs por trás de um Service',
  events: 'Events — o que os controllers relataram',
  nodes: 'Nodes — as máquinas do cluster',
  configmaps: 'ConfigMaps — configuração guardada fora da imagem',
  secrets: 'Secrets — valores sensíveis, guardados em base64 (não criptografados por padrão)',
  jobs: 'Jobs — rodam uma tarefa até terminar',
  daemonsets: 'DaemonSets — um Pod em cada node',
  horizontalpodautoscalers: 'HorizontalPodAutoscalers — ajustam as réplicas pela CPU',
  all: 'os tipos principais: Pods, Services, Deployments e ReplicaSets',
}

export const KIND_SINGULAR: Partial<Record<KindId, string>> = {
  pods: 'Pod',
  deployments: 'Deployment',
  replicasets: 'ReplicaSet',
  services: 'Service',
  nodes: 'Node',
  endpoints: 'Endpoints',
  endpointslices: 'EndpointSlice',
}
