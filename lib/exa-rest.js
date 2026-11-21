/**
 * Exa REST API client, used when an API key is configured.
 * Endpoints: POST /search (with contents.highlights) and POST /contents
 * (with text.maxCharacters). Authentication: x-api-key header.
 * https://docs.exa.ai/reference/search
 */

import { fetchWithTimeout, readExaJson } from './http.js'

/**
 * Search the web and return normalized sources with highlight excerpts.
 *
 * @param {{baseUrl: string, apiKey: string, query: string, numResults: number, timeoutMs: number, signal?: AbortSignal}} options
 * @returns {Promise<Array<{url: string, title?: string, snippet?: string, publishedAt?: string}>>}
 */
export async function restSearch({ baseUrl, apiKey, query, numResults, timeoutMs, signal }) {
  const res = await fetchWithTimeout(`${baseUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      query,
      type: 'auto',
      numResults,
      contents: { highlights: true },
    }),
  }, timeoutMs, signal)
  const data = await readExaJson(res)
  const results = Array.isArray(data.results) ? data.results : []
  return results
    .filter(item => item && typeof item.url === 'string')
    .map(item => ({
      url: item.url,
      ...typeof item.title === 'string' && item.title ? { title: item.title } : {},
      ...Array.isArray(item.highlights) && item.highlights.length > 0
        ? { snippet: item.highlights.filter(part => typeof part === 'string').join(' ') }
        : {},
      ...typeof item.publishedDate === 'string' && item.publishedDate ? { publishedAt: item.publishedDate } : {},
    }))
}

/**
 * Read one page's full text through the Contents endpoint.
 *
 * @param {{baseUrl: string, apiKey: string, url: string, maxCharacters: number, timeoutMs: number, signal?: AbortSignal}} options
 * @returns {Promise<{url: string, title?: string, text: string}>}
 */
export async function restFetch({ baseUrl, apiKey, url, maxCharacters, timeoutMs, signal }) {
  const res = await fetchWithTimeout(`${baseUrl}/contents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      ids: [url],
      text: { maxCharacters },
    }),
  }, timeoutMs, signal)
  const data = await readExaJson(res)
  const statuses = Array.isArray(data.statuses) ? data.statuses : []
  const status = statuses.find(item => item && item.id === url) ?? statuses[0]
  if (status && status.status !== 'success') {
    throw new Error(`Exa could not read ${url} (${status.status})`)
  }
  const item = Array.isArray(data.results) ? data.results[0] : undefined
  if (!item || typeof item.text !== 'string') {
    throw new Error(`Exa returned no text content for ${url}`)
  }
  return {
    url: typeof item.url === 'string' && item.url ? item.url : url,
    ...typeof item.title === 'string' && item.title ? { title: item.title } : {},
    text: item.text,
  }
}
