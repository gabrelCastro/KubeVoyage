import { rsSelector, type Simulation } from '../engine'
import type { ConfigMap, DaemonSet, Deployment, HorizontalPodAutoscaler, Job, Resources, Secret, Pod, ReplicaSet, Service, WorkerNode } from '../types'

/**
 * The simulated objects as the API server would return them — what `-o yaml`, `-o json`
 * and `--sort-by` read. Only fields the simulation actually models are filled in, plus the
 * defaults a real cluster would show (so the output reads like the real thing).
 */

type Obj = { [k: string]: Json }
type Json = string | number | boolean | null | Json[] | Obj

const K8S_VERSION = 'v1.34.1'
const CONTAINER = 'backend'
const CONTAINER_PORT = 8080

const stamp = (sim: Simulation, t: number) => new Date(Date.now() - (sim.now - t)).toISOString().replace(/\.\d+Z$/, 'Z')

const restartAnnotation = (sim: Simulation, at?: number): Obj => (at === undefined ? {} : { annotations: { 'kubectl.kubernetes.io/restartedAt': stamp(sim, at) } })

const owner = (apiVersion: string, kind: string, name: string, uid: string): Obj => ({ apiVersion, kind, name, uid, controller: true, blockOwnerDeletion: true })

const container = (image: string, name = CONTAINER, configMap?: string, liveness?: boolean, resources?: Resources, secret?: string, readiness = true): Obj => ({
  name,
  image,
  ...(resources && { resources: { requests: { cpu: `${resources.cpuRequest}m` }, ...(resources.cpuLimit && { limits: { cpu: `${resources.cpuLimit}m` } }) } }),
  ...((configMap || secret) && { envFrom: [...(configMap ? [{ configMapRef: { name: configMap } }] : []), ...(secret ? [{ secretRef: { name: secret } }] : [])] }),
  imagePullPolicy: 'IfNotPresent',
  ports: [{ containerPort: CONTAINER_PORT, protocol: 'TCP' }],
  ...(readiness && { readinessProbe: { httpGet: { path: '/healthz', port: CONTAINER_PORT, scheme: 'HTTP' }, periodSeconds: 10, failureThreshold: 3 } }),
  ...(liveness && { livenessProbe: { httpGet: { path: '/healthz', port: CONTAINER_PORT, scheme: 'HTTP' }, periodSeconds: 10, failureThreshold: 3 } }),
})

/** Phase as the API reports it: a crash-looping or terminating Pod is still "Running". */
export const apiPhase = (p: Pod) =>
  p.phase === 'Pending' || p.phase === 'ContainerCreating' ? 'Pending' : p.phase === 'Succeeded' ? 'Succeeded' : p.job && p.phase === 'Error' ? 'Failed' : 'Running'

