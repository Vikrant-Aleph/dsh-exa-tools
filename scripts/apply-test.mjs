// Integration test: run apply() against a mock cordis context, then execute
// the registered tools end-to-end (free mode + API-key error path).
import { Config, apply } from '../index.js'

const registrations = []
const sections = []
const cleanups = []

function makeCtx() {
  return {
    fiber: {},
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    inject(_deps, cb) { cb(makeCtx()) },
    tools: {
      get: () => undefined,
      register(def) { registrations.push(def); return () => {} },
    },
    systemPrompt: { section(s) { sections.push(s); return () => {} } },
    settings: { configure() { return () => {} } },
  }
}

apply(makeCtx(), new Config({}))
console.log('registered tools:', registrations.map(d => d.name).join(', '))
console.log('prompt sections:', sections.map(s => s.name).join(', '))
if (registrations.length !== 2) throw new Error('expected both tools registered')

const search = registrations.find(d => d.name === 'exa_search')
const fetchTool = registrations.find(d => d.name === 'exa_fetch')
const exec = { signal: new AbortController().signal }

// Free-mode search through the registered definition.
const value = await search.execute({ query: 'Exa AI search API documentation', num_results: 2 }, exec)
if (!Array.isArray(value.sources) || value.sources.length === 0) throw new Error('no sources')
if (!value.sources.every(s => typeof s.url === 'string')) throw new Error('bad source shape')
console.log('\nsearch canonical ok:', value.sources.length, 'sources')
console.log(search.output.render({}, value)[0].text.slice(0, 300))

// Free-mode fetch through the registered definition.
const fv = await fetchTool.execute({ url: 'https://example.com', max_characters: 3000 }, exec)
if (typeof fv.text !== 'string' || typeof fv.truncated !== 'boolean') throw new Error('bad fetch shape')
console.log('\nfetch canonical ok:', JSON.stringify({ url: fv.url, title: fv.title, truncated: fv.truncated }))
console.log(fetchTool.output.render({}, fv)[0].text.slice(0, 200))

// Argument validation.
for (const [tool, args, expect] of [
  [search, {}, /query must be a non-empty string/],
  [search, { query: 'x', num_results: 'many' }, /num_results must be a number/],
  [fetchTool, { url: 'not a url' }, /not a valid URL/],
  [fetchTool, { url: 'ftp://example.com' }, /http or https/],
]) {
  try { await tool.execute(args, exec); throw new Error(`expected rejection for ${JSON.stringify(args)}`) }
  catch (error) {
    if (!expect.test(error.message)) throw error
    console.log('validation ok:', error.message)
  }
}

// API-key mode with fallback disabled: an invalid key must surface the mapped 401.
const keyed = []
const keyedCtx = makeCtx()
keyedCtx.tools.register = def => { keyed.push(def); return () => {} }
apply(keyedCtx, new Config({ apiKey: 'invalid-key-for-test', fallbackToFree: false }))
try {
  await keyed.find(d => d.name === 'exa_search').execute({ query: 'test' }, exec)
  throw new Error('invalid key unexpectedly succeeded')
} catch (error) {
  if (!/HTTP 401/.test(error.message)) throw error
  console.log('\nAPI-mode (no fallback) ok:', error.message.slice(0, 100))
}

// Fallback: invalid key + default fallbackToFree → the free endpoint answers
// and the result carries the fallback reason, in the value and the render.
const fb = []
const fbCtx = makeCtx()
fbCtx.tools.register = def => { fb.push(def); return () => {} }
apply(fbCtx, new Config({ apiKey: 'invalid-key-for-test' }))
const fbSearch = fb.find(d => d.name === 'exa_search')
const fbValue = await fbSearch.execute({ query: 'Exa AI search API documentation', num_results: 2 }, exec)
if (!fbValue.fallback || !/HTTP 401/.test(fbValue.fallback)) throw new Error('fallback reason missing')
if (!Array.isArray(fbValue.sources) || fbValue.sources.length === 0) throw new Error('fallback produced no sources')
const fbText = fbSearch.output.render({}, fbValue)[0].text
if (!fbText.includes('free endpoint')) throw new Error('render missing fallback notice')
console.log('fallback ok:', fbValue.fallback.slice(0, 80))

for (const cleanup of cleanups) await cleanup()
console.log('\nAPPLY TEST OK')
