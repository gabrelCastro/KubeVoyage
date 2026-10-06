/**
 * The learner's workspace in the terminal: app.js (their code), a Dockerfile, and `docker build`
 * turning them into an image the cluster can run. The terminal only talks; the store owns the
 * code and the published images (see store/useApp.ts).
 */
import type { Seg, Tone } from './resourceSpecs'

type Line = Seg[]
const plain = (t: string, c?: Tone): Line => [{ t, c }]
const note = (t: string): Line => plain(`# ${t}`, 'muted')

export interface Workspace {
  /** app.js as it is now (the template, if the learner never wrote any). */
  code: string
  /** Builds and publishes an image from app.js; `tag` is the part after `:`. */
  build(tag: string): { image: string } | { error: string }
  /** The images already published (full references). */
  images: string[]
}

export const WORKSPACE_FILES = ['app.js', 'Dockerfile'] as const

export const DOCKERFILE = `FROM node:22-alpine
WORKDIR /app
COPY app.js .
CMD ["node", "app.js"]`

const REPO = 'ghcr.io/kubelearn/backend'
const EDITORS = ['nano', 'vim', 'vi', 'code', 'emacs']

export const WORKSPACE_COMMANDS = ['docker', 'edit']

export const WORKSPACE_DOCS: Record<string, string> = {
  edit: 'abre app.js no editor — o código que roda dentro do container',
  docker: 'docker build -t backend:TAG . cria uma imagem imutável a partir de app.js',
}

export const WORKSPACE_HELP: [string, string][] = [
  ['edit app.js', 'escrever o código que roda no container'],
  ['docker build -t backend:<tag> .', 'gerar uma imagem nova a partir de app.js'],
  ['docker images', 'listar as imagens que você publicou'],
]

export interface WorkspaceResult {
  lines: Line[]
  /** Open the code editor. */
  editCode?: boolean
}

/** Shell commands about the workspace; null when `cmd` isn't one of them. */
export function runWorkspace(cmd: string, args: string[], ws: Workspace | undefined): WorkspaceResult | null {
  if (cmd === 'edit' || EDITORS.includes(cmd)) {
    const file = args.find((a) => !a.startsWith('-'))
    if (cmd !== 'edit') return { lines: [plain(`${cmd}: este terminal não tem editores de tela cheia.`, 'warn'), note('use edit app.js — abre o editor do curso')] }
    if (!ws) return { lines: [plain('edit: o editor de código não está disponível aqui', 'error')] }
    if (!file) return { lines: [plain('edit: informe um arquivo — edit app.js', 'error')] }
    if (file === 'Dockerfile') return { lines: [plain('Dockerfile: este curso usa um Dockerfile fixo (cat Dockerfile) — o que muda é app.js.', 'warn')] }
    if (file !== 'app.js') return { lines: [plain(`edit: ${file}: só app.js é editável — os manifestos se aplicam como estão (kubectl apply -f)`, 'error')] }
    return { lines: [plain('abrindo app.js…', 'muted')], editCode: true }
  }
  if (cmd !== 'docker') return null
  if (!ws) return { lines: [plain('docker: não disponível neste terminal', 'error')] }
  const [sub, ...rest] = args
  if (sub === 'build') return build(rest, ws)
  if (sub === 'images' || (sub === 'image' && rest[0] === 'ls')) {
    if (!ws.images.length) return { lines: [plain('REPOSITORY   TAG', 'strong'), note('nenhuma imagem sua ainda — edit app.js e depois docker build -t backend:2.0 .')] }
    const width = REPO.length + 3
    return {
      lines: [
        [{ t: 'REPOSITORY'.padEnd(width), c: 'strong' }, { t: 'TAG', c: 'strong' }],
        ...ws.images.map((i) => [{ t: i.split(':')[0].padEnd(width) }, { t: i.split(':')[1], c: 'accent' as Tone }]),
      ],
    }
  }
  if (sub === 'push') return { lines: [plain('Everything up-to-date', 'muted'), note('aqui, docker build já publica no registry do curso: o cluster puxa a imagem de lá')] }
  if (sub === 'run' || sub === 'exec' || sub === 'ps')
    return { lines: [plain(`docker ${sub}: neste curso, quem roda containers é o cluster.`, 'warn'), note('crie Pods com a imagem: kubectl set image deployment/backend backend=<imagem> ou kubectl create job')] }
  if (!sub || sub === '--help' || sub === 'help') return { lines: WORKSPACE_HELP.slice(1).map(([c, d]) => [{ t: `  ${c}`.padEnd(40), c: 'accent' }, { t: d, c: 'muted' }]) }
  return { lines: [plain(`docker: '${sub}' is not a docker command.`, 'error'), note('aqui: docker build · docker images')] }
}

