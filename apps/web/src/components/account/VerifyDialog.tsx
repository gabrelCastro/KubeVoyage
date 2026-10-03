import { motion } from 'motion/react'
import { CircleAlert, Loader2, LogIn } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../auth/auth'
import { Modal } from '../ui/Modal'
import { explain } from './SignInDialog'

/**
 * Opened from the email link. Signing in waits for a click on purpose: mail scanners
 * pre-open links, and must not be able to spend the token on someone's behalf.
 */
export function VerifyDialog() {
  const token = useAuth((s) => s.pendingToken)
  const dismiss = useAuth((s) => s.dismissLink)
  return (
    <Modal open={!!token} onClose={dismiss} label="Concluir acesso">
      <VerifyBody />
    </Modal>
  )
}

function VerifyBody() {
  const { confirmLink, dismissLink, openSignIn } = useAuth()
  const [state, setState] = useState<{ kind: 'ready' } | { kind: 'working' } | { kind: 'failed'; message: string; expired: boolean }>({ kind: 'ready' })

  const go = async () => {
    setState({ kind: 'working' })
    try {
      await confirmLink()
    } catch (e) {
      const code = (e as { code?: string }).code
      setState({ kind: 'failed', message: code === 'invalid_link' ? 'Este link expirou ou já foi usado.' : explain(e), expired: code === 'invalid_link' })
    }
  }

  if (state.kind === 'failed') {
    return (
      <div className="px-6 pt-7 pb-6">
        <div className="grid size-11 place-items-center rounded-xl border border-crash/30 bg-crash/10 text-crash">
          <CircleAlert size={20} />
        </div>
        <h2 className="mt-4 text-[19px] font-semibold tracking-tight">Não foi possível entrar</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{state.message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={dismissLink} className="rounded-lg px-3 py-2 text-[13px] text-fg-muted transition hover:text-fg">
            Agora não
          </button>
          {state.expired ? (
            <button
              onClick={() => {
                dismissLink()
                openSignIn()
              }}
              className="rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-[#0b1020] transition hover:brightness-110"
            >
              Enviar um novo link
            </button>
          ) : (
            <button onClick={go} className="rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-[#0b1020] transition hover:brightness-110">
              Tentar novamente
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 pt-7 pb-6">
      <motion.div initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 16 }} className="grid size-11 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
        <LogIn size={20} />
      </motion.div>
      <h2 className="mt-4 text-[19px] font-semibold tracking-tight">Concluir acesso</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">Continue para entrar neste dispositivo. Tudo o que você fez enquanto estava fora da conta será mantido.</p>
      <button
        autoFocus
        onClick={go}
        disabled={state.kind === 'working'}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-[13px] font-semibold text-[#0b1020] transition hover:brightness-110 active:scale-[0.99] disabled:opacity-70"
      >
        {state.kind === 'working' && <Loader2 size={15} className="anim-spin" />}
        {state.kind === 'working' ? 'Entrando…' : 'Continuar'}
      </button>
    </div>
  )
}
