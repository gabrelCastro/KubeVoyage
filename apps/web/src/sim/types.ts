export type Labels = Record<string, string>

export type PodPhase = 'Pending' | 'ContainerCreating' | 'Running' | 'Terminating' | 'Error' | 'CrashLoopBackOff'

export type ResourceKind = 'Deployment' | 'ReplicaSet' | 'Pod' | 'Service' | 'Node'

export type RolloutState = 'complete' | 'progressing' | 'stalled'

export interface Deployment {
  kind: 'Deployment'
  uid: string
  name: string
  replicas: number
  selector: Labels
  template: { labels: Labels; image: string }
  createdAt: number
  revision: number
  /** Image of every revision, oldest first — what `rollout undo` walks back through. */
  history: string[]
  rollout: RolloutState
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
  revision: number
  desired: number
  /** The Deployment's selector. The effective selector also includes `pod-template-hash`. */
  selector: Labels
  createdAt: number
  phase: ControllerPhase
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
  nodes: WorkerNode[]
  vacancies: Vacancy[]
}

export type EventSource =
  | 'you'
  | 'cluster'
  | 'deployment-controller'
  | 'replicaset-controller'
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