export function podObject(sim: Simulation, p: Pod): Obj {
  const rs = p.ownerUid ? sim.cluster.replicaSets[p.ownerUid] : undefined
  const job = p.ownerUid ? sim.cluster.jobs[p.ownerUid] : undefined
  const daemonSet = p.ownerUid ? sim.cluster.daemonSets[p.ownerUid] : undefined
  const containerName = job?.name ?? daemonSet?.name ?? (p.image.includes('kubelearn/backend') ? CONTAINER : p.name)
  const scheduled = p.nodeName !== null
  const crashing = p.phase === 'Error' || p.phase === 'CrashLoopBackOff'
  const state: Obj =
    p.phase === 'Running' || p.phase === 'Terminating'
      ? { running: { startedAt: stamp(sim, p.createdAt) } }
      : p.phase === 'Succeeded'
        ? { terminated: { exitCode: 0, reason: 'Completed' } }
        : p.phase === 'Error'
        ? { terminated: { exitCode: p.job ? 1 : 2, reason: 'Error' } }
        : p.phase === 'CrashLoopBackOff'
          ? { waiting: { reason: 'CrashLoopBackOff', message: `back-off restarting failed container ${CONTAINER} in pod ${p.name}` } }
          : p.waiting
            ? { waiting: { reason: p.waiting, message: `configmap "${p.configMap}" not found` } }
            : { waiting: { reason: 'ContainerCreating' } }
  const cond = (type: string, ok: boolean): Obj => ({ type, status: ok ? 'True' : 'False' })
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: p.name,
      namespace: 'default',
      uid: p.uid,
      creationTimestamp: stamp(sim, p.createdAt),
      labels: { ...p.labels },
      ...(rs && { generateName: `${rs.name}-`, ownerReferences: [owner('apps/v1', 'ReplicaSet', rs.name, rs.uid)] }),
      ...(job && { generateName: `${job.name}-`, ownerReferences: [owner('batch/v1', 'Job', job.name, job.uid)] }),
      ...(daemonSet && { generateName: `${daemonSet.name}-`, ownerReferences: [owner('apps/v1', 'DaemonSet', daemonSet.name, daemonSet.uid)] }),
      ...(p.deletedAt !== null && { deletionTimestamp: stamp(sim, p.deletedAt + 30_000), deletionGracePeriodSeconds: 30 }),
    },
    spec: {
      containers: [container(p.image, containerName, p.configMap, p.liveness, p.resources, p.secret, !p.daemon && !p.job)],
      ...(p.nodeName && { nodeName: p.nodeName }),
      ...(p.daemon && { tolerations: [{ key: 'node.kubernetes.io/unschedulable', operator: 'Exists', effect: 'NoSchedule' }] }),
      restartPolicy: p.job ? 'Never' : 'Always',
      terminationGracePeriodSeconds: 30,
    },
    status: {
      phase: apiPhase(p),
      conditions: [cond('PodScheduled', scheduled), cond('Initialized', scheduled), cond('ContainersReady', p.ready), cond('Ready', p.ready)],
      ...(p.ip && { podIP: p.ip }),
      ...(scheduled && {
        containerStatuses: [
          {
            name: containerName,
            image: p.image,
            ready: p.ready,
            started: p.phase === 'Running' || p.phase === 'Terminating',
            restartCount: p.restarts,
            state,
            ...(crashing || p.restarts > 0 ? { lastState: { terminated: { exitCode: 2, reason: 'Error' } } } : {}),
          },
        ],
      }),
    },
  }
}

export function deploymentObject(sim: Simulation, d: Deployment): Obj {
  const pods = sim.deploymentPods(d).filter((p) => p.deletedAt === null)
  const current = sim.replicaSetOf(d)
  const updated = current ? sim.activePods(current.uid).length : 0
  const ready = pods.filter((p) => p.ready).length
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: d.name,
      namespace: 'default',
      uid: d.uid,
      generation: d.revision,
      creationTimestamp: stamp(sim, d.createdAt),
      annotations: { 'deployment.kubernetes.io/revision': String(d.history.length) },
    },
    spec: {
      replicas: d.replicas,
      ...(d.paused && { paused: true }),
      revisionHistoryLimit: 10,
      progressDeadlineSeconds: 600,
      selector: { matchLabels: { ...d.selector } },
      strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' } },
      template: { metadata: { labels: { ...d.template.labels }, ...restartAnnotation(sim, d.template.restartedAt) }, spec: { containers: [container(d.template.image, CONTAINER, d.template.configMap, d.template.liveness, d.template.resources, d.template.secret)] } },
    },
    status: {
      observedGeneration: d.revision,
      replicas: pods.length,
      updatedReplicas: updated,
      readyReplicas: ready,
      availableReplicas: ready,
      ...(pods.length - ready > 0 && { unavailableReplicas: pods.length - ready }),
      conditions: [
        { type: 'Available', status: ready >= d.replicas - Math.floor(d.replicas / 4) ? 'True' : 'False', reason: ready >= d.replicas - Math.floor(d.replicas / 4) ? 'MinimumReplicasAvailable' : 'MinimumReplicasUnavailable' },
        {
          type: 'Progressing',
          status: 'True',
          reason: d.rollout === 'complete' ? 'NewReplicaSetAvailable' : 'ReplicaSetUpdated',
          ...(current && { message: `ReplicaSet "${current.name}" ${d.rollout === 'complete' ? 'has successfully progressed' : 'is progressing'}.` }),
        },
      ],
    },
  }
}

