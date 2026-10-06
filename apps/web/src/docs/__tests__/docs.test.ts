import studioSrc from '../../components/app/AppStudio.tsx?raw'
import editorSrc from '../../components/app/CodeEditor.tsx?raw'
import accountSrc from '../../components/account/AccountButton.tsx?raw'
import inspectorSrc from '../../components/Inspector.tsx?raw'
import lessonPanelSrc from '../../components/LessonPanel.tsx?raw'
import overlaysSrc from '../../components/stage/Overlays.tsx?raw'
import terminalSrc from '../../components/Terminal.tsx?raw'
import appWindowSrc from '../../components/app/AppWindow.tsx?raw'
import helpSrc from '../../tour/HelpMenu.tsx?raw'
import kubectlSrc from '../../sim/kubectl.ts?raw'
import pipeSrc from '../../sim/cli/pipe.ts?raw'
import { Simulation } from '../../sim/engine'
import { WORKSPACE_RULES } from '@kubelearn/shared'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '../../components/app/templates'
import { LESSONS } from '../../lessons'
import { LIMITS } from '../../runtime/program'
import { UNSIMULATED_VERBS, USAGE, VERBS } from '../../sim/cli/usage'
import { FILES } from '../../sim/manifests'
import { SHORTCUTS } from '../../tour/shortcuts'
import { SECTIONS } from '../content'
import { DocPage } from '../DocPage'

// what a reader sees: the page rendered to text (entities decoded, tags dropped)
const html = renderToStaticMarkup(createElement(DocPage))
const text = html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&quot;/g, '"')
  .replace(/&#x27;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')

describe('/doc', () => {
  it('every section has a unique, linkable id', () => {
    const ids = SECTIONS.flatMap((s) => [s.id, ...s.subs.map((x) => x.id)])
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  it('links inside the page and into the app go somewhere real', () => {
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]))
    const lessons = new Set(LESSONS.map((l) => l.id))
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
      if (href.startsWith('#')) expect(ids, href).toContain(href.slice(1))
      else if (href.startsWith('/#/')) expect(lessons, href).toContain(href.slice(3))
      else expect(['/', '/privacidade'], href).toContain(href)
    }
  })

  it('lists every lesson, with its title, tagline and manifests — and every manifest exists', () => {
    for (const l of LESSONS) {
      expect(text).toContain(l.title)
      expect(text).toContain(l.tagline)
      for (const f of l.files) {
        expect(text).toContain(f)
        expect(FILES[f], f).toBeDefined()
      }
    }
  })

  it('documents every simulated command exactly as --help does, and every one that is not', () => {
    for (const verb of VERBS) {
      expect(text).toContain(`kubectl ${verb}`)
      expect(text).toContain(USAGE[verb].what)
      for (const line of USAGE[verb].use) expect(text).toContain(line)
    }
    for (const [verb, what] of Object.entries(UNSIMULATED_VERBS)) expect(text).toContain(`kubectl ${verb} ${what}`)
  })

  it('shows every keyboard shortcut and the limits the runtime enforces', () => {
    for (const group of SHORTCUTS) for (const [, what] of group.items) expect(text.toLowerCase()).toContain(what.toLowerCase())
    expect(text).toContain(`${LIMITS.codeChars.toLocaleString('pt-BR')} caracteres`)
    expect(text).toContain(`${(LIMITS.loadMs / 1000).toLocaleString('pt-BR')} s`)
    expect(text).toContain(`${(LIMITS.requestMs / 1000).toLocaleString('pt-BR')} s`)
    expect(text).toContain(`Cabem até ${WORKSPACE_RULES.releasesMax} imagens suas`)
  })

  it('names the editor templates the editor actually offers', () => {
    const editor = SECTIONS.find((s) => s.id === 'seu-codigo')!.subs.find((x) => x.id === 'editor')!
    const rendered = renderToStaticMarkup(createElement('div', null, editor.body)).replace(/<[^>]+>/g, '')
    for (const t of TEMPLATES) expect(rendered).toContain(t.label)
  })
})

// The prose quotes interface labels and numbers: each one must still exist where the app defines it.
describe('/doc quotes the app faithfully', () => {
  const quoted: [string, string][] = [
    ['Publicar com um bug', studioSrc],
    ['Implantar no cluster', studioSrc],
    ['Nova versão', studioSrc],
    ['Criar seu app', appWindowSrc],
    ['no ar agora', appWindowSrc],
    ['Testar', editorSrc],
    ['Gerar imagem', editorSrc],
    ['Restaurar modelo', editorSrc],
    ['Baixar meus dados', accountSrc],
    ['Reiniciar progresso…', accountSrc],
    ['Apagar conta…', accountSrc],
    ['apagar', accountSrc],
    ['Editar direto no container…', inspectorSrc],
    ['Travou? Mostrar uma dica', lessonPanelSrc],
    ['Aplicar backend.yaml', overlaysSrc],
    ['Rever o tutorial', helpSrc],
    ['Documentação', helpSrc],
    ['tente', terminalSrc],
    ['? explicar', terminalSrc],
  ]
  it.each(quoted)('“%s” is still what the app says', (label, src) => {
    expect(text).toContain(label)
    expect(src).toContain(label)
  })

  it('the numbers it states are the simulation’s', () => {
    expect(new Simulation().cluster.nodes).toHaveLength(3)
    expect(text).toContain('3 nodes')
    expect(kubectlSrc).toContain('use no máximo 8 réplicas')
    expect(kubectlSrc).toContain('use --max de no máximo 8')
    expect(text).toContain('até 8 réplicas')
    // the pipe commands it lists are the ones the terminal accepts
    expect(pipeSrc).toContain('só entende grep, head, tail, wc -l, sort e base64')
  })
})
