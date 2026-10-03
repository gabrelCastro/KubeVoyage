export type Labels = Record<string, string>

export type PodPhase = 'Pending' | 'ContainerCreating' | 'Running' | 'Terminating' | 'Error' | 'CrashLoopBackOff'

export type ResourceKind = 'Deployment' | 'ReplicaSet' | 'Pod' | 'Service' | 'Node' | 'ConfigMap' | 'HorizontalPodAutoscaler' | 'Secret'

export type RolloutState = 'complete' | 'progressing' | 'stalled'

/** What makes one revision of a Pod template different from another. */
export interface Template {
  image: string
  labels: Labels
  /** `kubectl rollout restart` stamps the template: same image, new revision. */
  restartedAt?: number
  /** `envFrom: configMapRef` — the ConfigMap whose keys become the container's environment. */
  configMap?: string
  /** A liveness probe: the kubelet restarts the container when it stops answering. */
  liveness?: boolean
  /** CPU the container asks for (requests) and may use at most (limits), in millicores. */
  resources?: Resources
  /** `envFrom: secretRef` — a Secret whose keys also become environment variables. */
  secret?: string
}

/** Like a ConfigMap, for sensitive values. Kept here in clear text; the API shows them base64-encoded. */
export interface Secret {
  kind: 'Secret'
  uid: string
  name: string
  data: Record<string, string>
  createdAt: number
}

export interface Resources {
  cpuRequest: number
  cpuLimit?: number
}

/** Adjusts a Deployment's replicas to keep average CPU, as a share of requests, near a target. */
export interface HorizontalPodAutoscaler {
  kind: 'HorizontalPodAutoscaler'
  uid: string
  name: string
  /** Name of the Deployment it scales. */
  target: string
  min: number
  max: number
  /** Target average CPU utilization, in % of requests. */
  cpuPercent: number
  createdAt: number
  /** Last measured average utilization; null when it can't be computed. */
  current: number | null
  /** Recent desired replica counts — scale-down waits for the highest of them (stabilization). */
  recommendations: { at: number; desired: number }[]
}

/** Configuration kept outside the image. Containers read it as environment variables at start. */
export interface ConfigMap {
  kind: 'ConfigMap'
  uid: string
  name: string
  data: Record<string, string>
  createdAt: number
}

export interface Deployment {
  kind: 'Deployment'
  uid: string
  name: string
  replicas: number
  selector: Labels
  template: Template
  createdAt: number
  revision: number
  /** Every revision's template, oldest first — what `rollout undo` walks back through. */
  history: Template[]
  rollout: RolloutState
  /** `kubectl rollout pause`: template changes wait until `resume`. */
  paused?: boolean
}

/** Controller loop state, exposed so the UI can show *when* Kubernetes is thinking. */
export type ControllerPhase = 'idle' | 'diverged' | 'reconciling'

export interface ReplicaSet {
  kind: 'ReplicaSet'
  uid: string
  name: string
  ownerUid: string
  hash: string
  image: string
  /** Pod labels captured by this revision's template. */
  templateLabels: Labels
  configMap?: string
  liveness?: boolean
  resources?: Resources
  secret?: string
  revision: number
  restartedAt?: number
  desired: number
  /** The Deployment's selector. The effective selector also includes `pod-template-hash`. */
  selector: Labels
  createdAt: number
  phase: ControllerPhase
  /** Set when the ReplicaSet is being deleted: its Pods are going away, then it is removed. */
  deletedAt?: number | null
}

export interface Pod {
  kind: 'Pod'
  uid: string
  name: string
  ownerUid: string | null
  labels: Labels
  image: string
  phase: PodPhase
  ready: boolean
  nodeName: string | null
  ip: string | null
  /** Horizontal position within its group. Presentational, but owned by the sim so every view agrees. */
  slot: number
  createdAt: number
  deletedAt: number | null
  restarts: number
  /** The ConfigMap the container reads its environment from (copied from the template). */
  configMap?: string
  /** The environment the container started with — a snapshot: later ConfigMap edits don't reach it. */
  env?: Record<string, string>
  /** Why the container can't be created yet, e.g. CreateContainerConfigError. */
  waiting?: string
  /** Has a liveness probe (copied from the template). */
  liveness?: boolean
  /** The process is alive but stopped answering — probes fail. */
  hung?: boolean
  resources?: Resources
  secret?: string
  /** A load generator: while it runs, it sends a stream of requests to this Service. */
  loadTarget?: string
}

export interface Service {
  kind: 'Service'
  uid: string
  name: string
  selector: Labels
  port: number
  targetPort: number
  clusterIP: string
  createdAt: number
  /** Ready Pods currently backing the Service, kept by the endpoints controller. */
  endpoints: string[]
}

export interface WorkerNode {
  kind: 'Node'
  name: string
}

/** A slot whose Pod vanished and has not been refilled yet — the visible "hole" self-healing fills. */
export interface Vacancy {
  slot: number
  ownerUid: string
  since: number
  podName: string
}

export interface ClusterState {
  deployments: Record<string, Deployment>
  replicaSets: Record<string, ReplicaSet>
  pods: Record<string, Pod>
  services: Record<string, Service>
  configMaps: Record<string, ConfigMap>
  hpas: Record<string, HorizontalPodAutoscaler>
  secrets: Record<string, Secret>
  nodes: WorkerNode[]
  vacancies: Vacancy[]
}

export type EventSource =
  | 'you'
  | 'cluster'
  | 'deployment-controller'
  | 'replicaset-controller'
  | 'garbage-collector'
  | 'horizontal-pod-autoscaler'
  | 'endpoints-controller'
  | 'default-scheduler'
  | 'kubelet'

export type EventTone = 'user' | 'create' | 'delete' | 'schedule' | 'progress' | 'ready' | 'reconcile' | 'success' | 'warning'

export interface ClusterEvent {
  id: number
  at: number
  type: 'Normal' | 'Warning'
  reason: string
  message: string
  tone: EventTone
  source: EventSource
  involved: { kind: ResourceKind; uid: string; name: string }
}

export interface Narration {
  id: number
  at: number
  tone: 'info' | 'warn' | 'success' | 'error'
  title: string
  body: string
  metrics?: { desired: number; actual: number }
  /** The kubectl equivalent of what just happened — concept first, syntax after. */
  command?: string
}

/** Transient visual signals that carry meaning (e.g. "the controller is propagating intent down this chain"). */
export type Effect =
  | { id: number; at: number; kind: 'pulse'; chain: string[]; tone: 'reconcile' | 'create' }
  | { id: number; at: number; kind: 'ping'; uid: string; tone: 'warn' | 'success' | 'info' | 'error' }

export interface PendingTask {
  id: number
  due: number
  label: string
}
