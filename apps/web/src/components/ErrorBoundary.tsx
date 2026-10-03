import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from '../lib/errorReporting'

/** A crash while rendering shows a way out instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.PROD) reportError(error, 'render')
    else console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="grid min-h-screen place-items-center bg-bg px-6 text-fg">
        <div className="max-w-sm text-center">
          <h1 className="text-[18px] font-semibold">Algo quebrou por aqui</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">
            O erro foi registrado para ser corrigido. Seu progresso está salvo — recarregar a página deve resolver.
          </p>
          <button
            onClick={() => location.reload()}
            className="mt-5 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-semibold text-[#0b1020] transition hover:brightness-110"
          >
            Recarregar
          </button>
        </div>
      </div>
    )
  }
}
