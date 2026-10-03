import { beforeEach, describe, expect, it } from 'vitest'
import { parseArgs, parseSelector, selects, suggest, tokenize } from '../cli/args'
import { toYaml } from '../cli/objects'
import { Simulation } from '../engine'
import { complete, IMAGE, run, watchRows } from '../kubectl'
import { settle } from './helpers'

const text = (r: ReturnType<typeof run>) => r.lines.map((l) => l.map((s) => s.t).join('')).join('\n')
const out = (sim: Simulation, cmd: string) => text(run(sim, cmd))

function cluster() {
  const sim = new Simulation()
  sim.files.push('service.yaml')
  run(sim, 'kubectl apply -f backend.yaml')
  run(sim, 'kubectl apply -f service.yaml')
  settle(sim)
  return sim
}

describe('parsing', () => {
  it('splits like a shell: quotes group, pipes separate', () => {
    expect(tokenize(`k get pods -l 'app in (a, b)' | grep x`).stages).toEqual([['k', 'get', 'pods', '-l', 'app in (a, b)'], ['grep', 'x']])
    expect(tokenize(`k get "pods`).error).toBeTruthy()
  })

  it('takes flag values in every form kubectl accepts', () => {
    expect(parseArgs(['--replicas', '3']).flags.replicas).toBe('3')
    expect(parseArgs(['--replicas=3']).flags.replicas).toBe('3')
    expect(parseArgs(['-owide']).flags.o).toBe('wide')
    expect(parseArgs(['--output', 'yaml']).flags.o).toBe('yaml')
    expect(parseArgs(['--selector=app=x']).flags.l).toBe('app=x')
    expect(parseArgs(['-L', 'app']).flags.L).toBe('app')
    expect(parseArgs(['-f'], 'logs').flags.follow).toBe(true)
  })

  it('understands every selector form', () => {
    const labels = { app: 'backend', tier: 'api' }
    const ok = (s: string) => {
      const r = parseSelector(s)
      if ('error' in r) throw new Error(r.error)
      return selects(r, labels)
    }
    expect(ok('app=backend')).toBe(true)
    expect(ok('app==backend,tier=api')).toBe(true)
    expect(ok('app!=backend')).toBe(false)
    expect(ok('app in (frontend, backend)')).toBe(true)
    expect(ok('app notin (backend)')).toBe(false)
    expect(ok('tier')).toBe(true)
    expect(ok('!tier')).toBe(false)
    expect(parseSelector('app=')).not.toHaveProperty('error')
    expect(parseSelector('=x')).toHaveProperty('error')
  })

  it('suggests close words only', () => {
    expect(suggest('gte', ['get', 'set', 'describe'])[0]).toBe('get')
    expect(suggest('pdos', ['pods', 'po'])).toContain('pods')
    expect(suggest('frobnicate', ['get', 'set'])).toEqual([])
  })

  it('prints YAML like kubectl: sorted keys, list items at the parent indentation', () => {
    expect(toYaml({ b: 1, a: { list: [{ y: 'v', x: 'True' }], empty: {} } })).toEqual(['a:', '  empty: {}', '  list:', '  - x: "True"', '    y: v', 'b: 1'])
  })
})

