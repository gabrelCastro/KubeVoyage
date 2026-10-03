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

// Lesson 7: configuration kept outside the image
FILES['configmap.yaml'] = {
  manifest: { kind: 'ConfigMap', name: 'app-config', data: { APP_MESSAGE: 'Olá, direto do ConfigMap!' } },
  yaml: `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  APP_MESSAGE: "Olá, direto do ConfigMap!"`,
}

FILES['backend-config.yaml'] = {
  manifest: { kind: 'Deployment', name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE, configMap: 'app-config' },
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
          envFrom:
            - configMapRef:
                name: app-config   # cada chave vira uma variável de ambiente
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }`,
}

// Lesson 8: a version that freezes, and the probe that notices
FILES['backend-liveness.yaml'] = {
  manifest: { kind: 'Deployment', name: 'backend', replicas: 3, labels: { app: 'backend' }, image: 'ghcr.io/kubelearn/backend:1.6', livenessProbe: true },
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
          image: ghcr.io/kubelearn/backend:1.6
          readinessProbe:            # falhou? sai do Service
            httpGet: { path: /healthz, port: 8080 }
          livenessProbe:             # falhou 3 vezes? o kubelet reinicia
            httpGet: { path: /healthz, port: 8080 }
            periodSeconds: 10
            failureThreshold: 3`,
}

/** Kept for the first lesson and tests. */
export const MANIFEST = { file: 'backend.yaml', manifest: FILES['backend.yaml'].manifest }
export const MANIFEST_YAML = FILES['backend.yaml'].yaml
