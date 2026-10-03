import type {
  ClusterEvent,
  ClusterState,
  Deployment,
  Effect,
  EventSource,
  EventTone,
  Labels,
  Narration,
  PendingTask,
  Pod,
  ReplicaSet,
  ResourceKind,
  Service,
  Template,
} from './types'

/**
 * Educational pacing. A real cluster does most of this in milliseconds; we stretch it
 * just enough that every transition is visible, without making the experience feel slow.
 */
export const TIMING = {
  rsCreate: 520,
  controllerNotice: 900,
  scaleNotice: 450,
  rolloutCheck: 350,
  createAfterSync: 600,
  createStagger: 260,
  schedule: 480,
  pull: 720,
  start: 620,
  ready: 680,
  crash: 900,
  errorToBackoff: 550,
  backoffBase: 1500,
  backoffMax: 8000,
  terminate: 900,
  scaleDownStagger: 220,
} as const

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type EffectInput = DistributiveOmit<Effect, 'id' | 'at'>

interface Task {
  id: number
  due: number
  label: string
  run: () => void
}

export interface DeploymentManifest {
  name: string
  replicas: number
  labels: Labels
  image: string
}

export interface ServiceManifest {
  name: string
  selector: Labels
  port: number
  targetPort: number
}

export type Manifest = ({ kind: 'Deployment' } & DeploymentManifest) | ({ kind: 'Service' } & ServiceManifest)

/** A cluster that already exists when a lesson starts. */
export interface Setup {
  deployments?: (DeploymentManifest & { age?: number })[]
  services?: ServiceManifest[]
  pods?: { name: string; labels: Labels; image: string }[]
}

/** Images that crash on start. Version 1.5 "forgot" a required environment variable. */
// Images published "with a bug" in the app studio — they crash like 1.5 does.
const brokenImages = new Set<string>()
export const setBrokenImages = (images: Iterable<string>) => {
  brokenImages.clear()
  for (const i of images) brokenImages.add(i)
}
export const isBroken = (image: string) => /:1\.5$/.test(image) || brokenImages.has(image)

// Same alphabet Kubernetes uses for generated name suffixes (no vowels, no ambiguous chars).
const ALPHABET = 'bcdfghjklmnpqrstvwxz2456789'
const randomSuffix = (n: number) => Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')
const randomHash = () => randomSuffix(4) + Math.floor(Math.random() * 90 + 10) + randomSuffix(3)

export const matches = (selector: Labels, labels: Labels) =>
  Object.keys(selector).length > 0 && Object.entries(selector).every(([k, v]) => labels[k] === v)

export const labelString = (l: Labels) =>
  Object.entries(l)
    .map(([k, v]) => `${k}=${v}`)
    .join(',')

const sameLabels = (a: Labels, b: Labels) => {
  const ak = Object.keys(a).sort()
  const bk = Object.keys(b).sort()
  return ak.length === bk.length && ak.every((key, i) => key === bk[i] && a[key] === b[key])
}

const sameTemplateData = (a: Template, b: Template) => a.image === b.image && (a.restartedAt ?? 0) === (b.restartedAt ?? 0) && sameLabels(a.labels, b.labels)

/** Does this ReplicaSet run this template? */
export const sameTemplate = (rs: { image: string; templateLabels: Labels; restartedAt?: number }, t: Template) =>
  sameTemplateData({ image: rs.image, labels: rs.templateLabels, restartedAt: rs.restartedAt }, t)

/** The selector a ReplicaSet really uses: the Deployment's, pinned to its own template hash. */
export const rsSelector = (rs: ReplicaSet): Labels => ({ ...rs.selector, 'pod-template-hash': rs.hash })

/** Standalone Pods (no owner) are laid out in their own group. */
export const NO_OWNER = 'none'
const groupOf = (p: Pod) => p.ownerUid ?? NO_OWNER

export class Simulation {
  now = 0
  cluster: ClusterState = {
    deployments: {},
    replicaSets: {},
    pods: {},
    services: {},
    nodes: [
      { kind: 'Node', name: 'node-1' },
      { kind: 'Node', name: 'node-2' },
      { kind: 'Node', name: 'node-3' },
    ],
    vacancies: [],
  }
  events: ClusterEvent[] = []
  narration: Narration[] = []
  effects: Effect[] = []
  /** Manifests in the terminal's working directory for the current lesson. */
  files: string[] = ['backend.yaml']

  private queue: Task[] = []
  private seq = 0
  private dirty = false
  private queued = new Set<string>()
  private inflight: Record<string, number> = {}
  /** When the current divergence started — lets us tell the user how long healing took. */
  private divergedSince: Record<string, number> = {}
  private told = new Set<string>()
  private ipCounter = 4
  private svcIpCounter = 12
  private quiet = false
  private listeners = new Set<() => void>()

  // ── clock ────────────────────────────────────────────────────────────────

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  advance(dt: number) {
    const target = this.now + dt
    this.runUntil(target)
    this.now = target
    this.flush()
  }

  /** Jump to the next scheduled transition and run it. Powers "Step →". */
  step() {
    const next = this.queue[0]
    if (!next) return false
    this.runUntil(next.due)
    this.flush()
    return true
  }

  get pending(): PendingTask[] {
    return this.queue.map(({ id, due, label }) => ({ id, due, label }))
  }

  private runUntil(t: number) {
    while (this.queue.length && this.queue[0].due <= t) {
      const task = this.queue.shift()!
      this.now = Math.max(this.now, task.due)
      task.run()
      this.syncEndpoints()
      this.dirty = true
    }
  }

  private flush() {
    if (!this.dirty) return
    this.dirty = false
    this.listeners.forEach((fn) => fn())
  }

  private schedule(delay: number, label: string, run: () => void) {
    const task = { id: ++this.seq, due: this.now + delay, label, run }
    const i = this.queue.findIndex((t) => t.due > task.due)
    if (i === -1) this.queue.push(task)
    else this.queue.splice(i, 0, task)
    this.dirty = true
  }

  /** Schedule a controller pass at most once until it runs. */
  private once(key: string, delay: number, label: string, run: () => void) {
    if (this.queued.has(key)) return
    this.queued.add(key)
    this.schedule(delay, label, () => {
      this.queued.delete(key)
      run()
    })
  }

  /** Wrap user-initiated mutations so subscribers hear about them immediately. */
  private act<T>(fn: () => T): T {
    const result = fn()
    this.syncEndpoints()
    this.dirty = true
    this.flush()
    return result
  }

  // ── reporting ────────────────────────────────────────────────────────────

  private emit(
    source: EventSource,
    tone: EventTone,
    reason: string,
    message: string,
    involved: { kind: ResourceKind; uid: string; name: string },
    type: 'Normal' | 'Warning' = 'Normal',
  ) {
    this.events = [...this.events, { id: ++this.seq, at: this.now, type, reason, message, tone, source, involved }]
  }

  private narrate(n: Omit<Narration, 'id' | 'at'>) {
    if (this.quiet) return
    this.narration = [...this.narration.slice(-12), { ...n, id: ++this.seq, at: this.now }]
  }

  /** Narrate something only the first time it happens (per key). */
  private narrateOnce(key: string, n: Omit<Narration, 'id' | 'at'>) {
    if (this.told.has(key)) return
    this.told.add(key)
    this.narrate(n)
  }

  private fx(effect: EffectInput) {
    if (this.quiet) return
    this.effects = [...this.effects.slice(-24), { ...effect, id: ++this.seq, at: this.now } as Effect]
  }

  // ── queries ──────────────────────────────────────────────────────────────

  podsOf(rsUid: string) {
    return Object.values(this.cluster.pods).filter((p) => p.ownerUid === rsUid)
  }