export function replicaSetObject(sim: Simulation, rs: ReplicaSet): Obj {
  const active = sim.activePods(rs.uid)
  const ready = active.filter((p) => p.ready).length
  const dep = sim.cluster.deployments[rs.ownerUid]
  const labels = { ...rs.templateLabels, 'pod-template-hash': rs.hash }
  return {
    apiVersion: 'apps/v1',
    kind: 'ReplicaSet',
    metadata: {
      name: rs.name,
      namespace: 'default',
      uid: rs.uid,
      creationTimestamp: stamp(sim, rs.createdAt),
      labels,
      annotations: { 'deployment.kubernetes.io/revision': String(rs.revision) },
      ...(dep && { ownerReferences: [owner('apps/v1', 'Deployment', dep.name, dep.uid)] }),
    },
    spec: {
      replicas: rs.desired,
      selector: { matchLabels: rsSelector(rs) },
      template: { metadata: { labels, ...restartAnnotation(sim, rs.restartedAt) }, spec: { containers: [container(rs.image, CONTAINER, rs.configMap, rs.liveness, rs.resources, rs.secret)] } },
    },
    status: { replicas: active.length, readyReplicas: ready, availableReplicas: ready, ...(rs.desired === 0 && { replicas: 0 }) },
  }
}

export function serviceObject(sim: Simulation, s: Service): Obj {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: s.name, namespace: 'default', uid: s.uid, creationTimestamp: stamp(sim, s.createdAt) },
    spec: {
      type: 'ClusterIP',
      clusterIP: s.clusterIP,
      clusterIPs: [s.clusterIP],
      selector: { ...s.selector },
      ports: [{ port: s.port, targetPort: s.targetPort, protocol: 'TCP' }],
      sessionAffinity: 'None',
    },
    status: { loadBalancer: {} },
  }
}

export function nodeObject(n: WorkerNode): Obj {
  return {
    apiVersion: 'v1',
    kind: 'Node',
    metadata: { name: n.name, labels: { 'kubernetes.io/hostname': n.name, 'kubernetes.io/os': 'linux' } },
    spec: n.unschedulable ? { unschedulable: true, taints: [{ key: 'node.kubernetes.io/unschedulable', effect: 'NoSchedule' }] } : {},
    status: {
      conditions: [{ type: 'Ready', status: 'True', reason: 'KubeletReady', message: 'kubelet is posting ready status' }],
      nodeInfo: { kubeletVersion: K8S_VERSION, operatingSystem: 'linux', containerRuntimeVersion: 'containerd://2.1.4' },
      capacity: { pods: '110' },
    },
  }
}

