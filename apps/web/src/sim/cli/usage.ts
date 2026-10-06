/**
 * What each simulated kubectl command does and how to call it — the single source for
 * `kubectl <cmd> --help` and for the reference in the documentation page (/doc).
 */

// ── verbs ──────────────────────────────────────────────────────────────────

export const VERBS = ['apply', 'get', 'describe', 'delete', 'scale', 'expose', 'label', 'set', 'rollout', 'logs', 'run', 'edit', 'create', 'patch', 'autoscale', 'top', 'cordon', 'uncordon', 'drain']

/** Real verbs that aren't simulated (yet): what they do, so the learner isn't told they don't exist. */
export const UNSIMULATED_VERBS: Record<string, string> = {
  exec: 'executar um comando dentro de um container',
  'port-forward': 'abrir um túnel da sua máquina até um Pod ou Service',
  explain: 'explicar os campos de cada tipo de recurso',
  annotate: 'mudar as annotations de um recurso',
  replace: 'substituir um recurso inteiro',
  cp: 'copiar arquivos de e para containers',
  attach: 'conectar ao processo de um container',
  debug: 'criar containers de depuração',
  taint: 'restringir quais Pods um node aceita',
  wait: 'esperar uma condição de um recurso',
  diff: 'comparar um manifesto com o que está no cluster',
  'cluster-info': 'mostrar os endereços do control plane',
  config: 'gerenciar contextos e o kubeconfig',
  version: 'mostrar as versões do cliente e do servidor',
  'api-resources': 'listar os tipos de recurso do cluster',
  'api-versions': 'listar as versões de API do cluster',
  auth: 'verificar permissões (RBAC)',
  proxy: 'abrir um proxy local para a API',
  events: 'listar eventos (aqui, use kubectl get events)',
  kustomize: 'gerar manifestos com Kustomize',
  certificate: 'aprovar certificados',
  completion: 'gerar autocompletar para o shell',
  plugin: 'gerenciar plugins',
}

