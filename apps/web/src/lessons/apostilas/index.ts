import type { ComponentType } from 'react'
import SelfHealingApostila from './self-healing.mdx'
import type { ApostilaId } from './store'

export const APOSTILAS: Record<ApostilaId, ComponentType> = {
  'self-healing': SelfHealingApostila,
}

export const hasApostila = (lessonId: string): lessonId is ApostilaId => lessonId in APOSTILAS
