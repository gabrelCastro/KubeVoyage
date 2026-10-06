import { DEFAULT_CODE } from '../../store/useApp'

/** Starting points, each showing one thing a container can do to the cluster. */
export const TEMPLATES: { label: string; hint: string; code: string }[] = [
  { label: 'Servidor', hint: 'responde e passa nas probes', code: DEFAULT_CODE },
  {
    label: 'Lê a config',
    hint: 'precisa de DATABASE_URL',
    code: `// Sem DATABASE_URL no ambiente, o processo morre ao iniciar.
// No cluster, ela vem de um Secret ou ConfigMap (envFrom).
if (!env.DATABASE_URL) throw new Error('DATABASE_URL não definida')
console.log('conectando em', env.DATABASE_URL.replace(/:[^:@]*@/, ':***@'))

function handle(req) {
  if (req.path === '/healthz') return 'ok'
  return 'Conectado ao banco!'
}
`,
  },
  {
    label: 'Quebra ao iniciar',
    hint: 'CrashLoopBackOff',
    code: `console.log('iniciando…')
const config = JSON.parse('{ isto não é json')

function handle() {
  return 'nunca chega aqui'
}
`,
  },
  {
    label: 'Trava',
    hint: 'readiness e liveness',
    code: `console.log('servidor iniciando')

function handle(req) {
  // um laço que nunca termina: o processo segue vivo, mas não responde
  if (req.path === '/healthz') while (true) {}
  return 'oi'
}
`,
  },
  {
    label: 'Não está pronto',
    hint: '/healthz responde 503',
    code: `function handle(req) {
  if (req.path === '/healthz') {
    return { status: 503, body: 'ainda aquecendo o cache' }
  }
  return 'oi'
}
`,
  },
  {
    label: 'Tarefa (Job)',
    hint: 'roda e termina',
    code: `// Sem handle(): é uma tarefa. Terminar sem erro = exit code 0.
const vendas = [120, 80, 310, 45]
const total = vendas.reduce((a, b) => a + b, 0)
console.log('vendas processadas:', vendas.length)
console.log('total do dia:', total)
if (env.FALHAR) throw new Error('arquivo de entrada não encontrado')
`,
  },
]
