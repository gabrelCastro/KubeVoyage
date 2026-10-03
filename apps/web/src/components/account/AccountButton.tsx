import { completedCount, LESSON_IDS } from '@kubelearn/shared'
import { AnimatePresence, motion } from 'motion/react'
import { CloudCheck, CloudOff, Download, LogOut, RefreshCw, RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth, type User } from '../../auth/auth'
import { progressSync, useProgress } from '../../progress/browser'
import type { SyncState } from '../../progress/sync'
import { cn } from '../../lib/visual'
import { Tooltip } from '../primitives'
import { Modal } from '../ui/Modal'

export function AccountButton() {
  const status = useAuth((s) => s.status)
  const user = useAuth((s) => s.user)
  const openSignIn = useAuth((s) => s.openSignIn)
  const sync = useProgress((s) => s.sync)
  const [open, setOpen] = useState(false)

  if (status === 'unknown') return <span className="skeleton size-7 rounded-full" aria-hidden />

  if (status === 'anonymous' || !user) {
    return (
      <Tooltip label="O progresso está salvo apenas neste dispositivo">
        <button
          onClick={openSignIn}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-[12.5px] text-fg-muted transition hover:border-fg-faint hover:text-fg"
        >
          <CloudOff size={14} /> Entrar
        </button>
      </Tooltip>
    )
  }

  return (
    <div className="relative">
      <Tooltip label={syncLabel(sync)}>
        <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="relative grid size-8 place-items-center rounded-full transition hover:ring-2 hover:ring-line-strong" aria-label={`Conta: ${user.email}`}>
          <Avatar user={user} size={28} />
          <SyncDot state={sync} />
        </button>
      </Tooltip>
      <AnimatePresence>{open && <AccountMenu user={user} sync={sync} onClose={() => setOpen(false)} />}</AnimatePresence>
    </div>
  )
}

export function Avatar({ user, size }: { user: User; size: number }) {
  const [broken, setBroken] = useState(false)
  if (user.avatarUrl && !broken) {
    return <img src={user.avatarUrl} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} className="rounded-full bg-raised object-cover" style={{ width: size, height: size }} />
  }
  const label = (user.name ?? user.email).trim()
  const hue = [...user.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)
  return (
    <span className="grid place-items-center rounded-full font-semibold text-[#0b1020]" style={{ width: size, height: size, fontSize: size * 0.42, background: `oklch(0.78 0.09 ${hue})` }} aria-hidden>
      {label[0]?.toUpperCase()}
    </span>
  )
}

function SyncDot({ state }: { state: SyncState }) {
  const color = { local: 'var(--color-fg-faint)', syncing: 'var(--color-accent)', synced: 'var(--color-ready)', offline: 'var(--color-warn)', error: 'var(--color-crash)' }[state.status]
  return (
    <span className="absolute -right-0.5 -bottom-0.5 grid size-3 place-items-center rounded-full bg-panel">
      <motion.span key={state.status} initial={{ scale: 0 }} animate={{ scale: 1 }} className={cn('size-2 rounded-full', state.status === 'syncing' && 'animate-pulse')} style={{ background: color }} />
    </span>
  )
}

function syncLabel(s: SyncState) {
  switch (s.status) {
    case 'syncing':
      return 'Sincronizando…'
    case 'synced':
      return `Todo o progresso foi sincronizado${s.lastSyncedAt ? ` · ${ago(s.lastSyncedAt)}` : ''}`
    case 'offline':
      return 'Offline — será sincronizado quando você voltar'
    case 'error':
      return 'Não foi possível sincronizar — tentando novamente'
    default:
      return 'Sem sincronização'
  }
}

function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 10) return 'agora mesmo'
  if (s < 60) return `há ${s}s`
  const m = Math.round(s / 60)
  return m < 60 ? `há ${m} min` : `há ${Math.round(m / 60)} h`
}

