import type { Setup } from '../sim/engine'
import type { ClusterEvent, ClusterState } from '../sim/types'

export interface LessonCtx {
  cluster: ClusterState
  events: ClusterEvent[]
  history: string[]
  /** Every resource the learner has selected on the stage during this run. */
  seen: string[]
}

export interface Objective {
  id: string
  title: string
  detail: string
  optional?: boolean
  /** A command the learner can drop into the terminal — syntax offered, never forced. */
  suggest?: (ctx: LessonCtx) => string | null
  /** The same objective done without the terminal. Concept first, syntax second. */
  uiHint?: string
  /** Held back until asked for, for exercises where the answer is the point. */
  hint?: { text: string; command?: string }
  done: (ctx: LessonCtx) => boolean
}

export interface StoryStep {
  t: number
  text: string
  tone?: 'start' | 'end'
}

export interface Lesson {
  id: string
  number: number
  track: string
  title: string
  tagline: string
  /** The one idea the lesson is about, as two things side by side. */
  idea: { a: { label: string; text: string }; b: { label: string; text: string }; body: string }
  files: string[]
  setup?: Setup
  /** Show the "drag replicas" control on the stage. */
  replicaControl?: boolean
  objectives: Objective[]
  completion: {
    title: string
    summary: (ctx: LessonCtx) => string
    story?: (events: ClusterEvent[]) => StoryStep[] | null
    takeaway: string
    note?: string
  }
}
