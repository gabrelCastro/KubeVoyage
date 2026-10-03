import { describe, expect, it } from 'vitest'
import { Simulation } from '../engine'
import { run } from '../kubectl'
import { IMAGE } from '../manifests'
import { settle } from './helpers'

const text = (r: ReturnType<typeof run>) => r.lines.map((l) => l.map((s) => s.t).join('')).join('\n')
const out = (sim: Simulation, cmd: string) => text(run(sim, cmd))
const live = (sim: Simulation) => Object.values(sim.cluster.pods).filter((p) => p.deletedAt === null)
const URL = 'postgres://app:s3cret@db:5432/app'

function cluster() {
  const sim = new Simulation()
  sim.bootstrap({ deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }] })
  sim.files.push('backend-secret.yaml')
  return sim
}

describe('Secrets', () => {
  it('base64, not encryption: describe hides the value, -o yaml and jsonpath give it away', () => {
    const sim = cluster()
    expect(out(sim, `kubectl create secret generic db-credentials --from-literal=DATABASE_URL=${URL}`)).toBe('secret/db-credentials created')
    expect(out(sim, 'kubectl get secrets')).toMatch(/^db-credentials\s+Opaque\s+1\s+/m)
    const described = out(sim, 'kubectl describe secret db-credentials')
    expect(described).toContain('DATABASE_URL:  33 bytes')
    expect(described).not.toContain('s3cret')
    const encoded = btoa(URL)
    expect(out(sim, 'kubectl get secret db-credentials -o yaml')).toContain(`DATABASE_URL: ${encoded}`)
    expect(out(sim, `kubectl get secret db-credentials -o jsonpath={.data.DATABASE_URL}`)).toBe(encoded)
    expect(out(sim, `kubectl get secret db-credentials -o jsonpath='{.data.DATABASE_URL}' | base64 -d`)).toBe(URL)
    expect(out(sim, `echo ${encoded} | base64 --decode`)).toBe(URL)
    expect(out(sim, 'kubectl get pods -o jsonpath={.items[*].metadata.name}').split(' ')).toHaveLength(3)
  })

  it('fixing forward: v1.5 reads DATABASE_URL from the Secret and stops crashing', () => {
    const sim = cluster()
    run(sim, `kubectl create secret generic db-credentials --from-literal=DATABASE_URL=${URL}`)
    expect(out(sim, 'kubectl apply -f backend-secret.yaml')).toBe('deployment.apps/backend configured')
    settle(sim, 30000)
    const pods = live(sim)
    expect(pods.every((p) => p.image.endsWith(':1.5') && p.ready && p.restarts === 0 && p.env?.DATABASE_URL === URL)).toBe(true)
    expect(sim.findDeployment('backend')!.rollout).toBe('complete')
    expect(out(sim, `kubectl logs ${pods[0].name}`)).not.toContain('panic')
    expect(out(sim, 'kubectl get deploy backend -o yaml')).toMatch(/- secretRef:\n\s+name: db-credentials/)
  })

  it('without the Secret, the Pods wait in CreateContainerConfigError', () => {
    const sim = cluster()
    run(sim, 'kubectl apply -f backend-secret.yaml')
    settle(sim, 8000)
    expect(live(sim).some((p) => p.waiting === 'CreateContainerConfigError')).toBe(true)
    expect(sim.events.some((e) => e.message === 'Error: secret "db-credentials" not found')).toBe(true)
  })

  it('create secret: only generic, keys validated, no duplicates; delete', () => {
    const sim = cluster()
    expect(out(sim, 'kubectl create secret tls x --cert=a --key=b')).toContain('só simulamos secret generic')
    expect(out(sim, 'kubectl create secret generic s --from-literal=bad key=1')).toContain('expected key=value')
    run(sim, 'kubectl create secret generic s --from-literal=A=1')
    expect(out(sim, 'kubectl create secret generic s --from-literal=A=1')).toContain('already exists')
    expect(out(sim, 'kubectl delete secret s')).toBe('secret "s" deleted')
  })
})
