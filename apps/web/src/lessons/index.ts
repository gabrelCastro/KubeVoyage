import { configmaps } from './configmaps'
import { debugging } from './debugging'
import { failures } from './failures'
import { labels } from './labels'
import { scaling } from './scaling'
import { selfHealing } from './selfHealing'
import { services } from './services'
import type { Lesson } from './types'

export const LESSONS: Lesson[] = [selfHealing, scaling, services, labels, debugging, failures, configmaps]

export const getLesson = (id: string | null | undefined) => LESSONS.find((l) => l.id === id) ?? LESSONS[0]

export const nextLesson = (id: string) => LESSONS[LESSONS.findIndex((l) => l.id === id) + 1]
