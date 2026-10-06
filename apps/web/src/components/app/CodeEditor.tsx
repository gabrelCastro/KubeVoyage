import { FlaskConical, Hammer, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/visual'
import { tryCode } from '../../runtime'
import { LIMITS, PROBE_PATHS, type Profile } from '../../runtime/program'
import { DEFAULT_CODE, nextTag, useApp } from '../../store/useApp'
import { useSim } from '../../store/useSim'
import { MOD } from '../primitives'
import { Modal } from '../ui/Modal'

/** Starting points, each showing one thing a container can do to the cluster. */
const TEMPLATES: { label: string; hint: string; code: string }[] = [
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

/** app.js — what the learner's images run. Saved as typed; nothing running changes until a build. */
export function CodeEditor() {
  const open = useApp((s) => s.codeOpen)
  const close = () => useApp.getState().openCode(false)
  return (
    <Modal open={open} onClose={close} label="app.js" className="w-[min(720px,calc(100vw-2rem))]">
      <Editor onClose={close} />
    </Modal>
  )
}

type Trial = { state: 'running'; code: string } | { state: 'done'; code: string; profile: Profile }

function Editor({ onClose }: { onClose: () => void }) {
  const stored = useApp((s) => s.code)
  const releases = useApp((s) => s.releases)
  const [code, setCode] = useState(() => stored ?? DEFAULT_CODE)
  // app.js changed outside this editor (another device, through sync): show that, or the next
  // keystroke here would save the old text over it as the newest edit
  const [seen, setSeen] = useState(stored)
  if (stored !== seen) {
    setSeen(stored)
    // null: the app was cleared (signed out) — back to the template, not the old text
    const next = stored ?? DEFAULT_CODE
    if (next !== code) setCode(next)
  }
  const [trial, setTrial] = useState<Trial | null>(null)
  const [saved, setSaved] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const gutter = useRef<HTMLDivElement>(null)
  const run = useRef(0)

  const change = (next: string) => {
    setCode(next)
    setSaved(false)
    useApp.getState().setCode(next)
  }
  const lines = code.split('\n').length
  const tooLong = code.length >= LIMITS.codeChars

  const test = async () => {
    const id = ++run.current
    const tried = code
    setTrial({ state: 'running', code: tried })
    const profile = await tryCode(tried)
    if (run.current === id) setTrial({ state: 'done', code: tried, profile })
  }
  const build = () => {
    onClose()
    void useSim.getState().exec(`docker build -t backend:${nextTag(releases)} .`, 'ui')
  }

  useEffect(() => () => void run.current++, [])

  return (
    <div className="px-6 pt-6 pb-5">
      <div className="flex items-baseline gap-2">
        <h2 className="font-mono text-[16px] font-semibold tracking-tight">app.js</h2>
        <span className="text-[11.5px] text-fg-faint">{saved ? 'salvo' : 'salvo automaticamente'}</span>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
        O código que roda dentro do container. Com <code className="font-mono text-fg">handle(req, env)</code> ele é um servidor; sem, uma tarefa que termina.{' '}
        <code className="font-mono text-fg">console.log</code> vai para <code className="font-mono text-fg">kubectl logs</code>. Mudar este arquivo não muda nenhum Pod: gere
        uma imagem e faça o rollout.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Modelos">
        {TEMPLATES.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => change(t.code)}
            title={t.hint}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11.5px] transition',
              code === t.code ? 'border-accent bg-accent/10 text-fg' : 'border-line text-fg-muted hover:border-line-strong hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex h-[min(340px,45vh)] overflow-hidden rounded-lg border border-line-strong bg-bg focus-within:border-accent/70">
        <div ref={gutter} aria-hidden className="shrink-0 overflow-hidden border-r border-line py-2 pr-2 pl-3 text-right font-mono text-[12px] leading-[1.6] text-fg-faint select-none">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={area}
          value={code}
          maxLength={LIMITS.codeChars}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Código de app.js"
          data-autofocus
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop
          }}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
              e.preventDefault()
              setSaved(true)
              return
            }
            if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
              e.preventDefault()
              const el = e.currentTarget
              const { selectionStart: a, selectionEnd: z } = el
              if (code.length - (z - a) + 2 > LIMITS.codeChars) return
              change(code.slice(0, a) + '  ' + code.slice(z))
              requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2))
            }
          }}
          className="min-w-0 flex-1 resize-none bg-transparent py-2 pr-3 pl-2 font-mono text-[12px] leading-[1.6] text-fg outline-none [tab-size:2]"
          style={{ whiteSpace: 'pre', overflowWrap: 'normal' }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-fg-faint">
        <span>
          Tab indenta · {MOD} S salva · Esc fecha
        </span>
        <span className={cn('tabular-nums', tooLong && 'text-warn')}>
          {code.length.toLocaleString('pt-BR')} / {LIMITS.codeChars.toLocaleString('pt-BR')}
        </span>
      </div>

      {trial && <TrialResult trial={trial} stale={trial.code !== code} />}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void test()}
          disabled={trial?.state === 'running'}
          className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[12.5px] text-fg transition hover:border-accent/60 disabled:opacity-60"
        >
          <FlaskConical size={14} /> {trial?.state === 'running' ? 'Testando…' : 'Testar'}
        </button>
        <button
          type="button"
          onClick={() => change(DEFAULT_CODE)}
          disabled={code === DEFAULT_CODE}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-fg-muted transition hover:text-fg disabled:opacity-40"
        >
          <RotateCcw size={13} /> Restaurar modelo
        </button>
        <button
          type="button"
          onClick={build}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-accent/90"
          title={`Roda no terminal: docker build -t backend:${nextTag(releases)} .`}
        >
          <Hammer size={14} /> Gerar imagem {nextTag(releases)}
        </button>
      </div>
    </div>
  )
}

