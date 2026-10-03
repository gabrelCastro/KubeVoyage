import { AnimatePresence, motion } from 'motion/react'
import { BookOpen, CircleHelp, Keyboard, PlayCircle, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Kbd, MOD, Tooltip } from '../components/primitives'
import { Modal } from '../components/ui/Modal'
import { hasApostila } from '../lessons/apostilas'
import { useApostila } from '../lessons/apostilas/store'
import { useSim } from '../store/useSim'
import { startTour } from './Tour'

export const useHelp = create<{ shortcutsOpen: boolean; setShortcuts(open: boolean): void }>((set) => ({
  shortcutsOpen: false,
  setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
}))

export function HelpMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const lessonId = useSim((s) => s.lessonId)
  const openApostila = useApostila((s) => s.openApostila)
  const setShortcuts = useHelp((s) => s.setShortcuts)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const items = [
    { icon: PlayCircle, label: 'Rever o tutorial', run: startTour },
    { icon: Keyboard, label: 'Atalhos de teclado', keys: '?', run: () => setShortcuts(true) },
    ...(hasApostila(lessonId) ? [{ icon: BookOpen, label: 'Abrir a apostila desta lição', run: () => openApostila(lessonId) }] : []),
    { icon: ShieldCheck, label: 'Privacidade', run: () => window.open('/privacidade', '_blank', 'noopener') },
  ]

  return (
    <div ref={ref} className="relative" data-tour="ajuda">
      <Tooltip label="Ajuda">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Ajuda"
          className="grid size-8 place-items-center rounded-lg text-fg-faint transition hover:bg-raised hover:text-fg-muted"
        >
          <CircleHelp size={16} />
        </button>
      </Tooltip>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Ajuda"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            style={{ transformOrigin: 'top right' }}
            className="absolute top-full right-0 z-50 mt-2 w-[250px] rounded-xl border border-line-strong bg-raised p-1.5 shadow-[0_20px_50px_-12px_rgb(0_0_0/0.85)]"
          >
            {items.map(({ icon: Icon, label, keys, run }) => (
              <button
                key={label}
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  run()
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] text-fg-muted transition hover:bg-panel hover:text-fg focus-visible:bg-panel focus-visible:text-fg focus-visible:outline-none"
              >
                <Icon size={14} /> <span className="flex-1">{label}</span>
                {keys && <Kbd>{keys}</Kbd>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const SHORTCUTS: { group: string; items: [string[], string][] }[] = [
  {
    group: 'Simulação',
    items: [
      [['Espaço'], 'pausar ou continuar'],
      [['.'], 'avançar uma decisão (com a simulação pausada)'],
      [['R'], 'reiniciar a lição'],
    ],
  },
  {
    group: 'Palco',
    items: [
      [['Delete'], 'apagar o Pod selecionado'],
      [['Esc'], 'tirar a seleção'],
    ],
  },
  {
    group: 'Terminal',
    items: [
      [['/'], 'ir para o terminal'],
      [['Tab'], 'completar comandos e nomes de Pods'],
      [['↑', '↓'], 'navegar no histórico'],
      [['Esc'], 'parar o kubectl get pods -w'],
      [['Ctrl', 'L'], 'limpar a tela'],
    ],
  },
  {
    group: 'Geral',
    items: [
      [[MOD, 'K'], 'paleta de comandos'],
      [['?'], 'esta lista de atalhos'],
    ],
  },
]

export function ShortcutsDialog() {
  const open = useHelp((s) => s.shortcutsOpen)
  const setShortcuts = useHelp((s) => s.setShortcuts)
  return (
    <Modal open={open} onClose={() => setShortcuts(false)} label="Atalhos de teclado" className="w-[min(480px,100%)]">
      <div className="px-6 pt-6 pb-5">
        <h2 className="text-[17px] font-semibold tracking-tight">Atalhos de teclado</h2>
        <p className="mt-1 text-[12px] text-fg-faint">Fora do terminal e de campos de texto.</p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {SHORTCUTS.map((g) => (
            <section key={g.group}>
              <h3 className="mb-2 text-[10px] font-semibold tracking-[0.1em] text-fg-faint uppercase">{g.group}</h3>
              <dl className="flex flex-col gap-1.5">
                {g.items.map(([keys, what]) => (
                  <div key={what} className="flex items-start justify-between gap-3 text-[12px]">
                    <dt className="text-fg-muted">{what}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </Modal>
  )
}
