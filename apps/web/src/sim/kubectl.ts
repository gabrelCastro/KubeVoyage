import { isBroken, labelString, matches, rsSelector, short, tag, type Manifest, type Simulation } from './engine'
import type { Labels, Pod } from './types'

export type Tone = 'muted' | 'error' | 'success' | 'warn' | 'accent' | 'info' | 'strong'
export type Seg = { t: string; c?: Tone }
export type Line = Seg[]

export interface CommandResult {
  lines: Line[]
  clear?: boolean
  watch?: 'pods'
  /** Resource the command was "about" — lets the stage acknowledge terminal activity. */
  focusUid?: string
}

export const IMAGE = 'ghcr.io/kubelearn/backend:1.4'

/** Manifests a lesson can put in the terminal's working directory. */
export const FILES: Record<string, { manifest: Manifest; yaml: string }> = {
  'backend.yaml': {
    manifest: { kind: 'Deployment', name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE },
    yaml: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: ${IMAGE}
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }`,
  },
  'service.yaml': {
    manifest: { kind: 'Service', name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 },
    yaml: `apiVersion: v1
kind: Service
metadata:
  name: backend
spec:
  selector:
    app: backend
  ports:
    - port: 80
      targetPort: 8080`,
  },
}

/** Kept for the first lesson and tests. */
export const MANIFEST = { file: 'backend.yaml', manifest: FILES['backend.yaml'].manifest }
export const MANIFEST_YAML = FILES['backend.yaml'].yaml

const plain = (t: string, c?: Tone): Line => [{ t, c }]
const err = (t: string): CommandResult => ({ lines: [plain(t, 'error')] })
const ok = (t: string, focusUid?: string): CommandResult => ({ lines: [plain(t, 'success')], focusUid })

export function age(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 120) return `${s}s`
  const m = Math.floor(s / 60)
  return s % 60 && m < 10 ? `${m}m${s % 60}s` : `${m}m`
}

function table(header: string[], rows: Seg[][]): Line[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].t.length)) + 3)
  const pad = (s: string, i: number) => (i === header.length - 1 ? s : s.padEnd(widths[i]))
  return [header.map((h, i) => ({ t: pad(h, i), c: 'muted' as Tone })), ...rows.map((r) => r.map((s, i) => ({ ...s, t: pad(s.t, i) })))]
}

const statusTone = (p: Pod): Tone =>
  p.phase === 'Terminating' || p.phase === 'Error' || p.phase === 'CrashLoopBackOff'
    ? 'error'
    : p.phase === 'Running'
      ? p.ready
        ? 'success'
        : 'info'
      : 'warn'

export function podRow(sim: Simulation, p: Pod, wide = false, labels = false): Seg[] {
  const row: Seg[] = [
    { t: p.name, c: 'strong' },
    { t: p.ready ? '1/1' : '0/1' },
    { t: p.phase, c: statusTone(p) },
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

/** "app=backend,tier=api" / "app=backend tier=api" → Labels; `key-` means "remove". */
function parseLabels(parts: string[]): Record<string, string | null> | null {
  const out: Record<string, string | null> = {}
  for (const part of parts.flatMap((p) => p.split(','))) {
    if (!part) continue
    if (part.endsWith('-') && !part.includes('=')) out[part.slice(0, -1)] = null
    else {
      const [k, v] = part.split('=')
      if (!k || v === undefined) return null
      out[k.trim()] = v.trim()
    }
  }
  return out
}

const parseSelector = (s: string): Labels => (parseLabels([s]) ?? {}) as Labels

type Kind = 'pods' | 'deployments' | 'replicasets' | 'services' | 'endpoints' | 'events' | 'nodes' | 'all'
const KIND_ALIASES: Record<string, Kind> = {
  po: 'pods', pod: 'pods', pods: 'pods',
  deploy: 'deployments', deployment: 'deployments', deployments: 'deployments', 'deployment.apps': 'deployments',
  rs: 'replicasets', replicaset: 'replicasets', replicasets: 'replicasets',
  svc: 'services', service: 'services', services: 'services',
  ep: 'endpoints', endpoint: 'endpoints', endpoints: 'endpoints',
  ev: 'events', event: 'events', events: 'events',
  no: 'nodes', node: 'nodes', nodes: 'nodes',
  all: 'all',
}

interface Parsed {
  args: string[]
  flags: Record<string, string | true>
}

function parseArgs(tokens: string[]): Parsed {
  const args: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.startsWith('--')) {
      const [k, ...v] = t.slice(2).split('=')
      flags[k] = v.length ? v.join('=') : true
    } else if (t.startsWith('-') && t.length > 1 && !/^-\d/.test(t)) {
      const k = t.slice(1)
      const next = tokens[i + 1]
      if (['o', 'l', 'f', 'n', 'p'].includes(k) && next !== undefined) {
        flags[k] = next
        i++
      } else flags[k] = true
    } else args.push(t)
  }
  return { args, flags }
}

/** "pod/foo" → ["pod", ["foo"]]; "pods foo bar" → ["pods", ["foo", "bar"]] */
function splitKind(args: string[]): [string | undefined, string[]] {
  if (!args[0]) return [undefined, []]
  if (args[0].includes('/')) {
    const [kind, name] = args[0].split('/')
    return [kind, [name, ...args.slice(1)]]
  }
  return [args[0], args.slice(1)]
}

export function run(sim: Simulation, input: string): CommandResult {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return { lines: [] }
  const [cmd, ...rest] = tokens

  if (cmd === 'clear') return { lines: [], clear: true }
  if (cmd === 'help') return help()
  if (cmd === 'ls') return { lines: [sim.files.map((f) => ({ t: `${f}  `, c: 'accent' as Tone }))] }
  if (cmd === 'cat') {
    const f = rest[0] ?? ''
    if (!sim.files.includes(f)) return err(`cat: ${f}: No such file or directory`)
    return { lines: FILES[f].yaml.split('\n').map((l) => plain(l, 'muted')) }
  }
  if (cmd !== 'kubectl' && cmd !== 'k') {
    return { lines: [plain(`command not found: ${cmd}`, 'error'), plain('Try `help` to see what this terminal understands.', 'muted')] }
  }

  const [verb, ...more] = rest
  const { args, flags } = parseArgs(more)

  switch (verb) {
    case 'apply': {
      const file = typeof flags.f === 'string' ? flags.f : ''
      if (!sim.files.includes(file)) return err(`error: the path "${file}" does not exist`)
      const m = FILES[file].manifest
      const result = sim.apply(m)
      const kind = m.kind === 'Service' ? 'service' : 'deployment.apps'
      const uid = m.kind === 'Service' ? sim.findService(m.name)?.uid : sim.findDeployment(m.name)?.uid
      return { lines: [plain(`${kind}/${m.name} ${result}`, result === 'unchanged' ? 'muted' : 'success')], focusUid: uid }
    }
    case 'get':
      return get(sim, args, flags)
    case 'describe':
      return describe(sim, args)
    case 'delete':
      return remove(sim, args, flags)
    case 'scale': {
      const [kind, names] = splitKind(args)
      if (!kind || KIND_ALIASES[kind] !== 'deployments' || !names[0]) return err('Usage: kubectl scale deployment <name> --replicas=<n>')
      const n = Number(flags.replicas)
      if (!Number.isInteger(n) || n < 0) return err('error: --replicas=<count> is required, and must be a non-negative integer')
      if (n > 8) return err('This playground cluster is small — keep replicas at 8 or fewer.')
      if (!sim.scale(names[0], n)) return err(`Error from server (NotFound): deployments.apps "${names[0]}" not found`)
      return ok(`deployment.apps/${names[0]} scaled`, sim.findDeployment(names[0])?.uid)
    }
    case 'expose': {
      const [kind, names] = splitKind(args)
      if (!kind || KIND_ALIASES[kind] !== 'deployments' || !names[0]) return err('Usage: kubectl expose deployment <name> --port=80 [--target-port=8080]')
      const port = Number(flags.port ?? 80)
      const target = Number(flags['target-port'] ?? 8080)
      const name = typeof flags.name === 'string' ? flags.name : undefined
      const r = sim.expose(names[0], port, target, name)
      if (r === 'notfound') return err(`Error from server (NotFound): deployments.apps "${names[0]}" not found`)
      if (r === 'exists') return err(`Error from server (AlreadyExists): services "${name ?? names[0]}" already exists`)
      return ok(`service/${name ?? names[0]} exposed`, sim.findService(name ?? names[0])?.uid)
    }
    case 'label': {
      const [kind, rest2] = splitKind(args)
      if (!kind || KIND_ALIASES[kind] !== 'pods' || !rest2[0]) return err('Usage: kubectl label pod <name> key=value [--overwrite]')
      const [name, ...specs] = rest2
      const changes = parseLabels(specs)
      if (!changes || !Object.keys(changes).length) return err('error: at least one label update is required, e.g. app=api')
      const r = sim.labelPod(name, changes, flags.overwrite === true)
      if ('error' in r) return err(r.error)
      return { lines: [plain(`pod/${name} ${r.changed ? 'labeled' : 'not labeled'}`, r.changed ? 'success' : 'muted')], focusUid: sim.findPod(name)?.uid }
    }
    case 'set':
      return set(sim, args)
    case 'rollout':
      return rollout(sim, args)
    case 'logs': {
      const name = args[0]?.replace(/^pods?\//, '')
      if (!name) return err('error: expected POD name. Usage: kubectl logs <pod>')
      const lines = sim.logs(name)
      if (!lines) return err(`Error from server (NotFound): pods "${name}" not found`)
      const pod = sim.findPod(name)!
      if (!lines.length) return err(`Error from server (BadRequest): container "backend" in pod "${name}" is waiting to start: ${pod.phase}`)
      return {
        focusUid: pod.uid,
        lines: lines.map((l) => plain(l, /panic|exit status|level=error/.test(l) ? 'error' : l.startsWith('\t') || l.startsWith('goroutine') || l.startsWith('main.') ? 'muted' : undefined)),
      }
    }
    case undefined:
      return help()
    default:
      return err(`error: unknown command "${verb}" for "kubectl"`)
  }
}

function remove(sim: Simulation, args: string[], flags: Parsed['flags']): CommandResult {
  const [kind, names] = splitKind(args)
  const k = kind ? KIND_ALIASES[kind] : undefined
  if (k === 'services') {
    if (!names[0]) return err('error: resource(s) were provided, but no name was specified')
    return sim.deleteService(names[0]) ? { lines: [plain(`service "${names[0]}" deleted`, 'warn')] } : err(`Error from server (NotFound): services "${names[0]}" not found`)
  }
  if (k !== 'pods') {
    return kind ? err('In this playground you can delete Pods and Services. Try: kubectl delete pod <name>') : err('error: You must provide one or more resources by argument or filename.')
  }
  let targets = names
  if (typeof flags.l === 'string') {
    const sel = parseSelector(flags.l)
    targets = Object.values(sim.cluster.pods)
      .filter((p) => matches(sel, p.labels) && p.deletedAt === null)
      .map((p) => p.name)
    if (!targets.length) return { lines: [plain('No resources found', 'muted')] }
  }
  if (!targets.length) return err('error: resource(s) were provided, but no name was specified')
  const lines: Line[] = []
  let focusUid: string | undefined
  for (const name of targets) {
    const r = sim.deletePod(name)
    if (r === 'notfound') lines.push(plain(`Error from server (NotFound): pods "${name}" not found`, 'error'))
    else {
      lines.push([{ t: `pod "${name}" deleted`, c: 'warn' }, ...(r === 'terminating' ? [{ t: '  (already terminating)', c: 'muted' as Tone }] : [])])
      focusUid ??= sim.findPod(name)?.uid
    }
  }
  if (lines.some((l) => l[0].c === 'error')) lines.push(plain('Tip: press Tab to autocomplete Pod names.', 'muted'))
  return { lines, focusUid }
}

function set(sim: Simulation, args: string[]): CommandResult {
  const [what, ...rest] = args
  if (what === 'selector') {
    const [kind, names] = splitKind(rest)
    if (!kind || KIND_ALIASES[kind] !== 'services' || !names[0] || !names[1]) return err('Usage: kubectl set selector service <name> key=value')
    const sel = parseLabels(names.slice(1))
    if (!sel || Object.values(sel).some((v) => v === null)) return err('error: invalid selector, expected key=value')
    const r = sim.setSelector(names[0], sel as Labels)
    if (r === 'notfound') return err(`Error from server (NotFound): services "${names[0]}" not found`)
    return { lines: [plain(`service/${names[0]} selector ${r === 'updated' ? 'updated' : 'unchanged'}`, r === 'updated' ? 'success' : 'muted')], focusUid: sim.findService(names[0])?.uid }
  }
  if (what === 'image') {
    const [kind, names] = splitKind(rest)
    if (!kind || KIND_ALIASES[kind] !== 'deployments' || !names[0] || !names[1]?.includes('=')) return err('Usage: kubectl set image deployment/<name> <container>=<image>')
    const [container, image] = names[1].split('=')
    const r = sim.setImage(names[0], container, image)
    if (r === 'notfound') return err(`Error from server (NotFound): deployments.apps "${names[0]}" not found`)
    if (r === 'nocontainer') return err(`error: unable to find container named "${container}"`)
    return { lines: [plain(`deployment.apps/${names[0]} image ${r === 'updated' ? 'updated' : 'unchanged'}`, r === 'updated' ? 'success' : 'muted')], focusUid: sim.findDeployment(names[0])?.uid }
  }
  return err('Usage: kubectl set image deployment/<name> backend=<image> | kubectl set selector service <name> key=value')
}

function rollout(sim: Simulation, args: string[]): CommandResult {
  const [action, ...rest] = args
  const [kind, names] = splitKind(rest)
  if (!action || !kind || KIND_ALIASES[kind] !== 'deployments' || !names[0]) return err('Usage: kubectl rollout status|undo|history deployment/<name>')
  const dep = sim.findDeployment(names[0])
  if (!dep) return err(`Error from server (NotFound): deployments.apps "${names[0]}" not found`)
  if (action === 'undo') {
    const r = sim.rolloutUndo(dep.name)
    if (r === 'nohistory') return err('error: no rollout history found for deployment "' + dep.name + '"')
    return ok(`deployment.apps/${dep.name} rolled back`, dep.uid)
  }
  if (action === 'history') {
    return {
      focusUid: dep.uid,
      lines: [
        plain(`deployment.apps/${dep.name}`, 'strong'),
        ...table(
          ['REVISION', 'IMAGE'],
          dep.history.map((img, i) => [{ t: String(i + 1), c: i === dep.history.length - 1 ? 'accent' : undefined }, { t: tag(img) }]),
        ),
      ],
    }
  }
  if (action === 'status') {
    const current = sim.replicaSetOf(dep)
    const updated = current ? sim.activePods(current.uid) : []
    const ready = updated.filter((p) => p.ready).length
    if (dep.rollout === 'complete') return { focusUid: dep.uid, lines: [plain(`deployment "${dep.name}" successfully rolled out`, 'success')] }
    const oldLeft = sim
      .replicaSetsOf(dep)
      .filter((rs) => rs.uid !== current?.uid)
      .reduce((n, rs) => n + rs.desired, 0)
    return {
      focusUid: dep.uid,
      lines: [
        plain(`Waiting for deployment "${dep.name}" rollout to finish: ${ready} of ${dep.replicas} updated replicas are available...`, 'warn'),
        ...(oldLeft ? [plain(`Waiting for deployment "${dep.name}" rollout to finish: ${oldLeft} old replicas are pending termination...`, 'warn')] : []),
        ...(dep.rollout === 'stalled' ? [plain('# the new Pods never become Ready — check them with kubectl get pods / kubectl logs', 'muted')] : []),
      ],
    }
  }
  return err(`error: unknown rollout action "${action}"`)
}

function get(sim: Simulation, args: string[], flags: Parsed['flags']): CommandResult {
  const [rawKind, names] = splitKind(args)
  const kind = rawKind ? KIND_ALIASES[rawKind] : undefined
  if (!kind) return err(rawKind ? `error: the server doesn't have a resource type "${rawKind}"` : 'error: You must specify the type of resource to get.')
  const wide = flags.o === 'wide'
  const showLabels = flags['show-labels'] === true
  const none = { lines: [plain('No resources found in default namespace.', 'muted')] }

  if (kind === 'pods') {
    let list = Object.values(sim.cluster.pods).sort((a, b) => a.createdAt - b.createdAt)
    if (typeof flags.l === 'string') {
      const sel = parseSelector(flags.l)
      list = list.filter((p) => matches(sel, p.labels))
    }
    if (names.length) list = list.filter((p) => names.includes(p.name))
    if (names.length && !list.length) return err(`Error from server (NotFound): pods "${names[0]}" not found`)
    const rows = table(podHeader(wide, showLabels), list.map((p) => podRow(sim, p, wide, showLabels)))
    if (flags.w || flags.watch) return { lines: rows, watch: 'pods' }
    return list.length ? { lines: rows } : none
  }

  if (kind === 'deployments') {
    const deps = Object.values(sim.cluster.deployments)
    if (!deps.length) return none
    return {
      lines: table(
        ['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE'],
        deps.map((d) => {
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
          ]
        }),
      ),
    }
  }

  if (kind === 'replicasets') {
    const list = Object.values(sim.cluster.replicaSets).sort((a, b) => a.createdAt - b.createdAt)
    if (!list.length) return none
    const header = ['NAME', 'DESIRED', 'CURRENT', 'READY', 'AGE', ...(wide ? ['IMAGES'] : [])]
    return {
      lines: table(
        header,
        list.map((rs) => {
          const active = sim.activePods(rs.uid)
          const ready = active.filter((p) => p.ready).length
          return [
            { t: rs.name, c: 'strong' },
            { t: String(rs.desired) },
            { t: String(active.length), c: active.length === rs.desired ? undefined : 'warn' },
            { t: String(ready), c: ready === rs.desired ? 'success' : 'warn' },
            { t: age(sim.now - rs.createdAt) },
            ...(wide ? [{ t: rs.image, c: isBroken(rs.image) ? ('error' as Tone) : undefined }] : []),
          ]
        }),
      ),
    }
  }

  if (kind === 'services') {
    const list = Object.values(sim.cluster.services)
    if (!list.length) return none
    return {
      lines: table(
        ['NAME', 'TYPE', 'CLUSTER-IP', 'PORT(S)', 'AGE', ...(wide ? ['SELECTOR'] : [])],
        list.map((s) => [
          { t: s.name, c: 'strong' },
          { t: 'ClusterIP' },
          { t: s.clusterIP },
          { t: `${s.port}/TCP` },
          { t: age(sim.now - s.createdAt) },
          ...(wide ? [{ t: labelString(s.selector), c: 'accent' as Tone }] : []),
        ]),
      ),
    }
  }

  if (kind === 'endpoints') {
    let list = Object.values(sim.cluster.services)
    if (names.length) list = list.filter((s) => names.includes(s.name))
    if (names.length && !list.length) return err(`Error from server (NotFound): endpoints "${names[0]}" not found`)
    if (!list.length) return none
    return {
      lines: table(
        ['NAME', 'ENDPOINTS', 'AGE'],
        list.map((s) => {
          const ips = s.endpoints.map((uid) => `${sim.cluster.pods[uid]?.ip}:${s.targetPort}`)
          return [
            { t: s.name, c: 'strong' },
            { t: ips.length ? (ips.length > 3 ? `${ips.slice(0, 3).join(',')} + ${ips.length - 3} more...` : ips.join(',')) : '<none>', c: ips.length ? 'success' : 'error' },
            { t: age(sim.now - s.createdAt) },
          ]
        }),
      ),
    }
  }

  if (kind === 'nodes') {
    return {
      lines: table(
        ['NAME', 'STATUS', 'ROLES', 'PODS', 'VERSION'],
        sim.cluster.nodes.map((n) => [
          { t: n.name, c: 'strong' },
          { t: 'Ready', c: 'success' },
          { t: '<none>', c: 'muted' },
          { t: String(Object.values(sim.cluster.pods).filter((p) => p.nodeName === n.name).length) },
          { t: 'v1.34.1' },
        ]),
      ),
    }
  }

  if (kind === 'events') {
    const evs = sim.events.filter((e) => e.source !== 'you' && e.source !== 'cluster').slice(-14)
    if (!evs.length) return { lines: [plain('No events found in default namespace.', 'muted')] }
    return {
      lines: table(
        ['LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'],
        evs.map((e) => [
          { t: age(sim.now - e.at) },
          { t: e.type, c: e.type === 'Warning' ? 'warn' : 'muted' },
          { t: e.reason, c: 'accent' },
          { t: `${e.involved.kind.toLowerCase()}/${e.involved.name}` },
          { t: e.message, c: 'muted' },
        ]),
      ),
    }
  }

  // all — the same tables, with kind-qualified names like the real kubectl
  const lines: Line[] = []
  const section = (prefix: string, kindLines: Line[]) => {
    if (kindLines.length < 2) return
    if (lines.length) lines.push([])
    const [header, ...rows] = kindLines.map((l) => l.map((s) => ({ ...s, t: s.t.trimEnd() })))
    lines.push(...table(header.map((h) => h.t), rows.map((r) => [{ ...r[0], t: `${prefix}/${r[0].t}` }, ...r.slice(1)])))
  }
  section('pod', get(sim, ['pods'], {}).lines)
  section('service', get(sim, ['services'], {}).lines)
  section('deployment.apps', get(sim, ['deployments'], {}).lines)
  section('replicaset.apps', get(sim, ['replicasets'], {}).lines)
  return lines.length ? { lines } : none
}

