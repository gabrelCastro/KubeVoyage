import { parseArgs, parseSelector, selects, suggest, TAKES_VALUE, tokenize, type Flags, type Parsed, type Requirement } from './cli/args'
import { ALL_KINDS, KIND_ALIASES, KIND_DOCS, KIND_SINGULAR, KIND_WORDS, UNSIMULATED_KINDS, type KindId } from './cli/resourceKinds'
import { apiPhase, listObject, readPath, toJson, toYaml, type Json, type Obj } from './cli/objects'
import { pipe } from './cli/pipe'
import { age, podHeader, podRow, SPECS, statusTone, type Item, type Seg, type Spec, type Tone } from './cli/resourceSpecs'
import type { Profile } from '../runtime/program'
import { UNSIMULATED_VERBS, USAGE, VERBS } from './cli/usage'
import { DOCKERFILE, runWorkspace, WORKSPACE_COMMANDS, WORKSPACE_DOCS, WORKSPACE_FILES, WORKSPACE_HELP, type Workspace } from './cli/workspace'
import { codeProfile, isBroken, labelString, NODE_CPU, rsSelector, short, tag, type Simulation } from './engine'
import { FILES, IMAGE } from './manifests'
import type { ClusterEvent, ConfigMap, DaemonSet, Deployment, HorizontalPodAutoscaler, Job, Labels, Pod, ReplicaSet, Service } from './types'

export { FILES, IMAGE, MANIFEST, MANIFEST_YAML } from './manifests'

export { age, podHeader, podRow }
export type { Seg, Tone }
export type Line = Seg[]

export interface CommandResult {
  lines: Line[]
  clear?: boolean
  watch?: WatchSpec
  edit?: { kind: 'deployment'; name: string }
  /** Open the code editor on app.js. */
  editCode?: boolean
  /** Resource the command was "about" — lets the stage acknowledge terminal activity. */
  focusUid?: string
}

export interface RunPresentation {
  app?: { name: string; message: string }
  /** The app as a given image serves it — each published version answers with its own face. */
  appFor?: (image: string, podUid?: string) => { name: string; message: string }
  /** Images published in the app studio (offered by Tab completion). */
  images?: string[]
  /** app.js, the Dockerfile and `docker build` (absent: the terminal has no workspace). */
  workspace?: Workspace
}

export type WatchKind = KindId

export interface WatchSpec {
  kind: WatchKind
  names: string[]
  selector: Requirement[] | null
  fields: { key: string; op: '=' | '!='; value: string }[]
  sortBy?: string
  wide: boolean
  labelCols: string[]
  showLabels: boolean
  allNamespaces: boolean
}

export interface WatchRow {
  key: string
  signature: string
  line: Line
}

const plain = (t: string, c?: Tone): Line => [{ t, c }]
const err = (t: string): CommandResult => ({ lines: [plain(t, 'error')] })
const ok = (t: string, focusUid?: string): CommandResult => ({ lines: [plain(t, 'success')], focusUid })

function table(header: string[], rows: Seg[][]): Line[] {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].t.length)) + 3)
  const pad = (s: string, i: number) => (i === header.length - 1 ? s : s.padEnd(widths[i]))
  return [header.map((h, i) => ({ t: pad(h, i), c: 'muted' as Tone })), ...rows.map((r) => r.map((s, i) => ({ ...s, t: pad(s.t, i) })))]
}

const note = (t: string): Line => plain(`# ${t}`, 'muted')

/** "app=backend,tier=api" / "app=backend tier=api" → label changes; `key-` means "remove". */
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

// ── resource kinds ─────────────────────────────────────────────────────────

function resolveKind(raw: string): KindId[] | { error: Line[] } {
  const out: KindId[] = []
  for (const part of raw.split(',')) {
    const k = KIND_ALIASES[part.toLowerCase()]
    if (k === 'all') out.push(...ALL_KINDS)
    else if (k) out.push(k)
    else if (UNSIMULATED_KINDS.includes(part.toLowerCase()))
      return { error: [plain(`"${part}" existe no Kubernetes real, mas este cluster de treino só simula Pods, Deployments, ReplicaSets, Jobs, DaemonSets, Services, ConfigMaps, Secrets, HPAs, EndpointSlices, Events e Nodes.`, 'warn')] }
    else {
      const guess = suggest(part, Object.keys(KIND_ALIASES).filter((a) => !a.includes('.')))[0]
      return { error: [plain(`error: the server doesn't have a resource type "${part}"`, 'error'), ...(guess ? [note(`você quis dizer "${guess}"?`)] : [])] }
    }
  }
  return [...new Set(out)]
}

/** `get pods a b`, `get pod/a svc/b`, `get po,svc` → groups of (kind, names). */
function targets(args: string[]): { kind: KindId; names: string[] }[] | { error: Line[] } {
  if (!args.length) return { error: [plain('error: You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.', 'error')] }
  if (args[0].includes('/')) {
    const groups: { kind: KindId; names: string[] }[] = []
    for (const a of args) {
      const [rawKind, name] = a.split('/')
      if (!name) return { error: [plain(`error: arguments in resource/name form must have a single resource and name`, 'error')] }
      const kinds = resolveKind(rawKind)
      if ('error' in kinds) return kinds
      if (kinds.length !== 1) return { error: [plain('error: arguments in resource/name form must have a single resource and name', 'error')] }
      const g = groups.find((x) => x.kind === kinds[0])
      if (g) g.names.push(name)
      else groups.push({ kind: kinds[0], names: [name] })
    }
    return groups
  }
  if (args.slice(1).some((a) => a.includes('/'))) return { error: [plain('error: there is no need to specify a resource type as a separate argument when passing arguments in resource/name form', 'error')] }
  const kinds = resolveKind(args[0])
  if ('error' in kinds) return kinds
  if (kinds.length > 1 && args.length > 1) return { error: [plain('error: you must specify only one resource type when passing resource names', 'error')] }
  return kinds.map((kind) => ({ kind, names: args.slice(1) }))
}

// ── flags ──────────────────────────────────────────────────────────────────

const GLOBAL_FLAGS = ['n', 'h', 'help']
const VERB_FLAGS: Record<string, string[]> = {
  apply: ['f'],
  get: ['o', 'l', 'w', 'L', 'A', 'show-labels', 'sort-by', 'field-selector', 'no-headers', 'ignore-not-found'],
  describe: ['l', 'A'],
  delete: ['l', 'grace-period', 'force', 'now', 'wait', 'ignore-not-found'],
  scale: ['replicas'],
  expose: ['port', 'target-port', 'name', 'type'],
  label: ['overwrite', 'list'],
  set: [],
  rollout: ['to-revision', 'w'],
  logs: ['p', 'follow', 'tail', 'c', 'l'],
  run: ['image', 'labels', 'restart', 'rm', 'i', 't', 'it', 'port'],
  edit: [],
  create: ['image', 'replicas', 'from-literal', 'cert', 'key'],
  patch: ['patch', 'type'],
  autoscale: ['cpu', 'cpu-percent', 'min', 'max', 'name'],
  cordon: [],
  uncordon: [],
  drain: ['ignore-daemonsets', 'force', 'delete-emptydir-data', 'grace-period', 'timeout'],
  top: [],
}

/** Real kubectl flags this playground doesn't simulate: refuse rather than half-do the command. */
const REAL_ONLY = new Set([
  'dry-run', 'record', 'context', 'kubeconfig', 'cluster', 'user', 'server', 's', 'token', 'v', 'request-timeout', 'server-side', 'force-conflicts', 'save-config', 'validate',
  'field-manager', 'all', 'cascade', 'raw', 'chunk-size', 'output-watch-events', 'watch-only', 'all-containers', 'since', 'since-time', 'limit-bytes', 'prefix', 'timestamps',
  'max-log-requests', 'current-replicas', 'resource-version', 'revision', 'R', 'recursive', 'k', 'kustomize', 'subresource', 'show-kind', 'template', 'selector-overwrite',
])

function checkFlags(verb: string, p: Parsed): Line[] | null {
  const allowed = new Set([...GLOBAL_FLAGS, ...(VERB_FLAGS[verb] ?? [])])
  for (const key of Object.keys(p.flags)) {
    const typed = p.spelled[key] ?? `--${key}`
    if (allowed.has(key)) {
      if (TAKES_VALUE.has(key) && p.flags[key] === true)
        return [plain(typed.startsWith('--') ? `error: flag needs an argument: ${typed}` : `error: flag needs an argument: '${key}' in ${typed}`, 'error')]
      continue
    }
    if (REAL_ONLY.has(key)) return [plain(`A flag ${typed} existe no kubectl real, mas não é simulada aqui — o comando não foi executado.`, 'warn')]
    return [
      plain(typed.startsWith('--') ? `error: unknown flag: ${typed}` : `error: unknown shorthand flag: '${key[0]}' in ${typed}`, 'error'),
      plain(`See 'kubectl ${verb} --help' for usage.`, 'muted'),
    ]
  }
  return null
}

function usage(verb: string): CommandResult {
  const u = USAGE[verb]
  return {
    lines: [
      plain(u.what, 'strong'),
      [],
      plain('Uso:', 'muted'),
      ...u.use.map((l) => plain(`  ${l}`, 'accent')),
      ...(u.examples ? [[], plain('Exemplos:', 'muted'), ...u.examples.map((l) => plain(`  ${l}`))] : []),
    ],
  }
}

export function run(sim: Simulation, input: string, presentation: RunPresentation = {}): CommandResult {
  const { stages, error } = tokenize(input.trim())
  if (error) return err(`bash: ${error}`)
  if (!stages.length || !stages[0].length) return stages.length > 1 ? err("bash: syntax error near unexpected token `|'") : { lines: [] }
  const result = runOne(sim, stages[0], presentation)
  if (stages.length === 1) return result
  let lines = result.lines
  for (const stage of stages.slice(1)) {
    const r = pipe(lines, stage)
    if ('error' in r) return err(r.error)
    lines = r
  }
  return { ...result, lines: [...lines, ...(result.watch ? [note('-w não acompanha a saída depois de um | neste terminal')] : [])], watch: undefined }
}

const SHELL = ['kubectl', 'k', 'clear', 'help', 'ls', 'cat', 'explicar', 'echo', ...WORKSPACE_COMMANDS]