/** What a test run did, outside any Pod and without the cluster's environment. */
function TrialResult({ trial, stale }: { trial: Trial; stale: boolean }) {
  if (trial.state === 'running') return <div className="mt-3 rounded-lg border border-line px-3 py-2 text-[12px] text-fg-muted">rodando…</div>
  const p = trial.profile
  const verdict = p.error
    ? { tone: 'text-crash', text: p.kind === 'script' ? 'A tarefa terminou com erro (exit code 1).' : 'O processo morre ao iniciar — num Pod, CrashLoopBackOff.' }
    : p.timedOut
      ? { tone: 'text-warn', text: 'Não terminou de iniciar a tempo: o processo fica preso.' }
      : p.kind === 'script'
        ? { tone: 'text-ready', text: 'Uma tarefa que terminou bem (exit code 0) — num Job, Completed.' }
        : { tone: 'text-ready', text: 'Um servidor: veja o que ele respondeu.' }
  return (
    <div className={cn('mt-3 rounded-lg border border-line bg-panel-2/40 px-3 py-2.5 text-[12px]', stale && 'opacity-60')} role="status">
      <div className={cn('font-medium', verdict.tone)}>{verdict.text}</div>
      {stale && <div className="mt-0.5 text-[11px] text-fg-faint">resultado de uma versão anterior do código — teste de novo</div>}
      {p.kind === 'server' && !p.error && !p.timedOut && (
        <ul className="mt-1.5 space-y-0.5 font-mono text-[11.5px]">
          {PROBE_PATHS.map((path) => {
            const r = p.replies[path]
            const text = !r ? '—' : 'timedOut' in r ? 'sem resposta (travou)' : 'error' in r ? `erro: ${r.error}` : `${r.status} ${r.body.split('\n')[0]}`
            const ok = r && 'status' in r && r.status < 400
            return (
              <li key={path} className="truncate">
                <span className="text-fg-faint">GET {path.padEnd(9)}</span> <span className={ok ? 'text-fg' : 'text-crash'}>{text}</span>
              </li>
            )
          })}
        </ul>
      )}
      {(p.logs.length > 0 || p.error) && (
        <pre className="mt-1.5 max-h-28 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg-muted">
          {[...p.logs, ...(p.error ? [p.error] : [])].join('\n')}
        </pre>
      )}
      <div className="mt-1.5 text-[11px] text-fg-faint">Teste sem variáveis de ambiente — no cluster, elas vêm de ConfigMaps e Secrets.</div>
    </div>
  )
}
