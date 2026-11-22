<h1 align="center">
  <img src="icon.svg" width="64" height="64" alt="">
  <br>
  dsh-exa-tools
</h1>

Exa web search and fetch tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). Adds five tools to every agent in the profile:

- **`exa_search`** — semantic web search: describe the ideal page in natural language, get back source URLs with titles and relevant excerpts. (no API key needed)
- **`exa_fetch`** — read any webpage through Exa as clean text/markdown. (no API key needed)
- **`exa_answer`** — Q&A: an Exa-generated answer with citation sources (API key required).
- **`exa_search_advanced`** — search with category, domain, and published-date filters (API key required).
- **`exa_find_similar`** — find webpages similar to a given URL (API key required).

**No API key? It just works.**

- Without a key, the tools use Exa's free hosted MCP endpoint (mcp.exa.ai, rate-limited);
- With a key, they call the official Exa REST API (api.exa.ai) under your account's limits;
- Enter the key under Settings → Exa tools — no config files, no restart, effective immediately;
- If the API fails (quota exhausted, rate limit, invalid key, network), calls automatically fall back to the free endpoint, the result notes the reason, and the fallback can be turned off on the settings page.

Three more tools are API-only — `exa_answer` (Q&A), `exa_search_advanced` (filtered search), `exa_find_similar` (similar pages): they appear once a key is set and never fall back.

[中文文档](README.md) · [Technical documentation](docs/TECHNICAL.en-US.md) · [技术文档](docs/TECHNICAL.md)

## Requirements