function runOne(sim: Simulation, tokens: string[], presentation: RunPresentation): CommandResult {
  const [cmd, ...rest] = tokens

  if (cmd === 'clear') return { lines: [], clear: true }
  if (cmd === 'help') return help(!!presentation.workspace)
  if (cmd === 'explicar') return explain(sim, rest)
  if (cmd === 'echo') return { lines: [plain(rest.filter((a) => a !== '-n').join(' '))] }
  const ws = presentation.workspace
  if (cmd === 'ls') return { lines: [[...sim.files, ...(ws ? WORKSPACE_FILES : [])].map((f) => ({ t: `${f}  `, c: 'accent' as Tone }))] }
  if (cmd === 'cat') {
    if (!rest.length) return err('cat: informe um arquivo — por exemplo, cat backend.yaml')
    const lines: Line[] = []
    for (const f of rest) {
      if (ws && f === 'app.js') lines.push(...ws.code.replace(/\n$/, '').split('\n').map((l) => plain(l, 'muted')))
      else if (ws && f === 'Dockerfile') lines.push(...DOCKERFILE.split('\n').map((l) => plain(l, 'muted')))
      else if (!sim.files.includes(f)) lines.push(plain(`cat: ${f}: No such file or directory`, 'error'))
      else lines.push(...FILES[f].yaml.split('\n').map((l) => plain(l, 'muted')))
    }
    return { lines }
  }
  const fromWorkspace = runWorkspace(cmd, rest, ws)
  if (fromWorkspace) return fromWorkspace
  if (cmd !== 'kubectl' && cmd !== 'k') {
    const guess = suggest(cmd, SHELL)[0]
    return {
      lines: [
        plain(`command not found: ${cmd}`, 'error'),
        plain(guess ? `Você quis dizer ${guess}?` : 'Digite `help` para ver o que este terminal entende.', 'muted'),
      ],
    }
  }

  const [verb, ...more] = rest
  if (verb === undefined || verb === '-h' || verb === '--help' || verb === 'help') return help()
  if (!VERBS.includes(verb)) {
    if (UNSIMULATED_VERBS[verb])
      return {
        lines: [
          plain(`kubectl ${verb} existe no kubectl real (serve para ${UNSIMULATED_VERBS[verb]}), mas ainda não é simulado aqui.`, 'warn'),
          plain('Digite `help` para ver o que este terminal entende.', 'muted'),
        ],
      }
    const guess = suggest(verb, [...VERBS, ...Object.keys(UNSIMULATED_VERBS)])
    return {
      lines: [
        plain(`error: unknown command "${verb}" for "kubectl"`, 'error'),
        ...(guess.length ? [[], plain('Did you mean this?', 'muted'), ...guess.slice(0, 2).map((g) => plain(`\t${g}`, 'accent'))] : []),
      ],
    }
  }

  const parsed = parseArgs(more, verb)
  const { args, flags } = parsed
  if (flags.h || flags.help) return usage(verb)
  const bad = checkFlags(verb, parsed)
  if (bad) return { lines: bad }

  const ns = typeof flags.n === 'string' ? flags.n : 'default'
  if (ns !== 'default') {
    const nsNote = note('este cluster de treino só simula o namespace default (num cluster real, kube-system teria os componentes do sistema)')
    if (verb === 'get') return { lines: [plain(`No resources found in ${ns} namespace.`, 'muted'), nsNote] }
    return { lines: [plain(`Error from server (NotFound): namespaces "${ns}" not found`, 'error'), nsNote] }
  }

  switch (verb) {
    case 'apply': {
      const file = typeof flags.f === 'string' ? flags.f : ''
      if (!file) return err('error: must specify one of -f and -k')
      if (!sim.files.includes(file)) return err(`error: the path "${file}" does not exist`)
      const m = FILES[file].manifest
      const result = sim.apply(m)
      const kind = m.kind === 'Service' ? 'service' : m.kind === 'ConfigMap' ? 'configmap' : m.kind === 'Job' ? 'job.batch' : m.kind === 'DaemonSet' ? 'daemonset.apps' : 'deployment.apps'
      const uid = m.kind === 'Service' ? sim.findService(m.name)?.uid : m.kind === 'ConfigMap' ? sim.findConfigMap(m.name)?.uid : m.kind === 'Job' ? sim.findJob(m.name)?.uid : m.kind === 'DaemonSet' ? sim.findDaemonSet(m.name)?.uid : sim.findDeployment(m.name)?.uid
      return { lines: [plain(`${kind}/${m.name} ${result}`, result === 'unchanged' ? 'muted' : 'success')], focusUid: uid }
    }
    case 'get':
      return get(sim, args, flags)
    case 'describe':
      return describe(sim, args, flags)
    case 'delete':
      return remove(sim, args, flags)
    case 'scale': {
      const [kind, names] = splitKind(args)
      if (!kind || KIND_ALIASES[kind] !== 'deployments' || !names[0]) return err('Usage: kubectl scale deployment <name> --replicas=<n>')
      const n = Number(flags.replicas)
      if (!Number.isInteger(n) || n < 0) return err('error: --replicas=<count> is required, and must be a non-negative integer')
      if (n > 8) return err('Este cluster de treino é pequeno — use no máximo 8 réplicas.')
      if (!sim.scale(names[0], n)) return err(`Error from server (NotFound): deployments.apps "${names[0]}" not found`)
      return ok(`deployment.apps/${names[0]} scaled`, sim.findDeployment(names[0])?.uid)
    }
    case 'expose': {
      const [kind, names] = splitKind(args)
      if (!kind || KIND_ALIASES[kind] !== 'deployments' || !names[0]) return err('Usage: kubectl expose deployment <name> --port=80 [--target-port=8080]')
      if (typeof flags.type === 'string' && flags.type !== 'ClusterIP')
        return { lines: [plain(`Services do tipo ${flags.type} existem no Kubernetes real, mas este cluster de treino só simula ClusterIP — o comando não foi executado.`, 'warn')] }
      const port = Number(flags.port ?? 80)
      const target = Number(flags['target-port'] ?? flags.port ?? 8080)
      if (!Number.isInteger(port) || port < 1 || port > 65535) return err(`error: invalid port "${flags.port}"`)
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
      if (flags.list) {
        const pod = sim.findPod(name)
        if (!pod) return err(`Error from server (NotFound): pods "${name}" not found`)
        return { lines: Object.entries(pod.labels).map(([k, v]) => plain(`${k}=${v}`, 'accent')), focusUid: pod.uid }
      }
      const changes = parseLabels(specs)
      if (!changes || !Object.keys(changes).length) return err('error: at least one label update is required, e.g. app=api')
      const r = sim.labelPod(name, changes, flags.overwrite === true)
      if ('error' in r) return err(r.error)
      return { lines: [plain(`pod/${name} ${r.changed ? 'labeled' : 'not labeled'}`, r.changed ? 'success' : 'muted')], focusUid: sim.findPod(name)?.uid }
    }
    case 'set':
      return set(sim, args)
    case 'rollout':
      return rollout(sim, args, flags)
    case 'logs':
      return logs(sim, args, flags)
    case 'run':
      return runPod(sim, args, flags, presentation)
    case 'edit': {
      const [kind, names] = splitKind(args)
      if (!kind || KIND_ALIASES[kind] !== 'deployments' || !names[0]) return err('Usage: kubectl edit deployment/<name>')
      const dep = sim.findDeployment(names[0])
      if (!dep) return err(`Error from server (NotFound): deployments.apps "${names[0]}" not found`)
      return { lines: [], edit: { kind: 'deployment', name: dep.name }, focusUid: dep.uid }
    }
    case 'patch':
      return patch(sim, args, flags)
    case 'autoscale':
      return autoscale(sim, args, flags)
    case 'top':
      return top(sim, args)
    case 'cordon':
    case 'uncordon':
      return cordon(sim, args, verb === 'cordon')
    case 'drain':
      return drain(sim, args, flags)
    case 'create': {
      const [kind, names] = splitKind(args)
      const name = names[0]
      if (kind && KIND_ALIASES[kind] === 'configmaps') return createConfigMap(sim, name, more)
      if (kind === 'secret') return createSecret(sim, names, more)
      if (kind && KIND_ALIASES[kind] === 'jobs') {
        if (!name) return err('error: NAME is required')
        if (typeof flags.image !== 'string') return err('error: required flag(s) "image" not set')
        const r = sim.createJob({ name, image: flags.image, completions: 1, parallelism: 1, backoffLimit: 6 }, 'create')
        if (r === 'exists') return err(`Error from server (AlreadyExists): jobs.batch "${name}" already exists`)
        return ok(`job.batch/${name} created`, sim.findJob(name)?.uid)
      }
      if (!kind || KIND_ALIASES[kind] !== 'deployments' || !name) return err('Usage: kubectl create deployment <name> --image=<image> [--replicas=N]')
      if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(name) || name.length > 253)
        return err(`error: failed to create deployment: Deployment.apps "${name}" is invalid: metadata.name: Invalid value`)
      if (typeof flags.image !== 'string' || !flags.image.trim()) return err('error: required flag(s) "image" not set')
      const replicas = flags.replicas === undefined ? 1 : Number(flags.replicas)
      if (!Number.isInteger(replicas) || replicas < 0) return err(`error: invalid argument "${flags.replicas}" for "--replicas" flag`)
      if (replicas > 8) return err('Este cluster de treino é pequeno — use no máximo 8 réplicas.')
      const result = sim.createDeployment(name, flags.image.trim(), replicas)
      if (result === 'exists') return err(`Error from server (AlreadyExists): deployments.apps "${name}" already exists`)
      return ok(`deployment.apps/${name} created`, sim.findDeployment(name)?.uid)
    }
  }
  return help()
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

function selectorFlag(flags: Flags): Requirement[] | { error: string } | null {
  if (typeof flags.l !== 'string') return null
  const r = parseSelector(flags.l)
  return 'error' in r ? { error: `error: ${r.error}` } : r
}

