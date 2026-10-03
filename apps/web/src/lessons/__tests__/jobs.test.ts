import { describe, expect, it } from 'vitest'
import { Simulation } from '../../sim/engine'
import { run } from '../../sim/kubectl'
import { settle } from '../../sim/__tests__/helpers'
import { jobs } from '../jobs'
import type { LessonCtx } from '../types'

describe('lesson 11: Jobs', () => {
  it('each objective is done only after its own step, and the story is told', () => {
    const sim = new Simulation()
    sim.files = [...jobs.files]
    sim.bootstrap(jobs.setup!)
    settle(sim, 2000)
    const history: string[] = []
    const ctx = (): LessonCtx => ({ cluster: sim.cluster, events: sim.events, history, seen: [] })
    const done = () => jobs.objectives.filter((o) => o.done(ctx())).map((o) => o.id)
    expect(done()).toEqual([])
    for (const [i, objective] of jobs.objectives.entries()) {
      const command = objective.suggest!(ctx())!
      history.push(command)
      expect(run(sim, command).lines.some((l) => l[0]?.c === 'error')).toBe(false)
      settle(sim, 60000)
      expect(done()).toEqual(jobs.objectives.slice(0, i + 1).map((o) => o.id))
    }
    const story = jobs.completion.story!(sim.events)!.map((s) => s.text)
    expect(story[0]).toBe('Você criou o Job relatorio')
    expect(story).toContain('5 de 5 — o Job concluiu e parou')
    expect(story.at(-1)).toBe('Depois de 3 falhas, o relatorio-setembro desistiu')
    // the backend next door kept its 2 Pods running the whole time
    expect(Object.values(sim.cluster.pods).filter((p) => p.labels.app === 'backend' && p.ready)).toHaveLength(2)
  })
})
