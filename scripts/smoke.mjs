/**
 * Smoke test for the backend libraries, outside DSH.
 *
 *   node scripts/smoke.mjs            # free endpoint: search + fetch
 *   node scripts/smoke.mjs --rest     # additionally probe the REST error path
 *                                     # with an invalid key (expects HTTP 401)
 *   EXA_API_KEY=... node scripts/smoke.mjs --api
 *                                     # real REST search + fetch with your key
 *
 * Requires Node >= 20.3 (global fetch, AbortSignal.any/timeout).
 */

import { ExaMcpClient } from '../lib/exa-mcp.js'
import { restSearch, restFetch } from '../lib/exa-rest.js'
import { parseMcpSearch, parseMcpFetch, renderSearch, renderFetch } from '../lib/format.js'

const mode = process.argv[2] ?? '--free'
const mcp = new ExaMcpClient('https://mcp.exa.ai/mcp')

function show(label, value) {
  console.log(`\n=== ${label} ===`)
  console.log(typeof value === 'string' ? value.slice(0, 1200) : JSON.stringify(value, null, 2).slice(0, 1200))
}

try {
  if (mode === '--free' || mode === '--rest') {
    const searchContent = await mcp.callTool('web_search_exa', {
      query: 'Exa AI search API documentation',
      numResults: 3,
      objective: 'Find the official Exa API documentation pages',
    }, { timeoutMs: 30_000 })
    const searchValue = parseMcpSearch(searchContent)
    show('free search: canonical value', searchValue)
    show('free search: rendered', renderSearch(searchValue))
    if (searchValue.sources.length === 0) throw new Error('free search returned no sources')

    const fetchContent = await mcp.callTool('web_fetch_exa', {
      urls: ['https://example.com'],
      maxCharacters: 5000,
    }, { timeoutMs: 60_000 })
    const fetchValue = { ...parseMcpFetch(fetchContent, 'https://example.com'), truncated: false }
    show('free fetch: canonical value', fetchValue)
    show('free fetch: rendered', renderFetch(fetchValue))
    if (!fetchValue.text.includes('Example Domain')) throw new Error('free fetch returned unexpected content')
  }

  if (mode === '--rest') {
    try {
      await restSearch({
        baseUrl: 'https://api.exa.ai',
        apiKey: 'invalid-key-for-error-path-test',
        query: 'test',
        numResults: 1,
        timeoutMs: 30_000,
      })
      throw new Error('REST search with an invalid key unexpectedly succeeded')
    } catch (error) {
      show('REST error path (expected 401/403 message)', error.message)
      if (!/HTTP 40[13]/.test(error.message)) throw error
    }
  }

  if (mode === '--api') {
    const apiKey = process.env.EXA_API_KEY
    if (!apiKey) throw new Error('--api needs EXA_API_KEY in the environment')
    const sources = await restSearch({
      baseUrl: 'https://api.exa.ai', apiKey,
      query: 'Exa AI search API documentation', numResults: 3, timeoutMs: 30_000,
    })
    show('REST search: sources', sources)
    const page = await restFetch({
      baseUrl: 'https://api.exa.ai', apiKey,
      url: 'https://example.com', maxCharacters: 5000, timeoutMs: 60_000,
    })
    show('REST fetch: page', page)
  }

  console.log('\nSMOKE OK')
} catch (error) {
  console.error('\nSMOKE FAILED:', error)
  process.exitCode = 1
} finally {
  await mcp.dispose()
}
