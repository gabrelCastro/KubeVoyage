import { describe, expect, it } from 'vitest'
import { Simulation } from '../../sim/engine'
import { run } from '../../sim/kubectl'
import { settle } from '../../sim/__tests__/helpers'
import { configmaps } from '../configmaps'
import type { LessonCtx } from '../types'

/** Plays the lesson the way a learner would: the suggested command for each objective, in order. */
describe('lesson 7: ConfigMaps', () => {
  it('each objective is done only after its own step, and the story is told', () => {
    const sim = new Simulation()
    sim.files = [...configmaps.files]
    sim.bootstrap(configmaps.setup!)
    settle(sim, 2000)
    const history: string[] = []
    const ctx = (): LessonCtx => ({ cluster: sim.cluster, events: sim.events, history, seen: [] })
    const done = () => configmaps.objectives.filter((o) => o.done(ctx())).map((o) => o.id)

    expect(done()).toEqual([])
    for (const [i, objective] of configmaps.objectives.entries()) {
      const command = objective.suggest!(ctx())!
      history.push(command)
      expect(run(sim, command).lines.some((l) => l[0]?.c === 'error')).toBe(false)
      settle(sim, 30000)
      expect(done()).toEqual(configmaps.objectives.slice(0, i + 1).map((o) => o.id))
    }

    const story = configmaps.completion.story!(sim.events)
    expect(story?.map((s) => s.text)).toEqual([
      'O template passou a ler o ConfigMap app-config',
      expect.stringContaining('não pôde iniciar'),
      'Você criou o ConfigMap — o rollout destravou',
      'Você mudou APP_MESSAGE — e os Pods continuaram com o valor antigo',
      'Você reiniciou o Deployment',
      'Pods novos, lendo o valor novo',
    ])
  })

  it('restarting before changing the ConfigMap does not count', () => {
    const sim = new Simulation()
    sim.files = [...configmaps.files]
    sim.bootstrap(configmaps.setup!)
    for (const c of ['kubectl apply -f configmap.yaml', 'kubectl apply -f backend-config.yaml']) run(sim, c)
    settle(sim, 30000)
    run(sim, 'kubectl rollout restart deployment/backend')
    settle(sim, 30000)
    const restart = configmaps.objectives.find((o) => o.id === 'restart')!
    expect(restart.done({ cluster: sim.cluster, events: sim.events, history: [], seen: [] })).toBe(false)
  })
})