describe('kubectl get', () => {
  let sim: Simulation
  beforeEach(() => (sim = cluster()))

  it('adds label columns with -L (taught in the labels workbook)', () => {
    const o = out(sim, 'kubectl get pods -L app')
    expect(o.split('\n')[0]).toMatch(/AGE\s+APP$/)
    expect(o).toMatch(/backend\s*$/m)
  })

  it('lists EndpointSlices by service name (taught in the debugging workbook)', () => {
    const o = out(sim, 'kubectl get endpointslices -l kubernetes.io/service-name=backend')
    expect(o).toMatch(/^NAME\s+ADDRESSTYPE\s+PORTS\s+ENDPOINTS\s+AGE/)
    expect(o).toMatch(/^backend-\w{5}\s+IPv4\s+8080\s+10\./m)
  })

  it('warns that v1 Endpoints is deprecated', () => {
    expect(out(sim, 'kubectl get endpoints')).toContain('Warning: v1 Endpoints is deprecated')
  })

  it('filters every kind by name and by label, and says why Deployments match nothing', () => {
    expect(out(sim, 'kubectl get svc nope')).toContain('services "nope" not found')
    expect(out(sim, 'kubectl get deploy backend')).toMatch(/^backend\s+3\/3/m)
    const o = out(sim, 'kubectl get deploy -l app=backend')
    expect(o).toContain('No resources found')
    expect(o).toContain('template dos Pods')
    expect(out(sim, 'kubectl get rs -l app=backend')).toMatch(/^backend-/m)
    expect(out(sim, 'kubectl get pods -l app!=backend')).toContain('No resources found')
    expect(out(sim, 'kubectl get pods -l "app in (backend,api)"').match(/Running/g)).toHaveLength(3)
  })

  it('prints several kinds with kind-qualified names', () => {
    const o = out(sim, 'kubectl get po,svc')
    expect(o).toMatch(/^pod\/backend-/m)
    expect(o).toMatch(/^service\/backend/m)
  })

  it('outputs YAML with the owner chain, JSON that parses, and names', () => {
    const pod = Object.values(sim.cluster.pods)[0]
    const yaml = out(sim, `kubectl get pod ${pod.name} -o yaml`)
    expect(yaml).toMatch(/^apiVersion: v1$/m)
    expect(yaml).toMatch(/^ {2}ownerReferences:\n {2}- apiVersion: apps\/v1$/m)
    expect(yaml).toMatch(/^ {4}kind: ReplicaSet$/m)
    expect(yaml).toMatch(/^ {2}phase: Running$/m)
    const json = JSON.parse(out(sim, 'kubectl get deploy -o json'))
    expect(json.kind).toBe('List')
    expect(json.items[0].spec.template.metadata.labels).toEqual({ app: 'backend' })
    expect(out(sim, 'kubectl get svc -o name')).toBe('service/backend')
    expect(out(sim, 'kubectl get pods -o jsonpath={.items}')).toContain('existe no kubectl real')
    expect(out(sim, 'kubectl get pods -o bogus')).toContain('unable to match a printer')
  })

  it('supports field selectors, sorting and headless output', () => {
    expect(out(sim, 'kubectl get pods --field-selector status.phase=Running').match(/Running/g)).toHaveLength(3)
    expect(out(sim, 'kubectl get pods --field-selector status.phase!=Running')).toContain('No resources found')
    expect(out(sim, 'kubectl get pods --field-selector spec.foo=x')).toContain('field label not supported')
    const sorted = out(sim, 'kubectl get pods --sort-by=.metadata.name --no-headers').split('\n').map((l) => l.split(/\s+/)[0])
    expect(sorted).toEqual([...sorted].sort())
    expect(sorted[0]).not.toBe('NAME')
  })

  it('is honest about namespaces', () => {
    expect(out(sim, 'kubectl get pods -n kube-system')).toContain('No resources found in kube-system namespace.')
    expect(out(sim, 'kubectl get pods -n default')).toMatch(/Running/)
    const all = out(sim, 'kubectl get pods -A')
    expect(all.split('\n')[0]).toMatch(/^NAMESPACE\s+NAME/)
    expect(all).toContain('só simula o namespace default')
    expect(out(sim, 'kubectl delete pod x -n prod')).toContain('namespaces "prod" not found')
  })

  it('watches every simulated resource kind and keeps table options', () => {
    for (const kind of ['pods', 'deployments', 'replicasets', 'services', 'endpoints', 'endpointslices', 'events', 'nodes']) {
      expect(run(sim, `kubectl get ${kind} -w`).watch?.kind).toBe(kind)
    }
    const watch = run(sim, 'kubectl get deployments backend -o wide --no-headers -w').watch!
    const before = watchRows(sim, watch)
    expect(before).toHaveLength(1)
    expect(before[0].line.map((s) => s.t).join('')).toContain('ghcr.io/kubelearn/backend:1.4')
    sim.scale('backend', 5)
    const after = watchRows(sim, watch)
    expect(after[0].signature).not.toBe(before[0].signature)

    const serviceWatch = run(sim, 'kubectl get service backend -w').watch!
    const serviceBefore = watchRows(sim, serviceWatch)[0]
    sim.setSelector('backend', { app: 'other' })
    expect(watchRows(sim, serviceWatch)[0].signature).not.toBe(serviceBefore.signature)

    const eventWatch = run(sim, 'kubectl get events -w').watch!
    const eventKeys = watchRows(sim, eventWatch).map((row) => row.key)
    sim.scale('backend', 4)
    settle(sim, 1000)
    expect(watchRows(sim, eventWatch).map((row) => row.key)).not.toEqual(eventKeys)

    const empty = new Simulation()
    const emptyEndpoints = run(empty, 'kubectl get endpoints -w')
    expect(text(emptyEndpoints)).toMatch(/Warning:.*\nNAME\s+ENDPOINTS\s+AGE/)
    expect(run(sim, 'kubectl get pods,services -w').watch).toBeUndefined()
    expect(out(sim, 'kubectl get pods,services -w')).toContain('-w acompanha um tipo')
    expect(out(sim, 'kubectl get deployments -o yaml -w')).toContain('-w acompanha apenas saídas em tabela')
  })
})

