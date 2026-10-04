import {
  apiPhase,
  configMapObject,
  daemonSetObject,
  deploymentObject,
  endpointSliceObject,
  endpointsObject,
  hpaObject,
  jobObject,
  nodeObject,
  podObject,
  replicaSetObject,
  secretObject,
  serviceObject,
  sliceName,
  type Obj,
} from './objects'
import { isBroken, labelString, rsSelector, type Simulation } from '../engine'
import type {
  ClusterEvent,
  ConfigMap,
  DaemonSet,
  Deployment,
  HorizontalPodAutoscaler,
  Job,
  Labels,
  Pod,
  ReplicaSet,
  Secret,
  Service,
  WorkerNode,
} from '../types'
import type { KindId } from './resourceKinds'

export type Tone = 'muted' | 'error' | 'success' | 'warn' | 'accent' | 'info' | 'strong'
export type Seg = { t: string; c?: Tone; ref?: string }
export type Item = { name: string; uid?: string }

export interface Spec<T extends Item> {
  /** As used in API errors: `pods "x" not found`. */
  resource: string
  /** As printed in `-o name` and multi-kind tables. */
  prefix: string
  namespaced: boolean
  items(sim: Simulation): T[]
  labels(sim: Simulation, t: T): Labels
  object(sim: Simulation, t: T): Obj
  header(wide: boolean): string[]
  row(sim: Simulation, t: T, wide: boolean): Seg[]
  /** `--field-selector` fields besides metadata.name. */
  fields?: Record<string, (t: T) => string>
}

export function age(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 120) return `${s}s`
  const m = Math.floor(s / 60)
  return s % 60 && m < 10 ? `${m}m${s % 60}s` : `${m}m`
}

export const statusTone = (p: Pod): Tone =>
  p.waiting || p.phase === 'Terminating' || p.phase === 'Error' || p.phase === 'CrashLoopBackOff'
    ? 'error'
    : p.phase === 'Running'
      ? p.ready
        ? 'success'
        : 'info'
      : 'warn'

export function podRow(sim: Simulation, p: Pod, wide = false, labels = false): Seg[] {
  const row: Seg[] = [
    { t: p.name, c: 'strong', ref: p.uid },
    { t: p.ready ? '1/1' : '0/1' },
    { t: p.waiting ?? (p.phase === 'Succeeded' ? 'Completed' : p.phase), c: p.phase === 'Succeeded' ? 'muted' : statusTone(p) },
    { t: String(p.restarts), c: p.restarts ? 'warn' : undefined },
    { t: age(sim.now - p.createdAt) },
  ]
  if (wide) row.push({ t: p.ip ?? '<none>', c: p.ip ? undefined : 'muted' }, { t: p.nodeName ?? '<none>', c: p.nodeName ? undefined : 'muted' })
  if (labels) row.push({ t: labelString(p.labels), c: 'accent' })
  return row
}

export function podHeader(wide = false, labels = false) {
  const h = ['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE']
  if (wide) h.push('IP', 'NODE')
  if (labels) h.push('LABELS')
  return h
}

const ipList = (ips: string[]) => (ips.length > 3 ? `${ips.slice(0, 3).join(',')} + ${ips.length - 3} more...` : ips.join(','))

