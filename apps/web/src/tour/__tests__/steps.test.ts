import { describe, expect, it } from 'vitest'
import { TOUR, type TourCtx } from '../steps'

// every component's source, read through Vite — no Node APIs needed
const files = import.meta.glob(['../../**/*.tsx', '!../../**/__tests__/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const empty: TourCtx = { cluster: { deployments: {}, replicaSets: {}, pods: {}, services: {}, nodes: [], vacancies: [] }, events: [], history: [], selected: null }

describe('onboarding tour', () => {
  it('points only at areas that exist in the UI', () => {
    const code = Object.values(files).join('\n')
    const declared = new Set([...code.matchAll(/data-tour="([a-z-]+)"/g), ...code.matchAll(/tour="([a-z-]+)"/g)].map((m) => m[1]))
    for (const step of TOUR) if (step.target) expect(declared, `missing data-tour="${step.target}"`).toContain(step.target)
  })

  it('does not consider any action done on a fresh lesson', () => {
    for (const step of TOUR) if (step.done) expect(step.done(empty), step.id).toBe(false)
  })

  it('asks for a waiting hint on every action step', () => {
    for (const step of TOUR) if (step.done) expect(step.waiting, step.id).toBeTruthy()
  })

  it('recognizes kubectl get pods in either spelling', () => {
    const terminal = TOUR.find((s) => s.id === 'terminal')!
    expect(terminal.done!({ ...empty, history: ['k get po'] })).toBe(true)
    expect(terminal.done!({ ...empty, history: ['kubectl get pods -o wide'] })).toBe(true)
    expect(terminal.done!({ ...empty, history: ['kubectl get deploy'] })).toBe(false)
  })
})