describe('flags', () => {
  let sim: Simulation
  beforeEach(() => (sim = cluster()))

  it('rejects unknown flags like kubectl', () => {
    expect(out(sim, 'kubectl get pods --frob')).toContain('error: unknown flag: --frob')
    expect(out(sim, 'kubectl get pods -z')).toContain("unknown shorthand flag: 'z' in -z")
  })

  it('never half-runs a command with a flag it does not simulate', () => {
    const o = out(sim, 'kubectl scale deployment backend --replicas=5 --dry-run=client')
    expect(o).toContain('não foi executado')
    expect(sim.findDeployment('backend')!.replicas).toBe(3)
  })

  it('asks for missing flag values', () => {
    expect(out(sim, 'kubectl get pods -l')).toContain("flag needs an argument: 'l' in -l")
  })

  it('accepts space-separated values', () => {
    expect(out(sim, 'kubectl scale deployment backend --replicas 2')).toContain('scaled')
    expect(sim.findDeployment('backend')!.replicas).toBe(2)
  })

  it('explains each command with --help', () => {
    expect(out(sim, 'kubectl get --help')).toContain('Uso:')
    expect(out(sim, 'kubectl logs -h')).toContain('--previous')
  })
})

describe('commands', () => {
  let sim: Simulation
  beforeEach(() => (sim = cluster()))

  it('suggests the verb you meant', () => {
    const o = out(sim, 'kubectl gte pods')
    expect(o).toContain('error: unknown command "gte" for "kubectl"')
    expect(o).toMatch(/Did you mean this\?\n\tget/)
    expect(out(sim, 'kubeclt get pods')).toContain('Você quis dizer kubectl?')
    expect(out(sim, 'kubectl get pdos')).toContain('você quis dizer "pods"?')
  })

  it('says real-but-unsimulated commands and kinds exist', () => {
    expect(out(sim, 'kubectl exec -it x -- sh')).toContain('existe no kubectl real')
    expect(out(sim, 'kubectl get configmaps')).toContain('existe no Kubernetes real')
    expect(out(sim, 'kubectl set env deployment/backend A=b')).toContain('ainda não é simulado')
  })

  it('opens a Deployment in the editor', () => {
    expect(run(sim, 'kubectl edit deployment/backend').edit).toEqual({ kind: 'deployment', name: 'backend' })
    expect(out(sim, 'kubectl edit deployment/nope')).toContain('deployments.apps "nope" not found')
    expect(out(sim, 'kubectl edit service/backend')).toContain('Usage: kubectl edit deployment')
  })

  it('creates another Deployment from arguments', () => {
    expect(out(sim, 'kubectl create deployment worker --image=busybox:1.36')).toBe('deployment.apps/worker created')
    const worker = sim.findDeployment('worker')!
    expect(worker.replicas).toBe(1)
    expect(worker.selector).toEqual({ app: 'worker' })
    expect(worker.template.labels).toEqual({ app: 'worker' })
    settle(sim)
    expect(sim.deploymentPods(worker).filter((pod) => pod.ready)).toHaveLength(1)
    expect(out(sim, 'kubectl create deployment worker --image=busybox')).toContain('AlreadyExists')
    expect(out(sim, 'kubectl create deployment jobs --image=busybox --replicas=2')).toContain('deployment.apps/jobs created')
    expect(sim.findDeployment('jobs')?.replicas).toBe(2)
    expect(out(sim, 'kubectl create deployment Missing --image=busybox')).toContain('metadata.name: Invalid value')
    expect(out(sim, 'kubectl create deployment no-image')).toContain('required flag(s) "image" not set')
  })

  it('shows the learner app in a request made from inside the cluster', () => {
    const result = text(run(sim, 'kubectl run test --rm -it --image=busybox -- wget -qO- http://backend', { app: { name: 'Café Lunar', message: 'Aberto no cluster' } }))
    expect(result).toContain('"app":"Café Lunar"')
    expect(result).toContain('"message":"Aberto no cluster"')
  })

  it('pipes through grep, wc, head', () => {
    expect(out(sim, 'kubectl get pods | grep Running | wc -l')).toBe('3')
    expect(out(sim, 'kubectl get pods | grep -c NAME')).toBe('1')
    expect(out(sim, 'kubectl get pods | head -n 2').split('\n')).toHaveLength(2)
    expect(out(sim, 'kubectl get pods -o yaml | grep -c "kind: Pod"')).toBe('3')
    expect(out(sim, 'kubectl get pods | awk x')).toContain('só entende grep')
  })

  it('describes everything of a kind when no name is given', () => {
    expect(out(sim, 'kubectl describe pods').match(/^Name:/gm)).toHaveLength(3)
    expect(out(sim, 'kubectl describe node node-1')).toContain('Non-terminated Pods')
  })

  it('shows the crashed container with logs --previous (taught in the failures workbook)', () => {
    const pod = Object.values(sim.cluster.pods)[0].name
    expect(out(sim, `kubectl logs ${pod} --previous`)).toContain('previous terminated container "backend"')
    sim.setImage('backend', 'backend', 'ghcr.io/kubelearn/backend:1.5')
    settle(sim, 20000)
    const crashing = Object.values(sim.cluster.pods).find((p) => p.restarts > 0)!
    expect(out(sim, `kubectl logs ${crashing.name} -p`)).toContain('DATABASE_URL')
    expect(out(sim, `kubectl logs ${crashing.name} --previous --tail=1`)).toBe('exit status 2')
  })

  it('rolls back to a chosen revision', () => {
    sim.setImage('backend', 'backend', 'ghcr.io/kubelearn/backend:1.5')
    settle(sim, 4000)
    expect(out(sim, 'kubectl rollout undo deployment/backend --to-revision=9')).toContain('unable to find specified revision 9')
    expect(out(sim, 'kubectl rollout undo deployment/backend --to-revision=2')).toContain('skipped rollback')
    expect(out(sim, 'kubectl rollout undo deployment/backend --to-revision=1')).toContain('rolled back')
    expect(sim.findDeployment('backend')!.template.image).toMatch(/:1\.4$/)
  })
})

