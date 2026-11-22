# 技术文档

`dsh-exa-tools` 的架构说明。这是一个 DeepSeek Harness（DSH）bundle，基于 DSH `0.2.2-rc.5` 编写；所用契约均为与 MCP 桥、settings 子系统共享的稳定契约。

English version: [TECHNICAL.en-US.md](TECHNICAL.en-US.md)

## 1. 设计目标

1. **零配置可用。** 没有 API Key 时，两个工具直接走 Exa 免费托管 MCP 端点。不需要账号、环境变量或改 YAML。
2. **统一的模型侧契约。** 免费（MCP）与付费（REST）两条后端归一化为同一份规范输出，模型感知不到当前模式。
3. **设置界面填 Key。** Key 在「插件」页填写，以只写密钥保存，实时生效，无需重启。
4. **最小依赖面。** 纯 ESM JavaScript，无构建步骤，只有一个 npm 依赖（`@deepseek-ai/schemastery`）。

## 2. Bundle 结构

DSH bundle 是一个在 `package.json` 里声明 `dsh.bundle.patch` 的包；YAML patch 向 profile 的组合树插入插件行。

```
package.json        包名 dsh-exa-tools；dsh.bundle.patch；dsh.client（platform web）
cordis.patch.yml    - insert: [{ id: exa-tools, name: dsh-exa-tools, config: {} }]
index.js            Host 端：export const Config、inject、apply(ctx, config)
client.js           客户端（Web/桌面通用）：window.__ModuleLoader__.load({ id, factory })
lib/*.js            后端客户端 + 格式化（纯模块，不 import cordis）
locale/{en,zh}.json 插件管理器显示的 meta.title / meta.description
icon.svg            原创 36×36 图标，导出为 ./icon
```

插入行的 **id `exa-tools`** 同时是它的 settings 命名空间（settings 服务以 `entry.options.id` 为表单键，而不是组合树路径 `include:exa-tools`）。