function AccountMenu({ user, sync, onClose }: { user: User; sync: SyncState; onClose: () => void }) {
  const { signOut } = useAuth()
  const done = useProgress((s) => completedCount(s.progress))
  const ref = useRef<HTMLDivElement>(null)
  const [confirm, setConfirm] = useState<'reset' | 'delete' | null>(null)
  const [, rerender] = useState(0)

  // keep "synced · 2 min ago" honest while the menu is open
  useEffect(() => {
    const t = setInterval(() => rerender((n) => n + 1), 10_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => !confirm && ref.current && !ref.current.contains(e.target as Node) && onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !confirm && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, confirm])

  const SyncIcon = sync.status === 'synced' ? CloudCheck : sync.status === 'syncing' ? RefreshCw : sync.status === 'error' ? TriangleAlert : CloudOff
  const syncColor = sync.status === 'synced' ? 'text-ready' : sync.status === 'error' ? 'text-crash' : sync.status === 'offline' ? 'text-warn' : 'text-fg-muted'

  return (
    <>
      <motion.div
        ref={ref}
        role="menu"
        aria-label="Conta"
        initial={{ opacity: 0, y: -6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }}
        transition={{ type: 'spring', stiffness: 500, damping: 34 }}
        style={{ transformOrigin: 'top right' }}
        className="absolute top-full right-0 z-50 mt-2 w-[280px] overflow-hidden rounded-xl border border-line-strong bg-raised shadow-[0_20px_50px_-12px_rgb(0_0_0/0.85)]"
      >
        <div className="flex items-center gap-3 px-3.5 pt-3.5 pb-3">
          <Avatar user={user} size={36} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-fg">{user.name ?? user.email.split('@')[0]}</div>
            <div className="truncate text-[11.5px] text-fg-faint">{user.email}</div>
          </div>
        </div>
        <div className="mx-3.5 rounded-lg border border-line bg-panel px-3 py-2.5">
          <div className={cn('flex items-center gap-1.5 text-[12px]', syncColor)}>
            <SyncIcon size={13} className={cn(sync.status === 'syncing' && 'anim-spin')} />
            <span>{syncLabel(sync)}</span>
            {(sync.status === 'error' || sync.status === 'offline') && (
              <button onClick={() => void progressSync.syncNow()} className="ml-auto text-[11.5px] text-accent hover:underline">
                Tentar novamente
              </button>
            )}
          </div>
          <div className="mt-2 flex gap-[3px]" aria-hidden>
            {LESSON_IDS.map((id, i) => (
              <span key={id} className={cn('h-1 flex-1 rounded-full', i < done ? 'bg-ready' : 'bg-line-strong')} />
            ))}
          </div>
          <div className="mt-1.5 text-[11.5px] text-fg-muted">
            {done} de {LESSON_IDS.length} lições concluídas
          </div>
        </div>
        <div className="mt-2 border-t border-line p-1.5">
          <MenuItem icon={LogOut} onClick={() => (onClose(), void signOut())}>
            Sair
          </MenuItem>
          {/* a plain navigation: the response is an attachment, so the page stays put */}
          <MenuItem icon={Download} onClick={() => (onClose(), location.assign('/api/me/export'))}>
            Baixar meus dados
          </MenuItem>
          <MenuItem icon={RotateCcw} onClick={() => setConfirm('reset')}>
            Reiniciar progresso…
          </MenuItem>
          <MenuItem icon={Trash2} danger onClick={() => setConfirm('delete')}>
            Apagar conta…
          </MenuItem>
        </div>
      </motion.div>
      <ConfirmReset open={confirm === 'reset'} onClose={() => setConfirm(null)} onDone={onClose} />
      <ConfirmDelete open={confirm === 'delete'} email={user.email} onClose={() => setConfirm(null)} onDone={onClose} />
    </>
  )
}

function MenuItem({ icon: Icon, children, onClick, danger }: { icon: typeof LogOut; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] transition focus-visible:outline-none',
        danger ? 'text-terminating hover:bg-terminating/10 focus-visible:bg-terminating/10' : 'text-fg-muted hover:bg-panel hover:text-fg focus-visible:bg-panel focus-visible:text-fg',
      )}
    >
      <Icon size={14} /> {children}
    </button>
  )
}

function ConfirmReset({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const resetProgress = useAuth((s) => s.resetProgress)
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={open} onClose={onClose} label="Reiniciar progresso">
      <div className="px-6 pt-7 pb-6">
        <h2 className="text-[17px] font-semibold tracking-tight">Reiniciar todo o progresso?</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">Todas as lições voltam ao início em todos os dispositivos. Sua conta continua ativa.</p>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] text-fg-muted transition hover:text-fg">
            Cancelar
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await resetProgress()
                onClose()
                onDone()
              } finally {
                setBusy(false)
              }
            }}
            className="rounded-lg border border-terminating/40 bg-terminating/10 px-3.5 py-2 text-[13px] font-medium text-terminating transition hover:bg-terminating/20 disabled:opacity-60"
          >
            Reiniciar progresso
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ConfirmDelete({ open, email, onClose, onDone }: { open: boolean; email: string; onClose: () => void; onDone: () => void }) {
  const deleteAccount = useAuth((s) => s.deleteAccount)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = typed.trim().toLowerCase() === 'apagar'
  return (
    <Modal open={open} onClose={onClose} label="Apagar conta">
      <div className="px-6 pt-7 pb-6">
        <h2 className="text-[17px] font-semibold tracking-tight">Apagar sua conta?</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
          Isso apaga permanentemente <span className="text-fg">{email}</span> e todo o progresso, além de encerrar sua sessão em todos os dispositivos. Não é possível desfazer.
        </p>
        <label htmlFor="confirm-delete" className="mt-4 block text-[12px] text-fg-muted">
          Digite <span className="font-mono text-fg">apagar</span> para confirmar
        </label>
        <input
          id="confirm-delete"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-line-strong bg-bg px-3 py-2 font-mono text-[13px] outline-none focus:border-terminating/60 focus-visible:outline-none"
        />
        {error && <p className="mt-2 text-[12px] text-terminating">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] text-fg-muted transition hover:text-fg">
            Cancelar
          </button>
          <button
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await deleteAccount()
                onClose()
                onDone()
              } catch {
                setError('Não foi possível apagar a conta. Tente novamente.')
              } finally {
                setBusy(false)
              }
            }}
            className="rounded-lg bg-terminating px-3.5 py-2 text-[13px] font-semibold text-[#1a0b0d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apagar conta
          </button>
        </div>
      </div>
    </Modal>
  )
}