export const USAGE: Record<string, { use: string[]; what: string; examples?: string[] }> = {
  apply: { use: ['kubectl apply -f <arquivo>'], what: 'Cria ou atualiza recursos a partir de um manifesto.', examples: ['kubectl apply -f backend.yaml'] },
  get: {
    use: ['kubectl get <tipo>[,<tipo>...] [nome...] [-l selector] [-o wide|yaml|json|name] [-w]', 'kubectl get <tipo>/<nome> [<tipo>/<nome>...]'],
    what: 'Lista recursos. Flags: -l, --field-selector, -L, --show-labels, -A, -o, --sort-by, --no-headers, -w.',
    examples: ['kubectl get pods -o wide', 'kubectl get pods -l app=backend --show-labels', 'kubectl get deploy backend -o yaml', 'kubectl get endpointslices -l kubernetes.io/service-name=backend'],
  },
  describe: { use: ['kubectl describe <tipo> [nome] [-l selector]'], what: 'Mostra detalhes e os eventos recentes de um recurso.', examples: ['kubectl describe pod <nome>', 'kubectl describe svc backend'] },
  delete: {
    use: ['kubectl delete pod <nome>... | -l selector', 'kubectl delete deployment|rs|service|job|daemonset|configmap|secret|hpa <nome>'],
    what: 'Apaga recursos. Apagar um dono apaga também o que ele possui (exclusão em cascata).',
    examples: ['kubectl delete pod <nome>', 'kubectl delete pods -l app=backend', 'kubectl delete rs <nome>'],
  },
  scale: { use: ['kubectl scale deployment <nome> --replicas=<n>'], what: 'Muda o número desejado de réplicas.', examples: ['kubectl scale deployment backend --replicas=5'] },
  expose: { use: ['kubectl expose deployment <nome> --port=<porta> [--target-port=<porta>] [--name=<nome>]'], what: 'Cria um Service (ClusterIP) com o selector do Deployment.', examples: ['kubectl expose deployment backend --port=80 --target-port=8080'] },
  label: { use: ['kubectl label pod <nome> chave=valor... [--overwrite]', 'kubectl label pod <nome> chave-'], what: 'Adiciona, troca ou remove labels de um Pod.', examples: ['kubectl label pod <nome> app=debug --overwrite'] },
  set: { use: ['kubectl set image deployment/<nome> <container>=<imagem>', 'kubectl set selector service <nome> chave=valor'], what: 'Troca a imagem de um Deployment ou o selector de um Service.' },
  rollout: {
    use: ['kubectl rollout status|history deployment/<nome>', 'kubectl rollout undo deployment/<nome> [--to-revision=N]', 'kubectl rollout restart|pause|resume deployment/<nome>'],
    what: 'Acompanha, lista, desfaz, reinicia ou pausa rollouts.',
    examples: ['kubectl rollout undo deployment/backend', 'kubectl rollout restart deployment/backend'],
  },
  run: {
    use: ['kubectl run <nome> --image=<imagem> [--labels=k=v]', 'kubectl run <nome> --rm -it --image=busybox --restart=Never -- wget -qO- http://<service>'],
    what: 'Cria um Pod avulso — ou roda um comando de teste dentro do cluster e apaga o Pod no fim.',
    examples: ['kubectl run teste --image=nginx', 'kubectl run teste --rm -it --image=busybox:1.36 --restart=Never -- wget -qO- http://backend', 'kubectl run dns --rm -it --image=busybox:1.36 --restart=Never -- nslookup backend'],
  },
  logs: { use: ['kubectl logs <pod> [--previous] [--tail=N]', 'kubectl logs -l <selector>'], what: 'Mostra a saída do container. --previous mostra a execução anterior ao último restart.', examples: ['kubectl logs <pod> --previous'] },
  edit: { use: ['kubectl edit deployment/<nome>'], what: 'Abre um resumo YAML do Deployment e aplica as mudanças salvas.', examples: ['kubectl edit deployment/backend'] },
  create: {
    use: [
      'kubectl create deployment <nome> --image=<imagem> [--replicas=N]',
      'kubectl create configmap <nome> --from-literal=CHAVE=valor ...',
      'kubectl create secret generic <nome> --from-literal=CHAVE=valor ...',
      'kubectl create job <nome> --image=<imagem>',
    ],
    what: 'Cria um Deployment, um ConfigMap, um Secret ou um Job a partir dos argumentos.',
    examples: [
      'kubectl create deployment web --image=nginx:1.27',
      'kubectl create configmap app-config --from-literal=APP_MESSAGE=Olá',
      'kubectl create secret generic db --from-literal=DATABASE_URL=postgres://app@db/app',
      'kubectl create job tarefa --image=ghcr.io/kubelearn/backend:2.0',
    ],
  },
  patch: {
    use: [`kubectl patch configmap <nome> -p '{"data":{"CHAVE":"valor"}}'`],
    what: 'Altera só os campos que você passar (merge). Aqui, os dados de um ConfigMap.',
    examples: [`kubectl patch configmap app-config -p '{"data":{"APP_MESSAGE":"Nova mensagem"}}'`],
  },
  top: {
    use: ['kubectl top pods [nome]', 'kubectl top nodes'],
    what: 'Mostra o consumo atual de CPU e memória dos Pods ou dos nodes.',
    examples: ['kubectl top pods', 'kubectl top nodes'],
  },
  autoscale: {
    use: ['kubectl autoscale deployment <nome> --cpu=<N>% --max=<n> [--min=<n>]'],
    what: 'Cria um HorizontalPodAutoscaler: mais réplicas quando a CPU média passa da meta, menos quando cai.',
    examples: ['kubectl autoscale deployment backend --cpu=50% --min=2 --max=8'],
  },
  cordon: { use: ['kubectl cordon <node>'], what: 'Marca o node como não agendável: nenhum Pod novo vai para ele (os que estão lá continuam).', examples: ['kubectl cordon node-2'] },
  uncordon: { use: ['kubectl uncordon <node>'], what: 'Devolve o node ao agendamento.', examples: ['kubectl uncordon node-2'] },
  drain: {
    use: ['kubectl drain <node> [--ignore-daemonsets] [--force]'],
    what: 'Isola o node (cordon) e tira os Pods dele, para os controladores recriarem em outros nodes. Pods de DaemonSet ficam, com --ignore-daemonsets; Pods sem dono só saem com --force.',
    examples: ['kubectl drain node-2 --ignore-daemonsets'],
  },
}
