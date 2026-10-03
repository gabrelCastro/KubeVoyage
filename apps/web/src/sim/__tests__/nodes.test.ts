import { describe, expect, it } from 'vitest'
import { Simulation } from '../engine'
import { complete, run } from '../kubectl'
import { IMAGE } from '../manifests'
import { settle } from './helpers'

const text = (sim: Simulation, command: string) => run(sim, command).lines.map((line) => line.map((span) => span.t).join('')).join('\n')
const live = (sim: Simulation) => Object.values(sim.cluster.pods).filter((pod) => pod.deletedAt === null)
const daemonPods = (sim: Simulation) => live(sim).filter((pod) => pod.daemon)
const backendPods = (sim: Simulation) => live(sim).filter((pod) => pod.labels.app === 'backend')

function cluster() {
  const sim = new Simulation()
  sim.files = ['log-agent.yaml']
  sim.bootstrap({ deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }] })
  return sim
}

describe('Nodes and DaemonSets', () => {
  it('keeps one DaemonSet Pod on every node and recreates one that is deleted', () => {
    const sim = cluster()
    expect(text(sim, 'kubectl apply -f log-agent.yaml')).toBe('daemonset.apps/log-agent created')
    settle(sim, 5000)

    expect(daemonPods(sim)).toHaveLength(3)
    expect(new Set(daemonPods(sim).map((pod) => pod.nodeName))).toEqual(new Set(['node-1', 'node-2', 'node-3']))
    expect(text(sim, 'kubectl get daemonsets')).toMatch(/log-agent\s+3\s+3\s+3/)
    expect(text(sim, `kubectl logs ${daemonPods(sim)[0].name}`)).toContain('watching container logs')
    expect(sim.podCpu(daemonPods(sim)[0])).toBeGreaterThan(0)

    const removed = daemonPods(sim).find((pod) => pod.nodeName === 'node-2')!
    text(sim, `kubectl delete pod ${removed.name}`)
    settle(sim, 6000)
    const replacement = daemonPods(sim).find((pod) => pod.nodeName === 'node-2')!
    expect(replacement.name).not.toBe(removed.name)
    expect(daemonPods(sim)).toHaveLength(3)
  })

  it('cordons and uncordons a node, keeping new ordinary Pods away while DaemonSet Pods remain', () => {
    const sim = cluster()
    text(sim, 'kubectl apply -f log-agent.yaml')
    settle(sim, 5000)

    expect(text(sim, 'kubectl cordon node-2')).toBe('node/node-2 cordoned')
    expect(sim.cluster.nodes.find((node) => node.name === 'node-2')?.unschedulable).toBe(true)
    text(sim, 'kubectl run avulso --image=nginx:1.27')
    settle(sim, 5000)
    expect(sim.findPod('avulso')?.nodeName).not.toBe('node-2')
    expect(daemonPods(sim).some((pod) => pod.nodeName === 'node-2')).toBe(true)
    expect(text(sim, 'kubectl get nodes')).toContain('Ready,SchedulingDisabled')

    expect(text(sim, 'kubectl uncordon node-2')).toBe('node/node-2 uncordoned')
    expect(sim.cluster.nodes.find((node) => node.name === 'node-2')?.unschedulable).toBe(false)
  })

  it('blocks drain without --ignore-daemonsets, then evicts backend Pods to other nodes', () => {
    const sim = cluster()
    text(sim, 'kubectl apply -f log-agent.yaml')
    settle(sim, 5000)
    const daemon = daemonPods(sim).find((pod) => pod.nodeName === 'node-2')!

    const blocked = text(sim, 'kubectl drain node-2')
    expect(blocked).toContain('cannot delete DaemonSet-managed Pods')
    expect(sim.cluster.nodes.find((node) => node.name === 'node-2')?.unschedulable).toBe(true)
    expect(backendPods(sim).some((pod) => pod.nodeName === 'node-2')).toBe(true)

    const drained = text(sim, 'kubectl drain node-2 --ignore-daemonsets')
    expect(drained).toContain('node/node-2 drained')
    settle(sim, 8000)
    expect(backendPods(sim)).toHaveLength(3)
    expect(backendPods(sim).every((pod) => pod.ready && pod.nodeName !== 'node-2')).toBe(true)
    expect(sim.cluster.pods[daemon.uid]?.deletedAt).toBeNull()
    expect(sim.cluster.pods[daemon.uid]?.nodeName).toBe('node-2')
  })

  it('requires --force for a Pod without a controller', () => {
    const sim = new Simulation()
    text(sim, 'kubectl run avulso --image=nginx:1.27')
    settle(sim, 5000)
    const node = sim.findPod('avulso')!.nodeName!

    expect(text(sim, `kubectl drain ${node}`)).toContain('cannot delete Pods that declare no controller')
    expect(sim.findPod('avulso')?.deletedAt).toBeNull()
    expect(text(sim, `kubectl drain ${node} --force`)).toContain(`pod/avulso evicted`)
    settle(sim, 3000)
    expect(sim.findPod('avulso')).toBeUndefined()
  })

  it('supports DaemonSet discovery, inspection, watch and deletion through kubectl', () => {
    const sim = cluster()
    text(sim, 'kubectl apply -f log-agent.yaml')
    settle(sim, 5000)

    expect(text(sim, 'kubectl get daemonset log-agent -o yaml')).toContain('desiredNumberScheduled: 3')
    expect(text(sim, 'kubectl describe ds log-agent')).toContain('Desired Number of Nodes Scheduled:3')
    expect(run(sim, 'kubectl get ds -w').watch?.kind).toBe('daemonsets')
    expect(complete(sim, 'kubectl get daemons').value).toBe('kubectl get daemonsets ')
    expect(text(sim, 'kubectl delete ds log-agent')).toBe('daemonset.apps "log-agent" deleted')
    settle(sim, 3000)
    expect(sim.findDaemonSet('log-agent')).toBeUndefined()
    expect(daemonPods(sim)).toHaveLength(0)
  })
})
