import { describe, expect, it } from 'vitest'
import { Simulation } from '../../sim/engine'
import { run } from '../../sim/kubectl'
import { settle } from '../../sim/__tests__/helpers'
import { secrets } from '../secrets'
import type { LessonCtx } from '../types'

describe('lesson 8: Secrets', () => {
  it('each objective is done only after its own step, and the story is told', () => {
    const sim = new Simulation()
    sim.files = [...secrets.files]
    sim.bootstrap(secrets.setup!)
    settle(sim, 2000)
    const history: string[] = []
    const ctx = (): LessonCtx => ({ cluster: sim.cluster, events: sim.events, history, seen: [] })
    const done = () => secrets.objectives.filter((o) => o.done(ctx())).map((o) => o.id)
    expect(done()).toEqual([])
    for (const [i, objective] of secrets.objectives.entries()) {
      const command = objective.suggest!(ctx())!
      history.push(command)
      const r = run(sim, command)
      expect(r.lines.some((l) => l[0]?.c === 'error')).toBe(false)
      if (objective.id === 'reveal') expect(r.lines.map((l) => l.map((s) => s.t).join('')).join('')).toBe('postgres://app:s3cret@db:5432/app')
      settle(sim, 30000)
      expect(done()).toEqual(secrets.objectives.slice(0, i + 1).map((o) => o.id))
    }
    expect(secrets.completion.story!(sim.events)!.map((s) => s.text)).toEqual([
      'Você guardou DATABASE_URL no Secret db-credentials',
      'A v1.5 passou a ler o Secret',
      'Rollout concluído — sem nenhum crash',
    ])
  })
})
