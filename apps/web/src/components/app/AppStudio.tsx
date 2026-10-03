import { CircleAlert, Lock, Plus, Rocket } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../../lib/visual'
import { IMAGE } from '../../sim/manifests'
import { APP_COLORS, APP_EMOJIS, imageOf, LIMITS, MAX_RELEASES, nextTag, useApp, type AppColor, type AppDesign } from '../../store/useApp'
import { useSim } from '../../store/useSim'
import { Modal } from '../ui/Modal'
import { AppPage } from './AppWindow'

/**
 * Where the learner makes the app theirs — and ships versions of it. Publishing is the
 * `docker build && docker push` step: it makes an image. Deploying it is kubectl's job.
 */
export function AppStudio() {
  const open = useApp((s) => s.studioOpen)
  const close = () => useApp.getState().openStudio(false)
  return (
    <Modal open={open} onClose={close} label="Seu app" className="w-[min(480px,calc(100vw-2rem))]">
      {/* mounted on open, so every visit starts from what's saved */}
      <Studio onClose={close} />
    </Modal>
  )
}

type View = { kind: 'base' } | { kind: 'release'; tag: string; justPublished?: boolean } | { kind: 'new' }

const BASE_TAG = IMAGE.split(':')[1]

function Studio({ onClose: close }: { onClose: () => void }) {
  const releases = useApp((s) => s.releases)
  const [view, setView] = useState<View>({ kind: 'base' })

  return (
    <div className="px-6 pt-6 pb-5">
      <h2 className="text-[17px] font-semibold tracking-tight">Seu app</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
        É isto que os seus Pods servem. Cada versão publicada vira uma imagem com tag própria — e quem decide qual delas roda é o Deployment.
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Versões">
        <Chip active={view.kind === 'base'} onClick={() => setView({ kind: 'base' })}>
          {BASE_TAG} <span className="text-fg-faint">· inicial</span>
        </Chip>
        {releases.map((r) => (
          <Chip key={r.tag} active={view.kind === 'release' && view.tag === r.tag} onClick={() => setView({ kind: 'release', tag: r.tag })}>
            <span aria-hidden>{r.design.emoji}</span> {r.tag}
            {r.broken && <CircleAlert size={12} className="text-crash" aria-label="com bug" />}
          </Chip>
        ))}
        {releases.length < MAX_RELEASES && (
          <Chip active={view.kind === 'new'} onClick={() => setView({ kind: 'new' })}>
            <Plus size={12} /> Nova versão
          </Chip>
        )}
      </div>

      {view.kind === 'base' && <BaseEditor onClose={close} />}
      {view.kind === 'new' && <NewRelease onPublished={(tag) => setView({ kind: 'release', tag, justPublished: true })} onCancel={close} />}
      {view.kind === 'release' && <ReleaseView tag={view.tag} justPublished={view.justPublished} onClose={close} />}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[11.5px] transition',
        active ? 'border-accent bg-accent/10 text-fg' : 'border-line text-fg-muted hover:border-line-strong hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

/** The editable fields of a design, with a live preview on top. */
function DesignFields({ draft, setDraft }: { draft: AppDesign; setDraft: (d: AppDesign) => void }) {
  return (
    <>
      <div className="mt-4">
        <AppPage design={draft} />
      </div>
      <label className="mt-4 block text-[11.5px] font-medium text-fg-muted">
        Nome
        <input
          value={draft.name}
          maxLength={LIMITS.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          data-autofocus
          className="mt-1 w-full rounded-lg border border-line-strong bg-bg px-3 py-2 text-[13px] text-fg outline-none focus:border-accent/70"
        />
      </label>
      <label className="mt-3 block text-[11.5px] font-medium text-fg-muted">
        Mensagem
        <input
          value={draft.message}
          maxLength={LIMITS.message}
          onChange={(e) => setDraft({ ...draft, message: e.target.value })}
          className="mt-1 w-full rounded-lg border border-line-strong bg-bg px-3 py-2 text-[13px] text-fg outline-none focus:border-accent/70"
        />
      </label>
      <fieldset className="mt-3">
        <legend className="text-[11.5px] font-medium text-fg-muted">Ícone</legend>
        <div className="mt-1 grid grid-cols-8 gap-1.5">
          {APP_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setDraft({ ...draft, emoji: e })}
              aria-pressed={draft.emoji === e}
              aria-label={`Ícone ${e}`}
              className={cn('grid h-9 place-items-center rounded-lg border text-[18px] transition', draft.emoji === e ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong')}
            >
              {e}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-3">
        <legend className="text-[11.5px] font-medium text-fg-muted">Cor</legend>
        <div className="mt-1 flex gap-2">
          {(Object.keys(APP_COLORS) as AppColor[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setDraft({ ...draft, color: c })}
              aria-pressed={draft.color === c}
              aria-label={`Cor ${c}`}
              className={cn('size-8 rounded-full ring-2 ring-offset-2 ring-offset-panel transition', draft.color === c ? 'ring-fg' : 'ring-transparent hover:ring-line-strong')}
              style={{ background: APP_COLORS[c] }}
            />
          ))}
        </div>
      </fieldset>
    </>
  )
}

const tidy = (d: AppDesign): AppDesign => ({ ...d, name: d.name.trim() || 'Meu app', message: d.message.trim() })

function BaseEditor({ onClose: close }: { onClose: () => void }) {
  const [draft, setDraft] = useState<AppDesign>(() => useApp.getState().design)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        useApp.getState().setDesign(tidy(draft))
        close()
      }}
    >
      <p className="mt-3 text-[11.5px] leading-relaxed text-fg-faint">
        A {BASE_TAG} é a versão que as lições usam. Mudar aqui muda o que todos os Pods {BASE_TAG} mostram.
      </p>
      <DesignFields draft={draft} setDraft={setDraft} />
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={close} className="rounded-lg px-3 py-2 text-[13px] text-fg-muted transition hover:text-fg">
          Cancelar
        </button>
        <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-[#0b1020] transition hover:brightness-110">
          Salvar
        </button>
      </div>
    </form>
  )
}

function NewRelease({ onPublished, onCancel }: { onPublished: (tag: string) => void; onCancel: () => void }) {
  const releases = useApp((s) => s.releases)
  // start from the latest version, so a new one is "the same app, changed a little"
  const [draft, setDraft] = useState<AppDesign>(() => {
    const s = useApp.getState()
    return s.releases.at(-1)?.design ?? s.design
  })
  const [broken, setBroken] = useState(false)
  const tag = nextTag(releases)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (useApp.getState().publish(tidy(draft), broken)) onPublished(tag)
      }}
    >
      <p className="mt-3 text-[11.5px] leading-relaxed text-fg-faint">
        Mude o que quiser e publique: vira a imagem <code className="font-mono text-fg-muted">{imageOf(tag)}</code>.
      </p>
      <DesignFields draft={draft} setDraft={setDraft} />
      <label className="mt-4 flex items-start gap-2.5 rounded-lg border border-line px-3 py-2.5 text-[12px] leading-relaxed text-fg-muted">
        <input type="checkbox" checked={broken} onChange={(e) => setBroken(e.target.checked)} className="mt-0.5 accent-[var(--color-crash)]" />
        <span>
          <span className="text-fg">Publicar com um bug</span> — esquecer a variável <code className="font-mono">DATABASE_URL</code>. O container vai quebrar ao iniciar,
          como a 1.5 da lição 6.
        </span>
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-[13px] text-fg-muted transition hover:text-fg">
          Cancelar
        </button>
        <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-[#0b1020] transition hover:brightness-110">
          Publicar {tag}
        </button>
      </div>
    </form>
  )
}