  /** Terminating Pods don't count toward a ReplicaSet — exactly like the real controller. */
  activePods(rsUid: string) {
    return this.podsOf(rsUid).filter((p) => p.deletedAt === null)
  }

  /** The Deployment's ReplicaSets — not counting ones already being deleted. */
  replicaSetsOf(dep: Deployment) {
    return Object.values(this.cluster.replicaSets)
      .filter((rs) => rs.ownerUid === dep.uid && !rs.deletedAt)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /** The ReplicaSet running the Deployment's current template. */
  replicaSetOf(dep: Deployment) {
    const all = this.replicaSetsOf(dep)
    return all.filter((rs) => sameTemplate(rs, dep.template)).at(-1) ?? all.at(-1)
  }

  deploymentPods(dep: Deployment) {
    return this.replicaSetsOf(dep).flatMap((rs) => this.podsOf(rs.uid))
  }

  findDeployment(name: string) {
    return Object.values(this.cluster.deployments).find((d) => d.name === name)
  }

  findPod(name: string) {
    return Object.values(this.cluster.pods).find((p) => p.name === name)
  }

  findService(name: string) {
    return Object.values(this.cluster.services).find((s) => s.name === name)
  }

  /** Pods a Service's selector matches, ready or not. */
  selectedBy(svc: Service) {
    return Object.values(this.cluster.pods).filter((p) => p.deletedAt === null && matches(svc.selector, p.labels))
  }

  // ── mutation helpers ─────────────────────────────────────────────────────

  private putPod(pod: Pod) {
    this.cluster = { ...this.cluster, pods: { ...this.cluster.pods, [pod.uid]: pod } }
  }

  private patchPod(uid: string, patch: Partial<Pod>) {
    const pod = this.cluster.pods[uid]
    if (pod) this.putPod({ ...pod, ...patch })
  }

  private removePod(uid: string) {
    const { [uid]: _gone, ...rest } = this.cluster.pods
    this.cluster = { ...this.cluster, pods: rest }
  }

  private patchRS(uid: string, patch: Partial<ReplicaSet>) {
    const rs = this.cluster.replicaSets[uid]
    if (rs) this.cluster = { ...this.cluster, replicaSets: { ...this.cluster.replicaSets, [uid]: { ...rs, ...patch } } }
  }

  private patchDep(uid: string, patch: Partial<Deployment>) {
    const dep = this.cluster.deployments[uid]
    if (dep) this.cluster = { ...this.cluster, deployments: { ...this.cluster.deployments, [uid]: { ...dep, ...patch } } }
  }

  private putService(svc: Service) {
    this.cluster = { ...this.cluster, services: { ...this.cluster.services, [svc.uid]: svc } }
  }

  private livePod(uid: string) {
    const pod = this.cluster.pods[uid]
    return pod && pod.deletedAt === null ? pod : undefined
  }

  private dropVacancy(ownerUid: string, slot: number) {
    this.cluster = { ...this.cluster, vacancies: this.cluster.vacancies.filter((v) => !(v.ownerUid === ownerUid && v.slot === slot)) }
  }

  private nextIp(nodeName: string | null) {
    const i = this.cluster.nodes.findIndex((n) => n.name === nodeName)
    return `10.244.${i + 1}.${this.ipCounter++}`
  }

  // ── setup ────────────────────────────────────────────────────────────────

  /** Materialize a running cluster instantly — no animation, no narration. */
  bootstrap(setup: Setup) {
    this.quiet = true
    for (const d of setup.deployments ?? []) {
      const born = -(d.age ?? 4 * 60_000)
      const dep: Deployment = {
        kind: 'Deployment',
        uid: `dep-${++this.seq}`,
        name: d.name,
        replicas: d.replicas,
        selector: { ...d.labels },
        template: { labels: { ...d.labels }, image: d.image },
        createdAt: born,
        revision: 1,
        history: [{ image: d.image, labels: { ...d.labels } }],
        rollout: 'complete',
      }
      const hash = randomHash()
      const rs: ReplicaSet = {
        kind: 'ReplicaSet',
        uid: `rs-${++this.seq}`,
        name: `${d.name}-${hash}`,
        ownerUid: dep.uid,
        hash,
        image: d.image,
        templateLabels: { ...d.labels },
        revision: 1,
        desired: d.replicas,
        selector: { ...d.labels },
        createdAt: born + 400,
        phase: 'idle',
      }
      this.cluster = {
        ...this.cluster,
        deployments: { ...this.cluster.deployments, [dep.uid]: dep },
        replicaSets: { ...this.cluster.replicaSets, [rs.uid]: rs },
      }
      for (let i = 0; i < d.replicas; i++) {
        const nodeName = this.cluster.nodes[i % this.cluster.nodes.length].name
        this.putPod({
          kind: 'Pod',
          uid: `pod-${++this.seq}`,
          name: `${rs.name}-${randomSuffix(5)}`,
          ownerUid: rs.uid,
          labels: { ...d.labels, 'pod-template-hash': hash },
          image: d.image,
          phase: 'Running',
          ready: true,
          nodeName,
          ip: this.nextIp(nodeName),
          slot: i,
          createdAt: born + 900 + i * 250,
          deletedAt: null,
          restarts: 0,
        })
      }
      this.emit('cluster', 'success', 'Existing', `deployment/${dep.name} already running — ${d.replicas}/${d.replicas} ready`, this.ref(dep))
    }
    for (const p of setup.pods ?? []) {
      const nodeName = this.cluster.nodes[Object.keys(this.cluster.pods).length % this.cluster.nodes.length].name
      const pod: Pod = {
        kind: 'Pod',
        uid: `pod-${++this.seq}`,
        name: p.name,
        ownerUid: null,
        labels: { ...p.labels },
        image: p.image,
        phase: 'Running',
        ready: true,
        nodeName,
        ip: this.nextIp(nodeName),
        slot: this.freeSlot(NO_OWNER),
        createdAt: -2 * 60_000,
        deletedAt: null,
        restarts: 0,
      }
      this.putPod(pod)
      this.emit('cluster', 'success', 'Existing', `pod/${pod.name} already running`, this.ref(pod))
    }
    for (const s of setup.services ?? []) {
      const svc = this.newService(s)
      svc.createdAt = -3 * 60_000
      this.putService(svc)
      this.emit('cluster', 'success', 'Existing', `service/${svc.name} selects ${labelString(svc.selector)}`, this.ref(svc))
    }
    this.syncEndpoints()
    this.quiet = false
    this.dirty = true
    this.flush()
  }

  // ── user actions ─────────────────────────────────────────────────────────

  /** `kubectl create deployment`: register desired state, then let controllers materialize it. */
  createDeployment(name: string, image: string, replicas = 1) {
    if (this.findDeployment(name)) return 'exists' as const
    return this.act(() => {
      const labels = { app: name }
      const dep: Deployment = {
        kind: 'Deployment',
        uid: `dep-${++this.seq}`,
        name,
        replicas,
        selector: { ...labels },
        template: { labels: { ...labels }, image },
        createdAt: this.now,
        revision: 1,
        history: [{ image, labels: { ...labels } }],
        rollout: 'progressing',
      }
      this.cluster = { ...this.cluster, deployments: { ...this.cluster.deployments, [dep.uid]: dep } }
      this.emit('you', 'user', 'Created', `kubectl create deployment ${name} --image=${image}`, this.ref(dep))
      this.narrate({
        tone: 'info',
        title: `Deployment ${name} criado`,
        body: `O desired state pede ${replicas} ${replicas === 1 ? 'réplica' : 'réplicas'} com app=${name}. O Deployment controller agora cria o ReplicaSet.`,
      })
      this.schedule(TIMING.rsCreate, 'o Deployment controller cria um ReplicaSet', () => this.syncDeployment(dep.uid))
      return 'created' as const
    })
  }

  apply(m: Manifest): 'created' | 'configured' | 'unchanged' {
    if (m.kind === 'Service') {
      const existing = this.findService(m.name)
      if (!existing) {
        this.act(() => this.createService(m))
        return 'created'
      }
      if (labelString(existing.selector) === labelString(m.selector)) return 'unchanged'
      this.setSelector(m.name, m.selector)
      return 'configured'
    }
    const existing = this.findDeployment(m.name)
    if (existing) {
      if (existing.template.image !== m.image) {
        this.setImage(m.name, 'backend', m.image, 'apply')
        return 'configured'
      }
      if (existing.replicas === m.replicas) return 'unchanged'
      this.scale(m.name, m.replicas, 'apply')
      return 'configured'
    }
    return this.act(() => {
      const dep: Deployment = {
        kind: 'Deployment',
        uid: `dep-${++this.seq}`,
        name: m.name,
        replicas: m.replicas,
        selector: { ...m.labels },
        template: { labels: { ...m.labels }, image: m.image },
        createdAt: this.now,
        revision: 1,
        history: [{ image: m.image, labels: { ...m.labels } }],
        rollout: 'complete',
      }
      this.cluster = { ...this.cluster, deployments: { ...this.cluster.deployments, [dep.uid]: dep } }
      this.emit('you', 'user', 'Applied', `kubectl apply — deployment.apps/${dep.name} created`, this.ref(dep))
      this.narrate({
        tone: 'info',
        title: 'Desired state registrado',
        body: `Você descreveu o que quer: ${dep.replicas} réplicas de ${dep.name}. Nada está rodando ainda — os controllers é que vão tornar isso real.`,
      })
      this.schedule(TIMING.rsCreate, 'o Deployment controller cria um ReplicaSet', () => this.syncDeployment(dep.uid))
      return 'created' as const
    })
  }

  scale(name: string, replicas: number, via: 'scale' | 'apply' | 'ui' | 'edit' = 'scale') {
    const dep = this.findDeployment(name)
    if (!dep) return false
    if (dep.replicas === replicas) return true
    this.act(() => {
      const from = dep.replicas
      this.patchDep(dep.uid, { replicas })
      this.emit('you', 'user', 'Scaled', `${via === 'apply' ? 'kubectl apply' : via === 'edit' ? 'kubectl edit' : 'kubectl scale'} — replicas ${from} → ${replicas}`, this.ref(dep))
      this.narrate({
        tone: 'info',
        title: 'Você mudou o desired state',
        body:
          replicas === 0
            ? `${name} agora quer 0 réplicas. O Deployment e o ReplicaSet continuam existindo — só os Pods vão embora.`
            : `${name} agora quer ${replicas} réplicas em vez de ${from}. Veja os controllers convergirem.`,
        command: via === 'ui' ? `kubectl scale deployment ${name} --replicas=${replicas}` : undefined,
      })
      this.schedule(TIMING.scaleNotice, 'o Deployment controller atualiza o ReplicaSet', () => this.syncDeployment(dep.uid))
    })
    return true
  }

  setImage(name: string, container: string, image: string, via: 'set' | 'apply' | 'edit' = 'set', labels?: Labels) {
    const dep = this.findDeployment(name)
    if (!dep) return 'notfound' as const
    if (container !== 'backend') return 'nocontainer' as const
    const nextLabels = labels ?? dep.template.labels
    if (!matches(dep.selector, nextLabels)) return 'selector' as const
    const imageChanged = dep.template.image !== image
    const labelsChanged = !sameLabels(dep.template.labels, nextLabels)
    if (!imageChanged && !labelsChanged) return 'unchanged' as const
    this.act(() => {
      const from = dep.template.image
      const template = { ...dep.template, image, labels: { ...nextLabels } }
      this.patchDep(dep.uid, {
        template,
        revision: dep.revision + 1,
        history: [...dep.history, { ...template, labels: { ...template.labels } }],
        rollout: dep.paused ? dep.rollout : 'progressing',
      })
      const command = via === 'apply' ? 'kubectl apply' : via === 'edit' ? 'kubectl edit' : 'kubectl set image'
      const change = imageChanged && labelsChanged ? `${tag(from)} → ${tag(image)}; labels → ${labelString(nextLabels)}` : imageChanged ? `${tag(from)} → ${tag(image)}` : `labels → ${labelString(nextLabels)}`
      this.emit('you', 'user', imageChanged ? 'ImageChanged' : 'LabelsChanged', `${command} — ${change}`, this.ref(dep))
      this.narrate({
        tone: 'info',
        title: imageChanged ? 'Nova versão solicitada' : 'Template atualizado',
        body: 'Template novo significa ReplicaSet novo. O Deployment troca os Pods um de cada vez — os antigos continuam atendendo até os novos ficarem Ready.',
      })
      this.schedule(TIMING.scaleNotice, 'o Deployment controller inicia o rollout', () => this.syncDeployment(dep.uid))
    })
    return 'updated' as const
  }

  /** `kubectl rollout undo [--to-revision=N]`. Revisions are 1-based positions in `history`. */
  rolloutUndo(name: string, toRevision?: number) {
    const dep = this.findDeployment(name)
    if (!dep) return 'notfound' as const
    if (toRevision !== undefined && !dep.history[toRevision - 1]) return 'norevision' as const
    const previous = toRevision !== undefined ? dep.history[toRevision - 1] : dep.history.length > 1 ? dep.history[dep.history.length - 2] : undefined
    if (!previous) return 'nohistory' as const
    if (sameTemplateData(previous, dep.template)) return 'skipped' as const
    this.act(() => {
      this.patchDep(dep.uid, {
        template: { image: previous.image, labels: { ...previous.labels }, restartedAt: previous.restartedAt },
        revision: dep.revision + 1,
        history: [...dep.history, previous],
        rollout: dep.paused ? dep.rollout : 'progressing',
      })
      this.emit('you', 'user', 'RolledBack', `kubectl rollout undo${toRevision !== undefined ? ` --to-revision=${toRevision}` : ''} — back to ${tag(previous.image)}`, this.ref(dep))
      this.narrate({
        tone: 'info',
        title: 'Fazendo rollback',
        body: `O template volta para ${tag(previous.image)}. O ReplicaSet antigo ainda existe, então o Deployment só precisa escalá-lo de volta e escalar o atual para zero.`,
      })
      this.schedule(TIMING.scaleNotice, 'o Deployment controller inicia o rollback', () => this.syncDeployment(dep.uid))
    })
    return 'rolledback' as const
  }

  /** `kubectl rollout restart`: a new template stamp, so every Pod is replaced — gradually. */
  rolloutRestart(name: string) {
    const dep = this.findDeployment(name)
    if (!dep) return 'notfound' as const
    if (dep.paused) return 'paused' as const
    this.act(() => {
      const template = { ...dep.template, restartedAt: this.now }
      this.patchDep(dep.uid, { template, revision: dep.revision + 1, history: [...dep.history, { ...template, labels: { ...template.labels } }], rollout: 'progressing' })
      this.emit('you', 'user', 'Restarted', `kubectl rollout restart deployment/${dep.name}`, this.ref(dep))
      this.narrate({
        tone: 'info',
        title: 'Reiniciando sem derrubar nada',
        body: 'Mesma imagem, mas o template ganhou a annotation restartedAt — para o Deployment, é uma revisão nova. Ele troca os Pods aos poucos, como em qualquer rolling update.',
      })
      this.schedule(TIMING.scaleNotice, 'o Deployment controller inicia o rollout', () => this.syncDeployment(dep.uid))
    })
    return 'restarted' as const
  }

  /** `kubectl rollout pause|resume`. While paused, template changes are recorded but not rolled out. */
  setPaused(name: string, paused: boolean) {
    const dep = this.findDeployment(name)
    if (!dep) return 'notfound' as const
    if (!!dep.paused === paused) return 'unchanged' as const
    this.act(() => {
      // resuming with a template that no ReplicaSet runs yet: that's a rollout starting
      const pending = !paused && !this.replicaSetsOf(dep).some((rs) => sameTemplate(rs, dep.template))
      this.patchDep(dep.uid, { paused, ...(pending && { rollout: 'progressing' as const }) })
      this.emit('you', 'user', paused ? 'Paused' : 'Resumed', `kubectl rollout ${paused ? 'pause' : 'resume'} deployment/${dep.name}`, this.ref(dep))
      this.narrate(
        paused
          ? { tone: 'info', title: 'Deployment pausado', body: 'Mudanças no template (como set image) ficam registradas, mas nenhum ReplicaSet novo é criado até o resume. Dá para acumular várias mudanças num rollout só.' }
          : { tone: 'info', title: 'Deployment retomado', body: 'Se o template mudou durante a pausa, o rollout começa agora — com todas as mudanças de uma vez.' },
      )
      if (!paused) this.schedule(TIMING.scaleNotice, 'o Deployment controller retoma o rollout', () => this.syncDeployment(dep.uid))
    })
    return 'updated' as const
  }

  deletePod(name: string) {
    const pod = this.findPod(name)
    if (!pod) return 'notfound' as const
    if (pod.deletedAt !== null) return 'terminating' as const
    this.act(() => {
      this.emit('you', 'user', 'Deleted', `kubectl delete pod ${pod.name}`, this.ref(pod))
      this.terminate(pod, 'you')
    })
    return 'deleted' as const
  }

  /** `kubectl label`. A `null` value removes the key. */
  labelPod(name: string, changes: Record<string, string | null>, overwrite: boolean): { ok: true; changed: boolean } | { error: string } {
    const pod = this.findPod(name)
    if (!pod) return { error: `Error from server (NotFound): pods "${name}" not found` }
    for (const [k, v] of Object.entries(changes)) {
      if (v !== null && pod.labels[k] !== undefined && pod.labels[k] !== v && !overwrite)
        return { error: `error: '${k}' already has a value (${pod.labels[k]}), and --overwrite is false` }
    }
    const labels = { ...pod.labels }
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) delete labels[k]
      else labels[k] = v
    }
    if (labelString(labels) === labelString(pod.labels)) return { ok: true, changed: false }
    this.act(() => {
      const spec = Object.entries(changes)
        .map(([k, v]) => (v === null ? `${k}-` : `${k}=${v}`))
        .join(' ')
      this.patchPod(pod.uid, { labels })
      this.emit('you', 'user', 'Labeled', `kubectl label pod ${pod.name} ${spec}`, this.ref(pod))
      this.fx({ kind: 'ping', uid: pod.uid, tone: 'info' })
      const rs = pod.ownerUid ? this.cluster.replicaSets[pod.ownerUid] : undefined
      if (rs && !matches(rsSelector(rs), labels)) this.release(this.cluster.pods[pod.uid], rs)
      // Any ReplicaSet whose selector now matches an orphan will want to adopt it.
      for (const other of Object.values(this.cluster.replicaSets)) this.kick(other.uid)
    })
    return { ok: true, changed: true }
  }

  setSelector(name: string, selector: Labels) {
    const svc = this.findService(name)
    if (!svc) return 'notfound' as const
    if (labelString(svc.selector) === labelString(selector)) return 'unchanged' as const
    this.act(() => {
      this.putService({ ...svc, selector: { ...selector } })
      this.emit('you', 'user', 'SelectorChanged', `service/${svc.name} selector → ${labelString(selector)}`, this.ref(svc))
      this.syncEndpoints()
      const updated = this.cluster.services[svc.uid]
      if (!updated.endpoints.length) {
        const matched = this.selectedBy(updated).length
        this.narrate({
          tone: 'error',
          title: 'Ainda sem endpoints',
          body: matched
            ? `${matched} Pod${matched === 1 ? '' : 's'} ${matched === 1 ? 'tem' : 'têm'} ${labelString(selector)}, mas nenhum está Ready ainda.`
            : `Nenhum Pod tem ${labelString(selector)}. O Service não tem para onde mandar o tráfego.`,
        })
      }
    })
    return 'updated' as const
  }

  expose(depName: string, port: number, targetPort: number, name?: string) {
    const dep = this.findDeployment(depName)
    if (!dep) return 'notfound' as const
    if (this.findService(name ?? depName)) return 'exists' as const
    this.act(() => this.createService({ name: name ?? depName, selector: { ...dep.selector }, port, targetPort }))
    return 'created' as const
  }

  deleteService(name: string) {
    const svc = this.findService(name)
    if (!svc) return false
    this.act(() => {
      const { [svc.uid]: _gone, ...rest } = this.cluster.services
      this.cluster = { ...this.cluster, services: rest }
      this.emit('you', 'user', 'Deleted', `kubectl delete service ${svc.name}`, this.ref(svc))
    })
    return true
  }

  /** `kubectl run`: a Pod with no owner. Nothing will replace it if it goes away. */
  runPod(name: string, image: string, labels: Labels) {
    if (this.findPod(name)) return 'exists' as const
    this.act(() => {
      const pod: Pod = {
        kind: 'Pod',
        uid: `pod-${++this.seq}`,
        name,
        ownerUid: null,
        labels: { ...labels },
        image,
        phase: 'Pending',
        ready: false,
        nodeName: null,
        ip: null,
        slot: this.freeSlot(NO_OWNER),
        createdAt: this.now,
        deletedAt: null,
        restarts: 0,
      }
      this.putPod(pod)
      this.emit('you', 'user', 'Created', `kubectl run ${name} --image=${image}`, this.ref(pod))
      this.fx({ kind: 'ping', uid: pod.uid, tone: 'info' })
      this.narrate({
        tone: 'info',
        title: 'Um Pod avulso',
        body: `${name} não tem ReplicaSet nem Deployment por trás. Ele roda igual aos outros — mas, se for apagado, nada o recria.`,
      })
      this.schedule(TIMING.schedule, `o scheduler escolhe um node para ${name}`, () => this.bind(pod.uid))
      // a ReplicaSet whose selector matches these labels would adopt it
      for (const rs of Object.values(this.cluster.replicaSets)) this.kick(rs.uid)
    })
    return 'created' as const
  }

  /** `kubectl delete deployment`: gone at once; the garbage collector then removes what it owned. */
  deleteDeployment(name: string) {
    const dep = this.findDeployment(name)
    if (!dep) return false
    this.act(() => {
      const owned = Object.values(this.cluster.replicaSets).filter((rs) => rs.ownerUid === dep.uid)
      const { [dep.uid]: _gone, ...rest } = this.cluster.deployments
      this.cluster = { ...this.cluster, deployments: rest }
      this.emit('you', 'user', 'Deleted', `kubectl delete deployment ${dep.name}`, this.ref(dep))
      this.narrate({
        tone: 'warn',
        title: 'Exclusão em cascata',
        body: `O Deployment some na hora. Seus ${owned.length === 1 ? 'ReplicaSet ficou' : `${owned.length} ReplicaSets ficaram`} sem dono vivo — o garbage collector percebe e apaga ${owned.length === 1 ? 'ele' : 'eles'}, e com ${owned.length === 1 ? 'ele' : 'eles'} os Pods.`,
      })
      this.schedule(TIMING.controllerNotice, 'o garbage collector apaga os dependentes', () => {
        for (const rs of owned) if (this.cluster.replicaSets[rs.uid]) this.collectReplicaSet(rs.uid, `owner deployment/${dep.name} is gone`)
      })
    })
    return true
  }

  /** `kubectl delete rs`: its Pods go with it — and an owning Deployment notices and makes a new one. */
  deleteReplicaSet(name: string) {
    const rs = Object.values(this.cluster.replicaSets).find((r) => r.name === name && !r.deletedAt)
    if (!rs) return false
    this.act(() => {
      const dep = this.cluster.deployments[rs.ownerUid]
      this.emit('you', 'user', 'Deleted', `kubectl delete replicaset ${rs.name}`, this.ref(rs))
      this.collectReplicaSet(rs.uid, 'deleted with kubectl')
      if (dep) {
        this.narrate({
          tone: 'warn',
          title: 'O Deployment vai perceber',
          body: `Os Pods de ${rs.name} saem junto com ele. Mas o Deployment ainda existe e quer ${dep.replicas} réplicas: ele cria um ReplicaSet novo para o mesmo template.`,
        })
        this.schedule(TIMING.controllerNotice, 'o Deployment controller nota que falta um ReplicaSet', () => this.syncDeployment(dep.uid))
      }
    })
    return true
  }

  /** The garbage collector at work: mark the ReplicaSet deleted and end its Pods; it disappears when empty. */
  private collectReplicaSet(rsUid: string, why: string) {
    const rs = this.cluster.replicaSets[rsUid]
    if (!rs || rs.deletedAt) return
    this.patchRS(rsUid, { deletedAt: this.now, phase: 'idle' })
    this.cluster = { ...this.cluster, vacancies: this.cluster.vacancies.filter((v) => v.ownerUid !== rsUid) }
    delete this.inflight[rsUid]
    this.emit('garbage-collector', 'delete', 'GarbageCollecting', `Deleting replica set ${rs.name}: ${why}`, this.ref(rs))
    this.fx({ kind: 'ping', uid: rs.uid, tone: 'warn' })
    const pods = this.activePods(rsUid)
    if (!pods.length && !this.podsOf(rsUid).length) return this.removeReplicaSet(rsUid)
    pods.forEach((pod, i) =>
      this.schedule(TIMING.scaleDownStagger * (i + 1), `o garbage collector apaga ${short(pod.name)}`, () => {
        const live = this.livePod(pod.uid)
        if (live) this.terminate(live, 'gc')
      }),
    )
  }

  private removeReplicaSet(rsUid: string) {
    const rs = this.cluster.replicaSets[rsUid]
    if (!rs) return
    const { [rsUid]: _gone, ...rest } = this.cluster.replicaSets
    this.cluster = { ...this.cluster, replicaSets: rest, vacancies: this.cluster.vacancies.filter((v) => v.ownerUid !== rsUid) }
    this.emit('garbage-collector', 'delete', 'GarbageCollected', `Replica set ${rs.name} removed: no Pods left`, this.ref(rs))
  }

  /**
   * Simulated container output. Broken images explain themselves — if you think to look.
   * `previous` is the container instance before the last restart (`kubectl logs --previous`).
   */
  logs(name: string, previous = false): string[] | 'noprevious' | null {
    const pod = this.findPod(name)
    if (!pod) return null
    if (previous && pod.restarts === 0) return 'noprevious'
    if (isBroken(pod.image)) {
      if (!previous && (pod.phase === 'Pending' || pod.phase === 'ContainerCreating')) return []
      return [
        `level=info msg="starting backend" version=${tag(pod.image)}`,
        'level=info msg="loading configuration"',
        'panic: config: required environment variable DATABASE_URL is not set',
        '',
        'goroutine 1 [running]:',
        'main.mustConfig(...)',
        '\t/app/config.go:41 +0x1d4',
        'exit status 2',
      ]
    }
    if (pod.phase === 'Pending' || pod.phase === 'ContainerCreating') return []
    if (!pod.image.includes('kubelearn/backend')) {
      if (/nginx/.test(pod.image))
        return [
          '/docker-entrypoint.sh: Configuration complete; ready for start up',
          `${new Date(Date.now() - (this.now - pod.createdAt)).toISOString().slice(0, 19).replace('T', ' ')} [notice] 1#1: start worker processes`,
        ]
      return []
    }
    const served = Math.max(0, Math.floor((this.now - pod.createdAt) / 1800))
    return [
      `level=info msg="starting backend" version=${tag(pod.image)}`,
      'level=info msg="connected to database"',
      'level=info msg="listening" addr=:8080',
      ...Array.from({ length: Math.min(served, 6) }, (_, i) => `level=info msg="request" method=GET path=${i % 3 ? '/api/items' : '/healthz'} status=200`),
    ]
  }

  // ── deployment controller ────────────────────────────────────────────────

  /** Something about a Deployment's Pods changed: re-evaluate its rollout soon. */
  private touchDeployment(rsUid: string | null) {
    const rs = rsUid ? this.cluster.replicaSets[rsUid] : undefined
    const dep = rs && this.cluster.deployments[rs.ownerUid]
    if (!dep) return
    const busy = dep.rollout !== 'complete' || this.replicaSetsOf(dep).filter((r) => r.desired > 0).length > 1
    if (busy) this.once(`dep:${dep.uid}`, TIMING.rolloutCheck, 'o Deployment controller verifica o andamento do rollout', () => this.syncDeployment(dep.uid))
  }

  private syncDeployment(depUid: string) {
    const dep = this.cluster.deployments[depUid]
    if (!dep) return
    const all = this.replicaSetsOf(dep)
    if (dep.paused) {
      // paused: no new ReplicaSet and no rollout progress — only plain scaling still applies
      const live = all.filter((rs) => rs.desired > 0)
      if (live.length === 1 && live[0].desired !== dep.replicas) this.scaleRS(live[0], dep.replicas)
      return
    }
    let current = all.filter((rs) => sameTemplate(rs, dep.template)).at(-1)
    if (!current) {
      current = this.createReplicaSet(dep, all.length ? 0 : dep.replicas)
      if (!all.length) return
    } else if (current.revision !== dep.revision) {
      this.patchRS(current.uid, { revision: dep.revision })
    }
    const old = all.filter((rs) => rs.uid !== current.uid && rs.desired > 0)
    if (!old.length) {
      if (current.desired !== dep.replicas) this.scaleRS(current, dep.replicas)
      return this.checkRollout(dep.uid)
    }

    // Rolling update, with the real defaults: maxSurge 25% (rounded up), maxUnavailable 25% (rounded down).
    const surge = Math.max(1, Math.ceil(dep.replicas * 0.25))
    const maxUnavailable = Math.floor(dep.replicas * 0.25)
    const readyIn = (rs: ReplicaSet) => this.activePods(rs.uid).filter((p) => p.ready).length

    // 1. Old Pods that aren't available are pure cost — drop them first.
    for (const rs of old) {
      const unhealthy = rs.desired - readyIn(rs)
      if (unhealthy > 0) this.scaleRS(rs, rs.desired - unhealthy)
    }
    // 2. Surge the new ReplicaSet up, within maxSurge.
    const totalDesired = all.reduce((n, rs) => n + this.cluster.replicaSets[rs.uid].desired, 0)
    const room = dep.replicas + surge - totalDesired
    const cur = this.cluster.replicaSets[current.uid]
    if (cur.desired < dep.replicas && room > 0) this.scaleRS(cur, Math.min(dep.replicas, cur.desired + room))
    // 3. Scale old ones down only as far as availability allows.
    const allPods = all.reduce((n, rs) => n + this.activePods(rs.uid).length, 0)
    const newUnavailable = Math.max(0, this.cluster.replicaSets[current.uid].desired - readyIn(current))
    let removable = allPods - (dep.replicas - maxUnavailable) - newUnavailable
    for (const rs of old) {
      const live = this.cluster.replicaSets[rs.uid]
      if (removable <= 0 || live.desired === 0) continue
      const n = Math.min(live.desired, removable)
      this.scaleRS(live, live.desired - n)
      removable -= n
    }
    this.checkRollout(dep.uid)
  }

  private checkRollout(depUid: string) {
    const dep = this.cluster.deployments[depUid]
    if (!dep || dep.rollout === 'complete') return
    const all = this.replicaSetsOf(dep)
    const current = all.find((rs) => sameTemplate(rs, dep.template))
    // done only when old revisions are not just scaled to 0, but actually empty
    if (!current || all.some((rs) => rs.uid !== current.uid && (rs.desired > 0 || this.podsOf(rs.uid).length > 0))) return
    const active = this.activePods(current.uid)
    if (current.desired !== dep.replicas || active.length !== dep.replicas || !active.every((p) => p.ready)) return
    this.patchDep(dep.uid, { rollout: 'complete' })
    this.emit('deployment-controller', 'success', 'RolloutComplete', `deployment "${dep.name}" successfully rolled out (revision ${dep.revision})`, this.ref(dep))
    this.fx({ kind: 'ping', uid: dep.uid, tone: 'success' })
    this.narrate({
      tone: 'success',
      title: 'Rollout concluído',
      body: `Todos os Pods agora rodam ${tag(dep.template.image)}. O ReplicaSet anterior fica guardado com 0 réplicas — é isso que torna um rollback instantâneo.`,
    })
  }

  private createReplicaSet(dep: Deployment, desired: number) {
    const hash = randomHash()
    const rs: ReplicaSet = {
      kind: 'ReplicaSet',
      uid: `rs-${++this.seq}`,
      name: `${dep.name}-${hash}`,
      ownerUid: dep.uid,
      hash,
      image: dep.template.image,
      templateLabels: { ...dep.template.labels },
      revision: dep.revision,
      restartedAt: dep.template.restartedAt,
      desired,
      selector: { ...dep.selector },
      createdAt: this.now,
      phase: 'idle',
    }
    this.cluster = { ...this.cluster, replicaSets: { ...this.cluster.replicaSets, [rs.uid]: rs } }
    this.fx({ kind: 'pulse', chain: [dep.uid, rs.uid], tone: 'create' })
    if (desired > 0) {
      this.emit('deployment-controller', 'create', 'ScalingReplicaSet', `Scaled up replica set ${rs.name} to ${desired}`, this.ref(rs))
      this.narrate({
        tone: 'info',
        title: 'ReplicaSet criado',
        body: `O Deployment não cria Pods diretamente. Ele cria um ReplicaSet, cuja única função é manter ${desired} Pods vivos.`,
        metrics: { desired, actual: 0 },
      })
    } else {
      this.emit('deployment-controller', 'create', 'NewReplicaSet', `Created replica set ${rs.name} for ${tag(rs.image)}`, this.ref(rs))
    }
    this.kick(rs.uid, TIMING.scaleNotice)
    return rs
  }

  private scaleRS(rs: ReplicaSet, desired: number) {
    if (rs.desired === desired) return
    const from = rs.desired
    this.patchRS(rs.uid, { desired })
    this.cluster = { ...this.cluster, vacancies: this.cluster.vacancies.filter((v) => v.ownerUid !== rs.uid || v.slot < desired) }
    this.emit('deployment-controller', 'reconcile', 'ScalingReplicaSet', `Scaled ${desired > from ? 'up' : 'down'} replica set ${rs.name} to ${desired}`, this.ref(rs))
    this.fx({ kind: 'pulse', chain: [rs.ownerUid, rs.uid], tone: 'reconcile' })
    this.kick(rs.uid, TIMING.scaleNotice)
  }

  // ── replicaset controller ────────────────────────────────────────────────

  private adoptable(rs: ReplicaSet) {
    const sel = rsSelector(rs)
    return Object.values(this.cluster.pods).filter((p) => p.ownerUid === null && p.deletedAt === null && matches(sel, p.labels))
  }

  /** Something changed that might make a ReplicaSet diverge from its desired count. */
  private kick(rsUid: string, delay: number = TIMING.controllerNotice) {
    const rs = this.cluster.replicaSets[rsUid]
    if (!rs) return
    const actual = this.activePods(rsUid).length + (this.inflight[rsUid] ?? 0)
    if (actual === rs.desired && !this.adoptable(rs).length) return
    if (rs.phase === 'idle') {
      this.patchRS(rsUid, { phase: 'diverged' })
      this.divergedSince[rsUid] ??= this.now
    }
    this.once(`rs:${rsUid}`, delay, 'o ReplicaSet controller percebe que Desired ≠ Actual', () => this.syncReplicaSet(rsUid))
  }

  private syncReplicaSet(rsUid: string) {
    const rs = this.cluster.replicaSets[rsUid]
    // a ReplicaSet being deleted no longer reconciles: its Pods are on their way out
    if (!rs || rs.deletedAt) return
    for (const orphan of this.adoptable(rs)) this.adopt(rs, orphan)
    const active = this.activePods(rsUid)
    const inflight = this.inflight[rsUid] ?? 0
    const diff = rs.desired - active.length - inflight
    if (diff === 0) return this.checkReconciled(rsUid)

    this.patchRS(rsUid, { phase: 'reconciling' })
    this.fx({ kind: 'pulse', chain: [rs.ownerUid, rs.uid], tone: 'reconcile' })
    this.emit(
      'replicaset-controller',
      'reconcile',
      'Reconciling',
      `Desired ${rs.desired}, actual ${active.length} — ${diff > 0 ? `creating ${diff}` : `terminating ${-diff}`} Pod${Math.abs(diff) === 1 ? '' : 's'}`,
      this.ref(rs),
    )
    this.narrate({
      tone: 'warn',
      title: 'Reconciliando',
      body:
        diff > 0
          ? `O ReplicaSet quer ${rs.desired} Pods, mas só existem ${active.length}. Ele cria ${diff === 1 ? 'um substituto' : `${diff} Pods novos`}.`
          : `O ReplicaSet quer ${rs.desired} Pod${rs.desired === 1 ? '' : 's'}, mas existem ${active.length}. Ele encerra ${-diff}.`,
      metrics: { desired: rs.desired, actual: active.length },
    })

    if (diff > 0) {
      this.inflight[rsUid] = inflight + diff
      for (let i = 0; i < diff; i++) {
        this.schedule(TIMING.createAfterSync + i * TIMING.createStagger, `o ReplicaSet cria um Pod (${i + 1}/${diff})`, () => this.createPod(rsUid))
      }
    } else {
      // Like the real controller: sacrifice the least valuable Pods first (not ready, then newest).
      const victims = [...active].sort((a, b) => Number(a.ready) - Number(b.ready) || b.createdAt - a.createdAt).slice(0, -diff)
      victims.forEach((pod, i) =>
        this.schedule(TIMING.createAfterSync / 2 + i * TIMING.scaleDownStagger, `o ReplicaSet encerra ${short(pod.name)}`, () => {
          const live = this.livePod(pod.uid)
          if (live) this.terminate(live, 'controller')
        }),
      )
    }
  }

  private adopt(rs: ReplicaSet, pod: Pod) {
    const slot = this.freeSlot(rs.uid)
    this.patchPod(pod.uid, { ownerUid: rs.uid, slot })
    this.dropVacancy(rs.uid, slot)
    this.compact(NO_OWNER)
    this.emit('replicaset-controller', 'create', 'Adopted', `Adopted pod ${pod.name}: its labels match the selector again`, this.ref(pod))
    this.fx({ kind: 'pulse', chain: [rs.uid, pod.uid], tone: 'create' })
    this.narrate({
      tone: 'info',
      title: 'Adotado',
      body: `${short(pod.name)} voltou a combinar com o selector do ReplicaSet, então volta a contar. Agora são ${this.activePods(rs.uid).length} para ${rs.desired} desejados.`,
      metrics: { desired: rs.desired, actual: this.activePods(rs.uid).length },
    })
  }

  /** The Pod's labels stopped matching: the ReplicaSet lets go of it (it keeps running, ownerless). */
  private release(pod: Pod, rs: ReplicaSet) {
    const fromSlot = pod.slot
    this.patchPod(pod.uid, { ownerUid: null, slot: this.freeSlot(NO_OWNER) })
    if (fromSlot < rs.desired) {
      this.cluster = { ...this.cluster, vacancies: [...this.cluster.vacancies, { slot: fromSlot, ownerUid: rs.uid, since: this.now, podName: pod.name }] }
    }
    const actual = this.activePods(rs.uid).length
    this.emit('replicaset-controller', 'delete', 'Orphaned', `Released pod ${pod.name}: it no longer matches ${labelString(rs.selector)}`, this.ref(pod))
    this.narrate({
      tone: 'warn',
      title: 'Liberado pelo ReplicaSet',
      body: `${short(pod.name)} não combina mais com ${labelString(rs.selector)}, então o ReplicaSet para de contá-lo — o Actual cai para ${actual}. O Pod continua rodando, sem dono.`,
      metrics: { desired: rs.desired, actual },
    })
    this.kick(rs.uid)
  }

  private freeSlot(group: string) {
    const taken = new Set(Object.values(this.cluster.pods).filter((p) => groupOf(p) === group).map((p) => p.slot))
    const vacancy = this.cluster.vacancies.filter((v) => v.ownerUid === group && !taken.has(v.slot)).sort((a, b) => a.since - b.since)[0]
    if (vacancy) return vacancy.slot
    let slot = 0
    while (taken.has(slot)) slot++
    return slot
  }

  /** Close gaps so a row reads as "N Pods", not "N Pods and some holes". */
  private compact(group: string) {
    if (group !== NO_OWNER && this.cluster.vacancies.some((v) => v.ownerUid === group)) return
    const pods = Object.values(this.cluster.pods)
      .filter((p) => groupOf(p) === group)
      .sort((a, b) => a.slot - b.slot)
    if (group !== NO_OWNER && pods.some((p) => p.deletedAt !== null)) return
    pods.forEach((p, i) => p.slot !== i && this.patchPod(p.uid, { slot: i }))
  }

  private createPod(rsUid: string) {
    this.inflight[rsUid] = Math.max(0, (this.inflight[rsUid] ?? 1) - 1)
    const rs = this.cluster.replicaSets[rsUid]
    if (!rs || !this.cluster.deployments[rs.ownerUid]) return
    const slot = this.freeSlot(rsUid)
    const pod: Pod = {
      kind: 'Pod',
      uid: `pod-${++this.seq}`,
      name: `${rs.name}-${randomSuffix(5)}`,
      ownerUid: rs.uid,
      labels: { ...rs.templateLabels, 'pod-template-hash': rs.hash },
      image: rs.image,
      phase: 'Pending',
      ready: false,
      nodeName: null,
      ip: null,
      slot,
      createdAt: this.now,
      deletedAt: null,
      restarts: 0,
    }
    this.putPod(pod)
    this.dropVacancy(rsUid, slot)
    this.emit('replicaset-controller', 'create', 'SuccessfulCreate', `Created pod: ${pod.name}`, this.ref(pod))
    this.fx({ kind: 'pulse', chain: [rs.uid, pod.uid], tone: 'create' })
    this.schedule(TIMING.schedule, `o scheduler escolhe um node para ${short(pod.name)}`, () => this.bind(pod.uid))
  }

  // ── scheduler & kubelet ──────────────────────────────────────────────────

  private bind(podUid: string) {
    const pod = this.livePod(podUid)
    if (!pod) return
    const load = (node: string) => Object.values(this.cluster.pods).filter((p) => p.nodeName === node && p.deletedAt === null).length
    const node = [...this.cluster.nodes].sort((a, b) => load(a.name) - load(b.name))[0]
    this.patchPod(podUid, { nodeName: node.name, phase: 'ContainerCreating' })
    this.emit('default-scheduler', 'schedule', 'Scheduled', `Successfully assigned default/${pod.name} to ${node.name}`, this.ref(pod))
    this.schedule(TIMING.pull, `o kubelet baixa a imagem de ${short(pod.name)}`, () => {
      const p = this.livePod(podUid)
      if (!p) return
      this.emit('kubelet', 'progress', 'Pulled', `Container image "${p.image}" already present on machine`, this.ref(p))
      this.schedule(TIMING.start, `o kubelet inicia o container de ${short(pod.name)}`, () => this.start(podUid))
    })
  }

  private start(podUid: string) {
    const pod = this.livePod(podUid)
    if (!pod) return
    this.patchPod(podUid, { phase: 'Running', ip: pod.ip ?? this.nextIp(pod.nodeName) })
    this.emit('kubelet', 'progress', 'Started', 'Started container backend', this.ref(pod))
    if (isBroken(pod.image)) {
      this.schedule(TIMING.crash, `o container de ${short(pod.name)} encerra com erro`, () => this.crash(podUid))
      return
    }
    this.schedule(TIMING.ready, `a readiness probe de ${short(pod.name)} passa`, () => {
      const p = this.livePod(podUid)
      if (!p) return
      this.patchPod(podUid, { ready: true })
      this.emit('kubelet', 'ready', 'Ready', 'Readiness probe succeeded — Pod is Ready', this.ref(p))
      if (p.ownerUid) {
        this.checkReconciled(p.ownerUid)
        this.touchDeployment(p.ownerUid)
      }
    })
  }

  private crash(podUid: string) {
    const pod = this.livePod(podUid)
    if (!pod) return
    const restarts = pod.restarts + 1
    this.patchPod(podUid, { phase: 'Error', ready: false, restarts })
    this.emit('kubelet', 'warning', 'BackOff', `Back-off restarting failed container backend in pod ${pod.name}`, this.ref(pod), 'Warning')
    this.fx({ kind: 'ping', uid: pod.uid, tone: 'error' })
    this.narrateOnce(`crash:${pod.ownerUid ?? pod.uid}`, {
      tone: 'error',
      title: 'CrashLoopBackOff',
      body: `O container de ${short(pod.name)} encerra logo depois de iniciar. O kubelet continua reiniciando, esperando mais a cada vez. Ele nunca fica Ready, então nunca recebe tráfego.`,
      command: `kubectl logs ${pod.name}`,
    })

    const rs = pod.ownerUid ? this.cluster.replicaSets[pod.ownerUid] : undefined
    const dep = rs && this.cluster.deployments[rs.ownerUid]
    if (dep && rs && sameTemplate(rs, dep.template) && dep.rollout === 'progressing') {
      this.patchDep(dep.uid, { rollout: 'stalled' })
      const oldReady = this.replicaSetsOf(dep)
        .filter((r) => r.uid !== rs.uid)
        .reduce((n, r) => n + this.activePods(r.uid).filter((p) => p.ready).length, 0)
      this.narrateOnce(`stall:${dep.uid}:${dep.revision}`, {
        tone: 'error',
        title: 'Rollout travado',
        body: `O Pod novo nunca fica Ready, então o Deployment não derruba nenhum Pod antigo. ${oldReady} Pod${oldReady === 1 ? '' : 's'} na ${tag(dep.history[dep.history.length - 2]?.image ?? '')} ${oldReady === 1 ? 'continua' : 'continuam'} atendendo — ninguém ficou fora do ar.`,
        command: `kubectl rollout status deployment/${dep.name}`,
      })
    }

    this.schedule(TIMING.errorToBackoff, `o kubelet aguarda (back-off) antes de reiniciar ${short(pod.name)}`, () => {
      const p = this.livePod(podUid)
      if (!p) return
      this.patchPod(podUid, { phase: 'CrashLoopBackOff' })
      const wait = Math.min(TIMING.backoffBase * 2 ** (p.restarts - 1), TIMING.backoffMax)
      this.schedule(wait, `o kubelet reinicia o container de ${short(pod.name)}`, () => {
        const q = this.livePod(podUid)
        if (!q) return
        this.patchPod(podUid, { phase: 'Running' })
        this.emit('kubelet', 'progress', 'Started', `Started container backend (restart #${q.restarts})`, this.ref(q))
        this.schedule(TIMING.crash, `o container de ${short(pod.name)} encerra com erro`, () => this.crash(podUid))
      })
    })
    this.touchDeployment(pod.ownerUid)
  }

  private terminate(pod: Pod, by: 'you' | 'controller' | 'gc') {
    this.patchPod(pod.uid, { phase: 'Terminating', ready: false, deletedAt: this.now })
    this.emit('kubelet', 'delete', 'Killing', 'Stopping container backend', this.ref(pod))
    this.fx({ kind: 'ping', uid: pod.uid, tone: 'warn' })

    const rs = pod.ownerUid ? this.cluster.replicaSets[pod.ownerUid] : undefined
    if (by === 'you') {
      if (rs) {
        const actual = this.activePods(rs.uid).length
        this.narrate({
          tone: 'warn',
          title: 'Um Pod está saindo',
          body: `Pods em Terminating não contam mais para o ReplicaSet. O Actual acabou de cair para ${actual}, mas o desired continua ${rs.desired}.`,
          metrics: { desired: rs.desired, actual },
        })
      } else {
        this.narrate({
          tone: 'warn',
          title: 'Um Pod sem dono',
          body: `${short(pod.name)} não é gerenciado por nenhum ReplicaSet. Quando ele sumir, nada vai trazê-lo de volta.`,
        })
      }
    }

    this.schedule(TIMING.terminate, `${short(pod.name)} termina de encerrar`, () => {
      const current = this.cluster.pods[pod.uid]
      if (!current) return
      const owner = current.ownerUid ? this.cluster.replicaSets[current.ownerUid] : undefined
      this.removePod(pod.uid)
      if (by === 'you' && owner && current.slot < owner.desired) {
        this.cluster = { ...this.cluster, vacancies: [...this.cluster.vacancies, { slot: current.slot, ownerUid: owner.uid, since: this.now, podName: pod.name }] }
      }
      this.emit('kubelet', 'delete', 'Removed', `Pod ${pod.name} removed from the API server`, this.ref(current))
      if (!owner) this.compact(NO_OWNER)
      else if (owner.deletedAt) {
        if (!this.podsOf(owner.uid).length) this.removeReplicaSet(owner.uid)
      } else {
        if (by === 'controller') this.compact(owner.uid)
        this.checkReconciled(owner.uid)
        this.touchDeployment(owner.uid)
      }
    })

    if (rs && !rs.deletedAt) this.kick(rs.uid)
  }

  private checkReconciled(rsUid: string) {
    const rs = this.cluster.replicaSets[rsUid]
    if (!rs || rs.phase === 'idle') return
    const active = this.activePods(rsUid)
    const terminating = this.podsOf(rsUid).length - active.length
    if ((this.inflight[rsUid] ?? 0) > 0 || active.length !== rs.desired || !active.every((p) => p.ready) || terminating > 0) return

    this.patchRS(rsUid, { phase: 'idle' })
    const since = this.divergedSince[rsUid]
    delete this.divergedSince[rsUid]
    if (rs.desired === 0) return // an old ReplicaSet emptied by a rollout — nothing to celebrate
    this.emit('replicaset-controller', 'success', 'Reconciled', `Desired state reached — ${rs.desired}/${rs.desired} Pods ready`, this.ref(rs))
    this.fx({ kind: 'ping', uid: rs.uid, tone: 'success' })
    this.fx({ kind: 'ping', uid: rs.ownerUid, tone: 'success' })
    this.narrate({
      tone: 'success',
      title: 'Reconciliado',
      body:
        since !== undefined
          ? `Actual voltou a ser igual ao desired. O cluster convergiu em ${((this.now - since) / 1000).toFixed(1).replace('.', ',')}s de tempo simulado — sem você fazer nada.`
          : 'Actual é igual ao desired. O cluster está exatamente como você descreveu.',
      metrics: { desired: rs.desired, actual: active.length },
    })
  }

  // ── services & endpoints ─────────────────────────────────────────────────

  private newService(m: ServiceManifest): Service {
    return {
      kind: 'Service',
      uid: `svc-${++this.seq}`,
      name: m.name,
      selector: { ...m.selector },
      port: m.port,
      targetPort: m.targetPort,
      clusterIP: `10.96.${Math.floor(this.svcIpCounter / 200)}.${this.svcIpCounter++ % 200}`,
      createdAt: this.now,
      endpoints: [],
    }
  }

  private createService(m: ServiceManifest) {
    const svc = this.newService(m)
    this.putService(svc)
    this.emit('you', 'user', 'Created', `service/${svc.name} created — selects ${labelString(svc.selector)}`, this.ref(svc))
    this.narrate({
      tone: 'info',
      title: 'Service criado',
      body: `Um Service é um endereço estável na frente de Pods que vêm e vão. Ele os encontra por label, não por nome: ${labelString(svc.selector)}.`,
    })
  }

  /** The endpoints controller: every Service tracks the Ready Pods its selector matches. */
  private syncEndpoints() {
    for (const svc of Object.values(this.cluster.services)) {
      const eps = Object.values(this.cluster.pods)
        .filter((p) => p.deletedAt === null && p.ready && matches(svc.selector, p.labels))
        .map((p) => p.uid)
      const before = svc.endpoints
      if (eps.length === before.length && eps.every((u) => before.includes(u))) continue
      this.putService({ ...svc, endpoints: eps })
      this.dirty = true
      if (this.quiet) continue
      for (const uid of eps.filter((u) => !before.includes(u))) {
        const p = this.cluster.pods[uid]
        this.emit('endpoints-controller', 'ready', 'EndpointAdded', `${p.ip} (${short(p.name)}) added to service/${svc.name}`, this.ref(p))
      }
      for (const uid of before.filter((u) => !eps.includes(u))) {
        const p = this.cluster.pods[uid]
        if (p) this.emit('endpoints-controller', 'delete', 'EndpointRemoved', `${p.ip} (${short(p.name)}) removed from service/${svc.name}`, this.ref(p))
      }
      if (before.length && !eps.length) {
        this.fx({ kind: 'ping', uid: svc.uid, tone: 'error' })
        this.narrate({
          tone: 'error',
          title: 'Sem endpoints',
          body: `service/${svc.name} seleciona ${labelString(svc.selector)}, mas nenhum Pod Ready combina. Toda requisição para ele falha.`,
        })
      } else if (!before.length && eps.length) {
        this.fx({ kind: 'ping', uid: svc.uid, tone: 'success' })
        this.narrate({
          tone: 'success',
          title: 'O tráfego está fluindo',
          body: `service/${svc.name} encontrou ${eps.length} Pod${eps.length === 1 ? '' : 's'} Ready com ${labelString(svc.selector)} e distribui as requisições entre ${eps.length === 1 ? 'ele' : 'eles'}.`,
        })
      }
    }
  }

  private ref(r: { kind: ResourceKind; uid: string; name: string }) {
    return { kind: r.kind, uid: r.uid, name: r.name }
  }
}

/** "backend-6d4c9-x7f2k" → "x7f2k": the part humans actually distinguish Pods by. */
export const short = (podName: string) => podName.split('-').pop() ?? podName

/** "ghcr.io/kubelearn/backend:1.4" → "v1.4" */
export const tag = (image: string) => {
  const t = image.split(':').pop() ?? image
  return /^\d/.test(t) ? `v${t}` : t
}
