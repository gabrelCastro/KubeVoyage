import { Simulation } from '../engine'

/** Advance simulated time in frame-sized steps, like the real clock loop. */
export function settle(sim: Simulation, ms = 12000) {
  for (let t = 0; t < ms; t += 16) sim.advance(16)
}

export const live = (sim: Simulation) => Object.values(sim.cluster.pods).filter((p) => p.deletedAt === null)
export const ready = (sim: Simulation) => live(sim).filter((p) => p.ready)
export const reasons = (sim: Simulation, from = 0) => sim.events.slice(from).map((e) => e.reason)