function ReleaseView({ tag, justPublished, onClose: close }: { tag: string; justPublished?: boolean; onClose: () => void }) {
  const release = useApp((s) => s.releases.find((r) => r.tag === tag))
  const deployment = useSim((s) => Object.values(s.cluster.deployments).find((d) => d.name === 'backend'))
  if (!release) return null
  const image = imageOf(tag)
  const running = deployment?.template.image === image
  const command = `kubectl set image deployment/backend backend=${image}`
  return (
    <div>
      {justPublished && <p className="mt-3 rounded-lg border border-ready/30 bg-ready/[0.06] px-3 py-2 text-[12px] text-ready">Publicada! A imagem existe — mas nenhum Pod a usa ainda.</p>}
      <div className="mt-4">
        <AppPage design={release.design} />
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-fg-faint">Imagem</dt>
        <dd className="truncate font-mono text-fg-muted">{image}</dd>
        {release.broken && (
          <>
            <dt className="text-fg-faint">Bug</dt>
            <dd className="text-crash">sem DATABASE_URL — quebra ao iniciar</dd>
          </>
        )}
      </dl>
      <p className="mt-3 flex gap-2 text-[11.5px] leading-relaxed text-fg-faint">
        <Lock size={13} className="mt-0.5 shrink-0" />
        Uma imagem publicada não muda. Para mudar o app, publique outra versão — é assim que o Deployment consegue voltar atrás com rollback.
      </p>
      <div className="mt-6 flex items-center justify-end gap-2">
        {!deployment ? (
          <span className="mr-auto text-[11.5px] text-fg-faint">Aplique o backend.yaml para ter onde implantar.</span>
        ) : running ? (
          <span className="mr-auto text-[11.5px] text-ready">É a versão no template do Deployment agora.</span>
        ) : null}
        <button type="button" onClick={close} className="rounded-lg px-3 py-2 text-[13px] text-fg-muted transition hover:text-fg">
          Fechar
        </button>
        <button
          type="button"
          disabled={!deployment || running}
          onClick={() => {
            useSim.getState().setDraft(command)
            close()
          }}
          title={command}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-[#0b1020] transition hover:brightness-110 disabled:opacity-40"
        >
          <Rocket size={14} /> Implantar no cluster
        </button>
      </div>
      {deployment && !running && (
        <p className="mt-2 text-right text-[11px] text-fg-faint">
          coloca <code className="font-mono">kubectl set image</code> no terminal — o rollout é com você
        </p>
      )}
    </div>
  )
}
