import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cn } from '../../lib/visual'

/**
 * Accessible modal: fixed to the viewport, scrolls when taller than it, traps focus,
 * closes on Escape and backdrop click, and gives focus back to whatever opened it.
 */
export function Modal({
  open,
  onClose,
  children,
  label,
  className,
  dismissible = true,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  label: string
  className?: string
  dismissible?: boolean
}) {
  return <AnimatePresence>{open && <ModalBody onClose={onClose} label={label} className={className} dismissible={dismissible}>{children}</ModalBody>}</AnimatePresence>
}

function ModalBody({ onClose, children, label, className, dismissible }: { onClose: () => void; children: ReactNode; label: string; className?: string; dismissible: boolean }) {
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('[autofocus], input, button:not([data-close])')
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation()
        onClose()
      }
      if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        if (!items.length) return
        const [a, z] = [items[0], items[items.length - 1]]
        if (e.shiftKey && document.activeElement === a) (e.preventDefault(), z.focus())
        else if (!e.shiftKey && document.activeElement === z) (e.preventDefault(), a.focus())
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
  }, [onClose, dismissible])

  return (
    <motion.div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/55 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      onMouseDown={(e) => dismissible && e.target === e.currentTarget && onClose()}
    >
      <div className="flex min-h-full items-center justify-center p-4" onMouseDown={(e) => dismissible && e.target === e.currentTarget && onClose()}>
        <motion.div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          aria-describedby={id}
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.12 } }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className={cn('relative w-[min(420px,100%)] rounded-2xl border border-line-strong bg-panel shadow-[0_30px_80px_-20px_rgb(0_0_0/0.85)]', className)}
        >
          {dismissible && (
            <button data-close onClick={onClose} className="absolute top-3.5 right-3.5 rounded-md p-1 text-fg-faint transition hover:bg-raised hover:text-fg" aria-label="Close">
              <X size={15} />
            </button>
          )}
          <div id={id}>{children}</div>
        </motion.div>
      </div>
    </motion.div>
  )
}
