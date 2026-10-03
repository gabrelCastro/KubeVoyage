import { describe, expect, it } from 'vitest'
import { Simulation } from '../engine'
import { run } from '../kubectl'
import { settle } from './helpers'

const text = (r: ReturnType<typeof run>) => r.lines.map((l) => l.map((s) => s.t).join('')).join('\n')
const out = (sim: Simulation, cmd: string) => text(run(sim, cmd))

function cluster() {
  const sim = new Simulation()
  sim.files = ['relatorio.yaml', 'relatorio-setembro.yaml']
  return sim
}
const podsOf = (sim: Simulation, job: string) => Object.values(sim.cluster.pods).filter((p) => p.labels['job-name'] === job)

describe('Jobs', () => {
  it('runs 5 tasks, at most 2 at a time, and stops when they all succeed', () => {
    const sim = cluster()
    expect(out(sim, 'kubectl apply -f relatorio.yaml')).toBe('job.batch/relatorio created')
    let maxActive = 0
    for (let t = 0; t < 40000; t += 250) {
      settle(sim, 250)
      const active = podsOf(sim, 'relatorio').filter((p) => p.deletedAt === null && p.phase !== 'Succeeded' && p.phase !== 'Error').length
      maxActive = Math.max(maxActive, active)
    }
    expect(maxActive).toBe(2)
    const job = sim.findJob('relatorio')!
    expect(job.status).toBe('Complete')
    expect(job.succeeded).toBe(5)
    expect(podsOf(sim, 'relatorio').filter((p) => p.phase === 'Succeeded')).toHaveLength(5)
    expect(out(sim, 'kubectl get jobs')).toMatch(/^relatorio\s+Complete\s+5\/5\s+/m)
    expect(out(sim, 'kubectl get pods')).toMatch(/relatorio-\w+\s+0\/1\s+Completed\s+0/)
    expect(out(sim, 'kubectl logs job/relatorio')).toContain('relatório salvo')
    // nothing replaces a completed Pod; deleting one doesn't undo the work
    const done = podsOf(sim, 'relatorio')[0]
    run(sim, `kubectl delete pod ${done.name}`)
    settle(sim, 8000)
    expect(podsOf(sim, 'relatorio')).toHaveLength(4)
    expect(sim.findJob('relatorio')!.succeeded).toBe(5)
  })

  it('a failing task is retried with growing waits, then the Job gives up at backoffLimit', () => {
    const sim = cluster()
    run(sim, 'kubectl apply -f relatorio-setembro.yaml')
    settle(sim, 60000)
    const job = sim.findJob('relatorio-setembro')!
    expect(job.status).toBe('Failed')
    expect(job.failed).toBe(3)
    expect(podsOf(sim, 'relatorio-setembro').every((p) => p.phase === 'Error')).toBe(true)
    expect(sim.events.some((e) => e.reason === 'BackoffLimitExceeded')).toBe(true)
    const described = out(sim, 'kubectl describe job relatorio-setembro')
    expect(described).toContain('0 Active / 0 Succeeded / 3 Failed')
    expect(described).toContain('BackoffLimitExceeded')
    expect(out(sim, 'kubectl logs job/relatorio-setembro')).toContain('arquivo de entrada não encontrado')
    expect(out(sim, 'kubectl get job relatorio-setembro -o yaml')).toContain('reason: BackoffLimitExceeded')
  })

  it('kubectl create job, and deleting a Job takes its Pods', () => {
    const sim = cluster()
    expect(out(sim, 'kubectl create job rapido --image=ghcr.io/kubelearn/relatorio:1.0')).toBe('job.batch/rapido created')
    settle(sim, 3000)
    expect(podsOf(sim, 'rapido').length).toBe(1)
    expect(out(sim, 'kubectl delete job rapido')).toBe('job.batch "rapido" deleted')
    settle(sim, 5000)
    expect(podsOf(sim, 'rapido')).toHaveLength(0)
    expect(Object.keys(sim.cluster.jobs)).toHaveLength(0)
  })

  it('deleting a running Pod of a Job gets it replaced', () => {
    const sim = cluster()
    run(sim, 'kubectl apply -f relatorio.yaml')
    settle(sim, 2600)
    const running = podsOf(sim, 'relatorio').find((p) => p.phase === 'Running')!
    run(sim, `kubectl delete pod ${running.name}`)
    settle(sim, 40000)
    expect(sim.findJob('relatorio')!.status).toBe('Complete')
    expect(sim.findJob('relatorio')!.succeeded).toBe(5)
  })
})