`engines.dsh: ">=0.1.7-rc.1"` 在安装时校验运行中的 DSH 版本；下限有实证依据，见[版本兼容](#10-版本兼容)。

## 3. Host 插件

### Config schema

`Config` 是 schemastery object，字段分两类：

- **Volatile**（`.volatile()`）：`apiKey`、`searchMaxResults`、`fetchMaxCharacters`、`searchTimeoutMs`、`fetchTimeoutMs`、`fallbackToFree`。loader 把它们解析为稳定引用；插件在调用时读 `config.field.get()`，settings 写入会**就地**提交新值——不重挂载、无过期闭包。
- **普通字段**：`search`、`fetch`、`answer`、`advancedSearch`、`findSimilar`、`apiBaseUrl`、`mcpBaseUrl`。在 profile patch 中编辑，修改会重挂载插件。

`apiKey` 额外带 `.role('secret')`。settings 子系统从所有跨线响应中剥离 secret 字段，改发一个旁路记录：`secrets: [{ path: ['apiKey'], set: true|false }]`。客户端只知道 Key **是否存在**，永远拿不到值。

### apply 生命周期

```js
export const inject = ['tools']
export function apply(ctx, config) {
  const mcp = new ExaMcpClient(config.mcpBaseUrl)
  ctx.effect(() => () => { void mcp.dispose() })        // 卸载时关闭会话
  ctx.inject(['settings'], child => {                   // 可选服务：
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  ctx.inject(['systemPrompt'], child => { /* 提示词段落 */ })
  if (config.search) ctx.tools.register({ /* exa_search */ })
  if (config.fetch)  ctx.tools.register({ /* exa_fetch */ })
}
```

- `ctx.tools` / `child.systemPrompt` 上的注册都是 effect 所有：插件卸载时工具与提示词段落自动注销。
- `settings.configure({ auto: false })` 声明本插件自带配置页；不影响表单读写。
- 提示词段落（`tool:exa_search` order 110、`tool:exa_fetch` order 111）仅在该步准入对应工具时渲染（`child.tools.get(name, scope, toolSet)`），与 `dsh-tool-web` 的信任提示一致。

### 工具定义：原生契约

两个工具注册的是**原生 `ToolDefinition` 对象**——与 `dsh-mcp-client`（`createMcpToolDefinition`）相同的契约：标准 JSON Schema 的 `parameters`、`output.schema` + `render(args, value)`、返回规范 JSON 值的 `execute(args, exec)`。

为什么不用 `@deepseek-ai/dsh-tools` 的 `defineTool`？`defineTool` 本身是纯函数（DSL→JSON Schema + 参数校验），但 import 它会把该包的运行时模块图（`cordis`、`dsh-scope`、`dsh-llm`……）拉进插件的解析范围。原生契约完全避开这个依赖；参数校验放在 `execute` 内（`checkArgs`、`checkOptionalCount`、语义检查），抛出的 `Error` 会成为普通的错误工具结果。

两个工具都声明 `isConcurrencySafe: () => true`（只读网络调用）。

### 超时与取消

每次调用把调用方信号与实时预算融合：

```js
AbortSignal.any([exec.signal, AbortSignal.timeout(config.searchTimeoutMs.get())])
```

- 调用方取消原样重抛 → 管线归类为 `ABORTED`。
- 内部超时变为 `Exa request timed out after N ms`。
- 预算逐次调用读取，settings 修改对下一次调用生效。插件不设置声明式 `timeoutMs`（那会在注册时冻结）；强制在 `execute` 内真实执行。

## 4. 后端

逐次调用选择：`config.apiKey.get()?.trim()` 非空 → REST，否则 MCP。

### 4.1 REST（有 API Key）

| 工具 | 请求 | 使用的响应字段 |
|---|---|---|
| `exa_search` | `POST {apiBaseUrl}/search` `{ query, type: 'auto', numResults, contents: { highlights: true } }` | `results[].{url,title,highlights,publishedDate}` |
| `exa_fetch` | `POST {apiBaseUrl}/contents` `{ ids: [url], text: { maxCharacters } }` | `results[0].{url,title,text}`、`statuses[]` |

认证：`x-api-key` 头。`/contents` 的 `text` 在顶层（没有 `contents` 包装——那是 `/search` 专属）。非 2xx 响应体 `{ error, tag }` 映射为可操作的消息：401/403 → 去 Plugins 检查 Key；402 → 计费；429 → 限流。错误文本只引用服务端响应，绝不包含请求 Key。

### 4.2 MCP（免费端点）

`lib/exa-mcp.js` 是极简 streamable-HTTP 客户端——不依赖 MCP SDK。时序（已对 `mcp.exa.ai` 实测，服务端 `exa-search-server` 3.5.1）：

```
POST initialize                → 200，SSE；响应头 Mcp-Session-Id
POST notifications/initialized → 202
POST tools/call                → 200，SSE（或 JSON）；按 JSON-RPC id 匹配
```

- 每个 POST 都带 `Accept: application/json, text/event-stream`；响应按 SSE 帧（`data:` 行 → JSON）或纯 JSON 解析。
- 会话 id 缓存后以 `Mcp-Session-Id` 发送。并发的首次调用共享同一个 initialize promise；握手用自己的 15 s 预算，某个调用方的取消不会连累其他等待者。
- `tools/call` 收到 HTTP 404（会话过期）时丢弃 id 并重试一次。
- `result.isError` 抛出服务端自己的文本；JSON-RPC `error` 对象抛出 code+message。
- 插件卸载时尽力发送带会话 id 的 `DELETE`。

托管服务端上的工具参数：

- `web_search_exa`：`{ query, numResults, objective }`（`objective` 为 schema 必填；插件传入 query 文本）。
- `web_fetch_exa`：`{ urls: [url], maxCharacters }`——注意 `urls` 是**数组**。

### 4.3 MCP 文本归一化

免费端点返回格式化文本而非 JSON：

- 搜索：一个 text 项，若干 `Title: …` / `URL: …` / `Published: …` / `Author: …` / `Highlights:` + 正文 的块。`parseMcpSearch` 在「`Title:` 行**后跟** `URL:` 行」处切块（前瞻避免摘录正文里的字面 `Title:` 行误切），提取头部并给每条摘录截断。若解析不出任何块，原文以 `text` 透传——服务端格式变化时降级而非失败。
- 抓取：`# Title` + `URL: …` + markdown 正文；`parseMcpFetch` 解析失败时回退为原文 + 请求 URL。

规范输出（两条后端一致）：

```jsonc
// exa_search
{ "sources": [{ "url", "title?", "snippet?", "publishedAt?" }], "text?" }
// exa_fetch
{ "url", "title?", "text", "truncated" }
```

渲染沿用 `dsh-tool-web` 约定：固定的不可信内容提示、`- [标题](url) — 摘录 (日期)` 来源行、引用提示、截断尾注。摘录折叠空白并截断到 800 字符（不切开代理对）。抓取截断判据为 `text.length >= maxCharacters`（启发式；恰好等长的页面可能被标记）。

### 4.4 失败回退

有 Key 时每次调用先走 REST；任何失败（402 额度耗尽、429 限流、401/403 密钥失效、5xx、网络错误、超时）且 `fallbackToFree` 开启（默认）时，自动改用免费 MCP 端点重试，并把简短原因（≤160 字符）写入规范输出的可选 `fallback` 字段，渲染为结果首行提示：`(Exa API unavailable: <原因> — this result comes from the free endpoint.)`。两端都失败时抛出合并错误。调用方取消（`exec.signal` aborted）不触发回退，原样重抛。每次尝试各自享有完整的超时预算（最坏总耗时约为配置的两倍）。无 Key 时本就直接走免费端点，无所谓回退。

### 4.5 API 专用工具（不回退）

`exa_answer`（POST /answer）、`exa_search_advanced`（POST /search + category / includeDomains / excludeDomains / startPublishedDate / endPublishedDate）、`exa_find_similar`（POST /findSimilar）仅走 REST：

- 注册带 `{ when: () => keyOf().length > 0 }` 条件，由注册表逐步求值——无 Key 时三个工具不出现在模型工具集；设置 Key 后下一步即生效，无需重启。`execute` 内另有 `requireKey` 守卫兜底（老宿主忽略 when 选项时也不会静默失败）。
- **不回退**：免费端点没有这些能力，失败直接抛出映射后的 REST 错误，与 `fallbackToFree` 无关。
- 类别枚举以当前 OpenAPI 为准：company / publication / news / personal site / financial report / people（其他字符串作为类别提示被接受）。company/people 不支持日期过滤，people 不支持 excludeDomains，违反返回 400——参数描述里已注明。
- `/findSimilar` 上游已标记 deprecated（官方推荐 /search + 描述性 query），仍可用；README 与本节如实注明。
- 输出：`exa_answer` 为 `{answer, citations[]}`，渲染为「不可信提示 + 回答 + Sources + 引用提示」；另两个复用 `exa_search` 的 `{sources}` 规范输出与渲染（摘录同样 800 字符截断）。
- 超时复用 `searchTimeoutMs`；并发安全声明与其余工具一致。

## 5. 设置界面

设置页与卡片在 Web 端和桌面端同样可用：客户端模块运行于两者的渲染层，注册与传输契约一致。

主入口是**「设置」面板导航中的独立页面**，注册进 `settings.section`（与会话回收站等第三方页面同一插槽）；同一张卡片也嵌入 Plugins 页：

```js
// 设置面板页面（locale 变化时重新注册以刷新导航标签：shell 自身不订阅 locale）。
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section', id: 'exa-tools', order: 35,
  label: () => t('nav'), inject: () => ({ form, mirror, t }),
}, ExaSettingsPage))
// 导航图标：注册 id 必须等于 section id；以 currentColor 绘制。
ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
  name: 'settings.section.icon', id: 'exa-tools',
}, ExaSettingsIcon))
// Plugins 页卡片，以 bundle 包名为 key。
ctx.configForms.whileServed(['exa-tools'], () =>
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: 'dsh-exa-tools', locale: 'exaTools',
    inject: () => ({ form, mirror }),
  }, ExaConfigCard)))
```

- `ExaSettingsPage` 是标题 + `ExaConfigCard`；section 组件收到 shell 的 `close` 能力与注入的 `{ form, mirror, t }`。

- `plugins.bundle.config` 以 **bundle 包名**为 key；卡片渲染在该 bundle 详情页的描述与行列表之间。`whileServed` 使注册仅在 Host 提供该命名空间期间存活。
- 读：`ctx.configForms.get('exa-tools')`（值 + 有序写入）与 `ctx.configForms.describe()`（共享 mirror，取 secret 存在标记）。两者都用 `useSyncExternalStore` 消费；类方法用 `useCallback` 包一层以保住 `this`。
- 写：草稿暂存，一次「保存」提交 `form.mutate(ops, revision)`——变更字段 `set`，清空的数字字段 `unset`（恢复组合默认值；表单会说明这一语义并显示各字段默认值）。revision 围栏在**开始编辑时**取快照，因此别处的并发写入会被拒绝而非静默覆盖；被拒时自动重载最新值、保留草稿并重置围栏，用户核对后可重试。数字校验错误会指明字段、标 `aria-invalid`、展开折叠并聚焦该输入框。成功消息带 `role="status"` 播报。「清除 API Key」即 `form.unset('apiKey')`。
- Key 输入框只写（`type=password`、`autocomplete=new-password`、草稿可切换显示）。占位符反映存在标记：「已配置 —— 输入新值可替换」/「粘贴 Exa API Key」。
- 回退开关：`fallbackToFree` 复选框，与其他字段一同暂存、一次保存。
- 样式：`dsh-exa-` 前缀的自包含控件，颜色全部走 `--dsw-alias-*` 主题令牌（样式范式抄自官方 Models 设置页）。不把任何 Harness Client 包当模块 import；React 来自客户端模块表（`require('react')`）。
- 字典（en/zh）经 `ctx.locale` 注册；所有可见文本走 `t`。

## 6. 模块解析

本地目录安装是**链接** checkout：profile 的 `node_modules/dsh-exa-tools` 是指向项目的 junction，Node 从项目真实路径解析插件的裸 import。两个推论：

1. 项目把 `@deepseek-ai/schemastery` 声明为依赖，并带一份 `nodeLinker: hoisted` 的 `pnpm-workspace.yaml`——真实目录，避免 Node/Electron/loader 下的符号链接边界问题。安装 bundle 前先执行一次 `pnpm install`。
2. 跨副本互操作由设计保证：schemastery 用 `Symbol.for('schemastery')` 标记 schema，cosmokit 的 volatile 引用用 `Symbol.for('cosmokit.volatile.write')`，明确「用于跨 ESM/CJS 副本识别引用」。loader 自己的副本能识别本插件的 schema 与 config 引用。

刻意**不** import `@deepseek-ai/dsh-tools`（见 §3）；工具注册表通过 `ctx.tools` 消费纯定义对象。

## 7. 安全与隐私

- 搜索词与抓取 URL 发送到 Exa（`mcp.exa.ai` 或 `apiBaseUrl`）。系统提示词与工具输出把所有返回内容标记为外部不可信数据。
- API Key 仅以 `x-api-key` 头发往 `apiBaseUrl`。不记日志、不进错误消息、不回传客户端（secret 脱敏）。
- 静态存储时 Key 与其他插件配置一样位于 profile 的 `cordis.patch.yml`——明文，由操作系统权限保护。未来版本可迁移到 DSH credentials 服务。
- `exa_fetch` 接受任意 http(s) URL，包括环回/内网地址（与内置 `web_fetch` 姿态一致）；需要逐次确认的部署应添加 `tools/pre-execute` 策略。

## 8. 测试

- `scripts/smoke.mjs` —— 真实后端测试：经 `lib/*` 的免费搜索/抓取、REST 401 错误路径（`--rest`）、带 `EXA_API_KEY` 的真实 REST（`--api`）。
- `scripts/apply-test.mjs` —— 用 mock cordis context 跑 `apply()`，再执行注册出的定义：免费模式规范值 + 渲染、参数校验、API 模式接线（无效 Key → 映射后的 401）。
- `scripts/client-test.mjs` —— 经 mock `__ModuleLoader__` 加载 `client.js`，用 mock context 跑客户端 `apply()`，以最小 React mock 渲染设置页、导航图标与卡片；断言三个插槽注册及其 id 规则。
- 已在 profile 中验证：bundle 安装成功，行 `include:exa-tools` 达到 `fiberPhase: active`；settings 命名空间推导与插槽契约已对照安装源码核实。渲染效果需在 Web 或桌面端界面查看，会话内工具调用需新会话，均另行报告。

## 9. 可能的扩展

- `EXA_API_KEY` 环境变量回退（并在 UI 上如实显示模式）。
- API 模式下的高级搜索过滤（`category`、`includeDomains`、日期范围），走 `web_search_advanced_exa` 或 REST。
- 批量 `exa_fetch`（MCP 工具本就接受多 URL）。
- Key 改存 credentials 服务，保持同样的只写 UI。

## 10. 版本兼容

`engines.dsh` 为 `>=0.1.7-rc.1`，**不设上限**。下限通过逐个里程碑版本探测已发布 npm tarball 中本插件所用 API 的存在性确定（源码级核实；运行时完整验证仅在 0.2.2-rc.5 上做过）：

| 所需能力 | 最早携带的版本 |
|---|---|
| 原生工具定义契约（`parameters` / `output.render` / `execute`，MCP 桥的注册方式） | 0.1.5-rc.3 |
| `settings.section` 插槽 | 0.1.5-rc.3 |
| `plugins.bundle.config` 插槽 | 0.1.6-alpha.2 |
| schemastery `.volatile()`（3.18.4）+ 支持 volatile 的 loader（1.0.5） | 0.1.7-rc.1 |
| settings 表单：`volatileForm`、secret 脱敏、`configure()` | 0.1.7-rc.1 |
| 客户端 `configForms` + `whileServed` | 0.1.7-rc.1 |
| `settings.section.icon` 插槽（导航图标） | 0.2.2-rc.1 |

- **0.1.5 / 0.1.6 无法运行本插件**：其 schemastery（3.18.2）没有 `.volatile()`，客户端 settings 包没有 `configForms`。
- **低于 0.2.2-rc.1** 时设置导航项显示 shell 默认图标：`slots.inject('settings.section.icon', …)` 等待一个永远不会出现的声明，是无操作而非错误。
- **老宿主上的跨副本安全**：插件自带 schemastery 3.19.0，而 0.1.7 宿主用 3.18.4 解析。两者都用 `Symbol.for('schemastery')` 标记 schema、用 `Symbol.for('cosmokit.volatile.write')` 标记 volatile 引用（已核实 cosmokit 1.8.5 / 1.8.6 / 1.9.0 协议一致），因此老 loader 能识别本插件的 schema 与 config 引用。
- **Node**：插件代码需要 ≥20.3（用到的最新 API 是 `AbortSignal.any`）；DSH 自身的运行时下限可能更高。
- **条件注册**：`register(def, { when })` 是 0.2.x 的 tools 契约；更老的宿主若忽略该选项，三个 API 专用工具会保持可见，但无 Key 调用时得到明确的「需要 API Key」错误（requireKey 守卫）。

## 11. 发布流水线

`.github/workflows/release.yml`，推送 `v*` 标签触发：校验标签与 `package.json` 版本一致 → `pnpm install --frozen-lockfile` → 客户端测试（`test:client`，离线且确定；`smoke` / `test:apply` 访问真实 Exa 端点，保留为本地开发工具）→ `pnpm pack` → `softprops/action-gh-release` 创建带 tgz 附件的 Release（自动生成 release notes）→ 仓库配置了 `NPM_TOKEN` secret 时执行 `npm publish --access public`（未配置则跳过）。workflow 需要 `contents: write` 权限。

发版步骤：

```sh
# 1. 修改 package.json 的 version，提交并推送
git tag v0.1.1
git push origin v0.1.1
# 2. Actions 自动建 Release（附 tgz）；配置了 NPM_TOKEN 时同步发布 npm
```

npm 自动发布的一次性准备：仓库 **Settings → Secrets and variables → Actions** 新增 `NPM_TOKEN`（npmjs.com 的 Automation token，不受 2FA 限制）。未配置时 workflow 跳过 npm 发布，只建 Release；也可以本地手动 `npm publish --access public`（账号开启 2FA 时需交互授权）。注意同一版本不可重复发布：手动发过的版本，配置 token 后再推同名标签会在 npm 步骤失败。