// a stable 5-character suffix, from the Service's uid
const SUFFIX = 'bcdfghjklmnpqrstvwxz2456789'
export function sliceName(s: Service) {
  let h = 0
  for (const ch of s.uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  let out = ''
  for (let i = 0; i < 5; i++, h = Math.floor(h / SUFFIX.length)) out += SUFFIX[h % SUFFIX.length]
  return `${s.name}-${out}`
}

/** One EndpointSlice per Service: every selected Pod with an IP, and its readiness conditions. */
export function endpointSliceObject(sim: Simulation, s: Service): Obj {
  const pods = sim.selectedBy(s).filter((p) => p.ip)
  return {
    apiVersion: 'discovery.k8s.io/v1',
    kind: 'EndpointSlice',
    metadata: {
      name: sliceName(s),
      namespace: 'default',
      labels: { 'kubernetes.io/service-name': s.name, 'endpointslice.kubernetes.io/managed-by': 'endpointslice-controller.k8s.io' },
      ownerReferences: [owner('v1', 'Service', s.name, s.uid)],
    },
    addressType: 'IPv4',
    endpoints: pods.map((p) => ({
      addresses: [p.ip!],
      conditions: { ready: s.endpoints.includes(p.uid), serving: p.ready, terminating: p.deletedAt !== null },
      ...(p.nodeName && { nodeName: p.nodeName }),
      targetRef: { kind: 'Pod', name: p.name, namespace: 'default', uid: p.uid },
    })),
    ports: [{ name: '', port: s.targetPort, protocol: 'TCP' }],
  }
}

export function endpointsObject(sim: Simulation, s: Service): Obj {
  const ready = s.endpoints.map((uid) => sim.cluster.pods[uid]).filter((p) => p?.ip)
  return {
    apiVersion: 'v1',
    kind: 'Endpoints',
    metadata: { name: s.name, namespace: 'default' },
    subsets: ready.length ? [{ addresses: ready.map((p) => ({ ip: p.ip!, nodeName: p.nodeName, targetRef: { kind: 'Pod', name: p.name, uid: p.uid } })), ports: [{ port: s.targetPort, protocol: 'TCP' }] }] : [],
  }
}

export const listObject = (items: Obj[]): Obj => ({ apiVersion: 'v1', kind: 'List', items, metadata: { resourceVersion: '' } })

// ── printers ───────────────────────────────────────────────────────────────

const PLAIN = /^[A-Za-z_/][\w./:@%-]*$/
// strings a YAML reader would take for something else: booleans, null, numbers, timestamps
const AMBIGUOUS = /^(true|false|yes|no|on|off|null|~|y|n)$/i
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$|^0x[\da-f]+$|^[-+]?\.(inf|nan)$/i
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}([Tt ]|$)/
// safe unquoted: no leading indicator, no ": " or " #", no surrounding spaces
const SAFE = /^[^\s\-?:,[\]{}#&*!|>'"%@`][^\n]*$/

function scalar(v: Json): string {
  if (typeof v !== 'string') return String(v)
  const quote = v === '' || AMBIGUOUS.test(v) || NUMBER.test(v) || TIMESTAMP.test(v) || !SAFE.test(v) || /: | #|\s$/.test(v)
  return quote ? JSON.stringify(v) : v
}

const isEmpty = (v: Json) => v !== null && typeof v === 'object' && (Array.isArray(v) ? !v.length : !Object.keys(v).length)
const empty = (v: Json) => (Array.isArray(v) ? '[]' : '{}')

/** YAML the way kubectl prints it: keys sorted, list items at their parent key's indentation. */
export function toYaml(value: Json, indent = 0): string[] {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (item !== null && typeof item === 'object' && !isEmpty(item)) {
        const lines = toYaml(item, indent + 2)
        return [`${pad}- ${lines[0].slice(indent + 2)}`, ...lines.slice(1)]
      }
      return [`${pad}- ${item !== null && typeof item === 'object' ? empty(item) : scalar(item)}`]
    })
  }
  if (value === null || typeof value !== 'object') return [pad + scalar(value)]
  return Object.keys(value)
    .sort()
    .flatMap((k) => {
      const v = value[k]
      const key = PLAIN.test(k) ? k : JSON.stringify(k)
      if (v === null || typeof v !== 'object') return [`${pad}${key}: ${scalar(v)}`]
      if (isEmpty(v)) return [`${pad}${key}: ${empty(v)}`]
      return [`${pad}${key}:`, ...toYaml(v, Array.isArray(v) ? indent : indent + 2)]
    })
}

export const toJson = (value: Json) => JSON.stringify(value, null, 2)

/** `.metadata.name`, `.status.containerStatuses[0].restartCount` — the JSONPath subset --sort-by uses. */
export function readPath(obj: Json, path: string): Json | undefined {
  const parts = path
    .replace(/^\{?\.?/, '')
    .replace(/\}$/, '')
    .split(/\.|\[(\d+)\]/)
    .filter((p) => p !== undefined && p !== '')
  let cur: Json | undefined = obj
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = Array.isArray(cur) ? cur[Number(p)] : cur[p]
  }
  return cur
}

export type { Json, Obj }

export function configMapObject(sim: Simulation, c: ConfigMap): Obj {
  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: c.name, namespace: 'default', uid: c.uid, creationTimestamp: stamp(sim, c.createdAt) },
    data: { ...c.data },
  }
}

