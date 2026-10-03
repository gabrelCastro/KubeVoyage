import type { ApostilaId } from './store'

/** Estimated reading time, from each text's length (~190 words per minute). */
export const READING_MINUTES: Record<ApostilaId, number> = {
  'self-healing': 5,
  scaling: 6,
  services: 5,
  labels: 5,
  debugging: 5,
  failures: 6,
  configmaps: 5,
  probes: 5,
  autoscaling: 5,
  secrets: 4,
  jobs: 4,
}
