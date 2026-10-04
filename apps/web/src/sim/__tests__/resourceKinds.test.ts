import { describe, expect, it } from 'vitest'
import { SPECS } from '../cli/resourceSpecs'
import { ALL_KINDS, KIND_ALIASES, KIND_DOCS, KIND_IDS, KIND_WORDS } from '../cli/resourceKinds'

describe('kubectl resource registry', () => {
  it('keeps metadata and output specs in sync', () => {
    expect(Object.keys(SPECS).sort()).toEqual([...KIND_IDS].sort())
    expect(new Set(KIND_IDS).size).toBe(KIND_IDS.length)
    expect(ALL_KINDS.every((kind) => KIND_IDS.includes(kind))).toBe(true)
  })

  it('only points aliases and completions at registered kinds', () => {
    const documented = [...KIND_IDS, 'all'] as const
    expect(Object.values(KIND_ALIASES).every((kind) => kind === 'all' || KIND_IDS.includes(kind))).toBe(true)
    expect(KIND_WORDS.every((word) => word === 'all' || word in KIND_ALIASES)).toBe(true)
    expect(documented.every((kind) => KIND_DOCS[kind])).toBe(true)
  })
})
