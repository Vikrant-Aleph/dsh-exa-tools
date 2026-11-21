# dsh-exa-tools

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）接入 Exa 搜索的插件，为 profile 中的每个 agent 增加两个工具：

- **`exa_search`** —— 语义化网页搜索：用自然语言描述你想找的页面，返回来源 URL、标题和相关摘录。
- **`exa_fetch`** —— 通过 Exa 抓取任意网页，返回干净的正文（text/markdown）。

**没有 API Key 也能直接用。** 未填 Key 时走 Exa 免费托管 MCP 端点（`mcp.exa.ai`，有速率限制）；填了 Key 则走 Exa 官方 REST API（`api.exa.ai`），使用你账户的限额。Key 只需在「设置 → Exa 搜索」填一次，不用改配置文件，不用重启。

[English](README.md) · [技术文档（中文）](docs/TECHNICAL.zh-CN.md) · [Technical documentation](docs/TECHNICAL.md)

## 环境要求

- DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`（Desktop 或 Web profile）
- Node.js `>=24.9`（DSH 自带运行时即满足）

## 安装

**通过 DSH 界面：** 侧边栏「插件」→「添加插件」，指向本项目：

- 本地目录：`D:\path\to\dsh-exa-tools`（或 `/path/to/dsh-exa-tools`）
- Git 地址：`https://github.com/Vikrant-Aleph/dsh-exa-tools.git`
- 发布到 npm 后也可直接填包名 `dsh-exa-tools`

**通过对话：** 直接让 agent 安装，例如「安装 `D:\path\to\dsh-exa-tools` 这个插件」。

> **本地目录安装注意：** DSH 以链接（link）方式引用你的 checkout，而不是复制。安装前请先在项目目录里执行一次 `pnpm install`（或 `npm install`），让插件依赖的 `@deepseek-ai/schemastery` 可解析。项目刻意使用 hoisted 的 `node_modules` 布局，原因见[技术文档](docs/TECHNICAL.zh-CN.md#模块解析)。

安装后插件立即启用（HMR）。**新开一个会话**，agent 就能调用这两个工具。

## 填写 API Key（可选）

1. 侧边栏「设置」→「Exa 搜索」（「插件」页的本插件详情里也有同样的表单）。
2. 在 **API Key** 输入框粘贴密钥，点「保存」。密钥在 [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys) 获取。
3. 状态行从「免费模式」变为「API 模式」。下一次工具调用即生效，无需重启。

同一页面上的「清除 API Key」可切回免费端点。

不填 Key 时开箱即用（Exa 免费额度）；免费端点有速率限制，触发限流时错误信息会提示填写 Key。

### Key 存在哪里

Key 保存在 profile 的 `cordis.patch.yml` 中（与其他插件设置同一位置）。它在界面上是**只写密钥**：DSH 从不把已保存的值回传给浏览器，输入框只显示「是否已配置」。请像对待其他凭据文件一样对待 profile 目录：磁盘上是明文，安全性取决于你的系统用户权限。

## 工具说明

### `exa_search`

| 参数 | 类型 | 说明 |
|---|---|---|
| `query` | string，必填 | 用自然语言描述想找的页面，例如「对比 React 和 Vue 性能的博客文章」，不要只写关键词。 |
| `num_results` | integer，可选 | 返回条数（默认 5，上限由 `searchMaxResults` 控制，默认 10）。 |

返回来源列表：`- [标题](url) — 摘录 (发布日期)`，每条摘录最多 800 字符，并附带固定提示：结果为外部不可信数据，引用时请用 markdown 链接。

### `exa_fetch`

| 参数 | 类型 | 说明 |
|---|---|---|
| `url` | string，必填 | 要读取的页面绝对 `http(s)` URL。 |
| `max_characters` | integer，可选 | 返回的正文字符数（默认 20 000，上限由 `fetchMaxCharacters` 控制，默认 50 000）。 |

返回 `Fetched <url>` 加干净正文。内容被截断时会标注，模型可据此抓取更具体的章节。

两个工具与 DSH 内置的 `web_search` / `web_fetch` 并存；系统提示词会告诉模型各自的用途，并把返回内容视为不可信数据。

## 配置项

设置页（设置 → Exa 搜索）可实时修改：API Key、`searchMaxResults`、`fetchMaxCharacters`、`searchTimeoutMs`、`fetchTimeoutMs`。部署级字段在 profile 的 `cordis.patch.yml` 中编辑：

```yaml
- id: exa-tools
  name: dsh-exa-tools
  config:
    search: true            # 注册 exa_search
    fetch: true             # 注册 exa_fetch
    apiBaseUrl: https://api.exa.ai
    mcpBaseUrl: https://mcp.exa.ai/mcp
```

| 字段 | 默认值 | 插件页可改 | 含义 |
|---|---|---|---|
| `apiKey` | *（空）* | 是（只写） | Exa API Key；空 = 免费 MCP 端点 |
| `searchMaxResults` | `10` | 是 | 单次搜索来源上限（1–50） |
| `fetchMaxCharacters` | `50000` | 是 | 单次抓取字符上限（1 000–500 000） |
| `searchTimeoutMs` | `30000` | 是 | 单次搜索超时（毫秒） |
| `fetchTimeoutMs` | `60000` | 是 | 单次抓取超时（毫秒） |
| `search` / `fetch` | `true` | 否（YAML） | 是否注册对应工具 |
| `apiBaseUrl` / `mcpBaseUrl` | 官方端点 | 否（YAML） | 代理或自建 MCP 时覆盖 |

## 开发

纯 ESM JavaScript，无构建步骤。

```
index.js            Host 插件：Config schema + 工具注册
lib/http.js         融合超时/取消的 fetch；REST 错误映射
lib/exa-mcp.js      极简 MCP streamable-HTTP 客户端（免费端点）
lib/exa-rest.js     Exa REST 客户端（/search、/contents）
lib/format.js       MCP 文本解析、规范化输出、面向模型的渲染
client.js           浏览器端：Plugins 页配置卡片
cordis.patch.yml    插入 exa-tools 行的 bundle patch
locale/             插件显示元数据（en、zh）
scripts/smoke.mjs   后端冒烟测试（真实端点）
scripts/apply-test.mjs  集成测试：mock context 下 apply() + execute()
scripts/client-test.mjs 客户端测试：插槽注册 + 设置页渲染
```

```sh
pnpm install          # 首次；hoisted 布局（见 pnpm-workspace.yaml）
pnpm smoke            # 免费端点搜索 + 抓取，REST 401 错误路径
pnpm smoke:api        # 真实 REST 调用；需要环境里有 EXA_API_KEY
pnpm test:apply       # 注册、参数校验、双后端、渲染
pnpm test:client      # 设置页 / 导航图标 / 卡片注册
```

架构细节（bundle 结构、原生工具定义契约、MCP 握手、密钥脱敏、settings 传输）见[技术文档](docs/TECHNICAL.zh-CN.md)。

## 已知限制

- 免费端点有速率限制且为共享额度，重度使用需要 API Key。
- 搜索摘录有上限（每条 800 字符）；需要全文请用 `exa_fetch`。
- 抓取截断按「长度达到请求预算」判断，恰好等长的页面可能被标记为截断。
- API Key 存于 profile patch（磁盘明文）；本版本未使用 DSH 的 credentials 服务。
- 暂不支持 `EXA_API_KEY` 环境变量回退——Key 来自插件页面或 profile patch。

## 许可证

[MIT](LICENSE)
