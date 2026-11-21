/**
 * Shared HTTP helpers: one fetch wrapper that fuses the caller's cancellation
 * signal with a per-call timeout budget, and one JSON reader that maps Exa API
 * failures to messages the model can act on.
 */

/**
 * Fetch with a cooperative deadline. The caller's signal (tool cancellation)
 * and an internal timeout are fused; a timeout becomes a plain readable Error,
 * while caller cancellation rethrows untouched so the tool pipeline classifies
 * it as ABORTED.
 *
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs
 * @param {AbortSignal} [callerSignal]
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options, timeoutMs, callerSignal) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout
  try {
    return await fetch(url, { ...options, signal })
  } catch (error) {
    if (callerSignal?.aborted) throw error
    if (timeout.aborted) throw new Error(`Exa request timed out after ${timeoutMs} ms`)
    throw new Error(`Exa request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Read an Exa REST response as JSON, mapping non-2xx statuses to actionable
 * messages. Response bodies never contain the request key, so quoting the
 * server's own error text is safe.
 *
 * @param {Response} res
 * @returns {Promise<any>}
 */
export async function readExaJson(res) {
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = undefined }
  if (!res.ok) {
    const detail = (data && typeof data.error === 'string' && data.error) || text.slice(0, 200) || res.statusText
    const tag = data && typeof data.tag === 'string' ? ` [${data.tag}]` : ''
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Exa API rejected the API key (HTTP ${res.status}). Check the key under Plugins -> Exa tools. ${detail}`)
    }
    if (res.status === 402) {
      throw new Error(`Exa API billing error (HTTP 402): ${detail}`)
    }
    if (res.status === 429) {
      throw new Error(`Exa API rate limit reached (HTTP 429): ${detail}`)
    }
    throw new Error(`Exa API request failed (HTTP ${res.status})${tag}: ${detail}`)
  }
  if (data === undefined) throw new Error('Exa API returned a non-JSON response')
  return data
}

/**
 * Whether an error message looks like a rate limit, so the tool layer can add
 * the free-endpoint hint.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRateLimitError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return /429|rate.?limit|too many requests|quota/i.test(message)
}
