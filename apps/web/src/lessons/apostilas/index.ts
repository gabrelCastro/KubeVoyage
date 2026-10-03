import type { ComponentType } from 'react'
import DebuggingApostila from './debugging.mdx'
import FailuresApostila from './failures.mdx'
import LabelsApostila from './labels.mdx'
import ScalingApostila from './scaling.mdx'
import SelfHealingApostila from './self-healing.mdx'
import ServicesApostila from './services.mdx'
import type { ApostilaId } from './store'

export const APOSTILAS: Record<ApostilaId, ComponentType> = {
  'self-healing': SelfHealingApostila,
  scaling: ScalingApostila,
  services: ServicesApostila,
  labels: LabelsApostila,
  debugging: DebuggingApostila,
  failures: FailuresApostila,
}

export { READING_MINUTES } from './meta'

export const hasApostila = (lessonId: string): lessonId is ApostilaId => lessonId in APOSTILAS
