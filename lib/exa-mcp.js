/**
 * Minimal MCP streamable-HTTP client for Exa's hosted free endpoint
 * (https://mcp.exa.ai/mcp). Implements only what the free-endpoint tools need:
 * initialize -> notifications/initialized -> tools/call, with JSON or SSE
 * responses, session reuse, and one re-initialize retry on an expired session.
 * No MCP SDK dependency; the protocol surface is small and stable.
 */

import { fetchWithTimeout } from './http.js'

const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'dsh-exa-tools', version: '0.1.0' }
const HANDSHAKE_TIMEOUT_MS = 15_000

/** Parse an SSE body into JSON-RPC messages (one `data:` payload per event). */
function parseSse(text) {
  const messages = []
  for (const frame of text.split(/\r?\n\r?\n/)) {
    const data = frame
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('\n')
    if (!data) continue
    try { messages.push(JSON.parse(data)) } catch { /* keep other frames */ }
  }
  return messages
}

export class ExaMcpClient {
  /** @param {string} baseUrl full MCP endpoint URL, e.g. https://mcp.exa.ai/mcp */
  constructor(baseUrl) {
    this.baseUrl = baseUrl
    this.sessionId = null
    this.nextId = 1
    this.initPromise = null
  }

  /**
   * POST one JSON-RPC payload. Notifications carry no id and expect 202.
   * @returns {Promise<{status: number, sessionId: string | null, messages: any[]}>}
   */
  async post(payload, signal, timeoutMs) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId
    const res = await fetchWithTimeout(this.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, timeoutMs, signal)
    const sessionId = res.headers.get('mcp-session-id')
    if (sessionId) this.sessionId = sessionId
    const text = await res.text()
    const contentType = res.headers.get('content-type') || ''
    let messages = []
    if (contentType.includes('text/event-stream')) {
      messages = parseSse(text)
    } else if (text.trim()) {
      try { messages = [JSON.parse(text)] } catch { /* non-JSON body; status decides */ }
    }
    return { status: res.status, sessionId, messages }
  }

  /** Handshake once; concurrent callers share the same promise. */
  async ensureSession() {
    if (this.sessionId) return
    if (!this.initPromise) {
      // The handshake runs on its own budget so one caller's cancellation
      // cannot fail a shared initialization other callers are waiting on.
      this.initPromise = this.initialize().finally(() => { this.initPromise = null })
    }
    await this.initPromise
  }

  async initialize() {
    const id = this.nextId++
    const res = await this.post({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
    }, undefined, HANDSHAKE_TIMEOUT_MS)
    if (res.status !== 200) {
      throw new Error(`Exa MCP endpoint returned HTTP ${res.status} during initialize`)
    }
    const answer = res.messages.find(message => message.id === id)
    if (!answer) throw new Error('Exa MCP endpoint returned no initialize response')
    if (answer.error) throw new Error(`Exa MCP initialize failed: ${answer.error.message ?? answer.error.code}`)
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, undefined, HANDSHAKE_TIMEOUT_MS)
  }

  /**
   * Call one tool and return its `content` array. Throws on transport errors,
   * JSON-RPC errors, and `isError` tool results (whose text is the server's
   * own message). An expired session (HTTP 404) is re-initialized once.
   *
   * @param {string} name tool name, e.g. web_search_exa
   * @param {Record<string, unknown>} args tool arguments
   * @param {{signal?: AbortSignal, timeoutMs: number}} options
   * @returns {Promise<Array<{type: string, text?: string}>>}
   */
  async callTool(name, args, { signal, timeoutMs }) {
    for (let attempt = 0; ; attempt++) {
      await this.ensureSession()
      const id = this.nextId++
      const res = await this.post({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: args },
      }, signal, timeoutMs)
      if (res.status === 404 && attempt === 0) {
        // Session expired or unknown: drop it and retry once with a fresh one.
        this.sessionId = null
        continue
      }
      if (res.status !== 200) {
        throw new Error(`Exa MCP endpoint returned HTTP ${res.status} for ${name}`)
      }
      const answer = res.messages.find(message => message.id === id)
      if (!answer) throw new Error(`Exa MCP endpoint returned no response for ${name}`)
      if (answer.error) throw new Error(`Exa MCP error ${answer.error.code}: ${answer.error.message ?? 'unknown'}`)
      const result = answer.result
      if (result?.isError) {
        const text = (result.content ?? [])
          .filter(item => item.type === 'text' && typeof item.text === 'string')
          .map(item => item.text)
          .join('\n')
        throw new Error(text || `Exa MCP tool ${name} failed`)
      }
      return result?.content ?? []
    }
  }

  /** Best-effort session teardown on plugin unload; never throws. */
  async dispose() {
    const sessionId = this.sessionId
    this.sessionId = null
    if (!sessionId) return
    try {
      await fetch(this.baseUrl, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': sessionId },
        signal: AbortSignal.timeout(3_000),
      })
    } catch { /* the server also drops idle sessions on its own */ }
  }
}