describe('tab completion', () => {
  let sim: Simulation
  beforeEach(() => (sim = cluster()))
  const tab = (input: string) => complete(sim, input)

  it('completes by position: command, verb, kind, name', () => {
    expect(tab('kub').value).toBe('kubectl ')
    expect(tab('kubectl desc').value).toBe('kubectl describe ')
    expect(tab('kubectl get endpo').value).toBe('kubectl get endpoints')
    expect(tab('kubectl get endpo').candidates).toEqual(['endpoints', 'endpointslices'])
    expect(tab('kubectl describe svc b').value).toBe('kubectl describe svc backend ')
    expect(tab('kubectl scale deploy b').value).toBe('kubectl scale deploy backend ')
    expect(tab('kubectl rollout undo d').value).toBe('kubectl rollout undo deployment/backend ')
    expect(tab('kubectl edit deployment/b').value).toBe('kubectl edit deployment/backend ')
    expect(tab('kubectl create dep').value).toBe('kubectl create deployment ')
  })

  it('completes names in kind/name form and pod names for logs', () => {
    expect(tab('kubectl get svc/b').value).toBe('kubectl get svc/backend ')
    expect(tab('kubectl logs b').candidates).toHaveLength(3)
  })

  it('completes flags of the verb, and their values', () => {
    expect(tab('kubectl get pods --show').value).toBe('kubectl get pods --show-labels ')
    expect(tab('kubectl get pods -o y').value).toBe('kubectl get pods -o yaml ')
    expect(tab('kubectl get pods --output=j').value).toBe('kubectl get pods --output=json ')
    expect(tab('kubectl get pods -l app=b').value).toBe('kubectl get pods -l app=backend ')
    expect(tab('kubectl scale deploy backend --rep').value).toBe('kubectl scale deploy backend --replicas=')
    expect(tab('kubectl logs x --prev').value).toBe('kubectl logs x --previous ')
    expect(tab('kubectl apply -f ').candidates).toEqual(['backend.yaml', 'service.yaml'])
    expect(tab('kubectl apply -f s').value).toBe('kubectl apply -f service.yaml ')
  })

  it('offers images and labels where they fit', () => {
    expect(tab('kubectl set image deployment/backend backend=').candidates.some((c) => c.endsWith(':1.5'))).toBe(true)
    const pod = Object.values(sim.cluster.pods)[0].name
    expect(tab(`kubectl label pod ${pod} ap`).candidates).toEqual(['app=backend', 'app-'])
  })
})