function describe(sim: Simulation, args: string[]): CommandResult {
  const [rawKind, names] = splitKind(args)
  const kind = rawKind ? KIND_ALIASES[rawKind] : undefined
  const name = names[0]
  if (!kind || !name) return err('Usage: kubectl describe pod|deployment|rs|service <name>')
  const kv = (k: string, v: string, c?: Tone): Line => [{ t: `${k}:`.padEnd(18), c: 'muted' }, { t: v, c }]
  const eventsFor = (uid: string) => {
    const evs = sim.events.filter((e) => e.involved.uid === uid && e.source !== 'you' && e.source !== 'cluster').slice(-10)
    return [
      [],
      plain('Events:', 'muted'),
      ...(evs.length
        ? table(
            ['  Type', 'Reason', 'Age', 'From', 'Message'],
            evs.map((e) => [{ t: `  ${e.type}`, c: e.type === 'Warning' ? ('warn' as Tone) : undefined }, { t: e.reason, c: 'accent' }, { t: age(sim.now - e.at) }, { t: e.source, c: 'muted' }, { t: e.message }]),
          )
        : [plain('  <none>', 'muted')]),
    ]
  }

  if (kind === 'pods') {
    const p = sim.findPod(name)
    if (!p) return err(`Error from server (NotFound): pods "${name}" not found`)
    const rs = p.ownerUid ? sim.cluster.replicaSets[p.ownerUid] : undefined
    const crashing = p.phase === 'Error' || p.phase === 'CrashLoopBackOff'
    return {
      focusUid: p.uid,
      lines: [
        kv('Name', p.name, 'strong'),
        kv('Namespace', 'default'),
        kv('Node', p.nodeName ?? '<none>'),
        kv('Labels', labelString(p.labels), 'accent'),
        kv('Status', p.phase === 'Terminating' ? 'Terminating' : p.phase === 'Pending' || p.phase === 'ContainerCreating' ? 'Pending' : 'Running', statusTone(p)),
        kv('IP', p.ip ?? '<none>'),
        kv('Controlled By', rs ? `ReplicaSet/${rs.name}` : '<none>', rs ? 'info' : 'warn'),
        kv('Image', p.image, isBroken(p.image) ? 'error' : undefined),
        ...(crashing
          ? [kv('State', `Waiting (Reason: ${p.phase === 'Error' ? 'Error' : 'CrashLoopBackOff'})`, 'error'), kv('Last State', 'Terminated (Reason: Error, Exit Code: 2)', 'error')]
          : []),
        kv('Restart Count', String(p.restarts), p.restarts ? 'warn' : undefined),
        kv('Ready', p.ready ? 'True' : 'False', p.ready ? 'success' : 'warn'),
        ...eventsFor(p.uid),
      ],
    }
  }

  if (kind === 'deployments') {
    const d = sim.findDeployment(name)
    if (!d) return err(`Error from server (NotFound): deployments.apps "${name}" not found`)
    const all = sim.deploymentPods(d).filter((p) => p.deletedAt === null)
    const current = sim.replicaSetOf(d)
    const olds = sim.replicaSetsOf(d).filter((rs) => rs.uid !== current?.uid && rs.desired > 0)
    const ready = all.filter((p) => p.ready).length
    const updated = current ? sim.activePods(current.uid).length : 0
    return {
      focusUid: d.uid,
      lines: [
        kv('Name', d.name, 'strong'),
        kv('Selector', labelString(d.selector), 'accent'),
        kv('Replicas', `${d.replicas} desired | ${updated} updated | ${all.length} total | ${ready} available | ${all.length - ready} unavailable`),
        kv('StrategyType', 'RollingUpdate'),
        kv('RollingUpdate', '25% max unavailable, 25% max surge', 'muted'),
        kv('Image', d.template.image, isBroken(d.template.image) ? 'error' : undefined),
        kv('Progressing', d.rollout === 'complete' ? 'True (NewReplicaSetAvailable)' : d.rollout === 'stalled' ? 'True (ReplicaSetUpdated) — new Pods not becoming ready' : 'True (ReplicaSetUpdated)', d.rollout === 'stalled' ? 'error' : undefined),
        kv('OldReplicaSets', olds.length ? olds.map((rs) => `${rs.name} (${sim.activePods(rs.uid).length}/${rs.desired} replicas created)`).join(', ') : '<none>', 'muted'),
        kv('NewReplicaSet', current ? `${current.name} (${updated}/${current.desired} replicas created)` : '<none>', 'info'),
        ...eventsFor(d.uid),
      ],
    }
  }

  if (kind === 'replicasets') {
    const rs = Object.values(sim.cluster.replicaSets).find((r) => r.name === name)
    if (!rs) return err(`Error from server (NotFound): replicasets.apps "${name}" not found`)
    const active = sim.activePods(rs.uid)
    const dep = sim.cluster.deployments[rs.ownerUid]
    return {
      focusUid: rs.uid,
      lines: [
        kv('Name', rs.name, 'strong'),
        kv('Selector', labelString(rsSelector(rs)), 'accent'),
        kv('Controlled By', dep ? `Deployment/${dep.name}` : '<none>', 'info'),
        kv('Image', rs.image, isBroken(rs.image) ? 'error' : undefined),
        kv('Replicas', `${active.length} current / ${rs.desired} desired`),
        kv('Pods Status', `${active.filter((p) => p.ready).length} Running / ${active.filter((p) => !p.ready).length} Waiting`),
        ...eventsFor(rs.uid),
      ],
    }
  }

  if (kind === 'services') {
    const s = sim.findService(name)
    if (!s) return err(`Error from server (NotFound): services "${name}" not found`)
    const ips = s.endpoints.map((uid) => `${sim.cluster.pods[uid]?.ip}:${s.targetPort}`)
    return {
      focusUid: s.uid,
      lines: [
        kv('Name', s.name, 'strong'),
        kv('Selector', labelString(s.selector), 'accent'),
        kv('Type', 'ClusterIP'),
        kv('IP', s.clusterIP),
        kv('Port', `<unset>  ${s.port}/TCP`),
        kv('TargetPort', `${s.targetPort}/TCP`),
        kv('Endpoints', ips.length ? ips.join(',') : '<none>', ips.length ? 'success' : 'error'),
        ...eventsFor(s.uid),
      ],
    }
  }
  return err(`describe for ${rawKind} isn't available here`)
}

