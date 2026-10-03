import { FilePenLine, Save } from 'lucide-react'
import { useSim } from '../store/useSim'
import { Modal } from './ui/Modal'

export function DeploymentEditor() {
  const editing = useSim((s) => s.editing)
  const update = useSim((s) => s.updateEditYaml)
  const save = useSim((s) => s.saveEdit)
  const cancel = useSim((s) => s.cancelEdit)

  return (
    <Modal open={!!editing} onClose={cancel} label={`Editar Deployment: ${editing?.name ?? ''}`} className="w-[min(760px,calc(100vw-2rem))] overflow-hidden">
      {editing && (
        <>
          <header className="flex items-center gap-3 border-b border-line px-5 py-3.5 pr-12">
            <span className="grid size-8 place-items-center rounded-lg border border-deploy/30 bg-deploy/10 text-deploy"><FilePenLine size={16} /></span>
            <div>
              <div className="text-[10px] font-semibold tracking-[0.1em] text-fg-faint uppercase">kubectl edit</div>
              <h1 className="text-[15px] font-semibold">deployment/{editing.name}</h1>
            </div>
          </header>
          <div className="px-5 py-4">
            <p className="mb-3 text-[12px] leading-relaxed text-fg-muted">
              Edite réplicas, imagem ou labels do template. O selector é imutável e as labels do template precisam continuar combinando com ele.
            </p>
            <textarea
              data-autofocus
              aria-label="YAML do Deployment"
              spellCheck={false}
              value={editing.yaml}
              onChange={(event) => update(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault()
                  void save()
                }
              }}
              className="h-[min(58vh,520px)] w-full resize-y rounded-xl border border-line-strong bg-bg/80 p-4 font-mono text-[12px] leading-[1.6] text-fg outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/10"
            />
            {editing.error && (
              <pre role="alert" className="mt-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg border border-crash/30 bg-crash/[0.06] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-crash">
                {editing.error}
              </pre>
            )}
          </div>
          <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
            <span className="text-[11px] text-fg-faint">Ctrl S salva · Esc cancela</span>
            <div className="flex gap-2">
              <button onClick={cancel} className="rounded-lg border border-line-strong px-3 py-1.5 text-[12px] text-fg-muted transition hover:bg-raised hover:text-fg">Cancelar</button>
              <button onClick={() => void save()} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-bg transition hover:brightness-110"><Save size={13} /> Salvar</button>
            </div>
          </footer>
        </>
      )}
    </Modal>
  )
}
