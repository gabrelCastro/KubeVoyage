import { useState } from 'react'
import { cn } from '../../lib/visual'
import { APP_COLORS, APP_EMOJIS, LIMITS, useApp, type AppColor, type AppDesign } from '../../store/useApp'
import { Modal } from '../ui/Modal'
import { AppPage } from './AppWindow'

/** Where the learner makes the app theirs. What they design is what the Pods serve. */
export function AppStudio() {
  const open = useApp((s) => s.studioOpen)
  const close = () => useApp.getState().openStudio(false)
  return (
    <Modal open={open} onClose={close} label="Criar seu app" className="w-[min(460px,calc(100vw-2rem))]">
      {/* mounted on open, so every visit starts from what's saved */}
      <StudioForm onClose={close} />
    </Modal>
  )
}

function StudioForm({ onClose: close }: { onClose: () => void }) {
  const [draft, setDraft] = useState<AppDesign>(() => useApp.getState().design)
  const save = () => {
    useApp.getState().setDesign({ ...draft, name: draft.name.trim() || 'Meu app', message: draft.message.trim() })
    close()
  }

  return (
    <form
      className="px-6 pt-6 pb-5"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <h2 className="text-[17px] font-semibold tracking-tight">Seu app</h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
        É isto que os seus Pods servem. Os visitantes que chegam pelo Service veem esta página — atendida por qualquer um dos Pods.
      </p>

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
              className={cn(
                'grid h-9 place-items-center rounded-lg border text-[18px] transition',
                draft.emoji === e ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong',
              )}
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
              className={cn(
                'size-8 rounded-full ring-2 ring-offset-2 ring-offset-panel transition',
                draft.color === c ? 'ring-fg' : 'ring-transparent hover:ring-line-strong',
              )}
              style={{ background: APP_COLORS[c] }}
            />
          ))}
        </div>
      </fieldset>

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