function help(): CommandResult {
  const row = (c: string, d: string): Line => [{ t: `  ${c}`.padEnd(54), c: 'accent' }, { t: d, c: 'muted' }]
  return {
    lines: [
      plain('This terminal talks to the simulated cluster on the stage.', 'muted'),
      [],
      row('ls · cat <file>', 'see the manifests for this lesson'),
      row('kubectl apply -f <file>', 'create or update from a manifest'),
      row('kubectl get pods [-o wide] [--show-labels] [-w]', 'list Pods (-w watches; Esc stops)'),
      row('kubectl get deploy | rs | svc | endpoints | events | all', 'list other resources'),
      row('kubectl describe pod|deploy|rs|svc <name>', 'details + events'),
      row('kubectl delete pod <name>... | -l key=value', 'delete Pods'),
      row('kubectl scale deploy backend --replicas=N', 'change desired replicas'),
      row('kubectl expose deploy backend --port=80', 'put a Service in front of it'),
      row('kubectl label pod <name> key=value --overwrite', 'change a Pod label (key- removes)'),
      row('kubectl set selector svc <name> key=value', "change a Service's selector"),
      row('kubectl set image deploy/backend backend=<image>', 'roll out a new version'),
      row('kubectl rollout status|undo|history deploy/backend', 'follow or revert a rollout'),
      row('kubectl logs <pod>', "read a container's output"),
      [],
      plain('Tab autocompletes · ↑/↓ history · `k` is an alias for kubectl · clear', 'muted'),
    ],
  }
}

