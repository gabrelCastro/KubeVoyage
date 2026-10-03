import type { Manifest } from './engine'

export const IMAGE = 'ghcr.io/kubelearn/backend:1.4'

/** Manifests a lesson can put in the terminal's working directory. */
export const FILES: Record<string, { manifest: Manifest; yaml: string }> = {
  'backend.yaml': {
    manifest: { kind: 'Deployment', name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE },
    yaml: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: ${IMAGE}
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }`,
  },
  'service.yaml': {
    manifest: { kind: 'Service', name: 'backend', selector: { app: 'backend' }, port: 80, targetPort: 8080 },
    yaml: `apiVersion: v1
kind: Service
metadata:
  name: backend
spec:
  selector:
    app: backend
  ports:
    - port: 80
      targetPort: 8080`,
  },
}

/** Kept for the first lesson and tests. */
export const MANIFEST = { file: 'backend.yaml', manifest: FILES['backend.yaml'].manifest }
export const MANIFEST_YAML = FILES['backend.yaml'].yaml
