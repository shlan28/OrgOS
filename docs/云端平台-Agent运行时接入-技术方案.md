# Agent 运行时接入（DeepSeek Harness）- 技术方案

> 创建日期：2026-10-24
> 状态：已实施（本地开发版）
> 关联：`docs/云端Agent协作平台-总体技术方案.md`（云端形态的长期方案）；本文记录当前在 Mock 前端上落地的真实运行时实现

## 1. 背景与范围

项目详情页原本是纯 Mock：格 1/2/3 的会话、消息、Agent CLI 轨迹全部来自 `src/data/projects.ts`。本次在不改动现有 UI 与样式的前提下，把 **Agent CLI 接入真实 DeepSeek Harness**，并补齐运行时与 Agent 的配置、持久化。

范围：

| 已实现 | 未实现（仍为 Mock） |
|---|---|
| 运行时（模型服务）管理、模型发现 | 项目中心/详情页的业务数据（项目、成员、任务、知识库等） |
| Agent 创建向导、配置弹窗、持久化 | 云端多租户、权限、工作流 |
| 会话 / 轮次 / 事件持久化 | 运行中插话（长驻进程） |
| 手动会话的真实 dsh 事件流 | 自动（auto）会话的真实执行 |

## 2. 总体结构

```
浏览器（React）
  ├─ 设置页：运行时 / Agent 配置
  └─ 项目详情：手动会话的 Agent CLI、对话
        │ REST + SSE
        ▼
本地后端（server/，Express + node:sqlite）
  ├─ 配置：runtimes / agents
  ├─ 运行：sessions / turns / events
  ├─ 模型发现：POST /api/runtimes/models → provider /models
  └─ 进程：spawn `dsh --profile headless --json`
        │
        ▼
DeepSeek Harness CLI（@deepseek-ai/dsh）
  └─ DSH_HOME = server/data/dsh/<agentId>/
```

## 3. 数据模型

```sql
runtimes(
  id, name, provider, base_url, models_json, created_at, updated_at)

agents(
  id, name, role, model, provider, permission, workdir,
  project_id, runtime_id, config_json, created_at, updated_at)

sessions(
  id, agent_id, project_id,
  external_ref,          -- 前端实体映射（如 loomweb:sess4），唯一索引
  title, dsh_session_id, -- Harness 原生会话 id
  status, created_at, updated_at)

turns(
  id, session_id, seq, user_content, status, error, created_at, ended_at)

events(
  id, turn_id, session_id, seq, type, payload, created_at)
```

迁移策略：`ensureColumn` 在启动时为旧库补 `project_id` / `runtime_id` / `external_ref`，并创建
`UNIQUE INDEX sessions_agent_ref (agent_id, external_ref) WHERE external_ref IS NOT NULL`。

`config_json` 保存 UI 侧字段：多模态/协作/第四模型槽、知识库、MCP、ADE.md、工具开关、关联项目等。

## 4. 运行时

### 4.1 概念

一个「运行时」= 一个模型服务：

| 字段 | 说明 |
|---|---|
| `name` | 展示名，如 DeepSeek 官方 |
| `provider` | `deepseek-official` / `openai-compatible` |
| `base_url` | 可选，留空用 provider 默认地址 |
| `models` | 可用模型列表（可自动拉取） |
| `hasKey` | 是否已配置 API Key（只读派生） |

### 4.2 模型发现

`POST /api/runtimes/models`：

- 输入：`provider`、`baseUrl`、`apiKey`（编辑已保存运行时且留空时复用已存 Key）、`runtimeId`
- 请求 `GET {base}/models`；base 以 `/v1` 结尾直接拼 `/models`，否则先试 `/models`，404 再试 `/v1/models`
- 12s 超时、响应上限 2MB、错误原文透传
- 返回 `{ models: string[] }`

实测：DeepSeek 官方返回 `deepseek-flash`、`deepseek-v4-pro`。

### 4.3 凭证

