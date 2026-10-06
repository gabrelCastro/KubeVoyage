import { parseWorkspace, type Release as WireRelease, type Workspace } from '@kubelearn/shared'
import type { AppColor, Release, Stored } from '../store/useApp'

/**
 * The store keeps times as milliseconds (0 = never) and leaves out absent code; the wire uses
 * ISO dates and nulls. Both directions are lossless for what the store can hold.
 */

const iso = (ms: number) => (ms > 0 ? new Date(ms).toISOString() : null)
const ms = (t: string | null) => (t === null ? 0 : Date.parse(t))

export function toWire(s: Stored): Workspace {
  return {
    draft: { design: { ...s.design }, designAt: iso(s.designAt), code: s.code, codeAt: iso(s.codeAt), customized: s.customized },
    releases: s.releases.map(
      (r): WireRelease => ({ tag: r.tag, design: { ...r.design }, broken: r.broken, code: r.code ?? null, createdAt: new Date(Math.max(0, r.createdAt)).toISOString() }),
    ),
  }
}

export function fromWire(w: Workspace): Stored {
  // the shared sanitizer already mapped unknown colors to the default, so this cast is safe
  const design = (d: Workspace['draft']['design']) => ({ ...d, color: d.color as AppColor })
  return {
    design: design(w.draft.design),
    designAt: ms(w.draft.designAt),
    code: w.draft.code,
    codeAt: ms(w.draft.codeAt),
    customized: w.draft.customized,
    releases: w.releases.map((r): Release => ({ tag: r.tag, design: design(r.design), broken: r.broken, ...(r.code !== null && { code: r.code }), createdAt: Date.parse(r.createdAt) })),
  }
}

/**
 * The device's app exactly as the server would store it (trimmed, sorted, sanitized). Sync
 * compares and merges only canonical values — otherwise a difference the server always
 * normalizes away would look like a change forever, and be pushed forever.
 */
export const canonical = (w: Workspace): Workspace => parseWorkspace(JSON.parse(JSON.stringify(w))) ?? w
