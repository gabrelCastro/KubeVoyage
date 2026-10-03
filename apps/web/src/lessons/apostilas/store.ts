import { create } from 'zustand'

export type ApostilaId = 'self-healing'

interface ApostilaState {
  lessonId: ApostilaId | null
  anchor: string | null
  openApostila: (lessonId: ApostilaId, anchor?: string) => void
  closeApostila: () => void
}

export const useApostila = create<ApostilaState>((set) => ({
  lessonId: null,
  anchor: null,
  openApostila: (lessonId, anchor) => set({ lessonId, anchor: anchor ?? null }),
  closeApostila: () => set({ lessonId: null, anchor: null }),
}))
