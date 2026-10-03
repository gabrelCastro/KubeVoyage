import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn, VISUAL, type PodVisual } from '../lib/visual'

/**
 * One glyph per lifecycle state. Each state has its own *kind* of motion, so the
 * state is readable even without color: hollow+drifting → filling → solid → breathing.
 */
export function StatusGlyph({ state, size = 16 }: { state: PodVisual; size?: number }) {
  const color = VISUAL[state].color
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={state}
          className="absolute inset-0 grid place-items-center"
          initial={{ scale: 0.4, opacity: 0, rotate: -45 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 26 }}
        >
          {state === 'ready' && (
            <span className="absolute inset-[3px] rounded-full anim-breathe" style={{ background: color }} />
          )}
          <svg viewBox="0 0 16 16" width={size} height={size} className={cn(state === 'pending' && 'anim-spin-slow', state === 'creating' && 'anim-spin')}>
            {state === 'pending' && <circle cx="8" cy="8" r="5.5" fill="none" stroke={color} strokeWidth="1.6" strokeDasharray="2.6 2.4" />}
            {state === 'creating' && (
              <>
                <circle cx="8" cy="8" r="5.5" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1.6" />
                <path d="M8 2.5 A5.5 5.5 0 0 1 8 13.5 Z" fill={color} />
              </>
            )}
            {state === 'running' && (
              <>
                <circle cx="8" cy="8" r="5.5" fill="none" stroke={color} strokeWidth="1.6" />
                <circle cx="8" cy="8" r="3" fill={color} />
              </>
            )}
            {state === 'ready' && <circle cx="8" cy="8" r="5" fill={color} />}
            {state === 'terminating' && <circle cx="8" cy="8" r="4.5" fill="none" stroke={color} strokeWidth="1.6" strokeDasharray="1 2.4" />}
            {state === 'crash' && (
              <>
                <path d="M8 2.2 L14 13 H2 Z" fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M8 6.2 V9.3" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="8" cy="11.3" r="0.9" fill={color} />
              </>
            )}
          </svg>
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/** Text that rolls vertically when it changes — a value changing is an event worth noticing. */
export function Rolling({ value, className }: { value: string | number; className?: string }) {
  return (
    <span className={cn('relative inline-flex overflow-hidden align-bottom', className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={String(value)}
          initial={{ y: '70%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-70%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="inline-block whitespace-nowrap"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/** Briefly tints when the value changes; settles back to the resting color. */
export function Metric({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'neutral' }) {
  const prev = useRef(value)
  const [flash, setFlash] = useState(0)
  useEffect(() => {
    if (prev.current !== value) setFlash((f) => f + 1)
    prev.current = value
  }, [value])
  const color = tone === 'ok' ? 'var(--color-ready)' : tone === 'warn' ? 'var(--color-warn)' : 'var(--color-fg)'
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9.5px] font-medium tracking-[0.08em] text-fg-faint uppercase">{label}</span>
      <motion.span
        key={flash}
        className="font-mono text-[17px] leading-none font-semibold tabular-nums"
        initial={flash ? { scale: 1.25 } : false}
        animate={{ scale: 1, color }}
        transition={{ type: 'spring', stiffness: 400, damping: 18 }}
        style={{ color, transformOrigin: 'left center' }}
      >
        <Rolling value={value} />
      </motion.span>
    </div>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-line-strong bg-panel-2 px-1 font-sans text-[10.5px] font-medium text-fg-muted',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

export function Tooltip({ label, children, side = 'bottom', className }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom'; className?: string }) {
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => (timer.current = window.setTimeout(() => setOpen(true), 350))}
      onMouseLeave={() => (clearTimeout(timer.current), setOpen(false))}
      onMouseDown={() => (clearTimeout(timer.current), setOpen(false))}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: side === 'bottom' ? -4 : 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 rounded-md border border-line-strong bg-raised px-2 py-1 text-[11.5px] whitespace-nowrap text-fg shadow-xl shadow-black/40',
              side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
            )}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

export function LabelChip({ k, v, tone = 'neutral' }: { k: string; v: string; tone?: 'neutral' | 'match' | 'muted' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[5px] border font-mono text-[11px] leading-[18px]',
        tone === 'match' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line-strong bg-panel-2 text-fg-muted',
        tone === 'muted' && 'opacity-60',
      )}
    >
      <span className="px-1.5 opacity-75">{k}</span>
      <span className="h-full border-l border-current/20 px-1.5 text-fg">{v}</span>
    </span>
  )
}

export type Kind = 'Deployment' | 'ReplicaSet' | 'Pod' | 'Service'

export const KIND_COLOR: Record<Kind, string> = {
  Deployment: 'var(--color-deploy)',
  ReplicaSet: 'var(--color-rs)',
  Pod: 'var(--color-fg-muted)',
  Service: 'var(--color-svc)',
}

export function KindBadge({ kind, className }: { kind: Kind; className?: string }) {
  const color = KIND_COLOR[kind]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[9.5px] font-semibold tracking-[0.1em] uppercase', className)} style={{ color }}>
      <KindIcon kind={kind} size={12} />
      {kind}
    </span>
  )
}

/** Small custom marks: a Deployment wraps, a ReplicaSet multiplies, a Pod is a unit. */
export function KindIcon({ kind, size = 14 }: { kind: Kind; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      {kind === 'Deployment' && (
        <>
          <path d="M8 1.8l5.4 3.1v6.2L8 14.2l-5.4-3.1V4.9z" />
          <path d="M8 5.3l2.4 1.4v2.6L8 10.7 5.6 9.3V6.7z" fill="currentColor" fillOpacity="0.35" />
        </>
      )}
      {kind === 'ReplicaSet' && (
        <>
          <rect x="2" y="5.5" width="8" height="8" rx="1.8" />
          <path d="M5 3.5V3a1 1 0 011-1h7a1 1 0 011 1v7a1 1 0 01-1 1h-.5" strokeOpacity="0.6" />
        </>
      )}
      {kind === 'Service' && (
        <>
          <circle cx="8" cy="12.5" r="1.8" />
          <path d="M8 10.7V8M8 8L3.5 4.5M8 8l4.5-3.5M8 8V3" strokeOpacity="0.7" />
          <circle cx="3.2" cy="3.8" r="1.2" fill="currentColor" />
          <circle cx="8" cy="2.6" r="1.2" fill="currentColor" />
          <circle cx="12.8" cy="3.8" r="1.2" fill="currentColor" />
        </>
      )}
      {kind === 'Pod' && (
        <>
          <path d="M8 2l5 2.8v6.4L8 14l-5-2.8V4.8z" />
          <path d="M3 4.8L8 7.6l5-2.8M8 7.6V14" strokeOpacity="0.6" />
        </>
      )}
    </svg>
  )
}

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
      <path d="M16 4.5l9.96 5.75v11.5L16 27.5 6.04 21.75v-11.5z" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="3.4" fill="var(--color-ready)" />
      <circle cx="16" cy="16" r="3.4" fill="var(--color-ready)" className="anim-breathe" style={{ transformOrigin: '16px 16px' }} />
    </svg>
  )
}

export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'
