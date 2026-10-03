import { parseDocument } from 'yaml'
import type { Deployment, Labels } from '../sim/types'

export interface DeploymentEdit {
  replicas: number
  image: string
  labels: Labels
}

type MapLike = Record<string, unknown>

const record = (value: unknown): value is MapLike => !!value && typeof value === 'object' && !Array.isArray(value)
const sameLabels = (a: Labels, b: Labels) => {
  const ak = Object.keys(a).sort()
  const bk = Object.keys(b).sort()
  return ak.length === bk.length && ak.every((key, i) => key === bk[i] && a[key] === b[key])
}

const invalid = (name: string, field: string, message: string) => ({ error: `error: deployments.apps "${name}" is invalid: ${field}: ${message}` })

function labels(value: unknown): Labels | null {
  if (!record(value) || !Object.keys(value).length) return null
  if (Object.values(value).some((entry) => typeof entry !== 'string')) return null
  return value as Labels
}

export function parseDeploymentEdit(source: string, dep: Deployment): DeploymentEdit | { error: string } {
  const doc = parseDocument(source, { prettyErrors: false })
  if (doc.errors.length) return { error: `error: unable to decode edited data: ${doc.errors[0].message}` }
  const root = doc.toJS() as unknown
  if (!record(root)) return { error: 'error: unable to decode edited data: expected a YAML mapping' }
  if (root.apiVersion !== 'apps/v1') return invalid(dep.name, 'apiVersion', 'Unsupported value: use apps/v1')
  if (root.kind !== 'Deployment') return invalid(dep.name, 'kind', 'Unsupported value: use Deployment')
  const metadata = root.metadata
  if (!record(metadata) || metadata.name !== dep.name) return invalid(dep.name, 'metadata.name', `Invalid value: o nome deve continuar sendo "${dep.name}"`)
  const spec = root.spec
  if (!record(spec)) return invalid(dep.name, 'spec', 'Required value')
  const replicas = spec.replicas
  if (!Number.isInteger(replicas) || (replicas as number) < 0) return invalid(dep.name, 'spec.replicas', 'Invalid value: informe um inteiro não negativo')
  if ((replicas as number) > 8) return invalid(dep.name, 'spec.replicas', 'Invalid value: este cluster de treino aceita no máximo 8')

  const selector = record(spec.selector) ? labels(spec.selector.matchLabels) : null
  if (!selector || !sameLabels(selector, dep.selector)) return invalid(dep.name, 'spec.selector', 'field is immutable')
  const template = spec.template
  const templateLabels = record(template) && record(template.metadata) ? labels(template.metadata.labels) : null
  if (!templateLabels) return invalid(dep.name, 'spec.template.metadata.labels', 'Required value: informe ao menos uma label')
  for (const [key, value] of Object.entries(dep.selector)) {
    if (templateLabels[key] !== value)
      return invalid(dep.name, 'spec.template.metadata.labels', `Invalid value: a label ${key}: ${value} precisa combinar com spec.selector`)
  }
  const podSpec = record(template) ? template.spec : null
  const containers = record(podSpec) && Array.isArray(podSpec.containers) ? podSpec.containers : []
  const container = containers.find((entry) => record(entry) && entry.name === 'backend')
  if (!record(container) || typeof container.image !== 'string' || !container.image.trim())
    return invalid(dep.name, 'spec.template.spec.containers[0].image', 'Required value')
  return { replicas: replicas as number, image: container.image.trim(), labels: templateLabels }
}
