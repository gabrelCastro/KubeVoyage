import { describe, expect, it } from 'vitest'
import { Simulation } from '../../sim/engine'
import { run } from '../../sim/kubectl'
import { settle } from '../../sim/__tests__/helpers'
import { probes } from '../probes'
import type { LessonCtx } from '../types'

function lesson() {
  const sim = new Simulation()
  sim.files = [...probes.files]
  sim.bootstrap(probes.setup!)
  settle(sim, 2000)
  const history: string[] = []
  const ctx = (): LessonCtx => ({ cluster: sim.cluster, events: sim.events, history, seen: [] })
  const exec = (command: string) => {
    history.push(command)
    return run(sim, command)
  }
  return { sim, ctx, exec, done: () => probes.objectives.filter((o) => o.done(ctx())).map((o) => o.id) }
}

/** Plays the lesson the way a learner would: the suggested command for each objective, in order. */
describe('lesson 9: probes', () => {
  it('each objective is done only after its own step, and the story is told', () => {
    const { sim, ctx, exec, done } = lesson()
    expect(done()).toEqual([])
    for (const [i, objective] of probes.objectives.entries()) {
      expect(exec(objective.suggest!(ctx())!).lines.some((l) => l[0]?.c === 'error')).toBe(false)
      // the freeze shows up a while after the rollout: give each step time to play out
      settle(sim, 70000)
      expect(done()).toEqual(probes.objectives.slice(0, i + 1).map((o) => o.id))
    }
    const story = probes.completion.story!(sim.events)!
    expect(story[0].text).toBe('Você publicou a v1.6 — tudo Ready')
    expect(story.at(-1)!.text).toBe('De volta à v1.4, com a probe')
    expect(story.some((s) => s.text.includes('falhou na liveness'))).toBe(true)
  })

  it('rollout undo instead of set image does not complete the lesson: the probe goes with it', () => {
    const { sim, ctx, exec } = lesson()
    for (const objective of probes.objectives.slice(0, 3)) {
      exec(objective.suggest!(ctx())!)
      settle(sim, 70000)
    }
    exec('kubectl rollout undo deployment/backend')
    settle(sim, 40000)
    expect(probes.objectives.find((o) => o.id === 'fix')!.done(ctx())).toBe(false)
  })
})
