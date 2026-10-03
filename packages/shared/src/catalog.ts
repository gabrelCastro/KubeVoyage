import catalog from '../catalog.json' with { type: 'json' }

/**
 * The lessons the server knows about, and the objectives that make up each one.
 * Defined once in catalog.json — read here and by the Java API. The web app's lesson
 * definitions are checked against it in a test.
 */
type Catalog = Record<'self-healing' | 'scaling' | 'services' | 'labels' | 'debugging' | 'failures', { required: string[]; optional: string[] }>

export const LESSON_CATALOG = catalog.lessons as Catalog

export type LessonId = keyof Catalog

export const LESSON_IDS = Object.keys(LESSON_CATALOG) as LessonId[]

export const isLessonId = (id: string): id is LessonId => Object.hasOwn(LESSON_CATALOG, id)

export const objectivesOf = (id: LessonId): readonly string[] => [...LESSON_CATALOG[id].required, ...LESSON_CATALOG[id].optional]
