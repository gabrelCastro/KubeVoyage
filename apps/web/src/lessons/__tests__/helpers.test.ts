import { describe, expect, it } from 'vitest'
import { Simulation } from '../../sim/engine'
import { deployment, ranServiceRequest } from '../helpers'

describe('ranServiceRequest', () => {
  it('accepts wget and curl against the Service from a temporary Pod', () => {
    expect(ranServiceRequest(['kubectl run teste --rm -it --image=busybox --restart=Never -- wget -qO- http://backend'], 'backend')).toBe(true)
    expect(ranServiceRequest(['k run teste --image=curlimages/curl -- curl http://backend:80/healthz'], 'backend')).toBe(true)
  })

  it('does not accept another Service or a command outside kubectl run', () => {
    expect(ranServiceRequest(['kubectl run teste --image=busybox -- wget http://frontend'], 'backend')).toBe(false)
    expect(ranServiceRequest(['explicar kubectl run teste --image=busybox -- wget http://backend'], 'backend')).toBe(false)
  })
})

describe('deployment', () => {
  it('keeps lesson objectives attached to backend when more Deployments exist', () => {
    const sim = new Simulation()
    sim.bootstrap({
      deployments: [
        { name: 'worker', replicas: 1, labels: { app: 'worker' }, image: 'worker:1' },
        { name: 'backend', replicas: 3, labels: { app: 'backend' }, image: 'backend:1' },
      ],
    })
    expect(deployment(sim.cluster).name).toBe('backend')
  })
})
