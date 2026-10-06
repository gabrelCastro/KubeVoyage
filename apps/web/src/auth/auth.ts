import { completedCount } from '@kubelearn/shared'
import { create } from 'zustand'
import { api, ApiError } from '../api/http'
import { progressSync, setUnauthorizedHandler } from '../progress/browser'
import { claimApp, forgetApp, setWorkspaceUnauthorizedHandler, workspaceSync } from '../workspace/browser'
import { getLesson } from '../lessons'
import { useSim } from '../store/useSim'
import { toast } from '../ui/toast'

export interface User {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  providers: string[]
  createdAt: string
}

export interface Providers {
  email: boolean
  github: boolean
}

type Status = 'unknown' | 'anonymous' | 'signed-in'

interface AuthStore {
  status: Status
  user: User | null
  providers: Providers
  dialogOpen: boolean
  /** A sign-in link token taken from the URL, waiting for the person to confirm. */
  pendingToken: string | null

  init(): Promise<void>
  openSignIn(): void
  closeSignIn(): void
  requestLink(email: string): Promise<{ email: string; expiresInSeconds: number }>
  confirmLink(): Promise<User>
  dismissLink(): void
  signInWithGithub(): void
  signOut(): Promise<void>
  deleteAccount(): Promise<void>
  resetProgress(): Promise<void>
}

const RETURN_KEY = 'kubelearn.auth.return'

function signedIn(set: (s: Partial<AuthStore>) => void, user: User) {
  set({ status: 'signed-in', user, dialogOpen: false, pendingToken: null })
  void progressSync.setSignedIn(true).then(resumeIfIdle)
  // "your app" comes along: what this device made while signed out is uploaded, the account's is merged in
  // (an app another account left on this device is dropped, never uploaded into this one)
  claimApp(user.id)
  void workspaceSync.setSignedIn(true)
}

/**
 * After the first sync, the account may know a more recent lesson (from another device).
 * Take the learner there — but only if they haven't started doing anything here.
 */
function resumeIfIdle() {
  const last = progressSync.progress.last?.lessonId
  const sim = useSim.getState()
  if (!last || last === sim.lessonId || sim.events.some((e) => e.source === 'you')) return
  sim.openLesson(last)
  toast({ tone: 'info', title: 'Continuamos de onde você parou', body: `De volta a ${getLesson(last).title}.` })
}

function becameAnonymous(set: (s: Partial<AuthStore>) => void) {
  set({ status: 'anonymous', user: null })
  progressSync.setSignedIn(false)
  void workspaceSync.setSignedIn(false)
}

