import { create } from 'zustand'

export interface Toast {
  id: number
  tone: 'success' | 'info' | 'error'
  title: string
  body?: string
}

interface ToastStore {
  toasts: Toast[]
  push(t: Omit<Toast, 'id'>, ms?: number): void
  dismiss(id: number): void
}

let seq = 0

export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push(t, ms = 4500) {
    const toast = { ...t, id: ++seq }
    set((s) => ({ toasts: [...s.toasts.slice(-2), toast] }))
    setTimeout(() => get().dismiss(toast.id), ms)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = (t: Omit<Toast, 'id'>, ms?: number) => useToasts.getState().push(t, ms)