function logs(sim: Simulation, args: string[], flags: Flags): CommandResult {
  if (typeof flags.c === 'string' && flags.c !== 'backend') return err(`error: container ${flags.c} is not valid for pod ${args[0] ?? ''}`)
  const tail = typeof flags.tail === 'string' ? Number(flags.tail) : -1
  if (!Number.isInteger(tail)) return err(`error: invalid argument "${flags.tail}" for "--tail" flag`)
  const previous = flags.p === true
  const follow = flags.follow ? [note('-f acompanharia as próximas linhas; aqui aparece só o que já foi escrito')] : []
  const cut = (ls: string[]) => (tail >= 0 ? ls.slice(Math.max(0, ls.length - tail)) : ls)
  const paint = (l: string): Line => plain(l, /panic|exit status|level=error|^[A-Z]\w*Error\b|^Uncaught |^error: /.test(l) ? 'error' : l.startsWith('\t') || l.startsWith('goroutine') || l.startsWith('main.') ? 'muted' : undefined)

  const sel = selectorFlag(flags)
  if (sel) {
    if ('error' in sel) return err(sel.error)
    const pods = Object.values(sim.cluster.pods).filter((p) => p.deletedAt === null && selects(sel, p.labels))
    if (!pods.length) return { lines: [plain('No resources found in default namespace.', 'muted')] }
    // like kubectl: 10 lines per Pod by default when selecting by label
    const lines = pods.flatMap((p) => {
      const out = sim.logs(p.name, previous)
      return Array.isArray(out) ? (tail >= 0 ? cut(out) : out.slice(-10)) : []
    })
    return { lines: [...lines.map(paint), ...follow] }
  }

  if (args[0] && /^jobs?\//.test(args[0])) {
    const jobName = args[0].split('/')[1]
    const job = sim.findJob(jobName)
    if (!job) return err(`Error from server (NotFound): jobs.batch "${jobName}" not found`)
    const pods = sim.podsOf(job.uid).filter((p) => p.phase !== 'Pending' && p.phase !== 'ContainerCreating')
    if (!pods.length) return err(`error: timed out waiting for the condition — os Pods de ${jobName} ainda não iniciaram`)
    // like kubectl: one of the Job's Pods, with a note saying which
    const pick = pods.at(-1)!
    return logs(sim, [pick.name], flags)
  }
  const name = args[0]?.replace(/^pods?\//, '')
  if (!name) return err('error: expected POD name. Usage: kubectl logs <pod>')
  const out = sim.logs(name, previous)
  if (out === null) return err(`Error from server (NotFound): pods "${name}" not found`)
  const pod = sim.findPod(name)!
  if (out === 'noprevious') return err(`Error from server (BadRequest): previous terminated container "backend" in pod "${name}" not found`)
  if (!out.length) return err(`Error from server (BadRequest): container "backend" in pod "${name}" is waiting to start: ${pod.phase}`)
  return { focusUid: pod.uid, lines: [...cut(out).map(paint), ...follow] }
}

function remove(sim: Simulation, args: string[], flags: Flags): CommandResult {
  const [kind, names] = splitKind(args)
  const k = kind ? KIND_ALIASES[kind] : undefined
  const graceNote = flags.force || flags.now || flags['grace-period'] !== undefined ? [note('neste simulador todo Pod passa pelo encerramento gracioso')] : []
  if (k === 'horizontalpodautoscalers') {
    if (!names[0]) return err('error: resource(s) were provided, but no name was specified')
    if (sim.deleteHpa(names[0])) return { lines: [plain(`horizontalpodautoscaler.autoscaling "${names[0]}" deleted`, 'warn')] }
    return flags['ignore-not-found'] ? { lines: [] } : err(`Error from server (NotFound): horizontalpodautoscalers.autoscaling "${names[0]}" not found`)
  }
  if (k === 'daemonsets') {
    if (!names[0]) return err('error: resource(s) were provided, but no name was specified')
    if (sim.deleteDaemonSet(names[0])) return { lines: [plain(`daemonset.apps "${names[0]}" deleted`, 'warn')] }
    return flags['ignore-not-found'] ? { lines: [] } : err(`Error from server (NotFound): daemonsets.apps "${names[0]}" not found`)
  }
  if (k === 'jobs') {
    if (!names[0]) return err('error: resource(s) were provided, but no name was specified')
    if (sim.deleteJob(names[0])) return { lines: [plain(`job.batch "${names[0]}" deleted`, 'warn')] }
    return flags['ignore-not-found'] ? { lines: [] } : err(`Error from server (NotFound): jobs.batch "${names[0]}" not found`)
  }
  if (k === 'secrets') {
    if (!names[0]) return err('error: resource(s) were provided, but no name was specified')
    if (sim.deleteSecret(names[0])) return { lines: [plain(`secret "${names[0]}" deleted`, 'warn')] }
    return flags['ignore-not-found'] ? { lines: [] } : err(`Error from server (NotFound): secrets "${names[0]}" not found`)
  }
  if (k === 'configmaps') {
    if (!names[0]) return err('error: resource(s) were provided, but no name was specified')
    if (sim.deleteConfigMap(names[0])) return { lines: [plain(`configmap "${names[0]}" deleted`, 'warn')] }
    return flags['ignore-not-found'] ? { lines: [] } : err(`Error from server (NotFound): configmaps "${names[0]}" not found`)
  }
  if (k === 'services') {
    if (!names[0]) return err('error: resource(s) were provided, but no name was specified')
    if (sim.deleteService(names[0])) return { lines: [plain(`service "${names[0]}" deleted`, 'warn')] }
    return flags['ignore-not-found'] ? { lines: [] } : err(`Error from server (NotFound): services "${names[0]}" not found`)
  }
  if (k === 'deployments' || k === 'replicasets') {
    if (!names.length) return err('error: resource(s) were provided, but no name was specified')
    const resource = k === 'deployments' ? 'deployments.apps' : 'replicasets.apps'
    const prefix = k === 'deployments' ? 'deployment.apps' : 'replicaset.apps'
    const lines: Line[] = []
    let focusUid: string | undefined
    for (const name of names) {
      const uid = k === 'deployments' ? sim.findDeployment(name)?.uid : Object.values(sim.cluster.replicaSets).find((r) => r.name === name)?.uid
      const gone = k === 'deployments' ? sim.deleteDeployment(name) : sim.deleteReplicaSet(name)
      if (gone) {
        lines.push([{ t: `${prefix} "`, c: 'warn' }, { t: name, c: 'warn', ref: k === 'replicasets' ? uid : undefined }, { t: '" deleted', c: 'warn' }])
        focusUid ??= k === 'replicasets' ? uid : undefined
      } else if (!flags['ignore-not-found']) lines.push(plain(`Error from server (NotFound): ${resource} "${name}" not found`, 'error'))
    }
    return { lines: [...lines, ...graceNote], focusUid }
  }
  if (k !== 'pods') {
    if (!kind) return err('error: You must provide one or more resources by argument or filename.')
    if (!k) {
      const r = resolveKind(kind)
      if ('error' in r) return { lines: r.error }
    }
    return err('Neste playground dá para apagar Pods, ReplicaSets, Deployments e Services.')
  }
  let targets = names
  const sel = selectorFlag(flags)
  if (sel) {
    if ('error' in sel) return err(sel.error)
    targets = Object.values(sim.cluster.pods)
      .filter((p) => selects(sel, p.labels) && p.deletedAt === null)
      .map((p) => p.name)
    if (!targets.length) return { lines: [plain('No resources found', 'muted')] }
  }
  if (!targets.length) return err('error: resource(s) were provided, but no name was specified')
  const lines: Line[] = []
  let focusUid: string | undefined
  for (const name of targets) {
    const r = sim.deletePod(name)
    if (r === 'notfound') {
      if (!flags['ignore-not-found']) lines.push(plain(`Error from server (NotFound): pods "${name}" not found`, 'error'))
    } else {
      lines.push([{ t: 'pod "', c: 'warn' }, { t: name, c: 'warn', ref: sim.findPod(name)?.uid }, { t: '" deleted', c: 'warn' }, ...(r === 'terminating' ? [{ t: '  (already terminating)', c: 'muted' as Tone }] : [])])
      focusUid ??= sim.findPod(name)?.uid
    }
  }
  if (lines.some((l) => l[0].c === 'error')) lines.push(plain('Dica: aperte Tab para completar nomes de Pods.', 'muted'))
  return { lines: [...lines, ...graceNote], focusUid }
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
  if (what && ['env', 'resources', 'serviceaccount', 'subject'].includes(what))
    return { lines: [plain(`kubectl set ${what} existe no kubectl real, mas ainda não é simulado aqui.`, 'warn')] }
  return err('Usage: kubectl set image deployment/<name> backend=<image> | kubectl set selector service <name> key=value')
}

function rollout(sim: Simulation, args: string[], flags: Flags): CommandResult {
  const [action, ...rest] = args
  const [kind, names] = splitKind(rest)
  if (!action || !kind || KIND_ALIASES[kind] !== 'deployments' || !names[0]) return err('Usage: kubectl rollout status|history|undo|restart|pause|resume deployment/<name>')
  const dep = sim.findDeployment(names[0])
  if (!dep) return err(`Error from server (NotFound): deployments.apps "${names[0]}" not found`)
  if (action === 'restart') {
    const r = sim.rolloutRestart(dep.name)
    if (r === 'paused') return err(`error: deployments.apps "${dep.name}" can't restart paused deployment (run rollout resume first)`)
    return ok(`deployment.apps/${dep.name} restarted`, dep.uid)
  }
  if (action === 'pause' || action === 'resume') {
    const r = sim.setPaused(dep.name, action === 'pause')
    if (r === 'unchanged') return err(`error: deployments.apps "${dep.name}" is ${action === 'pause' ? 'already paused' : 'not paused'}`)
    return ok(`deployment.apps/${dep.name} ${action}d`, dep.uid)
  }
  if (action === 'undo') {
    const to = flags['to-revision'] === undefined ? undefined : Number(flags['to-revision'])
    if (to !== undefined && (!Number.isInteger(to) || to < 0)) return err(`error: invalid argument "${flags['to-revision']}" for "--to-revision" flag`)
    // --to-revision=0 means "the previous one", like no flag at all
    const r = sim.rolloutUndo(dep.name, to || undefined)
    if (r === 'nohistory') return err('error: no rollout history found for deployment "' + dep.name + '"')
    if (r === 'norevision') return err(`error: unable to find specified revision ${to} in history`)
    if (r === 'skipped') return { focusUid: dep.uid, lines: [plain(`deployment.apps/${dep.name} skipped rollback (current template already matches revision ${to || dep.history.length - 1})`, 'muted')] }
    return ok(`deployment.apps/${dep.name} rolled back`, dep.uid)
  }
  if (action === 'history') {
    return {
      focusUid: dep.uid,
      lines: [
        plain(`deployment.apps/${dep.name}`, 'strong'),
        ...table(
          ['REVISION', 'IMAGE', 'CHANGE'],
          dep.history.map((rev, i) => {
            const prev = dep.history[i - 1]
            const change = i === 0 ? 'criação' : prev && prev.image === rev.image && prev.restartedAt !== rev.restartedAt ? 'rollout restart' : prev && prev.image !== rev.image ? `imagem ${tag(prev.image)} → ${tag(rev.image)}` : prev && labelString(prev.labels) !== labelString(rev.labels) ? 'labels do template' : 'rollback'
            return [{ t: String(i + 1), c: i === dep.history.length - 1 ? 'accent' : undefined }, { t: tag(rev.image), c: isBroken(rev.image) ? ('error' as Tone) : undefined }, { t: change, c: 'muted' as Tone }]
          }),
        ),
        note('o kubectl real mostra CHANGE-CAUSE (geralmente <none>); aqui mostramos a imagem e o que mudou'),
        ...(dep.paused ? [note('pausado — mudanças no template esperam o rollout resume')] : []),
      ],
    }
  }
  if (action === 'status') {
    const current = sim.replicaSetOf(dep)
    const updated = current ? sim.activePods(current.uid) : []
    const ready = updated.filter((p) => p.ready).length
    if (dep.paused && !sim.replicaSetsOf(dep).some((rs) => rs.desired > 0 && rs.image === dep.template.image && (rs.restartedAt ?? 0) === (dep.template.restartedAt ?? 0)))
      return { focusUid: dep.uid, lines: [plain(`Waiting for deployment "${dep.name}" rollout to finish: 0 out of ${dep.replicas} new replicas have been updated...`, 'warn'), note('o Deployment está pausado — use kubectl rollout resume')] }
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
        ...(dep.rollout === 'stalled' ? [note('os Pods novos nunca ficam Ready — investigue com kubectl get pods / kubectl logs')] : []),
      ],
    }
  }
  return err(`error: unknown rollout action "${action}"`)
}

// ── get ────────────────────────────────────────────────────────────────────

const FORMATS = ['wide', 'yaml', 'json', 'name']
const REAL_FORMATS = ['custom-columns', 'custom-columns-file', 'go-template', 'go-template-file', 'jsonpath-as-json', 'jsonpath-file', 'template', 'templatefile']

function yamlLines(obj: Obj): Line[] {
  return toYaml(obj).map((l) => {
    const m = l.match(/^(\s*(?:- )*[^:\s][^:]*:)(.*)$/)
    return m ? [{ t: m[1] }, { t: m[2], c: 'strong' as Tone }] : plain(l, 'strong')
  })
}

const watchHeader = (watch: WatchSpec) => {
  const spec = SPECS[watch.kind] as Spec<Item>
  return [...(watch.allNamespaces && spec.namespaced ? ['NAMESPACE'] : []), ...spec.header(watch.wide), ...watch.labelCols.map((c) => c.toUpperCase()), ...(watch.showLabels ? ['LABELS'] : [])]
}

const watchState = (sim: Simulation, kind: WatchKind, item: Item) => {
  if (kind === 'pods') {
    const p = item as Pod
    return [p.phase, p.waiting, p.ready, p.restarts, p.nodeName, p.ip, p.image, p.labels, p.ownerUid, p.deletedAt]
  }
  if (kind === 'deployments') {
    const d = item as Deployment
    const pods = sim.deploymentPods(d).filter((p) => p.deletedAt === null)
    return [d.replicas, d.template, d.selector, d.revision, d.rollout, d.paused, pods.length, pods.filter((p) => p.ready).length]
  }
  if (kind === 'replicasets') {
    const rs = item as ReplicaSet
    const pods = sim.activePods(rs.uid)
    return [rs.desired, rs.image, rs.selector, rs.revision, rs.phase, rs.deletedAt, pods.length, pods.filter((p) => p.ready).length]
  }
  if (kind === 'services') {
    const service = item as Service
    return [service.selector, service.port, service.targetPort, service.clusterIP]
  }
  if (kind === 'endpoints' || kind === 'endpointslices') {
    const service = item as Service
    return [service.selector, service.port, service.targetPort, sim.selectedBy(service).map((p) => [p.uid, p.ip, p.ready, p.deletedAt]), service.endpoints]
  }
  if (kind === 'events') return [(item as Item & ClusterEvent).id]
  if (kind === 'configmaps') return [(item as ConfigMap).data]
  if (kind === 'daemonsets') return [sim.podsOf((item as DaemonSet).uid).map((p) => [p.phase, p.ready, p.deletedAt])]
  if (kind === 'jobs') {
    const j = item as Job
    return [j.status, j.succeeded, j.failed]
  }
  if (kind === 'horizontalpodautoscalers') {
    const h = item as HorizontalPodAutoscaler
    return [h.current, h.min, h.max, h.cpuPercent, sim.findDeployment(h.target)?.replicas]
  }
  return [item.name]
}

/** Current table rows for an active `kubectl get -w`, without time-only changes. */
export function watchRows(sim: Simulation, watch: WatchSpec): WatchRow[] {
  const spec = SPECS[watch.kind] as Spec<Item>
  let items = spec.items(sim)
  if (watch.selector) items = items.filter((t) => selects(watch.selector!, spec.labels(sim, t)))
  for (const field of watch.fields) {
    const read = field.key === 'metadata.name' ? (t: Item) => t.name : field.key === 'metadata.namespace' ? () => 'default' : spec.fields?.[field.key]
    if (read) items = items.filter((t) => (read(t) === field.value) === (field.op === '='))
  }
  if (watch.names.length) items = watch.names.flatMap((name) => items.filter((t) => t.name === name))
  if (watch.sortBy) {
    const keyed = items.map((t) => ({ t, v: readPath(spec.object(sim, t), watch.sortBy!) }))
    keyed.sort((a, b) => (typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v ?? '').localeCompare(String(b.v ?? ''))))
    items = keyed.map(({ t }) => t)
  }

  const header = watchHeader(watch)
  const raw = items.map((item) => {
    const row = spec.row(sim, item, watch.wide)
    if (item.uid && watch.kind !== 'events' && watch.kind !== 'nodes') row[0] = { ...row[0], ref: item.uid }
    const labels = spec.labels(sim, item)
    return [
      ...(watch.allNamespaces && spec.namespaced ? [{ t: 'default' }] : []),
      ...row,
      ...watch.labelCols.map((column) => ({ t: labels[column] ?? '', c: 'accent' as Tone })),
      ...(watch.showLabels ? [{ t: labelString(labels) || '<none>', c: 'accent' as Tone }] : []),
    ]
  })
  const formatted = table(header, raw).slice(1)
  const meaningful = header.map((column, index) => ({ column, index })).filter(({ column }) => column !== 'AGE' && column !== 'LAST SEEN')
  return items.map((item, index) => ({
    key: `${watch.kind}:${item.uid ?? item.name}`,
    signature: JSON.stringify([watchState(sim, watch.kind, item), meaningful.map(({ index: i }) => raw[index][i]?.t ?? '')]),
    line: formatted[index],
  }))
}

