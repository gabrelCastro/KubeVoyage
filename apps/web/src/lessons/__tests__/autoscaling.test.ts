import { describe, expect, it } from 'vitest'
import { Simulation } from '../../sim/engine'
import { run } from '../../sim/kubectl'
import { settle } from '../../sim/__tests__/helpers'
import { autoscaling } from '../autoscaling'
import type { LessonCtx } from '../types'

/** Plays the lesson the way a learner would: the suggested command for each objective, in order. */
describe('lesson 10: resources and autoscaling', () => {
  it('each objective is done only after its own step, and the story is told', () => {
    const sim = new Simulation()
    sim.files = [...autoscaling.files]
    sim.bootstrap(autoscaling.setup!)
    settle(sim, 2000)
    const history: string[] = []
    const ctx = (): LessonCtx => ({ cluster: sim.cluster, events: sim.events, history, seen: [] })
    const done = () => autoscaling.objectives.filter((o) => o.done(ctx())).map((o) => o.id)

    expect(done()).toEqual([])
    for (const [i, objective] of autoscaling.objectives.entries()) {
      const command = objective.suggest!(ctx())!
      history.push(command)
      expect(run(sim, command).lines.some((l) => l[0]?.c === 'error')).toBe(false)
      settle(sim, 60000)
      expect(done()).toEqual(autoscaling.objectives.slice(0, i + 1).map((o) => o.id))
    }
    const story = autoscaling.completion.story!(sim.events)!.map((s) => s.text)
    expect(story[0]).toBe('Você criou o HPA — meta de CPU em 50%')
    expect(story).toContain('Sem requests, ele não conseguiu medir')
    expect(story.some((t) => t.startsWith('A CPU subiu e o HPA escalou para'))).toBe(true)
    expect(story.at(-1)).toMatch(/^A carga sumiu e, depois de estabilizar, ele reduziu para \d$/)
  })
})
