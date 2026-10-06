import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PrivacyPage } from './components/PrivacyPage'
import { installErrorReporting } from './lib/errorReporting'
import './index.css'

installErrorReporting()

// pages outside the app: real URLs, so they can be linked from anywhere. The docs load on their own
// (they don't need the simulation, and the app doesn't need them).
const DocPage = lazy(() => import('./docs/DocPage').then((m) => ({ default: m.DocPage })))
const path = location.pathname.replace(/\/+$/, '')
const page =
  path === '/privacidade' ? (
    <PrivacyPage />
  ) : path === '/doc' || path === '/docs' ? (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <DocPage />
    </Suspense>
  ) : (
    <App />
  )
if (path === '/privacidade') document.title = 'Privacidade — KubeLearn'
if (path === '/doc' || path === '/docs') document.title = 'Documentação — KubeLearn'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>{page}</ErrorBoundary>
  </StrictMode>,
)
