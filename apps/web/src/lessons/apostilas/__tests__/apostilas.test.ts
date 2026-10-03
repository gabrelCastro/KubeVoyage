/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LESSONS } from '../..'
import { GLOSSARY } from '../../glossary'
import { READING_MINUTES } from '../meta'

// read the MDX sources from disk (the MDX plugin compiles them even when imported with ?raw)
const dir = fileURLToPath(new URL('..', import.meta.url))
const byId = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith('.mdx'))
    .map((f) => [f.replace('.mdx', ''), readFileSync(join(dir, f), 'utf8')]),
)

const SECTIONS = ['o-que-voce-vai-entender', 'conceitos', 'no-mundo-real', 'o-que-simplificamos', 'erros-comuns', 'teste-rapido', 'para-ir-alem']
const ids = (text: string) => new Set([...text.matchAll(/id="([a-z0-9-]+)"/g)].map((m) => m[1]))

describe('apostilas', () => {
  it('exist for every lesson', () => {
    expect(Object.keys(byId).sort()).toEqual(LESSONS.map((l) => l.id).sort())
    expect(Object.keys(READING_MINUTES).sort()).toEqual(LESSONS.map((l) => l.id).sort())
  })

  it.each(Object.entries(byId))('%s has every section the index links to, in order', (_, text) => {
    const found = SECTIONS.map((s) => text.indexOf(`<section id="${s}">`))
    expect(found.every((i) => i >= 0)).toBe(true)
    expect([...found].sort((a, b) => a - b)).toEqual(found)
  })

  it.each(Object.entries(byId))('%s imports every component it uses', (_, text) => {
    const imported = new Set([...text.matchAll(/import \{([^}]+)\}/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())))
    const used = new Set([...text.matchAll(/<([A-Z][A-Za-z]+)/g)].map((m) => m[1]))
    for (const c of used) expect(imported, `<${c}> is not imported`).toContain(c)
  })

  it.each(Object.entries(byId))('%s has a three-question quiz, each with exactly one right answer', (_, text) => {
    const questions = text.split('<QuickQuestion').slice(1)
    expect(questions).toHaveLength(3)
    for (const q of questions) expect(q.split('/>')[0].match(/correct: true/g)).toHaveLength(1)
  })

  it.each(Object.entries(byId))('%s links only to the official Kubernetes docs', (_, text) => {
    const links = [...text.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1])
    expect(links.length).toBeGreaterThanOrEqual(3)
    for (const l of links) expect(l).toMatch(/^https:\/\/kubernetes\.io\/docs\//)
  })

  it('glossary terms point at anchors that exist', () => {
    for (const entry of GLOSSARY) {
      const text = byId[entry.lessonId]
      expect(text, `no apostila for ${entry.term}`).toBeTruthy()
      expect(ids(text), `${entry.term} → #${entry.anchor}`).toContain(entry.anchor)
    }
  })
})
