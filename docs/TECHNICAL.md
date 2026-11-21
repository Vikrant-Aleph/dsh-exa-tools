# Technical documentation

Architecture of `dsh-exa-tools`, a DeepSeek Harness (DSH) bundle. Written against DSH `0.2.2-rc.5`; the contracts used here are the stable ones shared with the MCP bridge and the settings subsystem.

中文版本：[TECHNICAL.zh-CN.md](TECHNICAL.zh-CN.md)

## 1. Design goals

1. **Zero-config start.** With no API key, both tools work against Exa's free hosted MCP endpoint. No account, no env var, no YAML edit.
2. **One model-facing contract.** Free (MCP) and paid (REST) backends normalize to the same canonical output per tool, so the model never sees which mode is active.
3. **Settings UI for the key.** The key is entered on the plugin's page under Plugins, stored as a write-only secret, and applies live without a restart.
4. **Small dependency surface.** Plain ESM JavaScript, no build step, one npm dependency (`@deepseek-ai/schemastery`).

## 2. Bundle layout

A DSH bundle is a package whose `package.json` declares `dsh.bundle.patch`; the YAML patch inserts plugin rows into the profile's composed tree.

```
package.json        name dsh-exa-tools; dsh.bundle.patch; dsh.client (platform web)
cordis.patch.yml    - insert: [{ id: exa-tools, name: dsh-exa-tools, config: {} }]
index.js            Host half: export const Config, inject, apply(ctx, config)
client.js           browser half: window.__ModuleLoader__.load({ id, factory })
lib/*.js            backend clients + formatting (pure modules, no cordis imports)
locale/{en,zh}.json meta.title / meta.description for Plugin Manager
icon.svg            original 36×36 mark, exported as ./icon
```

The inserted row's **id `exa-tools`** is also its settings namespace (the settings service keys forms by `entry.options.id`, not the composed tree path `include:exa-tools`).

`engines.dsh: ">=0.2.2-rc.1 <0.3.0-0"` gates installation against the running DSH.

## 3. Host plugin

### Config schema

`Config` is a schemastery object. Two field classes:

- **Volatile** (`.volatile()`): `apiKey`, `searchMaxResults`, `fetchMaxCharacters`, `searchTimeoutMs`, `fetchTimeoutMs`. The loader parses them into stable references; the plugin reads `config.field.get()` at call time, and a settings write commits new values **in place** — no remount, no stale closures.
- **Ordinary**: `search`, `fetch`, `apiBaseUrl`, `mcpBaseUrl`. Edited in the profile patch; a change remounts the plugin.

`apiKey` additionally carries `.role('secret')`. The settings subsystem strips secret fields from every wire response and ships a sidecar instead: `secrets: [{ path: ['apiKey'], set: true|false }]`. The browser learns *whether* a key exists, never its value.

### apply lifecycle

```js
export const inject = ['tools']
export function apply(ctx, config) {
  const mcp = new ExaMcpClient(config.mcpBaseUrl)
  ctx.effect(() => () => { void mcp.dispose() })        // session teardown on unload
  ctx.inject(['settings'], child => {                   // optional services:
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  ctx.inject(['systemPrompt'], child => { /* guidance sections */ })
  if (config.search) ctx.tools.register({ /* exa_search */ })
  if (config.fetch)  ctx.tools.register({ /* exa_fetch */ })
}
```

- Registrations on `ctx.tools` / `child.systemPrompt` are effect-scoped: unloading the plugin unregisters the tools and prompt sections automatically.
- `settings.configure({ auto: false })` declares that this plugin ships its own configuration page; it does not affect form reads/writes.
- Prompt sections (`tool:exa_search` order 110, `tool:exa_fetch` order 111) render only while the step admits their tool (`child.tools.get(name, scope, toolSet)`), mirroring `dsh-tool-web`'s trust guidance.

### Tool definitions: the native contract

The tools register **raw `ToolDefinition` objects** — the same contract `dsh-mcp-client` uses (`createMcpToolDefinition`): standard JSON Schema `parameters`, an `output.schema` + `render(args, value)`, and `execute(args, exec)` returning the canonical JSON value.