function get(sim: Simulation, args: string[], flags: Flags): CommandResult {
  const groups = targets(args)
  if ('error' in groups) return { lines: groups.error }

  const output = typeof flags.o === 'string' ? flags.o : undefined
  const jsonpath = output?.startsWith('jsonpath=') ? output.slice('jsonpath='.length) : undefined
  if (output && !FORMATS.includes(output) && jsonpath === undefined) {
    if (REAL_FORMATS.includes(output.split('=')[0]))
      return { lines: [plain(`O formato -o ${output.split('=')[0]} existe no kubectl real, mas aqui só há wide, yaml, json, name e jsonpath.`, 'warn')] }
    return err(
      `error: unable to match a printer suitable for the output format "${output}", allowed formats are: custom-columns,custom-columns-file,go-template,go-template-file,json,jsonpath,jsonpath-as-json,jsonpath-file,name,template,templatefile,wide,yaml`,
    )
  }
  const wide = output === 'wide'
  const sel = selectorFlag(flags)
  if (sel && 'error' in sel) return err(sel.error)

  let field: { key: string; op: '=' | '!='; value: string }[] = []
  if (typeof flags['field-selector'] === 'string') {
    for (const part of flags['field-selector'].split(',')) {
      const m = part.match(/^([\w.]+)\s*(==|=|!=)\s*(.*)$/)
      if (!m) return err(`error: invalid field selector: ${part}`)
      field.push({ key: m[1], op: m[2] === '!=' ? '!=' : '=', value: m[3] })
    }
  }
  const labelCols = typeof flags.L === 'string' ? flags.L.split(',').filter(Boolean) : []
  const showLabels = flags['show-labels'] === true
  const allNs = flags.A === true

  const lines: Line[] = []
  const objects: Obj[] = []
  const errors: Line[] = []
  const multi = groups.length > 1
  let focusUid: string | undefined
  let found = 0

  for (const { kind, names } of groups) {
    const spec = SPECS[kind] as Spec<Item>
    let items = spec.items(sim)
    if (sel && !('error' in sel)) items = items.filter((t) => selects(sel, spec.labels(sim, t)))
    for (const f of field) {
      const read = f.key === 'metadata.name' ? (t: Item) => t.name : f.key === 'metadata.namespace' ? () => 'default' : spec.fields?.[f.key]
      if (!read) return err(`Error from server (BadRequest): Unable to find "${spec.resource}" that match label selector "", field selector "${flags['field-selector']}": field label not supported: ${f.key}`)
      items = items.filter((t) => (read(t) === f.value) === (f.op === '='))
    }
    if (names.length) {
      for (const n of names) if (!items.some((t) => t.name === n) && !flags['ignore-not-found']) errors.push(plain(`Error from server (NotFound): ${spec.resource} "${n}" not found`, 'error'))
      items = names.flatMap((n) => items.filter((t) => t.name === n))
      if (items.length === 1 && groups.length === 1) focusUid = items[0].uid
    }
    if (typeof flags['sort-by'] === 'string') {
      const path = flags['sort-by']
      const keyed = items.map((t) => ({ t, v: readPath(spec.object(sim, t), path) }))
      keyed.sort((a, b) => (typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v ?? '').localeCompare(String(b.v ?? ''))))
      items = keyed.map((k) => k.t)
    }
    found += items.length

    if (output === 'yaml' || output === 'json' || jsonpath !== undefined) {
      objects.push(...items.map((t) => spec.object(sim, t)))
      continue
    }
    if (output === 'name') {
      lines.push(...items.map((t): Line => [{ t: `${spec.prefix}/${t.name}`, ref: kind === 'nodes' || kind === 'events' ? undefined : t.uid }]))
      continue
    }
    if (!items.length) continue
    const header = [...(allNs && spec.namespaced ? ['NAMESPACE'] : []), ...spec.header(wide), ...labelCols.map((c) => c.toUpperCase()), ...(showLabels ? ['LABELS'] : [])]
    const rows = items.map((t) => {
      const row = spec.row(sim, t, wide)
      if (t.uid && kind !== 'events' && kind !== 'nodes') row[0] = { ...row[0], ref: t.uid }
      if (multi) row[0] = { ...row[0], t: `${spec.prefix}/${row[0].t}` }
      const labels = spec.labels(sim, t)
      return [
        ...(allNs && spec.namespaced ? [{ t: 'default' }] : []),
        ...row,
        ...labelCols.map((c) => ({ t: labels[c] ?? '', c: 'accent' as Tone })),
        ...(showLabels ? [{ t: labelString(labels) || '<none>', c: 'accent' as Tone }] : []),
      ]
    })
    const t = table(header, rows)
    if (lines.length) lines.push([])
    lines.push(...(flags['no-headers'] ? t.slice(1) : t))
  }

  if (jsonpath !== undefined) {
    const single = objects.length === 1 && groups.length === 1 && groups[0].names.length === 1
    if (!objects.length) return { lines: errors.length ? errors : [] }
    const r = renderJsonPath(single ? objects[0] : listObject(objects), jsonpath)
    if ('error' in r) return err(r.error)
    return { lines: [...r.text.split('\n').map((l) => plain(l)), ...errors] }
  }
  if (output === 'yaml' || output === 'json') {
    const single = objects.length === 1 && groups.length === 1 && groups[0].names.length === 1
    const value = single ? objects[0] : listObject(objects)
    if (!objects.length && errors.length) return { lines: errors }
    lines.push(...(output === 'yaml' ? yamlLines(value) : toJson(value).split('\n').map((l) => plain(l))))
  }

  const notes: Line[] = []
  const kinds = groups.map((g) => g.kind)
  if (kinds.includes('endpoints') && !flags.o) lines.unshift(plain('Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice', 'warn'))
  if (allNs) notes.push(note('este cluster de treino só simula o namespace default'))
  if (sel && !found && kinds.includes('deployments'))
    notes.push(note('os Deployments daqui não têm labels próprias — app=backend está no template dos Pods (veja -o yaml)'))
  const watch = (flags.w === true) && !output?.match(/yaml|json|name/) && groups.length === 1
    ? {
        kind: groups[0].kind,
        names: groups[0].names,
        selector: sel && !('error' in sel) ? sel : null,
        fields: field,
        sortBy: typeof flags['sort-by'] === 'string' ? flags['sort-by'] : undefined,
        wide,
        labelCols,
        showLabels,
        allNamespaces: allNs,
      } satisfies WatchSpec
    : undefined
  if (flags.w && !watch) notes.push(note(output?.match(/yaml|json|name/) ? '-w acompanha apenas saídas em tabela neste terminal' : '-w acompanha um tipo de recurso por vez neste terminal'))

  if (!found && !errors.length && !watch) {
    if (output === 'yaml' || output === 'json') return { lines: [...lines, ...notes] }
    return { lines: [plain(kinds.every((k) => !SPECS[k].namespaced) ? 'No resources found' : 'No resources found in default namespace.', 'muted'), ...notes] }
  }
  if (watch) {
    const rows = found || flags['no-headers'] ? lines : [...lines, ...table(watchHeader(watch), []).slice(0, 1)]
    return { lines: [...rows, ...errors, ...notes], watch }
  }
  return { lines: [...lines, ...errors, ...notes], focusUid }
}

// ── describe ───────────────────────────────────────────────────────────────

function describe(sim: Simulation, args: string[], flags: Flags): CommandResult {
  const [rawKind, rawNames] = splitKind(args)
  if (!rawKind) return err('error: You must specify the type of resource to describe. Use "kubectl api-resources" for a complete list of supported resources.')
  const kinds = resolveKind(rawKind)
  if ('error' in kinds) return { lines: kinds.error }
  if (kinds.length !== 1) return err('Usage: kubectl describe pod|deployment|rs|service|node <name>')
  const kind = kinds[0]
  if (!['pods', 'deployments', 'replicasets', 'services', 'nodes', 'configmaps', 'horizontalpodautoscalers', 'secrets', 'jobs', 'daemonsets'].includes(kind)) return { lines: [plain(`describe de ${rawKind} ainda não está disponível aqui — tente kubectl get ${rawKind} -o yaml`, 'warn')] }
  const spec = SPECS[kind] as Spec<Item>
  let names = rawNames
  const sel = selectorFlag(flags)
  if (sel) {
    if ('error' in sel) return err(sel.error)
    names = spec.items(sim).filter((t) => selects(sel, spec.labels(sim, t))).map((t) => t.name)
    if (!names.length) return { lines: [plain('No resources found in default namespace.', 'muted')] }
  } else if (!names.length) {
    // like kubectl: no name means "all of them"
    names = spec.items(sim).map((t) => t.name)
    if (!names.length) return { lines: [plain('No resources found in default namespace.', 'muted')] }
  }
  const out: Line[] = []
  let focusUid: string | undefined
  for (const name of names) {
    const r = describeOne(sim, kind, name)
    if (out.length) out.push([], [])
    out.push(...r.lines)
    if (names.length === 1) focusUid = r.focusUid
  }
  return { lines: out, focusUid }
}