- 存在 `server/data/secrets.json`（文件权限 0600），结构：
  ```json
  { "runtimeKeys": { "rt_xxx": "sk-..." }, "deepseekApiKey": "兼容旧字段" }
  ```
- 只注入子进程环境，**不回传前端**；接口只返回 `hasKey` 布尔值。

## 5. Agent 配置

### 5.1 新建向导（四步）

```
① 选择运行时（显示 provider、模型数、Key 状态）
② 命名
③ 选择模型（下拉来自所选运行时的模型列表）
④ 个性化（角色 + ADE.md）
```

只在最后一步写入；取消不留半成品。创建后自动打开详情弹窗。

### 5.2 Agent 详情弹窗

左侧可点击目录 + 右侧编辑区：

| 目录 | 内容 |
|---|---|
| 名称 | Agent 名称 |
| 模型 | 模型 1 / 模型 2 / 模型 3 / 模型 4（四个槽位，无描述名） |
| 知识与上下文 | 个人知识库、MCP 服务 |
| ADE.md | 个性化文本，输入框撑满右侧高度 |

模型候选优先取绑定运行时的模型列表；不再展示角色、关联项目、权限档、工作目录、工具开关（保存时保留原值）。

### 5.3 设置页结构

```
运行环境      Harness CLI 状态（版本 + 二进制路径 + 刷新）
运行时        模型服务列表（新建 / 编辑 / 删除 / 拉取模型 / API Key）
我的 Agent    Agent 列表（新建向导、设为默认、点击打开详情）
```

已移除：默认模型、默认工具、知识与上下文、ADE.md 个性化（全部收进 Agent 详情弹窗）。

## 6. 多轮对话

### 6.1 两层会话

```
应用会话 sessions（一条 = 一段对话）
  └─ 绑定一个 Harness 原生会话 dsh_session_id
       └─ 状态落盘在 DSH_HOME/sessions/<cwd-scope>/<session-id>/session.v4.jsonl.zstd
```

- 首轮：`dsh --profile headless --patch <p> --json "<prompt>"`，从输出事件 `{"type":"session","sessionId":…}` 取得 id 并写库；
- 后续轮：追加 `--session-id <id>`，由 dsh 自己恢复历史，**应用不重发上下文**；
- `DSH_HOME` 按 Agent 隔离（`server/data/dsh/<agentId>/`），Harness 会话再按工作目录分目录。

### 6.2 每轮一进程

每轮启动一个 `dsh` 子进程，读完事件后退出。好处是实现简单、无长连接状态；代价是启动开销，且无法在运行中插话。

## 7. 项目详情页接入

### 7.1 映射粒度

只有**手动会话**接入真实运行时（auto 会话仍走 Mock 引擎）。映射键：

```
external_ref = "<项目id>:<会话id>"
```

后端按 `(agent_id, external_ref)` 唯一索引做「查找或创建」，同一会话重复进入会复用同一条后端会话；并发时靠唯一索引兜底。

### 7.2 数据映射

| 真实数据 | 详情页结构 |
|---|---|
| `events`（dsh NDJSON） | `TerminalLog`（sys/prompt/think/out/tool/ok/err/info） |
| `messages`（user/assistant） | `RunMessage`（人/ADE） |

后端不可用或还没有真实消息时，`realLogs` / `realMessages` 传 `undefined`，组件自动回退到 Mock，UI 与样式不变。

### 7.3 SSE

`GET /api/turns/:id/stream`：先回放已落库事件，再订阅实时事件；turn 结束后发送 `event: end` 并关闭。

## 8. API 一览

