import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useToasts } from '../../ui/toast'

const ICON = { success: CircleCheck, info: Info, error: CircleAlert }
const COLOR = { success: 'var(--color-ready)', info: 'var(--color-accent)', error: 'var(--color-crash)' }

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite" role="status">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICON[t.tone]
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="pointer-events-auto flex w-[min(400px,100%)] items-start gap-2.5 rounded-xl border border-line-strong bg-raised px-3.5 py-3 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.8)]"
            >
              <Icon size={16} className="mt-[1px] shrink-0" style={{ color: COLOR[t.tone] }} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-fg">{t.title}</div>
                {t.body && <div className="mt-0.5 text-[12px] leading-relaxed text-fg-muted">{t.body}</div>}
              </div>
              <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-fg-faint transition hover:text-fg" aria-label="Dismiss">
                <X size={13} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