const WORDS = [
  'kubectl', 'apply', 'get', 'describe', 'delete', 'scale', 'expose', 'label', 'set', 'selector', 'image', 'rollout', 'status', 'undo', 'history', 'logs',
  'pods', 'pod', 'deployment', 'deploy', 'deployment/backend', 'rs', 'svc', 'service', 'endpoints', 'events', 'nodes', 'all', 'backend',
  '--replicas=', '--show-labels', '--overwrite', '--port=80', '-o', 'wide', '-f', '-w', 'backend=ghcr.io/kubelearn/backend:1.5', 'app=backend',
]

/** Bash-style completion on the last token. Returns the new input, plus candidates when ambiguous. */
export function complete(sim: Simulation, input: string): { value: string; candidates: string[] } {
  const parts = input.split(' ')
  const last = parts[parts.length - 1]
  const prev = parts.slice(0, -1).join(' ')
  const podContext = /\b(delete|describe|get|label)\s+(pods?|po)\b/.test(prev) || /\blogs\s*$/.test(prev)
  const fileContext = /(-f|cat)\s*$/.test(prev)
  const pool = podContext
    ? Object.values(sim.cluster.pods)
        .filter((p) => p.deletedAt === null || !prev.includes('delete'))
        .map((p) => p.name)
    : fileContext
      ? sim.files
      : WORDS
  const hits = pool.filter((c) => c.startsWith(last) && !parts.slice(0, -1).includes(c))
  if (!hits.length) return { value: input, candidates: [] }
  if (hits.length === 1) return { value: [...parts.slice(0, -1), hits[0]].join(' ') + (hits[0].endsWith('=') ? '' : ' '), candidates: [] }
  let common = hits[0]
  for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1)
  return { value: [...parts.slice(0, -1), common].join(' '), candidates: hits.map((h) => (podContext ? short(h) : h)) }
}
