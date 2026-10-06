import { api } from '../api/http'
import { mergeWorkspace, sameWorkspace } from '@kubelearn/shared'
import { create } from 'zustand'
import { APP_STORAGE_KEY, parseStoredApp, useApp } from '../store/useApp'
import { canonical, fromWire, toWire } from './convert'
import { WorkspaceSync, type WorkspaceSyncStatus } from './sync'

/** The app's sync status, for the account button (progress has its own). */
export const useWorkspaceSync = create<{ status: WorkspaceSyncStatus }>(() => ({ status: 'local' }))

// Whose app this device holds: set when it's synced with an account. Signing in as someone
// else must never upload the previous person's code into the new account.
const OWNER_KEY = 'kubelearn.app.owner'
const owner = () => {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}
const setOwner = (id: string | null) => {
  try {
    if (id === null) localStorage.removeItem(OWNER_KEY)
    else localStorage.setItem(OWNER_KEY, id)
  } catch {
    // storage unavailable: nothing persists to mix up either
  }
}

/** Whose app *this tab* holds in memory — another tab may change the device's owner under it. */
let tabOwner = owner()

/** Signing in: an app left by another account is dropped from this device (it's in that account); anything else is uploaded. */
export function claimApp(userId: string) {
  const current = owner()
  // owner first: other tabs read it when the app's removal reaches them
  setOwner(userId)
  tabOwner = userId
  if (current !== null && current !== userId) useApp.getState().clearLocal()
}

/** Signing out (or deleting the account): this device forgets the app. */
export function forgetApp() {
  setOwner(null)
  tabOwner = null
  useApp.getState().clearLocal()
}

/**
 * Another tab changed whose app this device holds. Signed out there: forget it here too, or
 * this tab's next save would bring it back. A different account signed in there: this tab still
 * holds the previous account's app (and session state) in memory, and anything it saved or
 * pushed would land in the new account — start over as the new session instead.
 */
function followOwner() {
  const now = owner()
  if (now === tabOwner) return
  const was = tabOwner
  tabOwner = now
  // anonymous work that the other tab just uploaded into its account: nothing to undo
  if (was === null) return
  if (now === null) {
    void workspaceSync.setSignedIn(false)
    useApp.getState().clearLocal()
  } else location.reload()
}

let onUnauthorized = () => {}
/** Called by the auth layer, which owns what "signed out" means. */
export const setWorkspaceUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn)

/** Never push one account's app with another account's session (a tab that hasn't heard yet). */
function sameOwner() {
  if (owner() === tabOwner) return
  followOwner()
  throw Object.assign(new Error('O dono do app mudou em outra aba'), { status: 0 })
}

export const workspaceSync = new WorkspaceSync({
  local: () => canonical(toWire(useApp.getState())),
  adopt: (next) => useApp.getState().adopt(fromWire(next)),
  fetchAll: () => api('/api/workspace'),
  putDraft: async (draft, { keepalive }) => (sameOwner(), api('/api/workspace/draft', { method: 'PUT', body: draft, keepalive })),
  putRelease: async (release) => (sameOwner(), api(`/api/workspace/releases/${encodeURIComponent(release.tag)}`, { method: 'PUT', body: release })),
  schedule: (fn, ms) => {
    const t = setTimeout(fn, ms)
    return () => clearTimeout(t)
  },
  isOnline: () => navigator.onLine,
  onUnauthorized: () => onUnauthorized(),
  onStatus: (status) => useWorkspaceSync.setState({ status }),
})

// any change to what's synced (not the UI-only state) is pushed soon
useApp.subscribe((s, prev) => {
  if (s.design !== prev.design || s.code !== prev.code || s.releases !== prev.releases || s.customized !== prev.customized) workspaceSync.changed()
})

// another tab saved the app: merge it in with the same rules as devices, so neither tab's
// next save overwrites the other's work (that tab pushes its own changes)
window.addEventListener('storage', (e) => {
  if (e.key === OWNER_KEY) return followOwner()
  if (e.key !== APP_STORAGE_KEY) return
  // the owner may have changed in the same breath (events can arrive in either order)
  followOwner()
  if (owner() !== tabOwner) return
  if (e.newValue === null) {
    if (tabOwner === null) useApp.getState().clearLocal()
    return
  }
  const here = canonical(toWire(useApp.getState()))
  const merged = mergeWorkspace(here, canonical(toWire(parseStoredApp(e.newValue))))
  if (!sameWorkspace(merged, here)) useApp.getState().adopt(fromWire(merged))
})

let lastFocusSync = 0
window.addEventListener('online', () => void workspaceSync.refresh())
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastFocusSync > 15_000) {
    lastFocusSync = Date.now()
    void workspaceSync.refresh()
  } else if (document.visibilityState === 'hidden') workspaceSync.flush()
})
window.addEventListener('pagehide', () => workspaceSync.flush())
