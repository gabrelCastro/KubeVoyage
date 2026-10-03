import { describe, expect, it } from 'vitest'
import { Simulation } from '../../sim/engine'
import { run } from '../../sim/kubectl'
import { settle } from '../../sim/__tests__/helpers'
import { nodes } from '../nodes'
import type { LessonCtx } from '../types'

describe('lesson 12: Nodes and DaemonSets', () => {
  it('completes each objective in order and tells the maintenance story', () => {
    const sim = new Simulation()
    sim.files = [...nodes.files]
    sim.bootstrap(nodes.setup!)
    settle(sim, 2000)
    const history: string[] = []
    const ctx = (): LessonCtx => ({ cluster: sim.cluster, events: sim.events, history, seen: [] })
    const done = () => nodes.objectives.filter((objective) => objective.done(ctx())).map((objective) => objective.id)

    expect(done()).toEqual([])
    for (const [index, objective] of nodes.objectives.entries()) {
      const command = objective.suggest!(ctx())!
      history.push(command)
      run(sim, command)
      settle(sim, 10000)
      expect(done()).toEqual(nodes.objectives.slice(0, index + 1).map((item) => item.id))
    }

    const story = nodes.completion.story!(sim.events)!.map((step) => step.text)
    expect(story[0]).toBe('Você criou o DaemonSet log-agent')
    expect(story).toContain('O Pod do backend saiu do node-2')
    expect(story.at(-1)).toBe('Você liberou o node-2 para novos Pods')
  })
})