function describeOne(sim: Simulation, kind: KindId, name: string): CommandResult {
  const kv = (k: string, v: string, c?: Tone, ref?: string): Line => [{ t: `${k}:`.padEnd(18), c: 'muted' }, { t: v, c, ref }]
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
    const job = p.ownerUid ? sim.cluster.jobs[p.ownerUid] : undefined
    const daemonSet = p.ownerUid ? sim.cluster.daemonSets[p.ownerUid] : undefined
    const crashing = !p.job && (p.phase === 'Error' || p.phase === 'CrashLoopBackOff')
    return {
      focusUid: p.uid,
      lines: [
        kv('Name', p.name, 'strong', p.uid),
        kv('Namespace', 'default'),
        kv('Node', p.nodeName ?? '<none>'),
        kv('Labels', labelString(p.labels) || '<none>', 'accent'),
        kv('Status', p.phase === 'Terminating' ? 'Terminating' : apiPhase(p), statusTone(p)),
        kv('IP', p.ip ?? '<none>'),
        kv('Controlled By', rs ? `ReplicaSet/${rs.name}` : job ? `Job/${job.name}` : daemonSet ? `DaemonSet/${daemonSet.name}` : '<none>', rs || job || daemonSet ? 'info' : 'warn', rs?.uid ?? job?.uid ?? daemonSet?.uid),
        ...(p.job && (p.phase === 'Succeeded' || p.phase === 'Error') ? [kv('State', `Terminated (Reason: ${p.phase === 'Succeeded' ? 'Completed' : 'Error'}, Exit Code: ${p.phase === 'Succeeded' ? 0 : 1})`, p.phase === 'Succeeded' ? 'muted' : 'error')] : []),
        kv('Image', p.image, isBroken(p.image) ? 'error' : undefined),
        ...(crashing
          ? [kv('State', `Waiting (Reason: ${p.phase === 'Error' ? 'Error' : 'CrashLoopBackOff'})`, 'error'), kv('Last State', 'Terminated (Reason: Error, Exit Code: 2)', 'error')]
          : []),
        kv('Restart Count', String(p.restarts), p.restarts ? 'warn' : undefined),
        ...(p.resources ? [kv('Requests', `cpu: ${p.resources.cpuRequest}m`), kv('Limits', p.resources.cpuLimit ? `cpu: ${p.resources.cpuLimit}m` : '<none>')] : []),
        kv('Readiness', p.daemon ? '<none>' : 'http-get http://:8080/healthz period=10s #failure=3', p.daemon ? undefined : 'muted'),
        kv('Liveness', p.liveness ? 'http-get http://:8080/healthz period=10s #failure=3' : '<none>', p.liveness ? 'muted' : 'warn'),
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
        kv('Name', d.name, 'strong', d.uid),
        kv('Selector', labelString(d.selector), 'accent'),
        kv('Replicas', `${d.replicas} desired | ${updated} updated | ${all.length} total | ${ready} available | ${all.length - ready} unavailable`),
        ...(d.paused ? [kv('Paused', 'True — rollouts congelados até o resume', 'warn')] : []),
        kv('StrategyType', 'RollingUpdate'),
        kv('RollingUpdate', '25% max unavailable, 25% max surge', 'muted'),
        kv('Image', d.template.image, isBroken(d.template.image) ? 'error' : undefined),
        kv('Progressing', d.rollout === 'complete' ? 'True (NewReplicaSetAvailable)' : d.rollout === 'stalled' ? 'True (ReplicaSetUpdated) — new Pods not becoming ready' : 'True (ReplicaSetUpdated)', d.rollout === 'stalled' ? 'error' : undefined),
        kv('OldReplicaSets', olds.length ? olds.map((rs) => `${rs.name} (${sim.activePods(rs.uid).length}/${rs.desired} replicas created)`).join(', ') : '<none>', 'muted'),
        kv('NewReplicaSet', current ? `${current.name} (${updated}/${current.desired} replicas created)` : '<none>', 'info', current?.uid),
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
        kv('Name', rs.name, 'strong', rs.uid),
        kv('Selector', labelString(rsSelector(rs)), 'accent'),
        kv('Controlled By', dep ? `Deployment/${dep.name}` : '<none>', 'info', dep?.uid),
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
        kv('Name', s.name, 'strong', s.uid),
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

  if (kind === 'horizontalpodautoscalers') {
    const h = sim.findHpa(name)
    if (!h) return err(`Error from server (NotFound): horizontalpodautoscalers.autoscaling "${name}" not found`)
    const dep = sim.findDeployment(h.target)
    const stable = h.recommendations.length ? Math.max(...h.recommendations.map((r) => r.desired)) : undefined
    return {
      focusUid: h.uid,
      lines: [
        kv('Name', h.name, 'strong'),
        kv('Reference', `Deployment/${h.target}`, 'info', dep?.uid),
        kv('Metrics', `( current / target )`, 'muted'),
        kv('  cpu', `${h.current === null ? '<unknown>' : `${h.current}% (${Math.round((h.current / 100) * (dep?.template.resources?.cpuRequest ?? 0))}m)`} / ${h.cpuPercent}%`, h.current === null ? 'warn' : undefined),
        kv('Min replicas', String(h.min)),
        kv('Max replicas', String(h.max)),
        kv('Deployment pods', `${dep?.replicas ?? 0} desired`),
        kv('Conditions', h.current === null ? 'ScalingActive False — FailedGetResourceMetric' : 'ScalingActive True — ValidMetricFound', h.current === null ? 'error' : 'success'),
        ...(stable !== undefined && dep && stable > dep.replicas - 1 && h.recommendations.at(-1)!.desired < dep.replicas
          ? [note(`a CPU já pede menos réplicas, mas o HPA espera a carga se manter baixa antes de reduzir (janela de estabilização)`)]
          : []),
        ...eventsFor(h.uid),
      ],
    }
  }
  if (kind === 'daemonsets') {
    const d = sim.findDaemonSet(name)
    if (!d) return err(`Error from server (NotFound): daemonsets.apps "${name}" not found`)
    const pods = sim.podsOf(d.uid).filter((p) => p.deletedAt === null)
    return {
      focusUid: d.uid,
      lines: [
        kv('Name', d.name, 'strong', d.uid),
        kv('Selector', labelString(d.labels), 'accent'),
        kv('Desired Number of Nodes Scheduled', String(sim.cluster.nodes.length)),
        kv('Current Number of Nodes Scheduled', String(pods.filter((p) => p.nodeName).length)),
        kv('Number Ready', String(pods.filter((p) => p.ready).length)),
        kv('Image', d.image),
        [],
        plain('Pods por node:', 'muted'),
        ...sim.cluster.nodes.map((n): Line => {
          const p = pods.find((x) => x.labels['kubelearn.dev/node'] === n.name)
          return [{ t: `  ${n.name.padEnd(8)}`, c: 'muted' }, p ? { t: p.name, c: 'strong', ref: p.uid } : { t: '<nenhum>', c: 'warn' }]
        }),
        ...eventsFor(d.uid),
      ],
    }
  }
  if (kind === 'jobs') {
    const j = sim.findJob(name)
    if (!j) return err(`Error from server (NotFound): jobs.batch "${name}" not found`)
    const active = sim.podsOf(j.uid).filter((p) => p.deletedAt === null && p.phase !== 'Succeeded' && p.phase !== 'Error').length
    return {
      focusUid: j.uid,
      lines: [
        kv('Name', j.name, 'strong', j.uid),
        kv('Namespace', 'default'),
        kv('Parallelism', String(j.parallelism)),
        kv('Completions', String(j.completions)),
        kv('Backoff Limit', String(j.backoffLimit)),
        kv('Pods Statuses', `${active} Active / ${j.succeeded} Succeeded / ${j.failed} Failed`, j.failed ? 'warn' : undefined),
        kv('Image', j.image),
        ...(j.status !== 'Running' ? [kv('Condition', j.status === 'Complete' ? 'Complete' : 'Failed — BackoffLimitExceeded', j.status === 'Complete' ? 'success' : 'error')] : []),
        ...eventsFor(j.uid),
      ],
    }
  }
  if (kind === 'secrets') {
    const secret = sim.findSecret(name)
    if (!secret) return err(`Error from server (NotFound): secrets "${name}" not found`)
    return {
      focusUid: secret.uid,
      lines: [
        kv('Name', secret.name, 'strong'),
        kv('Namespace', 'default'),
        kv('Type', 'Opaque'),
        [],
        plain('Data', 'muted'),
        plain('====', 'muted'),
        ...Object.entries(secret.data).map(([k, v]): Line => [{ t: `${k}:  `, c: 'accent' }, { t: `${new TextEncoder().encode(v).length} bytes` }]),
        note('o describe esconde os valores — mas o -o yaml mostra, em base64'),
      ],
    }
  }
  if (kind === 'configmaps') {
    const c = sim.findConfigMap(name)
    if (!c) return err(`Error from server (NotFound): configmaps "${name}" not found`)
    const readers = Object.values(sim.cluster.pods).filter((p) => p.configMap === c.name && p.deletedAt === null)
    return {
      focusUid: c.uid,
      lines: [
        kv('Name', c.name, 'strong'),
        kv('Namespace', 'default'),
        [],
        plain('Data', 'muted'),
        plain('====', 'muted'),
        ...Object.entries(c.data).flatMap(([k, v]): Line[] => [plain(`${k}:`, 'accent'), plain('----', 'muted'), plain(v), []]),
        ...(readers.length ? [note(`${readers.length} Pod${readers.length === 1 ? '' : 's'} lê${readers.length === 1 ? '' : 'em'} este ConfigMap — cada um com o valor de quando iniciou`)] : []),
      ],
    }
  }
  const n = sim.cluster.nodes.find((x) => x.name === name)
  if (!n) return err(`Error from server (NotFound): nodes "${name}" not found`)
  const pods = Object.values(sim.cluster.pods).filter((p) => p.nodeName === n.name && p.deletedAt === null)
  return {
    lines: [
      kv('Name', n.name, 'strong'),
      kv('Roles', '<none>'),
      kv('Labels', `kubernetes.io/hostname=${n.name},kubernetes.io/os=linux`, 'accent'),
      kv('Unschedulable', n.unschedulable ? 'true' : 'false', n.unschedulable ? 'warn' : undefined),
      kv('Taints', n.unschedulable ? 'node.kubernetes.io/unschedulable:NoSchedule' : '<none>', n.unschedulable ? 'warn' : undefined),
      kv('Conditions', 'Ready=True (KubeletReady)', 'success'),
      kv('Kubelet Version', 'v1.34.1'),
      [],
      plain(`Non-terminated Pods:  (${pods.length} in total)`, 'muted'),
      ...(pods.length ? table(['  Namespace', 'Name', 'Age'], pods.map((p) => [{ t: '  default' }, { t: p.name, c: 'strong' as Tone, ref: p.uid }, { t: age(sim.now - p.createdAt) }])) : [plain('  <none>', 'muted')]),
    ],
  }
}

function help(workspace = false): CommandResult {
  const row = (c: string, d: string): Line => [{ t: `  ${c}`.padEnd(58), c: 'accent' }, { t: d, c: 'muted' }]
  return {
    lines: [
      plain('Este terminal conversa com o cluster simulado no palco.', 'muted'),
      [],
      row('ls · cat <file>', 'ver os manifestos desta lição'),
      row('kubectl apply -f <file>', 'criar ou atualizar a partir de um manifesto'),
      row('kubectl get pods [-o wide|yaml] [--show-labels] [-w]', 'listar Pods (-w acompanha; Esc para)'),
      row('kubectl get deploy | rs | svc | endpointslices | events | all', 'listar outros recursos'),
      row('kubectl get <tipo> -l app=backend · -L app · -A', 'filtrar por labels, mostrar colunas'),
      row('kubectl describe pod|deploy|rs|svc|node <name>', 'detalhes + eventos'),
      row('kubectl delete pod|rs|deploy|svc <name>... | -l k=v', 'apagar (em cascata: o dono leva o que possui)'),
      row('kubectl scale deploy backend --replicas=N', 'mudar as réplicas desejadas'),
      row('kubectl expose deploy backend --port=80', 'colocar um Service na frente'),
      row('kubectl label pod <name> key=value --overwrite', 'mudar uma label de Pod (key- remove)'),
      row('kubectl set selector svc <name> key=value', 'mudar o selector de um Service'),
      row('kubectl set image deploy/backend backend=<image>', 'publicar uma versão nova'),
      row('kubectl edit deployment/backend', 'editar réplicas, imagem e labels em YAML'),
      row('kubectl create deployment <nome> --image=<imagem>', 'criar outro Deployment'),
      row('kubectl rollout status|history|undo deploy/backend', 'acompanhar ou desfazer um rollout'),
      row('kubectl rollout restart|pause|resume deploy/backend', 'trocar todos os Pods · pausar mudanças'),
      row('kubectl logs <pod> [--previous] [--tail=N]', 'ler a saída de um container'),
      row('kubectl run <nome> --image=<imagem>', 'criar um Pod avulso (sem dono)'),
      row('kubectl top pods | nodes', 'consumo de CPU e memória'),
      row('kubectl autoscale deploy backend --cpu=50% --min=2 --max=8', 'criar um HPA'),
      row('kubectl cordon|uncordon <node>', 'fechar ou reabrir um node para novos Pods'),
      row('kubectl drain <node> --ignore-daemonsets', 'esvaziar um node para manutenção'),
      row('kubectl run t --rm -it --image=busybox -- wget -qO- http://backend', 'testar um Service de dentro do cluster'),
      row('… | grep · head · tail · wc -l · sort', 'filtrar a saída'),
      row('explicar <comando>', 'explica cada parte de um comando, sem executar'),
      ...(workspace ? WORKSPACE_HELP.map(([c, d]) => row(c, d)) : []),
      [],
      plain('kubectl <comando> --help explica cada comando · Tab completa · ↑/↓ histórico · `k` = kubectl · clear limpa', 'muted'),
      plain('Tudo isso, com exemplos, na documentação: /doc (menu Ajuda → Documentação).', 'muted'),
    ],
  }
}

// ── completion ─────────────────────────────────────────────────────────────

/** How each flag is offered: `=` means "a value follows, right here". */
const FLAG_WORDS: Record<string, string> = {
  cpu: '--cpu=', 'cpu-percent': '--cpu-percent=', min: '--min=', max: '--max=', 'ignore-daemonsets': '--ignore-daemonsets', 'delete-emptydir-data': '--delete-emptydir-data',
  o: '-o', l: '-l', L: '-L', w: '-w', A: '-A', f: '-f', n: '-n', c: '-c', p: '--previous',
  'show-labels': '--show-labels', 'sort-by': '--sort-by=', 'field-selector': '--field-selector=', 'no-headers': '--no-headers', 'ignore-not-found': '--ignore-not-found',
  'grace-period': '--grace-period=', timeout: '--timeout=', force: '--force', now: '--now', wait: '--wait', replicas: '--replicas=', port: '--port=', 'target-port': '--target-port=', name: '--name=', type: '--type=',
  overwrite: '--overwrite', list: '--list', 'to-revision': '--to-revision=', follow: '--follow', tail: '--tail=',
}

function namesOf(sim: Simulation, kind: KindId | 'all' | undefined, live = false): string[] {
  if (!kind || kind === 'all' || kind === 'events') return []
  if (kind === 'pods') return Object.values(sim.cluster.pods).filter((p) => !live || p.deletedAt === null).map((p) => p.name)
  return (SPECS[kind] as Spec<Item>).items(sim).map((t) => t.name)
}

function labelPairs(sim: Simulation): string[] {
  const pairs = new Set<string>()
  for (const p of Object.values(sim.cluster.pods)) for (const [k, v] of Object.entries(p.labels)) pairs.add(`${k}=${v}`)
  for (const s of Object.values(sim.cluster.services)) pairs.add(`kubernetes.io/service-name=${s.name}`)
  return [...pairs]
}

/** What fits at the end of `input`, given everything typed before it. */
function candidatesFor(sim: Simulation, words: string[], last: string, images: string[] = []): string[] {
  const [cmd, verb] = words
  if (!words.length) return SHELL
  if (cmd === 'cat') return [...sim.files, ...WORKSPACE_FILES]
  if (cmd === 'edit') return words.length === 1 ? ['app.js'] : []
  if (cmd === 'docker') return words.length === 1 ? ['build', 'images'] : words[1] === 'build' && !words.includes('-t') ? ['-t'] : []
  if (cmd !== 'kubectl' && cmd !== 'k') return []
  if (words.length === 1) return VERBS

  const prevWord = words[words.length - 1]
  const prevFlag = prevWord.startsWith('-') ? prevWord.replace(/^-+/, '') : null
  // values of the flag just typed
  if (prevFlag === 'o' || prevFlag === 'output') return FORMATS
  if (prevFlag === 'l' || prevFlag === 'selector') return labelPairs(sim)
  if (prevFlag === 'L' || prevFlag === 'label-columns') return [...new Set(labelPairs(sim).map((p) => p.split('=')[0]))]
  if ((prevFlag === 'f' || prevFlag === 'filename') && verb !== 'logs') return sim.files
  if (prevFlag === 'n' || prevFlag === 'namespace') return ['default']
  if (prevFlag === 'c' || prevFlag === 'container') return ['backend']
  // --output=y, --selector=app=b
  const inline = last.match(/^(--?[\w-]+=)(.*)$/)
  if (inline) {
    const flag = inline[1].replace(/^-+|=$/g, '')
    const values = flag === 'output' || flag === 'o' ? FORMATS : flag === 'selector' || flag === 'l' ? labelPairs(sim) : flag === 'sort-by' ? ['.metadata.name', '.metadata.creationTimestamp', '.status.containerStatuses[0].restartCount'] : flag === 'field-selector' ? ['status.phase=Running', 'status.phase!=Running', 'spec.nodeName=node-1', 'metadata.name='] : flag === 'type' ? ['ClusterIP'] : []
    return values.map((v) => inline[1] + v)
  }
  if (last.startsWith('-')) return (VERB_FLAGS[verb] ?? []).map((f) => FLAG_WORDS[f]).filter(Boolean).concat('--help')

  // positional arguments (flags and their values skipped)
  const positional: string[] = []
  for (let i = 2; i < words.length; i++) {
    const w = words[i]
    if (w.startsWith('-')) {
      const key = w.replace(/^-+/, '').split('=')[0]
      if (!w.includes('=') && TAKES_VALUE.has(key)) i++
      continue
    }
    positional.push(w)
  }
  const kindOf = (w: string | undefined) => (w ? (KIND_ALIASES[w.split('/')[0].toLowerCase()] as KindId | 'all' | undefined) : undefined)
  // kind/name form
  if (last.includes('/')) {
    const kind = kindOf(last)
    const prefix = last.split('/')[0]
    return namesOf(sim, kind, verb === 'delete').map((n) => `${prefix}/${n}`)
  }

  switch (verb) {
    case 'get':
    case 'describe':
      return positional.length === 0 ? KIND_WORDS : namesOf(sim, kindOf(positional[0]))
    case 'edit':
      return positional.length === 0 ? ['deployment', 'deploy'] : namesOf(sim, 'deployments')
    case 'create':
      return positional.length === 0 ? ['deployment', 'configmap', 'secret', 'job'] : positional[0] === 'secret' && positional.length === 1 ? ['generic'] : []
    case 'patch':
      return positional.length === 0 ? ['configmap'] : positional.length === 1 ? namesOf(sim, 'configmaps') : []
    case 'autoscale':
      return positional.length === 0 ? ['deployment'] : positional.length === 1 ? namesOf(sim, 'deployments') : []
    case 'top':
      return positional.length === 0 ? ['pods', 'nodes'] : namesOf(sim, 'pods', true)
    case 'cordon':
    case 'uncordon':
    case 'drain':
      return positional.length === 0 ? sim.cluster.nodes.map((n) => n.name) : []
    case 'delete':
      return positional.length === 0 ? ['pod', 'pods', 'service', 'svc', 'deployment', 'deploy', 'replicaset', 'rs', 'job', 'daemonset', 'ds'] : namesOf(sim, kindOf(positional[0]), true)
    case 'logs':
      return positional.length === 0 ? namesOf(sim, 'pods', true) : []
    case 'scale':
    case 'expose':
      return positional.length === 0 ? ['deployment', 'deploy'] : positional.length === 1 ? namesOf(sim, 'deployments') : []
    case 'label':
      if (positional.length === 0) return ['pod', 'pods']
      if (positional.length === 1) return namesOf(sim, 'pods', true)
      return [...labelPairs(sim), ...[...new Set(labelPairs(sim).map((p) => `${p.split('=')[0]}-`))]]
    case 'set':
      if (positional.length === 0) return ['image', 'selector']
      if (positional[0] === 'image') {
        if (positional.length === 1) return namesOf(sim, 'deployments').map((n) => `deployment/${n}`)
        return [...new Set(Object.values(sim.cluster.deployments).flatMap((d) => [...d.history.map((r) => r.image), IMAGE, 'ghcr.io/kubelearn/backend:1.5', ...images]))].map((img) => `backend=${img}`)
      }
      if (positional.length === 1) return ['service', 'svc']
      if (positional.length === 2) return namesOf(sim, 'services')
      return labelPairs(sim)
    case 'rollout':
      if (positional.length === 0) return ['status', 'history', 'undo', 'restart', 'pause', 'resume']
      return positional.length === 1 ? namesOf(sim, 'deployments').map((n) => `deployment/${n}`) : []
    case 'apply':
      return ['-f']
  }
  return []
}

/** Bash-style completion on the last word. Returns the new input, plus candidates when ambiguous. */
export function complete(sim: Simulation, input: string, images: string[] = []): { value: string; candidates: string[] } {
  const parts = input.split(' ')
  const last = parts[parts.length - 1]
  const words = parts.slice(0, -1).filter(Boolean)
  const pool = candidatesFor(sim, words, last, images)
  const hits = [...new Set(pool)].filter((c) => c.startsWith(last) && (c !== last || pool.length === 1) && !words.includes(c))
  if (!hits.length) return { value: input, candidates: [] }
  if (hits.length === 1) return { value: [...parts.slice(0, -1), hits[0]].join(' ') + (hits[0].endsWith('=') || hits[0].endsWith('/') ? '' : ' '), candidates: [] }
  let common = hits[0]
  for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1)
  const isPods = hits.every((h) => sim.findPod(h.split('/').pop()!))
  return { value: [...parts.slice(0, -1), common].join(' '), candidates: hits.map((h) => (isPods ? short(h) : h)).slice(0, 24) }
}

// ── explicar ───────────────────────────────────────────────────────────────

const VERB_DOCS: Record<string, string> = {
  apply: 'cria ou atualiza o que o manifesto descreve',
  get: 'lista recursos',
  describe: 'mostra detalhes e os eventos recentes',
  delete: 'apaga recursos',
  scale: 'muda quantas réplicas você quer',
  expose: 'cria um Service na frente dos Pods',
  label: 'muda as labels de um Pod',
  set: 'altera um campo específico',
  rollout: 'trata dos rollouts de um Deployment',
  logs: 'mostra a saída do container',
  run: 'cria um Pod avulso, sem dono',
  edit: 'abre o recurso em YAML para você alterar e salvar',
  create: 'cria um recurso novo a partir dos argumentos',
  patch: 'altera só os campos indicados de um recurso',
  autoscale: 'cria um HorizontalPodAutoscaler para um Deployment',
  top: 'mostra o consumo de CPU e memória agora (dados do metrics-server)',
  cordon: 'tira o node da escala: nenhum Pod novo vai para lá',
  uncordon: 'devolve o node à escala',
  drain: 'tira o node da escala e despeja os Pods dele, para manutenção',
}

function describeSelector(v: string): string {
  const r = parseSelector(v)
  if ('error' in r) return `selector inválido (${r.error})`
  const parts = r.map((q) =>
    q.op === '=' ? `${q.key} igual a ${q.value}` : q.op === '!=' ? `${q.key} diferente de ${q.value}` : q.op === 'in' ? `${q.key} em (${q.values.join(', ')})` : q.op === 'notin' ? `${q.key} fora de (${q.values.join(', ')})` : q.op === 'exists' ? `com a label ${q.key}` : `sem a label ${q.key}`,
  )
  return `selector: só o que tiver ${parts.join(' e ')}`
}

const FLAG_DOCS: Record<string, (v: string) => string> = {
  o: (v) => ({ wide: 'formato: a tabela com colunas extras (IP, nó, imagem…)', yaml: 'formato: o objeto completo, em YAML, como a API devolve', json: 'formato: o objeto completo, em JSON', name: 'formato: só tipo/nome' })[v] ?? `formato ${v}`,
  l: (v) => describeSelector(v),
  L: (v) => `uma coluna a mais com o valor da label ${v}`,
  w: () => 'continua acompanhando e imprime cada mudança (watch) — Esc para',
  A: () => 'todos os namespaces',
  n: (v) => `no namespace ${v}`,
  'show-labels': () => 'mostra todas as labels numa coluna',
  'sort-by': (v) => `ordena pelo campo ${v}`,
  'field-selector': (v) => `filtra por campo: ${v}`,
  'no-headers': () => 'sem a linha de cabeçalho',
  'ignore-not-found': () => 'não reclama se não existir',
  replicas: (v) => `quantidade desejada: ${v} réplica${v === '1' ? '' : 's'} — o ReplicaSet cria ou remove Pods até chegar lá`,
  port: (v) => `porta do Service, a que os clientes usam: ${v}`,
  'target-port': (v) => `porta do container, para onde o tráfego vai: ${v}`,
  name: (v) => `nome do Service criado: ${v}`,
  type: (v) => `tipo de Service: ${v}`,
  overwrite: () => 'permite trocar o valor de uma label que já existe',
  list: () => 'só lista as labels',
  'to-revision': (v) => `volta para a revisão ${v} (veja rollout history)`,
  p: () => 'a execução anterior ao último restart — onde está o motivo do crash',
  follow: () => 'continuaria acompanhando novas linhas',
  tail: (v) => `só as últimas ${v} linhas`,
  c: (v) => `do container ${v}`,
  f: (v) => `o manifesto ${v} (veja com cat ${v})`,
  'grace-period': (v) => `prazo para encerrar: ${v}s`,
  force: () => 'apaga sem esperar confirmação do kubelet',
  now: () => 'encerra imediatamente',
  wait: () => 'espera a exclusão terminar',
  image: (v) => `a imagem do container: ${v}`,
  'from-literal': (v) => `uma chave e seu valor: ${v}`,
  'ignore-daemonsets': () => 'deixa os Pods de DaemonSet onde estão (eles existem para estar em cada node)',
  timeout: (v) => `desiste se o drain não terminar em ${v}`,
  cpu: (v) => `a meta: CPU média em ${v} das requests`,
  'cpu-percent': (v) => `a meta: CPU média em ${v}% das requests`,
  min: (v) => `nunca menos que ${v} réplica${v === '1' ? '' : 's'}`,
  max: (v) => `nunca mais que ${v} réplicas`,
  patch: (v) => `o pedaço a mesclar no recurso: ${v}`,
  labels: (v) => `labels do Pod: ${v}`,
  restart: (v) => (v === 'Never' ? 'não reinicia o container quando ele termina' : `política de restart: ${v}`),
  rm: () => 'apaga o Pod quando o comando terminar',
  it: () => 'interativo, com terminal — você vê a saída do comando',
  i: () => 'mantém a entrada aberta',
  t: () => 'aloca um terminal',
  h: () => 'mostra a ajuda do comando',
  help: () => 'mostra a ajuda do comando',
}

function explain(sim: Simulation, tokens: string[]): CommandResult {
  if (!tokens.length) return { lines: [plain('Uso: explicar <comando> — por exemplo, explicar kubectl get pods -l app=backend', 'muted')] }
  const rows: [string, string, Tone?][] = []
  const [cmd, verb, ...more] = tokens
  if (cmd !== 'kubectl' && cmd !== 'k') {
    const shell: Record<string, string> = { ls: 'lista os arquivos desta lição', cat: 'mostra o conteúdo de um arquivo', clear: 'limpa o terminal', help: 'mostra o que este terminal entende', ...WORKSPACE_DOCS }
    return { lines: [plain(shell[cmd] ? `${cmd}: ${shell[cmd]}` : `${cmd} não é um comando que este terminal entende`, shell[cmd] ? undefined : 'warn')] }
  }
  rows.push([cmd, cmd === 'k' ? 'atalho para kubectl — a ferramenta que conversa com a API do cluster' : 'a ferramenta que conversa com a API do cluster'])
  if (!verb) return { lines: table2(rows) }
  if (!VERBS.includes(verb)) {
    rows.push([verb, UNSIMULATED_VERBS[verb] ? `${UNSIMULATED_VERBS[verb]} (não simulado aqui)` : 'não é um comando do kubectl', 'warn'])
    return { lines: table2(rows) }
  }
  rows.push([verb, VERB_DOCS[verb]])

  const { args, flags, spelled } = parseArgs(more, verb)
  // positional arguments
  const exists = (kind: KindId, name: string) => kind === 'events' || (SPECS[kind] as Spec<Item>).items(sim).some((t) => t.name === name)
  const nameRow = (kind: KindId, name: string, label: string) =>
    rows.push([name, exists(kind, name) ? label : `${label} — não existe nenhum com esse nome agora`, exists(kind, name) ? undefined : 'warn'])
  const positional = (list: string[], defaultKind?: KindId) => {
    let kind: KindId | undefined = defaultKind
    list.forEach((a, i) => {
      if (a.includes('/')) {
        const [k, n] = a.split('/')
        const kk = KIND_ALIASES[k]
        if (!kk || kk === 'all') return void rows.push([a, `tipo "${k}" desconhecido`, 'warn'])
        return nameRow(kk, n, `o ${KIND_SINGULAR[kk]} chamado ${n}`)
      }
      if (i === 0 && !defaultKind) {
        const ks = a.split(',').map((x) => KIND_ALIASES[x])
        if (ks.some((x) => !x)) return void rows.push([a, 'tipo de recurso desconhecido', 'warn'])
        rows.push([a, ks.length > 1 ? `vários tipos: ${a.split(',').join(', ')}` : KIND_DOCS[ks[0]!]])
        if (ks.length === 1 && ks[0] !== 'all') kind = ks[0] as KindId
        return
      }
      if (kind) nameRow(kind, a, `o ${KIND_SINGULAR[kind] ?? 'recurso'} chamado ${a}`)
      else rows.push([a, 'argumento'])
    })
  }

  switch (verb) {
    case 'get':
    case 'describe':
    case 'delete':
    case 'scale':
    case 'expose':
    case 'edit':
      positional(args)
      break
    case 'logs':
      if (args[0]) nameRow('pods', args[0].replace(/^pods?\//, ''), 'o Pod cujos logs você quer ver')
      break
    case 'label': {
      const [kind, name, ...specs] = args
      if (kind) rows.push([kind, KIND_DOCS[(KIND_ALIASES[kind] as KindId) ?? 'pods'] ?? kind])
      if (name) nameRow('pods', name, `o Pod chamado ${name}`)
      for (const sp of specs)
        rows.push([sp, sp.endsWith('-') && !sp.includes('=') ? `remove a label ${sp.slice(0, -1)}` : `define a label ${sp.split('=')[0]} com o valor ${sp.split('=')[1] ?? ''}`])
      break
    }
    case 'set': {
      const [what, target, spec] = args
      if (what) rows.push([what, what === 'image' ? 'troca a imagem do container — gera uma revisão nova e um rollout' : what === 'selector' ? 'troca o selector do Service — muda quais Pods recebem tráfego' : 'subcomando'])
      if (target) positional([target])
      if (spec) rows.push([spec, what === 'image' ? `container ${spec.split('=')[0]} passa a usar ${spec.split('=')[1] ?? ''}` : `selector novo: ${spec}`])
      break
    }
    case 'create': {
      const [kind, name] = args
      const k = kind ? KIND_ALIASES[kind] : undefined
      if (kind) rows.push([kind, k === 'deployments' || k === 'configmaps' ? KIND_DOCS[k] : 'tipo de recurso não simulado', k === 'deployments' || k === 'configmaps' ? undefined : 'warn'])
      if (name) rows.push([name, k === 'configmaps' ? 'o nome do ConfigMap novo' : 'o nome do Deployment novo'])
      break
    }
    case 'autoscale':
      positional(args)
      break
    case 'top': {
      const [what] = args
      if (what) rows.push([what, what.startsWith('no') ? 'o consumo de cada node' : 'o consumo de cada Pod, medido agora'])
      break
    }
    case 'patch': {
      const [kind, name] = args
      if (kind) rows.push([kind, KIND_DOCS.configmaps])
      if (name) nameRow('configmaps', name, `o ConfigMap chamado ${name}`)
      break
    }
    case 'run': {
      const [name, ...command] = args
      if (name) rows.push([name, 'o nome do Pod novo'])
      if (command.length) rows.push([`-- ${command.join(' ')}`, 'o comando que roda dentro do container'])
      break
    }
    case 'rollout': {
      const [action, target] = args
      const doc: Record<string, string> = { status: 'acompanha até o rollout terminar', history: 'lista as revisões', undo: 'volta para a revisão anterior', restart: 'troca todos os Pods aos poucos, sem mudar a imagem', pause: 'congela os rollouts: mudanças no template esperam', resume: 'retoma os rollouts — o que mudou durante a pausa sai de uma vez' }
      if (action) rows.push([action, doc[action] ?? 'ação desconhecida', doc[action] ? undefined : 'warn'])
      if (target) positional([target])
      break
    }
  }
  for (const [key, value] of Object.entries(flags)) {
    const typed = spelled[key] ?? `--${key}`
    const doc = FLAG_DOCS[key] as ((v: string) => string) | undefined
    rows.push([value === true ? typed : `${typed} ${value}`, doc ? doc(value === true ? '' : value) : 'flag que este terminal não conhece', doc ? undefined : 'warn'])
  }
  return { lines: table2(rows) }
}

function table2(rows: [string, string, Tone?][]): Line[] {
  const w = Math.min(34, Math.max(...rows.map(([t]) => t.length)) + 3)
  return rows.map(([t, d, tone]) => [{ t: t.length >= w ? `${t}  ` : t.padEnd(w), c: 'accent' as Tone }, { t: d, c: tone }])
}

// ── kubectl run ────────────────────────────────────────────────────────────

const DNS = /^([a-z0-9-]+)(?:\.default(?:\.svc(?:\.cluster\.local)?)?)?$/

/** What a request from inside the cluster to a Service would get: DNS → ClusterIP → kube-proxy → endpoint. */
function fromInside(sim: Simulation, command: string[], presentation: RunPresentation): Line[] {
  const [tool, ...rest] = command
  if (tool === 'nslookup') {
    const host = rest.find((a) => !a.startsWith('-')) ?? ''
    const m = host.match(DNS)
    const svc = m ? sim.findService(m[1]) : undefined
    if (!svc) return [plain('Server:\t\t10.96.0.10'), plain('Address:\t10.96.0.10:53'), [], plain(`** server can't find ${host}.default.svc.cluster.local: NXDOMAIN`, 'error')]
    return [plain('Server:\t\t10.96.0.10'), plain('Address:\t10.96.0.10:53'), [], plain(`Name:\t${svc.name}.default.svc.cluster.local`, 'strong'), plain(`Address: ${svc.clusterIP}`, 'success')]
  }
  if (tool === 'wget' || tool === 'curl') {
    const url = rest.find((a) => /^https?:\/\//.test(a) || (!a.startsWith('-') && a.includes('.')) || (!a.startsWith('-') && sim.findService(a)))
    if (!url) return [plain(`${tool}: informe uma URL — por exemplo, http://backend`, 'error')]
    const u = url.replace(/^https?:\/\//, '')
    const [hostPort, ...pathParts] = u.split('/')
    const [host, portText] = hostPort.split(':')
    const m = host.match(DNS)
    const svc = m ? sim.findService(m[1]) : Object.values(sim.cluster.services).find((s) => s.clusterIP === host)
    const fail = (why: string) => [plain(tool === 'wget' ? why : why.replace(/^wget:/, 'curl:'), 'error')]
    if (!svc) return fail(`wget: bad address '${host}'`)
    const port = portText ? Number(portText) : 80
    if (port !== svc.port) return [...fail(`wget: can't connect to remote host (${svc.clusterIP}): Connection refused`), note(`o Service ${svc.name} escuta na porta ${svc.port}, não na ${port}`)]
    if (!svc.endpoints.length)
      return [...fail(`wget: can't connect to remote host (${svc.clusterIP}): Connection refused`), note('o Service existe e o DNS resolveu, mas ele não tem endpoints — nenhum Pod Ready combina com o selector')]
    if (svc.targetPort !== 8080)
      return [...fail(`wget: can't connect to remote host (${svc.clusterIP}): Connection refused`), note(`o tráfego chegou a um Pod, mas na porta ${svc.targetPort} — o container escuta na 8080 (targetPort errado)`)]
    // kube-proxy picks an endpoint at random, per connection
    const pod = sim.cluster.pods[svc.endpoints[Math.floor(Math.random() * svc.endpoints.length)]]
    const path = '/' + pathParts.join('/')
    const code = codeProfile(pod.image, pod.env)
    if (code && code !== 'pending') return codeReply(tool, code, path, pod)
    return [
      plain(JSON.stringify({ status: 'ok', app: (presentation.appFor?.(pod.image, pod.uid) ?? presentation.app)?.name, message: (presentation.appFor?.(pod.image, pod.uid) ?? presentation.app)?.message, path, servedBy: pod.name, version: tag(pod.image) }), 'success'),
      [{ t: '# atendido por ', c: 'muted' }, { t: pod.name, c: 'muted', ref: pod.uid }, { t: ' — rode de novo e o kube-proxy pode escolher outro Pod', c: 'muted' }],
    ]
  }
  return [plain(`${tool ?? 'sh'}: este terminal não abre shells interativos dentro de Pods.`, 'warn'), note('dá para rodar wget, curl ou nslookup — ex.: -- wget -qO- http://backend')]
}

const REASONS: Record<number, string> = { 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' }

/** What the learner's code answered, as wget/curl would show it. */
function codeReply(tool: string, code: Profile, path: string, pod: Pod): Line[] {
  const servedBy: Line = [{ t: '# atendido por ', c: 'muted' }, { t: pod.name, c: 'muted', ref: pod.uid }, { t: ' — o seu código respondeu', c: 'muted' }]
  const reply = code.replies[path]
  if (!reply) return [plain(`${tool}: este terminal só conhece o que o seu código respondeu para / e /healthz`, 'warn'), note('são os caminhos que os visitantes e as probes pedem — teste com http://<service>/'), servedBy]
  if ('timedOut' in reply) return [plain(`${tool}: download timed out`, 'error'), note(`handle() não respondeu a ${path} a tempo`), servedBy]
  if ('error' in reply)
    return [plain(`${tool === 'wget' ? 'wget: server returned error: ' : ''}HTTP/1.1 500 Internal Server Error`, 'error'), note(`handle() lançou um erro em ${path}: ${reply.error}`), servedBy]
  const ok = reply.status >= 200 && reply.status < 400
  const body = reply.body.split('\n').map((l) => plain(l, ok ? 'success' : undefined))
  // wget stops at an error status; curl prints whatever came back
  if (!ok && tool === 'wget') return [plain(`wget: server returned error: HTTP/1.1 ${reply.status} ${REASONS[reply.status] ?? ''}`.trimEnd(), 'error'), servedBy]
  return [...(reply.body ? body : [note(`resposta vazia (HTTP ${reply.status})`)]), servedBy]
}

function runPod(sim: Simulation, args: string[], flags: Flags, presentation: RunPresentation): CommandResult {
  const [name, ...command] = args
  if (!name) return err('error: NAME is required for run')
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)) return err(`The Pod "${name}" is invalid: metadata.name: Invalid value: "${name}": a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-'`)
  if (typeof flags.image !== 'string') return err('error: required flag(s) "image" not set')
  const interactive = flags.it === true || (flags.i === true && flags.t === true) || flags.i === true
  if (flags.rm && !interactive) return err('error: --rm should only be used for attached containers')
  // a request loop (the HPA walkthrough's load generator): keeps a Service busy while the Pod runs
  const loop = command.join(' ').match(/\bwhile\b.*\b(?:wget|curl)\b.*?(?:https?:\/\/)?([a-z0-9-]+)(?:\.default(?:\.svc(?:\.cluster\.local)?)?)?(?::\d+)?\/?\s*;?\s*done/)
  if (loop && interactive)
    return {
      lines: [
        plain('Esse loop não termina sozinho: no kubectl real, ele prende o terminal até o Ctrl+C.', 'warn'),
        note('aqui, rode o gerador sem -it e apague o Pod quando quiser parar:'),
        plain(`kubectl run ${name} --image=${flags.image} --restart=Never -- /bin/sh -c "while sleep 0.01; do wget -q -O- http://${loop[1]}; done"`, 'accent'),
      ],
    }
  if (command.length && !interactive && !loop)
    return { lines: [plain('Sem -it o comando rodaria em segundo plano; aqui ele só é simulado com --rm -it — ou como gerador de carga (while … wget … done).', 'warn')] }
  if (interactive) {
    if (!command.length) return { lines: [plain('Este terminal não abre shells interativos dentro de Pods.', 'warn'), note('passe um comando depois de --, ex.: -- wget -qO- http://backend')] }
    const out = fromInside(sim, command, presentation)
    return { lines: [...out, ...(flags.rm ? [plain(`pod "${name}" deleted`, 'muted')] : [note('sem --rm, o Pod ficaria no cluster depois do comando')])] }
  }
  let labels: Labels = { run: name }
  if (typeof flags.labels === 'string') {
    const parsed = parseLabels([flags.labels])
    if (!parsed || Object.values(parsed).some((v) => v === null)) return err(`error: invalid label spec: ${flags.labels}`)
    labels = parsed as Labels
  }
  const r = sim.runPod(name, flags.image, labels, loop?.[1])
  if (r === 'exists') return err(`Error from server (AlreadyExists): pods "${name}" already exists`)
  return { ...ok(`pod/${name} created`, sim.findPod(name)?.uid), ...(loop && { lines: [plain(`pod/${name} created`, 'success'), note(`enquanto ${name} rodar, ele manda um fluxo de requisições para ${loop[1]} — apague o Pod para parar`)] }) }
}

// ── ConfigMaps ─────────────────────────────────────────────────────────────

const ENV_KEY = /^[-._a-zA-Z0-9]+$/

/** `--from-literal` can repeat, so it's read from the raw tokens rather than the flag map. */
function literals(tokens: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.startsWith('--from-literal=')) out.push(t.slice('--from-literal='.length))
    else if (t === '--from-literal' && tokens[i + 1] !== undefined) out.push(tokens[++i])
  }
  return out
}

function createConfigMap(sim: Simulation, name: string | undefined, tokens: string[]): CommandResult {
  if (!name) return err('error: exactly one NAME is required, got 0')
  if (!/^[a-z0-9]([-.a-z0-9]*[a-z0-9])?$/.test(name)) return err(`The ConfigMap "${name}" is invalid: metadata.name: Invalid value: "${name}"`)
  const data: Record<string, string> = {}
  for (const lit of literals(tokens)) {
    const eq = lit.indexOf('=')
    if (eq <= 0) return err(`error: invalid literal source ${lit}, expected key=value`)
    const key = lit.slice(0, eq)
    if (!ENV_KEY.test(key)) return err(`error: "${key}" is not a valid key name for a ConfigMap`)
    if (key in data) return err(`error: cannot add key "${key}", another key by that name already exists in Data for ConfigMap "${name}"`)
    data[key] = lit.slice(eq + 1)
  }
  if (sim.findConfigMap(name)) return err(`error: failed to create configmap: configmaps "${name}" already exists`)
  sim.putConfigMap(name, data, 'create')
  return ok(`configmap/${name} created`, sim.findConfigMap(name)?.uid)
}

function patch(sim: Simulation, args: string[], flags: Flags): CommandResult {
  const [kind, names] = splitKind(args)
  if (!kind || !names[0]) return err('error: You must provide one or more resources by argument or filename.')
  if (KIND_ALIASES[kind] !== 'configmaps') return { lines: [plain('Neste playground, kubectl patch funciona com ConfigMaps. Para Deployments, use set image, scale ou edit.', 'warn')] }
  if (typeof flags.patch !== 'string') return err('error: must specify -p to patch')
  if (typeof flags.type === 'string' && !['merge', 'strategic'].includes(flags.type))
    return { lines: [plain(`--type ${flags.type} existe no kubectl real, mas aqui só há merge.`, 'warn')] }
  const cm = sim.findConfigMap(names[0])
  if (!cm) return err(`Error from server (NotFound): configmaps "${names[0]}" not found`)
  let body: unknown
  try {
    body = JSON.parse(flags.patch)
  } catch {
    return err(`error: unable to parse "${flags.patch}": yaml: did not find expected node content`)
  }
  const patchData = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).data : undefined
  if (!patchData || typeof patchData !== 'object' || Array.isArray(patchData)) return err('error: aqui o patch precisa mudar .data, ex.: {"data":{"CHAVE":"valor"}}')
  const data = { ...cm.data }
  for (const [k, v] of Object.entries(patchData as Record<string, unknown>)) {
    if (!ENV_KEY.test(k)) return err(`The ConfigMap "${cm.name}" is invalid: data[${k}]: Invalid value`)
    // merge patch: null removes the key
    if (v === null) delete data[k]
    else if (typeof v === 'string') data[k] = v
    else return err(`error: data.${k} must be a string`)
  }
  const r = sim.putConfigMap(cm.name, data, 'patch')
  return { lines: [plain(`configmap/${cm.name} ${r === 'unchanged' ? 'patched (no change)' : 'patched'}`, r === 'unchanged' ? 'muted' : 'success')], focusUid: cm.uid }
}

// ── autoscaling ────────────────────────────────────────────────────────────

function autoscale(sim: Simulation, args: string[], flags: Flags): CommandResult {
  const [kind, names] = splitKind(args)
  if (!kind || KIND_ALIASES[kind] !== 'deployments' || !names[0]) return err('Usage: kubectl autoscale deployment <name> --cpu=50% --min=2 --max=8')
  const raw = typeof flags.cpu === 'string' ? flags.cpu : typeof flags['cpu-percent'] === 'string' ? `${flags['cpu-percent']}%` : undefined
  if (raw === undefined) return { lines: [plain('Diga a meta de CPU: --cpu=50% (média de uso como porcentagem das requests).', 'warn')] }
  if (!/^\d+%$/.test(raw)) return { lines: [plain(`--cpu=${raw}: aqui só metas em porcentagem (ex.: --cpu=50%). O kubectl real também aceita valores absolutos, como 500m.`, 'warn')] }
  const cpu = Number(raw.slice(0, -1))
  const max = Number(flags.max)
  const min = flags.min === undefined ? 1 : Number(flags.min)
  if (flags.max === undefined) return err('error: --max=MAXPODS is required and must be at least 1')
  if (!Number.isInteger(max) || max < 1) return err(`error: invalid argument "${flags.max}" for "--max" flag`)
  if (!Number.isInteger(min) || min < 1 || min > max) return err('error: --min must be between 1 and --max')
  if (cpu < 1 || cpu > 100) return err('error: --cpu must be a percentage between 1% and 100%')
  if (max > 8) return err('Este cluster de treino é pequeno — use --max de no máximo 8.')
  const r = sim.autoscale(names[0], min, max, cpu)
  if (r === 'notfound') return err(`Error from server (NotFound): deployments.apps "${names[0]}" not found`)
  if (r === 'exists') return err(`Error from server (AlreadyExists): horizontalpodautoscalers.autoscaling "${names[0]}" already exists`)
  return ok(`horizontalpodautoscaler.autoscaling/${names[0]} autoscaled`, sim.findHpa(names[0])?.uid)
}

/** Memory isn't modeled: a plausible, stable number per Pod. */
const mem = (p: Pod) => 24 + (p.uid.length % 7) + p.restarts * 3

function top(sim: Simulation, args: string[]): CommandResult {
  const [rawKind, ...names] = args
  const kind = rawKind ? KIND_ALIASES[rawKind] : undefined
  if (kind === 'nodes') {
    return {
      lines: table(
        ['NAME', 'CPU(cores)', 'CPU(%)', 'MEMORY(bytes)', 'MEMORY(%)'],
        sim.cluster.nodes.map((n) => {
          const pods = Object.values(sim.cluster.pods).filter((p) => p.nodeName === n.name && p.deletedAt === null)
          const cpu = 80 + pods.reduce((t, p) => t + sim.podCpu(p), 0)
          const memory = 600 + pods.reduce((t, p) => t + mem(p), 0)
          return [{ t: n.name, c: 'strong' as Tone }, { t: `${cpu}m` }, { t: `${Math.round((cpu / NODE_CPU) * 100)}%`, c: cpu > NODE_CPU * 0.8 ? ('warn' as Tone) : undefined }, { t: `${memory}Mi` }, { t: `${Math.round((memory / 4096) * 100)}%` }]
        }),
      ),
    }
  }
  if (kind !== 'pods') return err('Usage: kubectl top pods | kubectl top nodes')
  let pods = Object.values(sim.cluster.pods).filter((p) => p.phase === 'Running' && p.deletedAt === null)
  if (names.length) pods = pods.filter((p) => names.includes(p.name))
  if (!pods.length) return { lines: [plain(names.length ? `Error from server (NotFound): podmetrics.metrics.k8s.io "default/${names[0]}" not found` : 'No resources found in default namespace.', names.length ? 'error' : 'muted')] }
  const rows = pods.map((p) => {
    const cpu = sim.podCpu(p)
    const req = p.resources?.cpuRequest
    return [
      { t: p.name, c: 'strong' as Tone, ref: p.uid },
      { t: `${cpu}m`, c: sim.isThrottled(p) ? ('error' as Tone) : req && cpu > req ? ('warn' as Tone) : undefined },
      { t: `${mem(p)}Mi` },
    ]
  })
  const throttled = pods.filter((p) => sim.isThrottled(p))
  return {
    lines: [
      ...table(['NAME', 'CPU(cores)', 'MEMORY(bytes)'], rows),
      ...(throttled.length ? [note(`${throttled.length} Pod${throttled.length === 1 ? '' : 's'} no limite de CPU: o kernel está estrangulando (throttling) — ficam mais lentos`)] : []),
    ],
  }
}

// ── Secrets ────────────────────────────────────────────────────────────────

function createSecret(sim: Simulation, names: string[], tokens: string[]): CommandResult {
  const [type, name] = names
  if (type !== 'generic') {
    if (type === 'tls' || type === 'docker-registry')
      return { lines: [plain(`kubectl create secret ${type} existe no kubectl real, mas aqui só simulamos secret generic.`, 'warn')] }
    return err('Usage: kubectl create secret generic <nome> --from-literal=CHAVE=valor')
  }
  if (!name) return err('error: exactly one NAME is required, got 0')
  if (!/^[a-z0-9]([-.a-z0-9]*[a-z0-9])?$/.test(name)) return err(`The Secret "${name}" is invalid: metadata.name: Invalid value: "${name}"`)
  const data: Record<string, string> = {}
  for (const lit of literals(tokens)) {
    const eq = lit.indexOf('=')
    if (eq <= 0) return err(`error: invalid literal source ${lit}, expected key=value`)
    const key = lit.slice(0, eq)
    if (!ENV_KEY.test(key)) return err(`error: "${key}" is not a valid key name for a Secret`)
    data[key] = lit.slice(eq + 1)
  }
  if (sim.createSecret(name, data) === 'exists') return err(`error: failed to create secret secrets "${name}" already exists`)
  return ok(`secret/${name} created`, sim.findSecret(name)?.uid)
}

/** The JSONPath subset people actually type: `{.a.b}`, `{.items[0].x}`, `{.items[*].metadata.name}`, literal text around. */
function renderJsonPath(value: Json, template: string): { text: string } | { error: string } {
  const evalPath = (root: Json, path: string): Json[] => {
    const parts = path.replace(/^\./, '').split(/\.|\[([^\]]*)\]/).filter((p) => p !== undefined && p !== '')
    let current: Json[] = [root]
    for (const part of parts) {
      current = current.flatMap((v): Json[] => {
        if (v === null || typeof v !== 'object') return []
        if (part === '*') return Array.isArray(v) ? v : Object.values(v)
        if (Array.isArray(v)) return /^\d+$/.test(part) && v[Number(part)] !== undefined ? [v[Number(part)]] : []
        return part in v ? [v[part]] : []
      })
    }
    return current
  }
  let out = ''
  let rest = template
  while (rest.length) {
    const open = rest.indexOf('{')
    if (open < 0) {
      out += rest
      break
    }
    out += rest.slice(0, open)
    const close = rest.indexOf('}', open)
    if (close < 0) return { error: `error: error parsing jsonpath ${template}, unclosed action` }
    const expr = rest.slice(open + 1, close).trim()
    if (!expr.startsWith('.')) return { error: `error: aqui o -o jsonpath entende caminhos como {.data.CHAVE} ou {.items[*].metadata.name}` }
    out += evalPath(value, expr)
      .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
      .join(' ')
    rest = rest.slice(close + 1)
  }
  return { text: out.replace(/\\n/g, '\n') }
}