- DeepSeek Harness `>=0.1.7-rc.1` (Desktop or Web profile). The required APIs were verified against the published sources of every release line from 0.1.7-rc.1 to 0.2.2-rc.5, and fully exercised on 0.2.2-rc.5; no upper bound. The settings-page navigation icon needs `>=0.2.2-rc.1`; older releases show the default glyph. See [Version compatibility](docs/TECHNICAL.en-US.md#10-version-compatibility).
- Node.js `>=20.3` for the plugin code itself (global `fetch`, `AbortSignal.any/timeout`). DSH's own runtime requirement may be higher — current DSH ships Node 24.

## Install

**Option 1: npm (recommended)**

**Plugins** → **Add plugin** → enter the package name `dsh-exa-tools`.

**Option 2: download a Release**

1. Grab the latest `dsh-exa-tools-<version>.tgz` from [Releases](https://github.com/Vikrant-Aleph/dsh-exa-tools/releases)
2. DSH sidebar **Plugins** → **Add plugin** → pick the tgz file (or paste the Release asset URL)

**Option 3: Git URL / local directory (developers)**

- Git URL: `https://github.com/Vikrant-Aleph/dsh-exa-tools.git`
- Local directory: `D:\path\to\dsh-exa-tools` (or `/path/to/dsh-exa-tools`)
- Or ask the agent: “install the plugin at `D:\path\to\dsh-exa-tools`”

> **Local directory installs:** DSH links the checkout instead of copying it. Run `pnpm install` (or `npm install`) in the project directory once before installing, so the plugin's `@deepseek-ai/schemastery` dependency resolves. The project uses a hoisted `node_modules` layout on purpose — see [Technical documentation](docs/TECHNICAL.en-US.md#module-resolution).

After installation the plugin is enabled immediately (HMR). Open a **new session** and the tools are available to the agent (the API-only ones need a key set on the settings page first).

## Set up the API key (optional)

1. Sidebar **Settings** → **Exa tools** (the plugin's page under **Plugins** carries the same form).
2. Paste your key into **API key** and press **Save**. Get a key at [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys).
3. The status line flips from *Free mode* to *API mode*. Changes apply to the next tool call — no restart.

**Clear API key** on the same page switches back to the free endpoint.

Without a key everything works out of the box on Exa's free tier; the free endpoint is rate-limited, and a rate-limit error tells the model (and you) to add a key.

### Where the key lives

The key is stored in your profile's `cordis.patch.yml` (the same place as other plugin settings). It is a *write-only secret* in the UI: DSH never sends the stored value back to the client — the input only shows whether a key is configured. Treat the profile directory like any other credential store: it is plain text on disk, protected by your OS user permissions.

## Tools

### `exa_search`

| Parameter | Type | Description |
|---|---|---|
| `query` | string, required | Natural-language description of the page you want to find, e.g. `"blog post comparing React and Vue performance"` — not keyword strings. |
| `num_results` | integer, optional | Results to return (default 5, capped by `searchMaxResults`, default 10). |

Returns a source list: `- [title](url) — excerpt (publishedDate)`, each excerpt capped at 800 characters, with the standing notice that results are external, untrusted data and should be cited as markdown links.

### `exa_fetch`

| Parameter | Type | Description |
|---|---|---|
| `url` | string, required | Absolute `http(s)` URL of the page to read. |
| `max_characters` | integer, optional | Page characters to return (default 20 000, capped by `fetchMaxCharacters`, default 50 000). |

Returns `Fetched <url>` plus the page body as clean text/markdown. Truncated content is marked so the model can fetch a more specific section.

### `exa_answer` (API key required)

| Parameter | Type | Description |
|---|---|---|
| `query` | string, required | Natural-language question or instruction. |

Returns an Exa-generated answer plus its citation sources. The answer itself is generated from web content and stays untrusted.

### `exa_search_advanced` (API key required)

| Parameter | Type | Description |
|---|---|---|
| `query` | string, required | Natural-language description of the page you want to find. |
| `num_results` | integer, optional | Results to return (default 5, capped by `searchMaxResults`). |
| `category` | string, optional | Focus category: company / publication / news / personal site / financial report / people. company and people ignore date filters; people also ignores exclude_domains. |
| `include_domains` | string[], optional | Only results from these domains (supports `*.example.com`, `example.com/docs`). |
| `exclude_domains` | string[], optional | Never return results from these domains. |
| `start_published_date` / `end_published_date` | string, optional | ISO 8601 published-date range. |

Returns the same source list as `exa_search`.

### `exa_find_similar` (API key required)

| Parameter | Type | Description |
|---|---|---|
| `url` | string, required | Absolute http(s) URL of the reference page. |
| `num_results` | integer, optional | Results to return (default 5, capped). |
| `exclude_source_domain` | boolean, optional | Exclude results from the reference URL's own domain. |

Returns a source list of similar pages. Note: the upstream `/findSimilar` endpoint is marked deprecated by Exa (they recommend `/search` with a descriptive query) but is still served.

The three API-only tools appear in the toolset only while a key is configured (effective the next step after saving one); failures surface as errors and **never fall back** to the free endpoint.

These tools coexist with DSH's built-in `web_search` / `web_fetch`; the system prompt tells the model what each returns and to treat the content as untrusted data.

## Configuration

The settings page (Settings → Exa tools) edits the live fields: API key, `searchMaxResults`, `fetchMaxCharacters`, `searchTimeoutMs`, `fetchTimeoutMs`, and the `fallbackToFree` switch. Deployment-level fields are edited in the profile's `cordis.patch.yml`:

```yaml
- id: exa-tools
  name: dsh-exa-tools
  config:
    search: true            # register exa_search
    fetch: true             # register exa_fetch
    apiBaseUrl: https://api.exa.ai
    mcpBaseUrl: https://mcp.exa.ai/mcp
```

| Field | Default | Editable on plugin page | Meaning |
|---|---|---|---|
| `apiKey` | *(empty)* | yes (write-only) | Exa API key; empty = free MCP endpoint |
| `searchMaxResults` | `10` | yes | Cap on sources per search (1–50) |
| `fetchMaxCharacters` | `50000` | yes | Cap on page characters per fetch (1 000–500 000) |
| `searchTimeoutMs` | `30000` | yes | Per-call search budget (ms) |
| `fetchTimeoutMs` | `60000` | yes | Per-call fetch budget (ms) |
| `fallbackToFree` | `true` | yes | Fall back to the free endpoint when the API fails |
| `search` / `fetch` | `true` | no (YAML) | Register each tool |
| `answer` / `advancedSearch` / `findSimilar` | `true` | no (YAML) | Register each API-only tool |
| `apiBaseUrl` / `mcpBaseUrl` | official endpoints | no (YAML) | Override for proxies or self-hosted MCP |

## Development

Plain ESM JavaScript — no build step.

```
index.js            Host plugin: Config schema + tool registration
lib/http.js         fetch with fused timeout/cancellation; REST error mapping
lib/exa-mcp.js      minimal MCP streamable-HTTP client (free endpoint)
lib/exa-rest.js     Exa REST client (/search, /contents)
lib/format.js       MCP text parsing, canonical outputs, model-facing rendering
client.js           client half: settings page + Plugins-page card (Web and Desktop)
cordis.patch.yml    bundle patch inserting the exa-tools row
locale/             plugin display metadata (en, zh)
scripts/smoke.mjs   backend smoke test against the live endpoints
scripts/apply-test.mjs  integration test: apply() + execute() via a mock context
scripts/client-test.mjs client test: slot registrations + settings page render
```

```sh
pnpm install          # once; hoisted layout (see pnpm-workspace.yaml)
pnpm smoke            # free endpoint search + fetch, REST 401 error path
pnpm smoke:api        # real REST calls; needs EXA_API_KEY in the environment
pnpm test:apply       # registration, validation, both backends, rendering
pnpm test:client      # settings page / nav icon / card registrations
```

See [docs/TECHNICAL.en-US.md](docs/TECHNICAL.en-US.md) for the architecture: bundle layout, the native tool-definition contract, the MCP handshake, secret redaction, and the settings transport.

## Limitations

- The free endpoint is rate-limited and shared; heavy use needs an API key.
- Search excerpts are capped (800 chars/source); use `exa_fetch` for full pages.
- Fetch truncation is detected by length reaching the requested budget, so an exactly-sized page may be marked truncated.
- The API key is stored in the profile patch (plain text on disk); DSH's credentials service is not used in this version.
- No `EXA_API_KEY` environment fallback yet — the key comes from the plugin page or the profile patch.

## License

[MIT](LICENSE)
