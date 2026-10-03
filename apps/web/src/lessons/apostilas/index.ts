import { lazy, type ComponentType } from 'react'
import type { ApostilaId } from './store'

// Each apostila is its own chunk: they are long, and most sessions open one at most.
const LOADERS: Record<ApostilaId, () => Promise<{ default: ComponentType }>> = {
  'self-healing': () => import('./self-healing.mdx'),
  scaling: () => import('./scaling.mdx'),
  services: () => import('./services.mdx'),
  labels: () => import('./labels.mdx'),
  debugging: () => import('./debugging.mdx'),
  failures: () => import('./failures.mdx'),
  configmaps: () => import('./configmaps.mdx'),
  probes: () => import('./probes.mdx'),
  autoscaling: () => import('./autoscaling.mdx'),
  secrets: () => import('./secrets.mdx'),
}

export const APOSTILAS: Record<ApostilaId, ComponentType> = {
  'self-healing': lazy(LOADERS['self-healing']),
  scaling: lazy(LOADERS.scaling),
  services: lazy(LOADERS.services),
  labels: lazy(LOADERS.labels),
  debugging: lazy(LOADERS.debugging),
  failures: lazy(LOADERS.failures),
  configmaps: lazy(LOADERS.configmaps),
  probes: lazy(LOADERS.probes),
  autoscaling: lazy(LOADERS.autoscaling),
  secrets: lazy(LOADERS.secrets),
}

/** Fetch an apostila ahead of time (the browser caches the chunk; `lazy` reuses the same import). */
export const preloadApostila = (id: ApostilaId) => void LOADERS[id]().catch(() => {})

export { READING_MINUTES } from './meta'

export const hasApostila = (lessonId: string): lessonId is ApostilaId => lessonId in LOADERS