// ── nodes ──────────────────────────────────────────────────────────────────

function cordon(sim: Simulation, args: string[], on: boolean): CommandResult {
  const name = args[0]?.replace(/^nodes?\//, '')
  if (!name) return err(`error: USAGE: ${on ? 'cordon' : 'uncordon'} NODE [flags]`)
  const r = sim.setSchedulable(name, !on)
  if (r === 'notfound') return err(`Error from server (NotFound): nodes "${name}" not found`)
  const verb = on ? 'cordoned' : 'uncordoned'
  return { lines: [plain(`node/${name} ${r === 'unchanged' ? `already ${verb}` : verb}`, r === 'unchanged' ? 'muted' : 'success')] }
}

function drain(sim: Simulation, args: string[], flags: Flags): CommandResult {
  const name = args[0]?.replace(/^nodes?\//, '')
  if (!name) return err('error: USAGE: drain NODE [flags]')
  const r = sim.drain(name, { ignoreDaemonsets: flags['ignore-daemonsets'] === true, force: flags.force === true })
  if (r.result === 'notfound') return err(`Error from server (NotFound): nodes "${name}" not found`)
  const lines: Line[] = [plain(`node/${name} ${r.cordoned ? 'cordoned' : 'already cordoned'}`, 'success')]
  const list = (pods: Pod[]) => pods.map((p) => `default/${p.name}`).join(', ')
  if (r.result === 'blocked') {
    const reasons = [
      ...(r.daemons.length && !flags['ignore-daemonsets'] ? [`cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore): ${list(r.daemons)}`] : []),
      ...(r.unmanaged.length && !flags.force ? [`cannot delete Pods that declare no controller (use --force to override): ${list(r.unmanaged)}`] : []),
    ]
    return {
      lines: [
        ...lines,
        plain(`error: unable to drain node "${name}" due to error: ${reasons.join(', ')}, continuing command...`, 'error'),
        plain('There are pending nodes to be drained:', 'muted'),
        plain(` ${name}`, 'muted'),
        ...reasons.map((x) => plain(x, 'error')),
        note(`o node já ficou fora da escala (cordon) — nada novo vai para lá, mas ninguém saiu ainda`),
      ],
    }
  }
  if (r.daemons.length) lines.push(plain(`Warning: ignoring DaemonSet-managed Pods: ${list(r.daemons)}`, 'warn'))
  for (const p of r.evicted) lines.push(plain(`evicting pod default/${p.name}`, 'muted'))
  for (const p of r.evicted) lines.push([{ t: 'pod/' }, { t: p.name, ref: p.uid }, { t: ' evicted' }])
  lines.push(plain(`node/${name} drained`, 'success'))
  return { lines }
}