describe('explicar', () => {
  it('breaks a command into parts, in Portuguese, and checks the names', () => {
    const sim = cluster()
    const o = out(sim, 'explicar kubectl get pods -l app=backend -o wide')
    expect(o).toMatch(/^kubectl\s+a ferramenta que conversa com a API/m)
    expect(o).toMatch(/^pods\s+Pods — os containers rodando/m)
    expect(o).toMatch(/^-l app=backend\s+selector: só o que tiver app igual a backend/m)
    expect(o).toMatch(/^-o wide\s+formato: a tabela com colunas extras/m)
    expect(out(sim, 'explicar kubectl delete pod ghost')).toContain('não existe nenhum com esse nome agora')
    expect(out(sim, 'explicar k scale deploy backend --replicas 2')).toContain('quantidade desejada: 2 réplicas')
    expect(out(sim, 'explicar kubectl logs x --previous')).toContain('motivo do crash')
  })
})

describe('cascading deletion', () => {
  it('deleting a Deployment takes its ReplicaSets and Pods with it', () => {
    const sim = cluster()
    expect(out(sim, 'kubectl delete deployment backend')).toBe('deployment.apps "backend" deleted')
    expect(sim.findDeployment('backend')).toBeUndefined()
    settle(sim, 1500)
    expect(Object.values(sim.cluster.replicaSets).every((rs) => rs.deletedAt)).toBe(true)
    settle(sim, 8000)
    expect(Object.keys(sim.cluster.replicaSets)).toHaveLength(0)
    expect(Object.keys(sim.cluster.pods)).toHaveLength(0)
    expect(sim.events.some((e) => e.source === 'garbage-collector')).toBe(true)
    // nothing comes back
    settle(sim, 8000)
    expect(Object.keys(sim.cluster.pods)).toHaveLength(0)
  })

  it('deleting an owned ReplicaSet: its Pods go, and the Deployment makes a new one', () => {
    const sim = cluster()
    const old = Object.values(sim.cluster.replicaSets)[0]
    const oldPods = Object.keys(sim.cluster.pods)
    expect(out(sim, `kubectl delete rs ${old.name}`)).toBe(`replicaset.apps "${old.name}" deleted`)
    settle(sim, 15000)
    const rss = Object.values(sim.cluster.replicaSets)
    expect(rss).toHaveLength(1)
    expect(rss[0].uid).not.toBe(old.uid)
    const pods = Object.values(sim.cluster.pods)
    expect(pods.filter((p) => p.ready)).toHaveLength(3)
    expect(pods.some((p) => oldPods.includes(p.uid))).toBe(false)
  })

  it('says NotFound for missing ones', () => {
    expect(out(cluster(), 'kubectl delete deploy nope')).toContain('deployments.apps "nope" not found')
  })
})

describe('rollout restart, pause and resume', () => {
  it('restart replaces every Pod with a new ReplicaSet, same image — and undo goes back', () => {
    const sim = cluster()
    const before = Object.keys(sim.cluster.pods)
    expect(out(sim, 'kubectl rollout restart deployment/backend')).toBe('deployment.apps/backend restarted')
    settle(sim, 20000)
    const dep = sim.findDeployment('backend')!
    expect(dep.rollout).toBe('complete')
    const pods = Object.values(sim.cluster.pods)
    expect(pods.filter((p) => p.ready)).toHaveLength(3)
    expect(pods.some((p) => before.includes(p.uid))).toBe(false)
    expect(pods.every((p) => p.image === dep.template.image)).toBe(true)
    expect(Object.keys(sim.cluster.replicaSets)).toHaveLength(2)
    expect(out(sim, 'kubectl rollout history deployment/backend')).toContain('rollout restart')
    expect(out(sim, 'kubectl get deploy backend -o yaml')).toContain('kubectl.kubernetes.io/restartedAt')
    expect(out(sim, 'kubectl rollout undo deployment/backend')).toContain('rolled back')
    settle(sim, 20000)
    expect(sim.findDeployment('backend')!.template.restartedAt).toBeUndefined()
  })

  it('pause holds template changes until resume, then rolls them out at once', () => {
    const sim = cluster()
    expect(out(sim, 'kubectl rollout pause deployment/backend')).toBe('deployment.apps/backend paused')
    expect(out(sim, 'kubectl rollout pause deployment/backend')).toContain('already paused')
    expect(out(sim, 'kubectl rollout restart deployment/backend')).toContain("can't restart paused deployment")
    run(sim, 'kubectl set image deployment/backend backend=ghcr.io/kubelearn/backend:1.6')
    settle(sim, 8000)
    expect(Object.keys(sim.cluster.replicaSets)).toHaveLength(1)
    expect(Object.values(sim.cluster.pods).every((p) => p.image.endsWith(':1.4'))).toBe(true)
    expect(out(sim, 'kubectl rollout status deployment/backend')).toContain('rollout resume')
    // scaling still works while paused
    run(sim, 'kubectl scale deployment backend --replicas=4')
    settle(sim, 8000)
    expect(Object.values(sim.cluster.pods).filter((p) => p.ready)).toHaveLength(4)
    expect(out(sim, 'kubectl rollout resume deployment/backend')).toBe('deployment.apps/backend resumed')
    settle(sim, 25000)
    expect(Object.values(sim.cluster.pods).filter((p) => p.ready && p.image.endsWith(':1.6'))).toHaveLength(4)
  })
})

