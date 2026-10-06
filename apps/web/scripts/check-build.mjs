/**
 * Checks the production build against what deploy/Caddyfile expects of it.
 *
 * The learner's code runs in a Web Worker that needs its own CSP ('unsafe-eval', no network).
 * Caddy picks that file by name; if the name ever changes, the worker silently gets the page's
 * CSP, eval throws, and every image built from app.js crash-loops — in production only.
 *
 *   npm run build -w @kubelearn/web && npm run check:build -w @kubelearn/web
 */
import { readdirSync, readFileSync } from 'node:fs'

const assets = readdirSync(new URL('../dist/assets/', import.meta.url))
const caddy = readFileSync(new URL('../../../deploy/Caddyfile', import.meta.url), 'utf8')

const fail = (msg) => {
  console.error(`check-build: ${msg}`)
  process.exit(1)
}

const matcher = caddy.match(/^\s*@codeWorker\s+path\s+(\S+)\s*$/m)?.[1]
if (!matcher) fail('deploy/Caddyfile has no `@codeWorker path …` matcher')
const page = caddy.match(/^\s*@page\s+not\s+path\s+(\S+)\s*$/m)?.[1]
if (page !== matcher) fail(`@page must exclude exactly what @codeWorker matches (${page} vs ${matcher})`)

// Caddy path globs: * matches within the path
const glob = new RegExp(`^${matcher.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`)
const workers = assets.filter((f) => glob.test(`/assets/${f}`))
if (workers.length !== 1) fail(`expected exactly one asset matching ${matcher}, found ${workers.length}: ${workers.join(', ') || 'none'}`)

// the worker must be self-contained: under its CSP it may only load scripts from this origin
const code = readFileSync(new URL(`../dist/assets/${workers[0]}`, import.meta.url), 'utf8')
if (!code.includes('eval')) fail(`${workers[0]} doesn't look like the code worker (no eval)`)
if (/\bfrom\s*["']https?:|import\(\s*["']https?:/.test(code)) fail(`${workers[0]} imports from another origin`)

console.log(`check-build: ok — ${workers[0]} gets the worker CSP (${matcher})`)
