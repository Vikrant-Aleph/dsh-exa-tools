/**
 * Exa REST API client, used when an API key is configured.
 * Endpoints: POST /search (with contents.highlights), POST /contents
 * (with text.maxCharacters), POST /answer, POST /findSimilar.
 * Authentication: x-api-key header.
 * https://docs.exa.ai/reference/search
 */

import { fetchWithTimeout, readExaJson } from './http.js'

/** Normalize one /search-style result item into a canonical source. */
function projectSource(item) {
  return {
    url: item.url,
    ...typeof item.title === 'string' && item.title ? { title: item.title } : {},
    ...Array.isArray(item.highlights) && item.highlights.length > 0
      ? { snippet: item.highlights.filter(part => typeof part === 'string').join(' ') }
      : {},
    ...typeof item.publishedDate === 'string' && item.publishedDate ? { publishedAt: item.publishedDate } : {},
  }
}

/** POST a /search-style request and return normalized sources. */
async function searchStyleRequest(path, { baseUrl, apiKey, body, timeoutMs, signal }) {
  const res = await fetchWithTimeout(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  }, timeoutMs, signal)
  const data = await readExaJson(res)
  const results = Array.isArray(data.results) ? data.results : []
  return results.filter(item => item && typeof item.url === 'string').map(projectSource)
}

/**
 * Search the web and return normalized sources with highlight excerpts.
 *
 * @param {{baseUrl: string, apiKey: string, query: string, numResults: number, timeoutMs: number, signal?: AbortSignal}} options
 * @returns {Promise<Array<{url: string, title?: string, snippet?: string, publishedAt?: string}>>}
 */
export async function restSearch({ baseUrl, apiKey, query, numResults, timeoutMs, signal }) {
  return searchStyleRequest('/search', {
    baseUrl, apiKey, timeoutMs, signal,
    body: { query, type: 'auto', numResults, contents: { highlights: true } },
  })
}

/**
 * Advanced search with category, domain, and published-date filters.
 * API-only: no free-endpoint equivalent.
 *
 * @param {{baseUrl: string, apiKey: string, query: string, numResults: number, category?: string, includeDomains?: string[], excludeDomains?: string[], startPublishedDate?: string, endPublishedDate?: string, timeoutMs: number, signal?: AbortSignal}} options
 */
export async function restSearchAdvanced({ baseUrl, apiKey, query, numResults, category, includeDomains, excludeDomains, startPublishedDate, endPublishedDate, timeoutMs, signal }) {
  const body = { query, type: 'auto', numResults, contents: { highlights: true } }
  if (category) body.category = category
  if (Array.isArray(includeDomains) && includeDomains.length > 0) body.includeDomains = includeDomains
  if (Array.isArray(excludeDomains) && excludeDomains.length > 0) body.excludeDomains = excludeDomains
  if (startPublishedDate) body.startPublishedDate = startPublishedDate
  if (endPublishedDate) body.endPublishedDate = endPublishedDate
  return searchStyleRequest('/search', { baseUrl, apiKey, body, timeoutMs, signal })
}

/**
 * Find pages similar to a given URL. API-only. The upstream endpoint is
 * marked deprecated (Exa recommends /search with a descriptive query) but
 * is still served.
 *
 * @param {{baseUrl: string, apiKey: string, url: string, numResults: number, excludeSourceDomain?: boolean, timeoutMs: number, signal?: AbortSignal}} options
 */
export async function restFindSimilar({ baseUrl, apiKey, url, numResults, excludeSourceDomain, timeoutMs, signal }) {
  const body = { url, numResults, contents: { highlights: true } }
  if (excludeSourceDomain !== undefined) body.excludeSourceDomain = excludeSourceDomain
  return searchStyleRequest('/findSimilar', { baseUrl, apiKey, body, timeoutMs, signal })
}

/**
 * Ask a question and get an LLM answer with citations. API-only.
 *
 * @param {{baseUrl: string, apiKey: string, query: string, timeoutMs: number, signal?: AbortSignal}} options
 * @returns {Promise<{answer: string, citations: Array<{url: string, title?: string, publishedAt?: string}>}>}
 */
export async function restAnswer({ baseUrl, apiKey, query, timeoutMs, signal }) {
  const res = await fetchWithTimeout(`${baseUrl}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ query }),
  }, timeoutMs, signal)
  const data = await readExaJson(res)
  if (typeof data.answer !== 'string') throw new Error('Exa /answer returned no answer text')
  const citations = (Array.isArray(data.citations) ? data.citations : [])
    .filter(item => item && typeof item.url === 'string')
    .map(item => ({
      url: item.url,
      ...typeof item.title === 'string' && item.title ? { title: item.title } : {},
      ...typeof item.publishedDate === 'string' && item.publishedDate ? { publishedAt: item.publishedDate } : {},
    }))
  return { answer: data.answer, citations }
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