Why not `defineTool` from `@deepseek-ai/dsh-tools`? `defineTool` is a pure helper (DSL→JSON Schema + argument validation), but importing it pulls the package's runtime module graph (`cordis`, `dsh-scope`, `dsh-llm`, …) into the plugin's resolution scope. The raw contract avoids that dependency entirely; argument validation lives in `execute` (`checkArgs`, `checkOptionalCount`, semantic checks), and thrown `Error`s become normal error tool results.

Both tools declare `isConcurrencySafe: () => true` (read-only network calls).

### Timeouts and cancellation

Each call fuses the caller's signal with a live budget:

```js
AbortSignal.any([exec.signal, AbortSignal.timeout(config.searchTimeoutMs.get())])
```

- Caller cancellation rethrows untouched → the pipeline classifies it `ABORTED`.
- Internal timeout becomes `Exa request timed out after N ms`.
- Budgets are read per call, so a settings change applies to the next call. The plugin does not set declarative `timeoutMs` (which would freeze at registration); enforcement is real, inside `execute`.

## 4. Backends

Selection per call: `config.apiKey.get()?.trim()` non-empty → REST, else MCP.

### 4.1 REST (with API key)

| Tool | Request | Response fields used |
|---|---|---|
| `exa_search` | `POST {apiBaseUrl}/search` `{ query, type: 'auto', numResults, contents: { highlights: true } }` | `results[].{url,title,highlights,publishedDate}` |
| `exa_fetch` | `POST {apiBaseUrl}/contents` `{ ids: [url], text: { maxCharacters } }` | `results[0].{url,title,text}`, `statuses[]` |

