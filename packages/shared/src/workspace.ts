// zod/mini: same validation, tree-shakeable (this ships in the web bundle)
import * as z from 'zod/mini'
import rules from '../workspace.json' with { type: 'json' }

/**
 * "Your app" as it's synced: the draft the learner is editing (design and app.js) and the
 * images they published. Any two copies merge without conflicts — in any order, any number
 * of times — and always agree:
 *
 *   draft.design      latest designAt wins   (ties: the larger design, so every replica agrees)
 *   draft.code        latest codeAt wins     (the same, separately: design on one device and
 *                                             code on another both survive)
 *   draft.customized  or
 *   releases          union by tag; a tag is immutable, so if two devices published the same
 *                     tag the first one (earliest createdAt) is the image — like a registry
 *                     that refuses to overwrite a tag. At most releasesMax, the earliest.
 *
 * Mirrors the Java API's Workspace; both are checked against the same fixtures.
 */

export const WORKSPACE_RULES = rules
export const APP_EMOJIS: readonly string[] = rules.design.emojis
export const APP_COLOR_NAMES: readonly string[] = rules.design.colors

const TAG = new RegExp(rules.tagPattern)
const RESERVED = new RegExp(rules.reservedTagPattern)
/** 1.x belong to the lessons' images; `latest` would change with every build. */
export const isReservedTag = (tag: string) => RESERVED.test(tag)
export const isValidTag = (tag: string) => TAG.test(tag)

export interface Design {
  name: string
  emoji: string
  color: string
  message: string
}

export interface Draft {
  design: Design
  /** When the design was last edited; null = never (the default design). */
  designAt: string | null
  /** app.js; null = never written. */
  code: string | null
  codeAt: string | null
  customized: boolean
}

export interface Release {
  tag: string
  design: Design
  /** Published "forgetting" DATABASE_URL: crashes on start. */
  broken: boolean
  /** The app.js it was built from; null = a design-only version. */
  code: string | null
  createdAt: string
}

export interface Workspace {
  draft: Draft
  /** Sorted by createdAt, then tag. */
  releases: Release[]
}

export const DEFAULT_DESIGN: Design = { name: 'Meu app', emoji: '🐳', color: 'azul', message: 'Olá do cluster!' }

export const emptyWorkspace = (): Workspace => ({
  draft: { design: { ...DEFAULT_DESIGN }, designAt: null, code: null, codeAt: null, customized: false },
  releases: [],
})

// ── shape (what may cross a trust boundary) ─────────────────────────────────

const isoDate = z.iso.datetime({ offset: true })

const DesignSchema = z.object({
  name: z.string().check(z.minLength(1), z.maxLength(rules.design.nameMax)),
  emoji: z.string().check(z.minLength(1), z.maxLength(16)),
  color: z.string().check(z.minLength(1), z.maxLength(16)),
  message: z.string().check(z.maxLength(rules.design.messageMax)),
})

const code = z.nullable(z.string().check(z.maxLength(rules.codeMax)))

export const DraftSchema = z.object({
  design: DesignSchema,
  designAt: z.nullable(isoDate),
  code,
  codeAt: z.nullable(isoDate),
  customized: z.boolean(),
})

export const ReleaseSchema = z.object({
  tag: z.string().check(z.minLength(1), z.maxLength(32)),
  design: DesignSchema,
  broken: z.boolean(),
  code,
  createdAt: isoDate,
})

export const WorkspaceSchema = z.object({
  draft: DraftSchema,
  // room for two devices' worth before the cap applies
  releases: z.array(ReleaseSchema).check(z.maxLength(rules.releasesMax * 2)),
})

// ── canonical form ──────────────────────────────────────────────────────────

const toIso = (s: string) => new Date(s).toISOString()
// control characters other than tab and line breaks have no business in code or text
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
// half of a surrogate pair can't be stored or encoded faithfully: replace it, like toWellFormed()
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
const clean = (s: string) => s.replace(CONTROL, '').replace(LONE_SURROGATE, '\uFFFD')

/** Unknown emojis or colors (from a newer version, or junk) fall back to the defaults. */
export function sanitizeDesign(d: z.infer<typeof DesignSchema>): Design {
  const name = clean(d.name).trim()
  return {
    name: name || DEFAULT_DESIGN.name,
    emoji: APP_EMOJIS.includes(d.emoji) ? d.emoji : DEFAULT_DESIGN.emoji,
    color: APP_COLOR_NAMES.includes(d.color) ? d.color : DEFAULT_DESIGN.color,
    message: clean(d.message).trim(),
  }
}

