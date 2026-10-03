import { describe, expect, it } from 'vitest'
import { Simulation } from '../engine'
import { run } from '../kubectl'
import { IMAGE } from '../manifests'
import { settle } from './helpers'

const text = (r: ReturnType<typeof run>) => r.lines.map((l) => l.map((s) => s.t).join('')).join('\n')
const out = (sim: Simulation, cmd: string) => text(run(sim, cmd))

function cluster() {
  const sim = new Simulation()
  sim.bootstrap({ deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }] })
  sim.files.push('configmap.yaml', 'backend-config.yaml')
  return sim
}

const live = (sim: Simulation) => Object.values(sim.cluster.pods).filter((p) => p.deletedAt === null)

describe('ConfigMaps', () => {
  it('a Deployment reading a missing ConfigMap stalls safely; creating it unblocks the rollout', () => {
    const sim = cluster()
    expect(out(sim, 'kubectl apply -f backend-config.yaml')).toBe('deployment.apps/backend configured')
    settle(sim, 6000)
    const waiting = live(sim).filter((p) => p.waiting)
    expect(waiting.length).toBeGreaterThan(0)
    expect(waiting.every((p) => p.waiting === 'CreateContainerConfigError' && !p.ready)).toBe(true)
    expect(out(sim, 'kubectl get pods')).toContain('CreateContainerConfigError')
    expect(sim.findDeployment('backend')!.rollout).toBe('stalled')
    // the old version keeps serving
    expect(live(sim).filter((p) => p.ready)).toHaveLength(3)
    expect(sim.events.some((e) => e.reason === 'Failed' && e.message === 'Error: configmap "app-config" not found')).toBe(true)

    expect(out(sim, 'kubectl apply -f configmap.yaml')).toBe('configmap/app-config created')
    settle(sim, 25000)
    const pods = live(sim)
    expect(pods.filter((p) => p.ready)).toHaveLength(3)
    expect(pods.every((p) => p.configMap === 'app-config' && p.env?.APP_MESSAGE === 'Olá, direto do ConfigMap!')).toBe(true)
    expect(sim.findDeployment('backend')!.rollout).toBe('complete')
  })

  it('running Pods keep the value they started with; a restart picks up the new one', () => {
    const sim = cluster()
    run(sim, 'kubectl apply -f configmap.yaml')
    run(sim, 'kubectl apply -f backend-config.yaml')
    settle(sim, 25000)
    expect(out(sim, `kubectl patch configmap app-config -p '{"data":{"APP_MESSAGE":"Mensagem nova"}}'`)).toBe('configmap/app-config patched')
    expect(out(sim, 'kubectl describe cm app-config')).toContain('Mensagem nova')
    settle(sim, 5000)
    expect(live(sim).every((p) => p.env?.APP_MESSAGE === 'Olá, direto do ConfigMap!')).toBe(true)
    run(sim, 'kubectl rollout restart deployment/backend')
    settle(sim, 25000)
    expect(live(sim).filter((p) => p.ready)).toHaveLength(3)
    expect(live(sim).every((p) => p.env?.APP_MESSAGE === 'Mensagem nova')).toBe(true)
  })

  it('kubectl create, get, -o yaml, patch and delete', () => {
    const sim = cluster()
    expect(out(sim, 'kubectl create configmap cfg --from-literal=A=1 --from-literal B=dois')).toBe('configmap/cfg created')
    expect(out(sim, 'kubectl create configmap cfg --from-literal=A=1')).toContain('already exists')
    expect(out(sim, 'kubectl create cm x --from-literal=semvalor')).toContain('expected key=value')
    expect(out(sim, 'kubectl get cm')).toMatch(/^cfg\s+2\s+/m)
    const yaml = out(sim, 'kubectl get configmap cfg -o yaml')
    expect(yaml).toMatch(/^data:\n {2}A: "1"\n {2}B: dois$/m)
    expect(out(sim, `kubectl patch cm cfg -p '{"data":{"A":null,"C":"3"}}'`)).toBe('configmap/cfg patched')
    expect(sim.findConfigMap('cfg')!.data).toEqual({ B: 'dois', C: '3' })
    expect(out(sim, `kubectl patch cm cfg -p '{"data":{"B":"dois","C":"3"}}'`)).toContain('no change')
    expect(out(sim, 'kubectl patch cm cfg -p nope')).toContain('unable to parse')
    expect(out(sim, `kubectl patch deploy backend -p '{}'`)).toContain('funciona com ConfigMaps')
    expect(out(sim, 'kubectl delete configmap cfg')).toBe('configmap "cfg" deleted')
    expect(out(sim, 'kubectl get cm')).toContain('No resources found')
  })

  it('shows envFrom in the template and the waiting reason in the Pod', () => {
    const sim = cluster()
    run(sim, 'kubectl apply -f backend-config.yaml')
    settle(sim, 6000)
    expect(out(sim, 'kubectl get deploy backend -o yaml')).toMatch(/envFrom:\n\s+- configMapRef:\n\s+name: app-config/)
    const pod = live(sim).find((p) => p.waiting)!
    const yaml = out(sim, `kubectl get pod ${pod.name} -o yaml`)
    expect(yaml).toContain('reason: CreateContainerConfigError')
    expect(yaml).toContain('message: configmap "app-config" not found')
  })
})