Auth: `x-api-key` header. `/contents` takes top-level `text` (no `contents` wrapper — that's `/search` only). Non-2xx bodies `{ error, tag }` map to actionable messages: 401/403 → check the key under Plugins; 402 → billing; 429 → rate limit. Error text quotes only the server's response, never the request key.

### 4.2 MCP (free endpoint)

`lib/exa-mcp.js` is a minimal streamable-HTTP client — no MCP SDK. Sequence (verified against `mcp.exa.ai`, server `exa-search-server` 3.5.1):

```
POST initialize            → 200, SSE; Mcp-Session-Id response header
POST notifications/initialized → 202
POST tools/call            → 200, SSE (or JSON); match JSON-RPC id
```

- Every POST sends `Accept: application/json, text/event-stream`; responses are parsed as SSE frames (`data:` lines → JSON) or plain JSON.
- The session id is cached and sent as `Mcp-Session-Id`. Concurrent first calls share one initialize promise; the handshake runs on its own 15 s budget so one caller's cancellation cannot fail it for others.
- HTTP 404 on `tools/call` (expired session) drops the id and retries once.
- `result.isError` throws the server's own text; JSON-RPC `error` objects throw code+message.
- Plugin unload sends a best-effort `DELETE` with the session id.

Tool arguments on the hosted server:

- `web_search_exa`: `{ query, numResults, objective }` (`objective` is schema-required; the plugin passes the query text).
- `web_fetch_exa`: `{ urls: [url], maxCharacters }` — note `urls` is an **array**.

### 4.3 Normalizing MCP text

The free endpoint returns formatted text, not JSON:

- Search: one text item, blocks of `Title: …` / `URL: …` / `Published: …` / `Author: …` / `Highlights:` + body. `parseMcpSearch` splits blocks on a `Title:` line **followed by** a `URL:` line (lookahead keeps literal `Title:` lines inside highlight bodies from splitting), extracts headers, and caps each excerpt. If nothing parses, the raw text passes through as `text` — a server format change degrades, not fails.
- Fetch: `# Title` + `URL: …` + markdown body; `parseMcpFetch` falls back to the raw text with the requested URL.

Canonical outputs (identical for both backends):

```jsonc
// exa_search
{ "sources": [{ "url", "title?", "snippet?", "publishedAt?" }], "text?" }
// exa_fetch
{ "url", "title?", "text", "truncated" }
```

Rendering follows `dsh-tool-web` conventions: the standing untrusted-content notice, `- [title](url) — excerpt (date)` source lines, a cite-your-sources instruction, and a truncation footer. Snippets are whitespace-collapsed and capped at 800 characters (surrogate-safe cut). Fetch truncation is `text.length >= maxCharacters` (heuristic; an exactly-sized page may be flagged).

## 5. Settings UI (browser half)

`client.js` registers one React component into the Plugins page slot:

```js
ctx.configForms.whileServed(['exa-tools'], () =>
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: 'dsh-exa-tools', locale: 'exaTools',
    inject: () => ({ form, mirror }),
  }, ExaConfigCard)))
```

- `plugins.bundle.config` is keyed by the **bundle package name**; the card renders on the bundle's page between its description and its rows. `whileServed` keeps the registration alive only while the Host serves the namespace.
- Reads: `ctx.configForms.get('exa-tools')` (values + ordered writes) and `ctx.configForms.describe()` (the shared mirror, for the secret presence marker). Both are consumed with `useSyncExternalStore`; class methods are wrapped in `useCallback` to keep `this`.
- Writes: staged drafts, one **Save** submits `form.mutate(ops, revision)` — `set` for changed fields, `unset` for emptied numeric fields (restores the composed default; the form says so and shows each field's default). The revision fence is captured **when editing begins**, so a concurrent write elsewhere is refused instead of silently overwritten; a refusal auto-reloads the latest values, keeps the drafts, and resets the fence so an informed retry can proceed. Invalid numeric input names the field, marks it `aria-invalid`, expands the fold, and focuses it. Success messages announce via `role="status"`. **Clear API key** is `form.unset('apiKey')`.
- The key input is write-only (`type=password`, `autocomplete=new-password`, reveal toggle for the draft). Its placeholder reflects the presence marker: “Key configured — type to replace” vs “Paste your Exa API key”.
- Styling: self-contained controls under a `dsh-exa-` prefix, colors exclusively through `--dsw-alias-*` theme tokens (patterns copied from the official Models settings page). No Harness Client package is imported as a module; React comes from the browser module table (`require('react')`).
- Locale dictionaries (en/zh) register through `ctx.locale`; all visible text routes through `t`.

## 6. Module resolution

A local-directory install **links** the checkout: the profile's `node_modules/dsh-exa-tools` is a junction to the project, and Node resolves the plugin's bare imports from the project's real path. Two consequences:

1. The project declares `@deepseek-ai/schemastery` as a dependency and ships a `pnpm-workspace.yaml` with `nodeLinker: hoisted` — real directories, no symlink edge cases under Node/Electron/the loader. Run `pnpm install` once before installing the bundle.
2. Cross-copy interop is safe by design: schemastery marks schemas with `Symbol.for('schemastery')`, and cosmokit's volatile references use `Symbol.for('cosmokit.volatile.write')` explicitly “to identify references across ESM/CJS copies”. The loader's own copies recognize this plugin's schema and config references.

`@deepseek-ai/dsh-tools` is deliberately **not** imported (see §3); the tool registry consumes the plain definition objects through `ctx.tools`.

## 7. Security & privacy

- Queries and fetched URLs go to Exa (`mcp.exa.ai` or `apiBaseUrl`). The system prompt and tool output label all returned content as external, untrusted data.
- The API key travels only to `apiBaseUrl` as `x-api-key`. It is never logged, never included in error messages, and never returned to the browser (secret redaction).
- At rest the key sits in the profile's `cordis.patch.yml` like other plugin config — plain text, guarded by OS permissions. A future version may move it to the DSH credentials service.
- `exa_fetch` accepts any http(s) URL, including loopback/private hosts (same posture as the built-in `web_fetch`); deployments needing per-call confirmation should add a `tools/pre-execute` policy.

## 8. Testing

- `scripts/smoke.mjs` — live backend tests: free search/fetch through `lib/*`, REST 401 error path (`--rest`), real REST with `EXA_API_KEY` (`--api`).
- `scripts/apply-test.mjs` — runs `apply()` against a mock cordis context, then executes the registered definitions: free-mode canonical values + render, argument validation, and API-mode wiring (invalid key → mapped 401).
- Verified in the profile: bundle installs, row `include:exa-tools` reaches `fiberPhase: active`, settings namespace derivation and slot contract checked against the installed sources. Rendered UI and in-session tool calls require a browser/new session and are reported separately.

## 9. Possible extensions

- `EXA_API_KEY` environment fallback (with an honest mode indicator in the UI).
- Advanced search filters in API mode (`category`, `includeDomains`, date ranges) via `web_search_advanced_exa` or REST.
- Batch `exa_fetch` (the MCP tool already accepts multiple URLs).
- Credentials-service storage for the key, keeping the same write-only UI.