export const useAuth = create<AuthStore>((set, get) => ({
  status: 'unknown',
  user: null,
  providers: { email: true, github: false },
  dialogOpen: false,
  pendingToken: null,

  async init() {
    takeTokenFromUrl(set)
    const flags = takeFlagsFromUrl()
    void api<Providers>('/api/auth/providers')
      .then((providers) => set({ providers }))
      .catch(() => {})
    try {
      const had = completedCount(progressSync.progress)
      signedIn(set, await api<User>('/api/me'))
      if (flags.signedIn) welcome(get().user!, had)
    } catch (e) {
      becameAnonymous(set)
      if (e instanceof ApiError && e.network) {
        // the app works fully offline; account features just wait
        console.info('KubeLearn: a API está inacessível; por enquanto, o progresso fica neste dispositivo.')
      }
    }
    if (flags.error) {
      toast({
        tone: 'error',
        title: 'Não foi possível entrar com o GitHub',
        body: flags.error === 'no_verified_email' ? 'Sua conta do GitHub não tem um e-mail verificado. Verifique um e-mail no GitHub ou use um link por e-mail.' : 'Tente novamente.',
      })
    }
  },

  openSignIn: () => set({ dialogOpen: true }),
  closeSignIn: () => set({ dialogOpen: false }),

  requestLink: (email) => api('/api/auth/magic-link', { method: 'POST', body: { email } }),

  async confirmLink() {
    const token = get().pendingToken
    if (!token) throw new ApiError(401, 'invalid_link', 'Não há link de acesso para confirmar.')
    const had = completedCount(progressSync.progress)
    const user = await api<User>('/api/auth/magic-link/verify', { method: 'POST', body: { token } })
    signedIn(set, user)
    welcome(user, had)
    return user
  },

  dismissLink: () => set({ pendingToken: null }),

  signInWithGithub() {
    // come back to the same lesson afterwards
    try {
      sessionStorage.setItem(RETURN_KEY, location.hash)
    } catch {
      // fine: we'll land on the last lesson instead
    }
    location.assign('/oauth2/authorization/github')
  },

  async signOut() {
    // what changed in the last moments goes up first (a few seconds at most)
    await Promise.all([workspaceSync.settle(), progressSync.settle()])
    const unsentApp = workspaceSync.hasPending()
    const unsentProgress = progressSync.hasPending()
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    becameAnonymous(set)
    // the account keeps the progress and the app; this (possibly shared) device forgets them —
    // except what never reached the account: that stays here rather than vanish
    if (!unsentProgress) progressSync.clearLocal()
    if (!unsentApp) forgetApp()
    const unsent = [unsentProgress && 'o progresso', unsentApp && 'o seu app'].filter(Boolean).join(' e ')
    toast(
      unsent
        ? { tone: 'info', title: 'Você saiu', body: `Mudanças recentes (${unsent}) não chegaram à sua conta, então ficaram neste dispositivo. Entre de novo para enviá-las.` }
        : { tone: 'info', title: 'Você saiu', body: 'Seu progresso e o seu app estão salvos na sua conta.' },
      unsent ? 9000 : undefined,
    )
  },

  async deleteAccount() {
    await api('/api/me', { method: 'DELETE' })
    becameAnonymous(set)
    progressSync.clearLocal()
    forgetApp()
    toast({ tone: 'info', title: 'Conta apagada', body: 'Sua conta, todo o progresso e o seu app foram apagados permanentemente.' })
  },

  async resetProgress() {
    if (get().status === 'signed-in') await api('/api/progress', { method: 'DELETE' })
    progressSync.clearLocal()
    if (get().status === 'signed-in') progressSync.setSignedIn(true)
    toast({ tone: 'info', title: 'Progresso reiniciado', body: 'Todas as lições voltaram ao início.' })
  },
}))

const sessionEnded = () => {
  if (useAuth.getState().status !== 'signed-in') return
  useAuth.setState({ status: 'anonymous', user: null })
  // whichever sync noticed first, both stop
  progressSync.setSignedIn(false)
  void workspaceSync.setSignedIn(false)
  toast({ tone: 'info', title: 'Sua sessão terminou', body: 'Seu progresso está seguro neste dispositivo. Entre novamente para continuar sincronizando.' }, 7000)
}
setUnauthorizedHandler(sessionEnded)
setWorkspaceUnauthorizedHandler(sessionEnded)

function welcome(user: User, hadOnDevice: number) {
  toast({
    tone: 'success',
    title: `Você entrou como ${user.name ?? user.email}`,
    body: hadOnDevice ? 'O progresso deste dispositivo foi adicionado à sua conta.' : 'Agora seu progresso acompanha você em todos os dispositivos.',
  })
}

/** /auth/verify#token=… — keep the token in memory and get it out of the address bar at once. */
function takeTokenFromUrl(set: (s: Partial<AuthStore>) => void) {
  if (location.pathname !== '/auth/verify') return
  const token = new URLSearchParams(location.hash.slice(1)).get('token')
  history.replaceState(null, '', '/')
  if (token && /^[A-Za-z0-9_-]{20,128}$/.test(token)) set({ pendingToken: token })
}

/** ?signed-in=github / ?auth-error=… from the OAuth round trip. */
function takeFlagsFromUrl() {
  const params = new URLSearchParams(location.search)
  const flags = { signedIn: params.has('signed-in'), error: params.get('auth-error') }
  if (flags.signedIn || flags.error) {
    let back = ''
    try {
      back = sessionStorage.getItem(RETURN_KEY) ?? ''
      sessionStorage.removeItem(RETURN_KEY)
    } catch {
      // no stored location
    }
    history.replaceState(null, '', `/${back}`)
    // replaceState doesn't fire hashchange; the lesson router listens for it
    if (back) window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
  return flags
}
