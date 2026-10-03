import { describe, expect, it } from 'vitest'
import { Simulation } from '../../sim/engine'
import { IMAGE } from '../../sim/manifests'
import { parseDeploymentEdit } from '../deploymentEdit'
import { deploymentEditYaml } from '../deploymentEditYaml'

const deployment = () => {
  const sim = new Simulation()
  sim.bootstrap({ deployments: [{ name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE }] })
  return sim.findDeployment('backend')!
}

describe('deploymentEdit', () => {
  it('round-trips the editable Deployment summary', () => {
    const dep = deployment()
    expect(parseDeploymentEdit(deploymentEditYaml(dep), dep)).toEqual({ replicas: 3, image: IMAGE, labels: { app: 'backend' } })
  })

  it('reports YAML syntax errors like kubectl', () => {
    const result = parseDeploymentEdit('apiVersion: apps/v1\nspec: [', deployment())
    expect(result).toHaveProperty('error')
    expect('error' in result && result.error).toContain('error: unable to decode edited data')
  })

  it('rejects invalid replicas, selector changes and template labels that do not match', () => {
    const dep = deployment()
    const source = deploymentEditYaml(dep)
    const replicas = parseDeploymentEdit(source.replace('replicas: 3', 'replicas: nove'), dep)
    expect('error' in replicas && replicas.error).toContain('spec.replicas')
    const selector = parseDeploymentEdit(source.replace('matchLabels:\n      app: backend', 'matchLabels:\n      app: api'), dep)
    expect('error' in selector && selector.error).toContain('field is immutable')
    const labels = parseDeploymentEdit(source.replace('labels:\n        app: backend', 'labels:\n        app: api'), dep)
    expect('error' in labels && labels.error).toContain('precisa combinar com spec.selector')
  })
})
