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

// Lesson 9: what each container asks for (requests) and may use (limits)
FILES['backend-resources.yaml'] = {
  manifest: { kind: 'Deployment', name: 'backend', replicas: 3, labels: { app: 'backend' }, image: IMAGE, resources: { cpuRequest: 200, cpuLimit: 500 } },
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
          resources:
            requests:
              cpu: 200m      # reservado no node; a base do HPA
            limits:
              cpu: 500m      # acima disso, o container é estrangulado
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }`,
}

// Lesson 10: the v1.5 that crashed for lack of DATABASE_URL, now reading it from a Secret
FILES['backend-secret.yaml'] = {
  manifest: { kind: 'Deployment', name: 'backend', replicas: 3, labels: { app: 'backend' }, image: 'ghcr.io/kubelearn/backend:1.5', secret: 'db-credentials' },
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
          image: ghcr.io/kubelearn/backend:1.5
          envFrom:
            - secretRef:
                name: db-credentials   # DATABASE_URL vem daqui
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }`,
}

// Lesson 11: work that ends
FILES['relatorio.yaml'] = {
  manifest: { kind: 'Job', name: 'relatorio', image: 'ghcr.io/kubelearn/relatorio:1.0', completions: 5, parallelism: 2, backoffLimit: 4 },
  yaml: `apiVersion: batch/v1
kind: Job
metadata:
  name: relatorio
spec:
  completions: 5       # 5 tarefas precisam terminar bem
  parallelism: 2       # no máximo 2 Pods ao mesmo tempo
  backoffLimit: 4      # desiste depois de 4 falhas
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: relatorio
          image: ghcr.io/kubelearn/relatorio:1.0`,
}

FILES['relatorio-setembro.yaml'] = {
  manifest: { kind: 'Job', name: 'relatorio-setembro', image: 'ghcr.io/kubelearn/relatorio:1.1', completions: 1, parallelism: 1, backoffLimit: 2 },
  yaml: `apiVersion: batch/v1
kind: Job
metadata:
  name: relatorio-setembro
spec:
  completions: 1
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: relatorio
          image: ghcr.io/kubelearn/relatorio:1.1`,
}

// Lesson 12: an agent on every node
FILES['log-agent.yaml'] = {
  manifest: { kind: 'DaemonSet', name: 'log-agent', image: 'ghcr.io/kubelearn/log-agent:1.0', labels: { app: 'log-agent' } },
  yaml: `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: log-agent
spec:
  selector:
    matchLabels:
      app: log-agent
  template:
    metadata:
      labels:
        app: log-agent
    spec:
      containers:
        - name: log-agent
          image: ghcr.io/kubelearn/log-agent:1.0
          volumeMounts:
            - name: logs
              mountPath: /var/log
              readOnly: true
      volumes:
        - name: logs
          hostPath:
            path: /var/log`,
}

/** Kept for the first lesson and tests. */
export const MANIFEST = { file: 'backend.yaml', manifest: FILES['backend.yaml'].manifest }
export const MANIFEST_YAML = FILES['backend.yaml'].yaml
