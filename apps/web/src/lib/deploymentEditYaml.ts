import type { Deployment, Labels } from '../sim/types'

const PLAIN = /^[A-Za-z_/][\w./:@%-]*$/
const AMBIGUOUS = /^(true|false|yes|no|on|off|null|~|y|n)$/i
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/

const scalar = (value: string) => (value && PLAIN.test(value) && !AMBIGUOUS.test(value) && !NUMBER.test(value) ? value : JSON.stringify(value))
const labelLines = (labels: Labels, indent: number) =>
  Object.entries(labels).map(([key, value]) => `${' '.repeat(indent)}${PLAIN.test(key) ? key : JSON.stringify(key)}: ${scalar(value)}`)

export function deploymentEditYaml(dep: Deployment) {
  return [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    `  name: ${scalar(dep.name)}`,
    'spec:',
    `  replicas: ${dep.replicas}`,
    '  selector:',
    '    matchLabels:',
    ...labelLines(dep.selector, 6),
    '  template:',
    '    metadata:',
    '      labels:',
    ...labelLines(dep.template.labels, 8),
    '    spec:',
    '      containers:',
    '        - name: backend',
    `          image: ${scalar(dep.template.image)}`,
    '',
  ].join('\n')
}
