import { MotionConfig } from 'motion/react'
import { useEffect } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { Completion } from './components/Completion'
import { Inspector } from './components/Inspector'
import { LessonPanel } from './components/LessonPanel'
import { Stage } from './components/stage/Stage'
import { Terminal } from './components/Terminal'
import { Timeline } from './components/Timeline'
import { TopBar } from './components/TopBar'
import { cn } from './lib/visual'
import { useAuth } from './auth/auth'
import { SignInDialog } from './components/account/SignInDialog'
import { VerifyDialog } from './components/account/VerifyDialog'
import { Toaster } from './components/ui/Toaster'
import { ApostilaPanel } from './components/apostila/ApostilaPanel'
import { LessonTracker } from './lessons/useLesson'
import { useSim } from './store/useSim'

function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useSim.getState()
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        s.setPalette(!s.paletteOpen)
        return
      }
      const t = e.target as HTMLElement
      if (s.paletteOpen || t.closest('input, textarea, [contenteditable]') || document.querySelector('[aria-modal="true"]')) return
      if (e.key === ' ') {
        e.preventDefault()
        s.togglePause()
      } else if (e.key === '.') {
        s.step()
      } else if (e.key === '/') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('[data-terminal-input]')?.focus()
      } else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
        s.restart()
      } else if (e.key === 'Escape') {
        s.select(null)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected && s.cluster.pods[s.selected]) {
        s.exec(`kubectl delete pod ${s.cluster.pods[s.selected].name}`, 'ui')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  useEffect(() => {
    void useAuth.getState().init()
  }, [])
  const reduced = useSim((s) => s.reducedMotion)
  const paused = useSim((s) => s.paused)
  useGlobalKeys()

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className={cn('flex h-full flex-col', reduced && 'reduce-motion', paused && 'sim-paused')}>
        <TopBar />
        <div className="flex min-h-0 flex-1 flex-col overflow-auto lg:grid lg:grid-cols-[270px_minmax(0,1fr)_300px] lg:overflow-hidden xl:grid-cols-[300px_minmax(0,1fr)_340px]">
          <div className="order-2 shrink-0 border-t border-line bg-panel lg:order-none lg:min-h-0 lg:shrink lg:border-t-0 lg:border-r">
            <LessonPanel />
          </div>
          <main className="order-1 flex shrink-0 flex-col lg:order-none lg:min-h-0 lg:shrink">
            <div className="relative h-[620px] shrink-0 bg-bg lg:h-auto lg:min-h-0 lg:flex-1">
              <Stage />
              <Completion />
            </div>
            <div className="h-[300px] shrink-0 border-t border-line lg:h-[34%] lg:min-h-[190px]">
              <Terminal />
            </div>
          </main>
          <aside className="order-3 flex h-[640px] shrink-0 flex-col border-t border-line bg-panel lg:order-none lg:h-auto lg:min-h-0 lg:border-t-0 lg:border-l">
            <Inspector />
            <Timeline />
          </aside>
        </div>
      </div>
      <CommandPalette />
      <LessonTracker />
      <SignInDialog />
      <VerifyDialog />
      <ApostilaPanel />
      <Toaster />
    </MotionConfig>
  )
}