export function hpaObject(sim: Simulation, h: HorizontalPodAutoscaler): Obj {
  const dep = sim.findDeployment(h.target)
  return {
    apiVersion: 'autoscaling/v2',
    kind: 'HorizontalPodAutoscaler',
    metadata: { name: h.name, namespace: 'default', uid: h.uid, creationTimestamp: stamp(sim, h.createdAt) },
    spec: {
      scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: h.target },
      minReplicas: h.min,
      maxReplicas: h.max,
      metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: h.cpuPercent } } }],
    },
    status: {
      currentReplicas: dep?.replicas ?? 0,
      desiredReplicas: h.recommendations.at(-1)?.desired ?? dep?.replicas ?? 0,
      ...(h.current !== null && { currentMetrics: [{ type: 'Resource', resource: { name: 'cpu', current: { averageUtilization: h.current } } }] }),
      conditions: [
        h.current === null
          ? { type: 'ScalingActive', status: 'False', reason: 'FailedGetResourceMetric', message: 'the HPA was unable to compute the replica count: failed to get cpu utilization: missing request for cpu' }
          : { type: 'ScalingActive', status: 'True', reason: 'ValidMetricFound', message: 'the HPA was able to successfully calculate a replica count from cpu resource utilization (percentage of request)' },
      ],
    },
  }
}

const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

/** The API never shows a Secret's values in clear text — only base64, which anyone can decode. */
export function secretObject(sim: Simulation, c: Secret): Obj {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    type: 'Opaque',
    metadata: { name: c.name, namespace: 'default', uid: c.uid, creationTimestamp: stamp(sim, c.createdAt) },
    data: Object.fromEntries(Object.entries(c.data).map(([k, v]) => [k, base64(v)])),
  }
}

export function jobObject(sim: Simulation, j: Job): Obj {
  const active = sim.podsOf(j.uid).filter((p) => p.deletedAt === null && p.phase !== 'Succeeded' && p.phase !== 'Error').length
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: j.name, namespace: 'default', uid: j.uid, creationTimestamp: stamp(sim, j.createdAt), labels: { 'job-name': j.name } },
    spec: {
      completions: j.completions,
      parallelism: j.parallelism,
      backoffLimit: j.backoffLimit,
      template: { spec: { containers: [{ name: j.name, image: j.image }], restartPolicy: 'Never' } },
    },
    status: {
      ...(active && { active }),
      ...(j.succeeded && { succeeded: j.succeeded }),
      ...(j.failed && { failed: j.failed }),
      startTime: stamp(sim, j.createdAt),
      ...(j.completedAt !== null && j.status === 'Complete' && { completionTime: stamp(sim, j.completedAt) }),
      ...(j.status !== 'Running' && {
        conditions: [
          j.status === 'Complete'
            ? { type: 'Complete', status: 'True' }
            : { type: 'Failed', status: 'True', reason: 'BackoffLimitExceeded', message: 'Job has reached the specified backoff limit' },
        ],
      }),
    },
  }
}

export function daemonSetObject(sim: Simulation, d: DaemonSet): Obj {
  const pods = sim.podsOf(d.uid).filter((p) => p.deletedAt === null)
  const ready = pods.filter((p) => p.ready).length
  const desired = sim.cluster.nodes.length
  return {
    apiVersion: 'apps/v1',
    kind: 'DaemonSet',
    metadata: { name: d.name, namespace: 'default', uid: d.uid, creationTimestamp: stamp(sim, d.createdAt) },
    spec: {
      selector: { matchLabels: { ...d.labels } },
      template: { metadata: { labels: { ...d.labels } }, spec: { containers: [{ name: d.name, image: d.image }] } },
    },
    status: {
      desiredNumberScheduled: desired,
      currentNumberScheduled: pods.filter((p) => p.nodeName).length,
      updatedNumberScheduled: pods.length,
      numberAvailable: ready,
      numberReady: ready,
      numberUnavailable: Math.max(0, desired - ready),
      numberMisscheduled: 0,
    },
  }
}
