import { completedCount } from '@kubelearn/shared'
import { create } from 'zustand'
import { api, ApiError } from '../api/http'
import { progressSync, setUnauthorizedHandler } from '../progress/browser'
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
  toast({ tone: 'info', title: 'Picked up where you left off', body: `Back to ${getLesson(last).title}.` })
}

function becameAnonymous(set: (s: Partial<AuthStore>) => void) {
  set({ status: 'anonymous', user: null })
  progressSync.setSignedIn(false)
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
        console.info('KubeLearn: API unreachable, progress stays on this device for now.')
      }
    }
    if (flags.error) {
      toast({
        tone: 'error',
        title: "Couldn't sign in with GitHub",
        body: flags.error === 'no_verified_email' ? 'Your GitHub account has no verified email address. Verify one on GitHub, or use an email link.' : 'Please try again.',
      })
    }
  },

  openSignIn: () => set({ dialogOpen: true }),
  closeSignIn: () => set({ dialogOpen: false }),

  requestLink: (email) => api('/api/auth/magic-link', { method: 'POST', body: { email } }),

  async confirmLink() {
    const token = get().pendingToken
    if (!token) throw new ApiError(401, 'invalid_link', 'No sign-in link to confirm.')
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
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    becameAnonymous(set)
    // the account keeps the progress; this (possibly shared) device forgets it
    progressSync.clearLocal()
    toast({ tone: 'info', title: 'Signed out', body: 'Your progress is saved in your account.' })
  },

  async deleteAccount() {
    await api('/api/me', { method: 'DELETE' })
    becameAnonymous(set)
    progressSync.clearLocal()
    toast({ tone: 'info', title: 'Account deleted', body: 'Your account and its progress are gone for good.' })
  },

  async resetProgress() {
    if (get().status === 'signed-in') await api('/api/progress', { method: 'DELETE' })
    progressSync.clearLocal()
    if (get().status === 'signed-in') progressSync.setSignedIn(true)
    toast({ tone: 'info', title: 'Progress reset', body: 'Every lesson is back to the start.' })
  },
}))

setUnauthorizedHandler(() => {
  if (useAuth.getState().status !== 'signed-in') return
  useAuth.setState({ status: 'anonymous', user: null })
  toast({ tone: 'info', title: 'You were signed out', body: 'Your progress is safe on this device. Sign in again to keep syncing.' }, 7000)
})

function welcome(user: User, hadOnDevice: number) {
  toast({
    tone: 'success',
    title: `Signed in as ${user.name ?? user.email}`,
    body: hadOnDevice ? 'Progress from this device was added to your account.' : 'Your progress now follows you to every device.',
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
