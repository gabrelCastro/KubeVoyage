import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PrivacyPage } from './components/PrivacyPage'
import { installErrorReporting } from './lib/errorReporting'
import './index.css'

installErrorReporting()

// the one page outside the app: a real URL, so it can be linked from anywhere
const page = location.pathname.replace(/\/+$/, '') === '/privacidade' ? <PrivacyPage /> : <App />
if (page.type === PrivacyPage) document.title = 'Privacidade — KubeLearn'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>{page}</ErrorBoundary>
  </StrictMode>,
)