```
GET    /api/health
GET    /api/runtime                  CLI 状态 + Key 汇总
GET    /api/runtimes
POST   /api/runtimes
PATCH  /api/runtimes/:id
DELETE /api/runtimes/:id
PUT    /api/runtimes/:id/key
POST   /api/runtimes/models          从 provider 拉取模型

GET    /api/agents
POST   /api/agents
PATCH  /api/agents/:id
DELETE /api/agents/:id
POST   /api/agents/sync              设置页整表同步

GET    /api/agents/:id/sessions
POST   /api/agents/:id/sessions      { title, externalRef?, projectId? }
GET    /api/sessions/:id
DELETE /api/sessions/:id
GET    /api/sessions/:id/messages
POST   /api/sessions/:id/turns       { content }
POST   /api/turns/:id/cancel
GET    /api/turns/:id/stream         SSE
```

## 9. 运行与配置

```bash
npm install
npm run dev        # 同时启动 Vite(5173) 与 API(8791)
npm run dev:web    # 仅前端
npm run dev:api    # 仅后端
```

API Key 在「设置 → Agent 设置 → 运行时」保存，运行时编辑器里也有 Key 输入；无需环境变量。

## 10. 安全

1. 子进程环境白名单：只透传 PATH/HOME/SHELL/LANG/TMPDIR/TERM，加上 DSH_* 与凭证；不继承其他密钥。
2. Key 文件 0600，接口永不下发明文。
3. 权限档映射：`readonly → DSH_PERMISSION_MODE=read-only`，`workspace-write`，`full → danger-full-access`；同时通过 profile patch 设置审批策略（只读时 ask，其余 never）。
4. 自定义 Base URL 仅允许 http(s)，请求有超时与响应上限。
5. 启动器参数（`--patch`）排在应用参数之前，避免被 headless 当成未知参数。

## 11. 已知限制与后续

| 限制 | 影响 | 后续方案 |
|---|---|---|
| 每轮一个进程 | 启动开销；不能运行中插话 | 改用 `dsh --profile sdk` 长驻 JSON-RPC |
| 会话按工作目录分目录 | 改 workdir 后旧 `--session-id` 失效 | 会话目录迁移或按 agent 固定 workdir |
| 无并发锁 | API 层可并发提交同一 session | sessions 加 running 锁 |
| 未知 session 直接报错 | Harness 状态丢失时报错 | 捕获后自动新建会话 |
| 模型 2/3/4 仅存储 | 执行只用模型 1 | 明确槽位语义后再接入 |

## 12. 验证记录

- `npm run build` 通过
- CLI：`/api/runtime` 返回本地 `node_modules/@deepseek-ai/dsh`，版本 `0.2.1-rc.2`
- 真实运行：headless 子进程正常输出 `session → turn_start → step_start …`
- 模型发现：DeepSeek `/models` 返回 `deepseek-flash`、`deepseek-v4-pro`
- 多会话映射：同一项目下 `loomweb:sess4` / `loomweb:sess5` 生成两条独立后端会话；同 ref 复用
- 旧项目级会话（`项目 · loomweb`、`项目 · data-pipeline`）已清理

## 13. 文件清单

| 文件 | 作用 |
|---|---|
| `server/index.js` | Express 路由、SSE、静态服务 |
| `server/db.js` | SQLite 表与读写、迁移、种子 |
| `server/runner.js` | dsh 子进程、事件解析、环境与 patch |
| `server/models.js` | provider `/models` 拉取 |
| `src/lib/runtimeApi.ts` | 前端 API 客户端与类型映射 |
| `src/hooks/useRealSession.ts` | 单会话运行状态（消息/事件/发送/停止） |
| `src/hooks/useProjectHarness.ts` | 项目详情按「项目 + 会话」接入真实运行时 |
| `src/components/agent-console/` | 独立 Agent 控制台（真实运行） |
| `src/components/settings/RuntimeManager.tsx` | 运行环境 / 运行时管理 |
| `src/components/settings/CreateAgentWizard.tsx` | 四步创建向导 |
| `src/components/project-detail/AdeSettingsModal.tsx` | Agent 详情弹窗（左目录） |
| `src/components/project-detail/ChatPane.tsx` / `TerminalPane.tsx` | 增加真实数据入参，样式未改 |