function build(args: string[], ws: Workspace): WorkspaceResult {
  let name: string | undefined
  const contexts: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-t' || a === '--tag') name = args[++i]
    else if (a.startsWith('--tag=')) name = a.slice(6)
    else if (a.startsWith('-t')) name = a.slice(a[2] === '=' ? 3 : 2)
    else if (a === '-f' || a === '--file') {
      const file = args[++i]
      if (file !== 'Dockerfile' && file !== './Dockerfile') return { lines: [plain(`ERROR: failed to read dockerfile: open ${file ?? ''}: no such file or directory`, 'error'), note('aqui só existe o Dockerfile desta pasta')] }
    } else if (a.startsWith('-')) return { lines: [plain(`unknown flag: ${a}`, 'error'), note('use: docker build -t backend:<tag> .')] }
    else contexts.push(a)
  }
  if (contexts.length !== 1) return { lines: [plain('ERROR: docker build requires exactly 1 argument', 'error'), note('o contexto é a pasta atual: docker build -t backend:2.0 .')] }
  if (contexts[0] !== '.' && contexts[0] !== './') return { lines: [plain(`ERROR: unable to prepare context: path "${contexts[0]}" not found`, 'error'), note('app.js e o Dockerfile estão aqui: use . como contexto')] }
  if (!name) return { lines: [plain('ERROR: informe o nome da imagem com -t', 'error'), note('ex.: docker build -t backend:2.0 . — o cluster acha a imagem pelo nome e pela tag')] }
  const m = name.match(/^(?:ghcr\.io\/kubelearn\/)?([^:/]+)(?::(.+))?$/)
  if (!m || m[1] !== 'backend')
    return { lines: [plain(`ERROR: o registry do curso só aceita imagens do repositório backend`, 'error'), note(`use backend:<tag> (vira ${REPO}:<tag>)`)] }
  if (m[2] === undefined || m[2] === '') return { lines: [plain('ERROR: informe uma tag — sem ela o docker usaria "latest", que muda de conteúdo a cada build', 'error'), note('ex.: docker build -t backend:2.0 .')] }
  const r = ws.build(m[2])
  if ('error' in r) return { lines: [plain(`ERROR: ${r.error}`, 'error')] }
  const digest = digestOf(ws.code)
  return {
    lines: [
      plain('[+] Building 1.2s (3/3) FINISHED', 'muted'),
      plain(' => [1/3] FROM docker.io/library/node:22-alpine', 'muted'),
      plain(' => [2/3] WORKDIR /app', 'muted'),
      plain(` => [3/3] COPY app.js .  (${ws.code.length} bytes)`, 'muted'),
      plain(` => exporting to image  sha256:${digest}`, 'muted'),
      plain(` => naming to ${r.image}`, 'muted'),
      plain(` => pushing ${r.image}`, 'muted'),
      plain(`Successfully built ${r.image}`, 'success'),
      note(`imutável: mudar app.js não muda esta imagem — para usá-la: kubectl set image deployment/backend backend=${r.image}`),
    ],
  }
}

/** A stable short "digest" of the code, so the same code always looks like the same image. */
function digestOf(code: string) {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < code.length; i++) {
    h1 = Math.imul(h1 ^ code.charCodeAt(i), 0x01000193)
    h2 = Math.imul(h2 ^ code.charCodeAt(i), 0x5bd1e995)
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).slice(0, 12)
}