export function sanitizeDraft(d: z.infer<typeof DraftSchema>): Draft {
  return {
    design: sanitizeDesign(d.design),
    designAt: d.designAt === null ? null : toIso(d.designAt),
    code: d.code === null ? null : clean(d.code),
    codeAt: d.codeAt === null ? null : toIso(d.codeAt),
    customized: d.customized,
  }
}

/** A release, or null if its tag isn't one a learner may publish. */
export function sanitizeRelease(r: z.infer<typeof ReleaseSchema>): Release | null {
  if (!isValidTag(r.tag) || isReservedTag(r.tag)) return null
  return { tag: r.tag, design: sanitizeDesign(r.design), broken: r.broken, code: r.code === null ? null : clean(r.code), createdAt: toIso(r.createdAt) }
}

export function sanitizeWorkspace(w: z.infer<typeof WorkspaceSchema>): Workspace {
  const releases = w.releases.map(sanitizeRelease).filter((r): r is Release => r !== null)
  return { draft: sanitizeDraft(w.draft), releases: mergeReleases([], releases) }
}

/** Parse untrusted data into a canonical Workspace, or null if the shape is wrong. */
export function parseWorkspace(data: unknown): Workspace | null {
  const r = WorkspaceSchema.safeParse(data)
  return r.success ? sanitizeWorkspace(r.data) : null
}

export function parseRelease(data: unknown): Release | null {
  const r = ReleaseSchema.safeParse(data)
  return r.success ? sanitizeRelease(r.data) : null
}

export function parseDraft(data: unknown): Draft | null {
  const r = DraftSchema.safeParse(data)
  return r.success ? sanitizeDraft(r.data) : null
}

// ── merge ───────────────────────────────────────────────────────────────────

// plain string comparison (UTF-16 code units) — Java's String.compareTo agrees
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const time = (t: string | null) => (t === null ? -Infinity : Date.parse(t))
const designKey = (d: Design) => [d.name, d.emoji, d.color, d.message].join('\u0000')
const releaseKey = (r: Release) => [r.code === null ? '0' : `1${r.code}`, designKey(r.design), r.broken ? '1' : '0'].join('\u0000')

/** The later edit; on a tie, the larger value — any rule works as long as every replica uses it. */
function later<T>(a: T, aAt: string | null, b: T, bAt: string | null, key: (v: T) => string): [T, string | null] {
  const ta = time(aAt)
  const tb = time(bAt)
  if (ta !== tb) return ta > tb ? [a, aAt] : [b, bAt]
  return cmp(key(a), key(b)) >= 0 ? [a, aAt] : [b, bAt]
}

export function mergeDraft(a: Draft, b: Draft): Draft {
  const [design, designAt] = later(a.design, a.designAt, b.design, b.designAt, designKey)
  const [code, codeAt] = later(a.code, a.codeAt, b.code, b.codeAt, (c) => (c === null ? '0' : `1${c}`))
  return { design, designAt, code, codeAt, customized: a.customized || b.customized }
}

/** Two releases with the same tag: the first published is the image. */
export function winningRelease(a: Release, b: Release): Release {
  const ta = Date.parse(a.createdAt)
  const tb = Date.parse(b.createdAt)
  if (ta !== tb) return ta < tb ? a : b
  return cmp(releaseKey(a), releaseKey(b)) >= 0 ? a : b
}

const byAge = (a: Release, b: Release) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || cmp(a.tag, b.tag)

export function mergeReleases(a: Release[], b: Release[]): Release[] {
  const byTag = new Map<string, Release>()
  for (const r of [...a, ...b]) {
    const seen = byTag.get(r.tag)
    byTag.set(r.tag, seen ? winningRelease(seen, r) : r)
  }
  return [...byTag.values()].sort(byAge).slice(0, rules.releasesMax)
}

/** Commutative, associative and idempotent. Inputs must be canonical (see sanitizeWorkspace). */
export function mergeWorkspace(a: Workspace, b: Workspace): Workspace {
  return { draft: mergeDraft(a.draft, b.draft), releases: mergeReleases(a.releases, b.releases) }
}

export const sameDesign = (a: Design, b: Design) => designKey(a) === designKey(b)
export const sameRelease = (a: Release, b: Release) => a.tag === b.tag && a.createdAt === b.createdAt && releaseKey(a) === releaseKey(b)
export const sameDraft = (a: Draft, b: Draft) =>
  sameDesign(a.design, b.design) && a.designAt === b.designAt && a.code === b.code && a.codeAt === b.codeAt && a.customized === b.customized
export const sameWorkspace = (a: Workspace, b: Workspace) =>
  sameDraft(a.draft, b.draft) && a.releases.length === b.releases.length && a.releases.every((r, i) => sameRelease(r, b.releases[i]!))
