import { describe, expect, it } from 'vitest'
import { assemble, execute, normalizeReply, okReply, type Profile } from '../program'
import { nodeSandbox } from './nodeSandbox'

const run = async (code: string, env: Record<string, string> = {}): Promise<Profile> => assemble(await execute(nodeSandbox(), code, env))

describe('the learner code runtime', () => {
  it('a file with handle() is a server: it answers the probe paths', async () => {
    const p = await run(`console.log('servidor iniciado')\nfunction handle(req) { return 'Olá de ' + req.path }`)
    expect(p.kind).toBe('server')
    expect(p.logs).toEqual(['servidor iniciado'])
    expect(p.replies['/']).toEqual({ status: 200, body: 'Olá de /' })
    expect(okReply(p.replies['/healthz'])).toBe(true)
  })

  it('reads the environment through env and process.env', async () => {
    const p = await run(`function handle(req, env) { return env.APP_MESSAGE + ' / ' + process.env.APP_MESSAGE }`, { APP_MESSAGE: 'oi' })
    expect(p.replies['/']).toEqual({ status: 200, body: 'oi / oi' })
  })

  it('a file without handle() is a task: it runs once and finishes', async () => {
    const p = await run(`for (let i = 1; i <= 3; i++) console.log('lote', i, 'ok')`)
    expect(p).toEqual({ kind: 'script', logs: ['lote 1 ok', 'lote 2 ok', 'lote 3 ok'], replies: {} })
  })

  it('an error while loading is reported, with the logs printed before it', async () => {
    const p = await run(`console.log('carregando')\nthrow new Error('DATABASE_URL não definida')`)
    expect(p.error).toBe('Error: DATABASE_URL não definida')
    expect(p.logs).toEqual(['carregando'])
    const syntax = await run(`function handle( { return 1 }`)
    expect(syntax.error).toMatch(/^SyntaxError/)
    expect(syntax.kind).toBe('server')
  })

  it('an infinite loop while loading times out instead of hanging the test', async () => {
    const p = await run(`while (true) {}`)
    expect(p.timedOut).toBe(true)
  })

  it('a handler that loops forever times out on that request only', async () => {
    const p = await run(`function handle(req) { if (req.path === '/healthz') while (true) {} ; return 'ok' }`)
    expect(p.replies['/']).toEqual({ status: 200, body: 'ok' })
    expect(p.replies['/healthz']).toEqual({ timedOut: true })
  })

  it('a handler that throws answers with an error, per path', async () => {
    const p = await run(`function handle(req) { if (req.path === '/') throw new TypeError('x is undefined'); return 'saudável' }`)
    expect(p.replies['/']).toEqual({ error: 'TypeError: x is undefined' })
    expect(okReply(p.replies['/healthz'])).toBe(true)
  })

  it('async handlers and status codes work', async () => {
    const p = await run(`async function handle(req) { return req.path === '/healthz' ? { status: 503, body: 'ainda não' } : { status: 201, body: { ok: true } } }`)
    expect(p.replies['/']).toEqual({ status: 201, body: '{"ok":true}' })
    expect(p.replies['/healthz']).toEqual({ status: 503, body: 'ainda não' })
    expect(okReply(p.replies['/healthz'])).toBe(false)
  })

  it('bounds output: log lines and reply sizes', async () => {
    const p = await run(`for (let i = 0; i < 1000; i++) console.log(i)`)
    expect(p.logs.length).toBe(201)
    expect(p.logs.at(-1)).toContain('limite de linhas')
    expect(normalizeReply('x'.repeat(5000))).toMatchObject({ status: 200 })
    expect((normalizeReply('x'.repeat(5000)) as { body: string }).body.length).toBeLessThan(2100)
  })

  it('a trailing comment in the learner code does not break the program', async () => {
    const p = await run(`function handle() { return 'ok' } // fim`)
    expect(p.replies['/']).toEqual({ status: 200, body: 'ok' })
  })

  it('normalizes what handle returns', () => {
    expect(normalizeReply(undefined)).toEqual({ status: 204, body: '' })
    expect(normalizeReply({ status: 999, body: 'x' })).toEqual({ status: 200, body: 'x' })
    expect(normalizeReply(42)).toEqual({ status: 200, body: '42' })
  })

  it('behaves like a Node file: process.exit, require, module.exports, sloppy mode', async () => {
    expect(await run(`console.log('feito'); process.exit(0); console.log('nunca')`)).toEqual({ kind: 'script', logs: ['feito'], replies: {} })
    expect((await run(`process.exit(2)`)).error).toBe('process.exit(2)')
    expect((await run(`const x = require('express')`)).error).toMatch(/^Error: Cannot find module 'express'/)
    expect((await run(`total = 1; console.log(total)`)).logs).toEqual(['1'])
    expect((await run(`module.exports = function (req) { return 'via exports' }`)).replies['/']).toEqual({ status: 200, body: 'via exports' })
    expect((await run(`module.exports = { handle: () => 'obj' }`)).replies['/']).toEqual({ status: 200, body: 'obj' })
  })

  it('a server that calls process.exit while answering is gone', async () => {
    const p = await run(`function handle(req) { if (req.path === '/healthz') process.exit(1); return 'oi' }`)
    expect(p.kind).toBe('server')
    expect(p.error).toBe('process.exit(1)')
  })
})