export const SPECS: { [K in KindId]: Spec<any> } = {
  pods: {
    resource: 'pods',
    prefix: 'pod',
    namespaced: true,
    items: (sim) => Object.values(sim.cluster.pods).sort((a, b) => a.createdAt - b.createdAt),
    labels: (_sim, p: Pod) => p.labels,
    object: (sim, p: Pod) => podObject(sim, p),
    header: (wide) => podHeader(wide),
    row: (sim, p: Pod, wide) => podRow(sim, p, wide),
    fields: { 'status.phase': (p: Pod) => apiPhase(p), 'spec.nodeName': (p: Pod) => p.nodeName ?? '', 'spec.restartPolicy': () => 'Always' },
  } satisfies Spec<Pod>,
  deployments: {
    resource: 'deployments.apps',
    prefix: 'deployment.apps',
    namespaced: true,
    items: (sim) => Object.values(sim.cluster.deployments).sort((a, b) => a.createdAt - b.createdAt),
    // the manifests in this cluster set labels on the Pod template, not on the Deployment itself
    labels: () => ({}),
    object: (sim, d: Deployment) => deploymentObject(sim, d),
    header: (wide) => ['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE', ...(wide ? ['CONTAINERS', 'IMAGES', 'SELECTOR'] : [])],
    row: (sim, d: Deployment, wide) => {
      const all = sim.deploymentPods(d).filter((p) => p.deletedAt === null)
      const current = sim.replicaSetOf(d)
      const updated = current ? sim.activePods(current.uid).length : 0
      const ready = all.filter((p) => p.ready).length
      return [
        { t: d.name, c: 'strong' },
        { t: `${ready}/${d.replicas}`, c: ready === d.replicas ? 'success' : 'warn' },
        { t: String(updated) },
        { t: String(ready) },
        { t: age(sim.now - d.createdAt) },
        ...(wide ? [{ t: 'backend' }, { t: d.template.image, c: isBroken(d.template.image) ? ('error' as Tone) : undefined }, { t: labelString(d.selector), c: 'accent' as Tone }] : []),
      ]
    },
  } satisfies Spec<Deployment>,
  replicasets: {
    resource: 'replicasets.apps',
    prefix: 'replicaset.apps',
    namespaced: true,
    items: (sim) => Object.values(sim.cluster.replicaSets).sort((a, b) => a.createdAt - b.createdAt),
    labels: (_sim, rs: ReplicaSet) => ({ ...rs.templateLabels, 'pod-template-hash': rs.hash }),
    object: (sim, rs: ReplicaSet) => replicaSetObject(sim, rs),
    header: (wide) => ['NAME', 'DESIRED', 'CURRENT', 'READY', 'AGE', ...(wide ? ['CONTAINERS', 'IMAGES', 'SELECTOR'] : [])],
    row: (sim, rs: ReplicaSet, wide) => {
      const active = sim.activePods(rs.uid)
      const ready = active.filter((p) => p.ready).length
      return [
        { t: rs.name, c: 'strong' },
        { t: String(rs.desired) },
        { t: String(active.length), c: active.length === rs.desired ? undefined : 'warn' },
        { t: String(ready), c: ready === rs.desired ? 'success' : 'warn' },
        { t: age(sim.now - rs.createdAt) },
        ...(wide ? [{ t: 'backend' }, { t: rs.image, c: isBroken(rs.image) ? ('error' as Tone) : undefined }, { t: labelString(rsSelector(rs)), c: 'accent' as Tone }] : []),
      ]
    },
  } satisfies Spec<ReplicaSet>,
  services: {
    resource: 'services',
    prefix: 'service',
    namespaced: true,
    items: (sim) => Object.values(sim.cluster.services).sort((a, b) => a.createdAt - b.createdAt),
    labels: () => ({}),
    object: (sim, s: Service) => serviceObject(sim, s),
    header: (wide) => ['NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE', ...(wide ? ['SELECTOR'] : [])],
    row: (sim, s: Service, wide) => [
      { t: s.name, c: 'strong' },
      { t: 'ClusterIP' },
      { t: s.clusterIP },
      { t: '<none>', c: 'muted' },
      { t: `${s.port}/TCP` },
      { t: age(sim.now - s.createdAt) },
      ...(wide ? [{ t: labelString(s.selector), c: 'accent' as Tone }] : []),
    ],
  } satisfies Spec<Service>,
  endpoints: {
    resource: 'endpoints',
    prefix: 'endpoints',
    namespaced: true,
    items: (sim) => Object.values(sim.cluster.services).sort((a, b) => a.createdAt - b.createdAt),
    labels: () => ({}),
    object: (sim, s: Service) => endpointsObject(sim, s),
    header: () => ['NAME', 'ENDPOINTS', 'AGE'],
    row: (sim, s: Service) => {
      const ips = s.endpoints.map((uid) => `${sim.cluster.pods[uid]?.ip}:${s.targetPort}`)
      return [
        { t: s.name, c: 'strong' },
        { t: ips.length ? ipList(ips) : '<none>', c: ips.length ? 'success' : 'error' },
        { t: age(sim.now - s.createdAt) },
      ]
    },
  } satisfies Spec<Service>,
  endpointslices: {
    resource: 'endpointslices.discovery.k8s.io',
    prefix: 'endpointslice.discovery.k8s.io',
    namespaced: true,
    items: (sim) => Object.values(sim.cluster.services).map((s) => ({ ...s, svcName: s.name, name: sliceName(s) })),
    labels: (_sim, s: Service & { svcName: string }) => ({ 'kubernetes.io/service-name': s.svcName, 'endpointslice.kubernetes.io/managed-by': 'endpointslice-controller.k8s.io' }),
    object: (sim, s: Service & { svcName: string }) => endpointSliceObject(sim, { ...s, name: s.svcName }),
    header: () => ['NAME', 'ADDRESSTYPE', 'PORTS', 'ENDPOINTS', 'AGE'],
    row: (sim, s: Service) => {
      const ips = s.endpoints.map((uid) => sim.cluster.pods[uid]?.ip ?? '')
      return [
        { t: s.name, c: 'strong' },
        { t: 'IPv4' },
        { t: String(s.targetPort) },
        { t: ips.length ? ipList(ips) : '<unset>', c: ips.length ? 'success' : 'error' },
        { t: age(sim.now - s.createdAt) },
      ]
    },
  } satisfies Spec<Service & { svcName: string }>,
  events: {
    resource: 'events',
    prefix: 'event',
    namespaced: true,
    items: (sim) => sim.events.filter((e) => e.source !== 'you' && e.source !== 'cluster').slice(-14).map((e) => ({ ...e, name: `${e.involved.name}.${(e.id * 7919).toString(16).padStart(8, '0')}` })),
    labels: () => ({}),
    object: (sim, e: ClusterEvent & { name: string }) => ({
      apiVersion: 'v1',
      kind: 'Event',
      metadata: { name: e.name, namespace: 'default' },
      type: e.type,
      reason: e.reason,
      message: e.message,
      source: { component: e.source },
      involvedObject: { kind: e.involved.kind, name: e.involved.name, uid: e.involved.uid, namespace: 'default' },
      lastTimestamp: new Date(Date.now() - (sim.now - e.at)).toISOString().replace(/\.\d+Z$/, 'Z'),
    }),
    header: () => ['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'],
    row: (sim, e: ClusterEvent) => [
      { t: age(sim.now - e.at) },
      { t: e.type, c: e.type === 'Warning' ? 'warn' : 'muted' },
      { t: e.reason, c: 'accent' },
      { t: `${e.involved.kind.toLowerCase()}/${e.involved.name}`, ref: e.involved.uid },
      { t: e.message, c: 'muted' },
    ],
  } satisfies Spec<ClusterEvent & { name: string }>,
  horizontalpodautoscalers: {
    resource: 'horizontalpodautoscalers.autoscaling',
    prefix: 'horizontalpodautoscaler.autoscaling',
    namespaced: true,
    items: (sim) => Object.values(sim.cluster.hpas).sort((a, b) => a.createdAt - b.createdAt),
    labels: () => ({}),
    object: (sim, h: HorizontalPodAutoscaler) => hpaObject(sim, h),
    header: () => ['NAME', 'REFERENCE', 'TARGETS', 'MINPODS', 'MAXPODS', 'REPLICAS', 'AGE'],
    row: (sim, h: HorizontalPodAutoscaler) => [
      { t: h.name, c: 'strong' },
      { t: `Deployment/${h.target}` },
      { t: `cpu: ${h.current === null ? '<unknown>' : `${h.current}%`}/${h.cpuPercent}%`, c: h.current === null ? 'warn' : h.current > h.cpuPercent * 1.1 ? 'error' : 'success' },
      { t: String(h.min) },
      { t: String(h.max) },
      { t: String(sim.findDeployment(h.target)?.replicas ?? 0) },
      { t: age(sim.now - h.createdAt) },
    ],
  } satisfies Spec<HorizontalPodAutoscaler>,
  daemonsets: {
    resource: 'daemonsets.apps',
    prefix: 'daemonset.apps',
    namespaced: true,
    items: (sim) => Object.values(sim.cluster.daemonSets).sort((a, b) => a.createdAt - b.createdAt),
    labels: (_sim, d: DaemonSet) => d.labels,
    object: (sim, d: DaemonSet) => daemonSetObject(sim, d),
    header: () => ['NAME', 'DESIRED', 'CURRENT', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'NODE SELECTOR', 'AGE'],
    row: (sim, d: DaemonSet) => {
      const pods = sim.podsOf(d.uid).filter((p) => p.deletedAt === null)
      const ready = pods.filter((p) => p.ready).length
      const want = sim.cluster.nodes.length
      return [
        { t: d.name, c: 'strong' },
        { t: String(want) },
        { t: String(pods.filter((p) => p.nodeName).length) },
        { t: String(ready), c: ready === want ? 'success' : 'warn' },
        { t: String(pods.length) },
        { t: String(ready) },
        { t: '<none>', c: 'muted' },
        { t: age(sim.now - d.createdAt) },
      ]
    },
  } satisfies Spec<DaemonSet>,
  jobs: {
    resource: 'jobs.batch',
    prefix: 'job.batch',
    namespaced: true,
    items: (sim) => Object.values(sim.cluster.jobs).filter((j) => !j.deletedAt).sort((a, b) => a.createdAt - b.createdAt),
    labels: (_sim, j: Job) => ({ 'job-name': j.name }),
    object: (sim, j: Job) => jobObject(sim, j),
    header: () => ['NAME', 'STATUS', 'COMPLETIONS', 'DURATION', 'AGE'],
    row: (sim, j: Job) => [
      { t: j.name, c: 'strong' },
      { t: j.status, c: j.status === 'Complete' ? 'success' : j.status === 'Failed' ? 'error' : 'info' },
      { t: `${j.succeeded}/${j.completions}` },
      { t: age((j.completedAt ?? sim.now) - j.createdAt) },
      { t: age(sim.now - j.createdAt) },
    ],
  } satisfies Spec<Job>,
  secrets: {
    resource: 'secrets',
    prefix: 'secret',
    namespaced: true,
    items: (sim) => Object.values(sim.cluster.secrets).sort((a, b) => a.createdAt - b.createdAt),
    labels: () => ({}),
    object: (sim, c: Secret) => secretObject(sim, c),
    header: () => ['NAME', 'TYPE', 'DATA', 'AGE'],
    row: (sim, c: Secret) => [{ t: c.name, c: 'strong' }, { t: 'Opaque' }, { t: String(Object.keys(c.data).length) }, { t: age(sim.now - c.createdAt) }],
  } satisfies Spec<Secret>,
  configmaps: {
    resource: 'configmaps',
    prefix: 'configmap',
    namespaced: true,
    items: (sim) => Object.values(sim.cluster.configMaps).sort((a, b) => a.createdAt - b.createdAt),
    labels: () => ({}),
    object: (sim, c: ConfigMap) => configMapObject(sim, c),
    header: () => ['NAME', 'DATA', 'AGE'],
    row: (sim, c: ConfigMap) => [{ t: c.name, c: 'strong' }, { t: String(Object.keys(c.data).length) }, { t: age(sim.now - c.createdAt) }],
  } satisfies Spec<ConfigMap>,
  nodes: {
    resource: 'nodes',
    prefix: 'node',
    namespaced: false,
    items: (sim) => sim.cluster.nodes,
    labels: (_sim, n: WorkerNode) => ({ 'kubernetes.io/hostname': n.name, 'kubernetes.io/os': 'linux' }),
    object: (_sim, n: WorkerNode) => nodeObject(n),
    header: (wide) => ['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION', ...(wide ? ['INTERNAL-IP', 'OS-IMAGE', 'CONTAINER-RUNTIME'] : [])],
    row: (_sim, n: WorkerNode, wide) => [
      { t: n.name, c: 'strong' },
      { t: n.unschedulable ? 'Ready,SchedulingDisabled' : 'Ready', c: n.unschedulable ? 'warn' : 'success' },
      { t: '<none>', c: 'muted' },
      { t: '42d' },
      { t: 'v1.34.1' },
      ...(wide ? [{ t: `192.168.49.${n.name.replace(/\D/g, '') || '2'}` }, { t: 'Ubuntu 24.04 LTS' }, { t: 'containerd://2.1.4' }] : []),
    ],
  } satisfies Spec<WorkerNode>,
}
