import { completedCount } from '@kubelearn/shared'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, Check, Loader2, Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError } from '../../api/http'
import { useAuth } from '../../auth/auth'
import { useProgress } from '../../progress/browser'
import { cn } from '../../lib/visual'
import { Modal } from '../ui/Modal'

type Step = { kind: 'form'; error?: string } | { kind: 'sending' } | { kind: 'sent'; email: string; minutes: number }

const RESEND_AFTER = 30

export function SignInDialog() {
  const open = useAuth((s) => s.dialogOpen)
  const close = useAuth((s) => s.closeSignIn)
  return (
    <Modal open={open} onClose={close} label="Entrar no KubeLearn">
      <SignInFlow />
    </Modal>
  )
}

function SignInFlow() {
  const { requestLink, signInWithGithub, providers } = useAuth()
  const done = useProgress((s) => completedCount(s.progress))
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<Step>({ kind: 'form' })
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const send = async (address: string) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim())) {
      setStep({ kind: 'form', error: 'Esse endereço de e-mail não parece válido.' })
      return
    }
    setStep({ kind: 'sending' })
    try {
      const r = await requestLink(address.trim())
      setStep({ kind: 'sent', email: r.email, minutes: Math.round(r.expiresInSeconds / 60) })
      setCooldown(RESEND_AFTER)
    } catch (e) {
      setStep({ kind: 'form', error: explain(e) })
    }
  }

  return (
    <div className="px-6 pt-7 pb-6">
      <AnimatePresence mode="wait" initial={false}>
        {step.kind === 'sent' ? (
          <motion.div key="sent" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
            <motion.div
              initial={{ scale: 0.6, rotate: -8 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 16 }}
              className="grid size-11 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent"
            >
              <Mail size={20} />
            </motion.div>
            <h2 className="mt-4 text-[19px] font-semibold tracking-tight">Confira sua caixa de entrada</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
              Enviamos um link de acesso para <span className="font-medium text-fg">{step.email}</span>. Ele funciona uma vez e expira em {step.minutes} minutos. Você pode abri-lo em qualquer dispositivo.
            </p>
            {import.meta.env.DEV && (
              <a href="http://localhost:8025" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-dashed border-line-strong px-2 py-1 font-mono text-[11px] text-fg-faint transition hover:text-fg">
                dev · abrir Mailpit (localhost:8025) ↗
              </a>
            )}
            <div className="mt-6 flex items-center justify-between gap-2">
              <button onClick={() => setStep({ kind: 'form' })} className="flex items-center gap-1.5 text-[12.5px] text-fg-muted transition hover:text-fg">
                <ArrowLeft size={13} /> Usar outro e-mail
              </button>
              <button
                disabled={cooldown > 0}
                onClick={() => send(step.email)}
                className="rounded-lg border border-line-strong px-3 py-1.5 text-[12.5px] text-fg-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar link'}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.18 }}>
            <h2 className="text-[19px] font-semibold tracking-tight">Guarde seu progresso</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">Entre para salvar o que aprendeu e continuar de onde parou em qualquer dispositivo.</p>

            {providers.github && (
              <>
                <button
                  onClick={signInWithGithub}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-[13px] font-medium text-fg transition hover:border-fg-faint active:scale-[0.99]"
                >
                  <GithubMark /> Continuar com o GitHub
                </button>
                <div className="my-4 flex items-center gap-3 text-[11px] text-fg-faint">
                  <span className="h-px flex-1 bg-line" /> ou <span className="h-px flex-1 bg-line" />
                </div>
              </>
            )}

            <form
              className={cn(!providers.github && 'mt-5')}
              onSubmit={(e) => {
                e.preventDefault()
                void send(email)
              }}
              noValidate
            >
              <label htmlFor="signin-email" className="text-[12px] font-medium text-fg-muted">
                E-mail
              </label>
              <input
                id="signin-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (step.kind === 'form' && step.error) setStep({ kind: 'form' })
                }}
                placeholder="voce@exemplo.com"
                aria-invalid={step.kind === 'form' && !!step.error}
                aria-describedby={step.kind === 'form' && step.error ? 'signin-error' : undefined}
                className={cn(
                  'mt-1.5 w-full rounded-lg border bg-bg px-3 py-2.5 text-[13.5px] text-fg outline-none transition placeholder:text-fg-faint focus:border-accent/70 focus-visible:outline-none',
                  step.kind === 'form' && step.error ? 'border-terminating/60' : 'border-line-strong',
                )}
              />
              <AnimatePresence>
                {step.kind === 'form' && step.error && (
                  <motion.p id="signin-error" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-1.5 text-[12px] text-terminating">
                    {step.error}
                  </motion.p>
                )}
              </AnimatePresence>
              <button
                type="submit"
                disabled={step.kind === 'sending'}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-[13px] font-semibold text-[#0b1020] transition hover:brightness-110 active:scale-[0.99] disabled:opacity-70"
              >
                {step.kind === 'sending' ? <Loader2 size={15} className="anim-spin" /> : null}
                {step.kind === 'sending' ? 'Enviando…' : 'Enviar um link de acesso por e-mail'}
              </button>
            </form>

            <p className="mt-4 text-[11.5px] leading-relaxed text-fg-faint">Sem senha. O link funciona uma vez e expira em 10 minutos.</p>
            {done > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-fg-muted">
                <Check size={12} className="text-ready" /> {done === 1 ? 'A lição que você concluiu neste dispositivo vai com você.' : `As ${done} lições que você concluiu neste dispositivo vão com você.`}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function explain(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.network) return 'Não foi possível acessar o servidor agora. Seu progresso está seguro neste dispositivo — tente novamente em instantes.'
    if (e.code === 'rate_limited') {
      const m = Math.ceil((e.retryAfterSeconds ?? 60) / 60)
      return `Muitos links foram solicitados. Tente novamente ${m === 1 ? 'em 1 minuto' : `em ${m} minutos`}.`
    }
    if (e.code === 'invalid_request') return 'Esse endereço de e-mail não parece válido.'
    return e.message
  }
  return 'Algo deu errado. Tente novamente.'
}

export function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}