describe('editing a Deployment template', () => {
  it('rolls out label changes and restores them on undo', () => {
    const sim = cluster()
    expect(sim.setImage('backend', 'backend', IMAGE, 'edit', { app: 'backend', track: 'canary' })).toBe('updated')
    settle(sim, 20000)
    const dep = sim.findDeployment('backend')!
    expect(dep.template.labels).toEqual({ app: 'backend', track: 'canary' })
    expect(sim.replicaSetOf(dep)?.templateLabels).toEqual({ app: 'backend', track: 'canary' })
    expect(Object.values(sim.cluster.pods).filter((pod) => pod.ready).every((pod) => pod.labels.track === 'canary')).toBe(true)
    expect(out(sim, 'kubectl rollout undo deployment/backend')).toContain('rolled back')
    settle(sim, 20000)
    expect(sim.findDeployment('backend')!.template.labels).toEqual({ app: 'backend' })
  })
})

describe('kubectl run', () => {
  it('creates a Pod with no owner — deleting it brings nothing back', () => {
    const sim = cluster()
    expect(out(sim, 'kubectl run teste --image=nginx')).toBe('pod/teste created')
    expect(out(sim, 'kubectl run teste --image=nginx')).toContain('AlreadyExists')
    settle(sim, 6000)
    const pod = sim.findPod('teste')!
    expect(pod.ownerUid).toBeNull()
    expect(pod.ready).toBe(true)
    expect(pod.labels).toEqual({ run: 'teste' })
    expect(out(sim, 'kubectl logs teste')).toContain('start worker processes')
    run(sim, 'kubectl delete pod teste')
    settle(sim, 8000)
    expect(sim.findPod('teste')).toBeUndefined()
    expect(Object.values(sim.cluster.pods).filter((p) => p.ready)).toHaveLength(3)
  })

  it('tests a Service from inside the cluster, failing the way a real one fails', () => {
    const sim = cluster()
    const test = 'kubectl run t --rm -it --image=busybox:1.36 --restart=Never -- '
    const ok = out(sim, test + 'wget -qO- http://backend')
    expect(ok).toMatch(/"status":"ok"/)
    expect(ok).toMatch(/pod "t" deleted$/)
    expect(sim.findPod('t')).toBeUndefined()
    expect(out(sim, test + 'wget -qO- http://backend.default.svc.cluster.local/api')).toContain('"path":"/api"')
    expect(out(sim, test + 'nslookup backend')).toContain('Address: 10.96.')
    expect(out(sim, test + 'wget -qO- http://nope')).toContain("bad address 'nope'")
    expect(out(sim, test + 'wget -qO- http://backend:8080')).toContain('Connection refused')
    run(sim, 'kubectl set selector service backend app=api')
    settle(sim, 2000)
    const empty = out(sim, test + 'wget -qO- http://backend')
    expect(empty).toContain('Connection refused')
    expect(empty).toContain('não tem endpoints')
  })

  it('asks for what it needs', () => {
    const sim = cluster()
    expect(out(sim, 'kubectl run x')).toContain('required flag(s) "image" not set')
    expect(out(sim, 'kubectl run x --rm --image=busybox')).toContain('--rm should only be used for attached containers')
    expect(out(sim, 'kubectl run x -it --image=busybox -- sh')).toContain('não abre shells interativos')
  })
})
