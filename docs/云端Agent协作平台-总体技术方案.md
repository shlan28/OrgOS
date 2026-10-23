# 云端多用户 Agent 协作平台 - 总体技术方案

> 创建日期：2026-10-23
> 适用范围：由 `loom-ui-mock`（纯前端 Mock）演进为可上线的云端产品
> 相关文档：`docs/loom-ui-mock-技术方案.md`（Mock 期记录，保留不动）、`docs/项目中心-技术方案.md` 及后续各功能方案（描述 UI 现状）

## 1. 背景与目标

现有工程是纯前端 Mock（React 18 + TypeScript + Vite 5，40 个 CSS 文件，约 1 万行，无后端、无持久化、无网络请求）。产品形态经三轮讨论后确定为**云端多用户协作平台**，不是本地桌面应用。

### 1.1 目标形态

| # | 需求 | 说明 |
|---|---|---|
| 1 | 云端运行 Agent CLI | 在云端安装并启动 `claude code` / `codex` / `deepseek harness` / `opencode` 等本地 CLI 的云端版本，用户机器零安装 |
| 2 | 多用户协作 | 项目中心是**多人群聊**，项目内可同时启动多个**共享 Agent** |
| 3 | 账号与管理员 | 多用户登录体系；组织管理员负责用户权限、模型配置等组织级管理 |
| 4 | 项目上下文 | 项目文件增删改查，作为**知识库（RAG）/ 记忆 / 项目规范** |
| 5 | 代码仓库 | 关联 GitLab / GitHub，支持只读查看（网页端走 API，不 clone） |
| 6 | 工作流 | 前端 React Flow；每个节点 = 独立 Agent 会话；支持人工介入、条件分支、并行扇出、定时触发、**非 DAG 循环** |

### 1.2 形态决策

**云端 Web 为主，Mac 桌面壳后置。**

- 多用户实时协作必须有服务端状态与广播，本地应用天然做不到；
- CLI 在云端运行，权限、版本、凭证均可控；
- 现有 React UI 可复用（它就是 Web）；
- 若未来需要「本地算力」模式，可把同一 Web 应用包进 Electron/Tauri，不影响本期设计。

> 已废弃的早期设想：Electron 本地壳、本地 PATH 探测、node-pty 客户端终端、`safeStorage`、公证签名。这些在云端形态下均不需要，但**适配层与事件协议的设计原样保留**，宿主从 Electron 主进程换成容器内的 agent-runner。

### 1.3 与现有 Mock 的关系

| 层 | 处理 |
|---|---|
| 组件 / CSS / 视觉体系（约 1 万行） | **保留**，作为产品 UI |
| `src/data/*.ts` Mock 数据 | **替换**为 API 客户端 + React Query |
| `App.tsx` 内存状态（projects / folders / settings / invite） | **替换**为服务端状态 |
| 假窗口外壳（`.desktop` 渐变 + `.window` 圆角 + 假红绿灯） | **移除**，保留配色与信息密度 |
| `TerminalPane` 行类型（`sys/prompt/think/cmd/out/file/tool/ok/err/info`） | **升级为跨 CLI 统一事件 schema** |

---

## 2. 总体架构

```
浏览器 (React + React Flow)
   │  HTTPS REST + WebSocket
   ▼
API / BFF (Node + TypeScript)
   ├─ Auth        组织 / 用户 / 角色 / 会话
   ├─ Admin       用户权限、模型配置、配额、审计
   ├─ Projects    项目、文件夹、成员、ADE
   ├─ Chat        群聊消息、定序、插话队列、已读
   ├─ Files       文件目录树、CRUD、规范合成
   ├─ Git         仓库绑定、只读代理、webhook
   ├─ Workflow    图定义、运行、人工任务、定时器
   └─ Realtime    WS 扇出 + 事件序号
        │
   ┌────┴──────────────┬────────────────────┬──────────────────┐
   ▼                   ▼                    ▼                  ▼
RAG 索引服务       工作流执行器          模型网关           定时调度器
解析/切分/嵌入     token 状态机         组织 key/配额/审计  cron + 分布式锁
   │                   │
   └─────────┬─────────┘
             ▼
   项目沙箱容器（每项目一个）
     workspace 卷
       ├─ repos/<name>/       代码仓库 clone（含仓内文档 README / docs / ADR）
       ├─ specs/              项目规范（可选、内部 git；注入提示词用）
       ├─ .feishu-mirror/     飞书文档只读镜像
       ├─ scratch/<session>/  临时产物（不提交、不索引）
       └─ worktrees/<node>/   工作流节点独立 worktree
     agent-runner（常驻进程）
       ├─ 适配器：claude / codex / opencode / custom
       ├─ 每个共享 Agent = 一个长驻 CLI 进程
       └─ 事件流 → 控制面 → WS → 所有在线成员
             │
   Postgres(+pgvector) / Redis / 对象存储（S3 / MinIO）
```

### 2.1 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 前端 | 现有 React 18 + Vite + 组件级 CSS；新增 React Flow | 存量复用，零 UI 库约束 |
| 前端数据层 | TanStack Query + WebSocket 事件合并 | 缓存/重试/失效现成，减少手写状态 |
| 后端 | Node 22 + TypeScript（Fastify 或 NestJS） | 与前端共享类型，团队切换成本最低 |
| 数据库 | Postgres 16 + pgvector | 业务数据与向量同库，少一个系统 |
| 实时 | 原生 WebSocket；多实例时加 Redis pub/sub | 单实例无需 Redis 也能跑 |
| 队列 | BullMQ（Redis）或 Postgres `SKIP LOCKED` | 索引、执行、定时三类后台任务 |
| 沙箱 | Docker（dockerode 驱动），设计成可替换为 K8s | 起步简单，隔离边界清晰 |
| 对象存储 | S3 兼容（MinIO 自建） | 附件、录音、大文件、日志归档 |
| 模型调用 | LiteLLM / one-api 或自研网关 | 组织级 key、白名单、配额、成本归集 |
| 认证 | OIDC + JWT；优先接团队已有 IdP | 不自研密码体系 |

---

## 3. 多用户与权限

### 3.1 认证

- 管理员在组织层配置 IdP（飞书 / Google Workspace / 通用 OIDC）；
- 登录回调后签发短时 access token + 刷新 token（httpOnly cookie）；
- 组织架构与头像从 IdP 同步，减少「邀请成员」的复杂度；
- WebSocket 握手校验 token，连接绑定 `user_id + org_id`。

### 3.2 角色模型（两层 RBAC）

```
组织层：owner / admin / member
项目层：负责人 / 管理员 / 成员 / 只读
```

| 能力 | owner | admin | 成员 | 项目负责人 | 项目管理员 | 项目成员 | 只读 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| 组织用户与角色管理 | ✓ | ✓ | | | | | |
| 模型配置 / 配额 | ✓ | ✓ | | | | | |
| 创建项目 | ✓ | ✓ | ✓ | | | | |
| 删除项目 | ✓ | ✓ | | ✓ | | | |
| 编辑项目配置 / 成员 | ✓ | ✓ | | ✓ | ✓ | | |
| 启停 Agent、打断运行 | ✓ | ✓ | | ✓ | ✓ | | |
| 审批 Gate / 人工节点 | ✓ | ✓ | | ✓ | ✓ | | |
| 发起对话、插话 | ✓ | ✓ | | ✓ | ✓ | ✓ | |
| 查看（只读） | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ |

### 3.3 共享 Agent 的并发语义

这是多用户与单用户最大的区别，必须由服务端定义：

1. **消息定序**：每个项目一个单调递增 `seq`，客户端按 seq 渲染；WS 断线重连后拉增量。禁止依赖客户端时间戳。
2. **插话队列**：多用户同时插话 → 服务端串行入队（`run_queue`），Agent 按序消费；UI 显示「排队中 · 第 N 位 · 姓名」。
3. **控制权**：停止 / 中断 / 换模型 / 改权限档属破坏性操作，仅项目负责人与管理员可用；普通成员只能发言。
4. **消息归属**：每条消息带 `author_type(user|agent|system)` + `author_id`，UI 必须区分「谁说的」与「哪个 Agent 说的」。
5. **文件与提交归属**：git 提交带 trailer 标注 `Agent` 与触发用户；同一仓库的写操作加分布式锁串行化。

---

## 4. Agent 运行时

### 4.1 分层

```
发现/注册层  →  适配层  →  运行层
扫描 CLI/版本/能力   统一事件协议   进程、会话、续接、回收
```

云端形态下，「发现」发生在**镜像构建期**而非用户机器：基础镜像内固定 CLI 版本，注册表描述的是「镜像里有什么」。

### 4.2 各 CLI 能力矩阵（实测版本）

| CLI | 实测版本 | 非交互入口 | 流式/结构化 | 会话续接 | 插话 | 权限控制 |
|---|---|---|---|---|---|---|
| Claude Code | 2.1.2 | `-p` | `--output-format stream-json` + **`--input-format stream-json`** + `--include-partial-messages` | `--session-id <uuid>` / `--resume` | 写 stdin（stream-json user message） | `--permission-mode` / `--allowedTools` / `--disallowedTools` / `--max-budget-usd` |
| Codex | 0.155.1 | `codex exec` | `--json`（JSONL）；**`app-server`**（control socket + `proxy` + `generate-ts` 生成 TS 绑定） | `resume` / `fork` | `codex queue` | `-s/--sandbox` + 审批档位 |
| opencode | 未在 PATH（有 `~/.config/opencode`） | `run` | 待以 `--help` 确认；有 `serve` HTTP 模式 | 视版本 | 视版本 | 视版本 |
| DeepSeek harness | 无公开约定 | 自定义模板 | 自定义模板 | 自定义模板 | 自定义模板 | 自定义模板 |
| droid / codebuddy / 其他 | 社区 CLI 众多 | 通用模板适配器 | — | — | — | — |

**版本漂移是常态**：能力必须从运行时 `--help` 推导（构建期写入 `capabilities` 快照），不硬编码。遇到不兼容版本在 UI 中禁选并提示，而不是运行到一半崩溃。

### 4.3 统一事件协议

复用 `TerminalPane` 的行类型，作为跨 CLI 的公共事件模型：

```ts
type AgentEvent =
  | { kind: 'session'; cliSessionId: string }
  | { kind: 'think';  text: string }
  | { kind: 'tool';   name: string; input: unknown }
  | { kind: 'cmd';    text: string }
  | { kind: 'out';    text: string }
  | { kind: 'file';   op: 'read' | 'write'; path: string; preview?: string }
  | { kind: 'usage';  tokens?: number; costUsd?: number }
  | { kind: 'result'; ok: boolean; text: string }
  | { kind: 'error';  code: 'auth' | 'rate_limit' | 'crash' | 'unknown'; message: string }
```

### 4.4 适配器接口

```ts
interface AgentAdapter {
  id: 'claude-code' | 'codex' | 'opencode' | 'custom'
  capabilities: {
    mode: 'stream-json' | 'app-server' | 'jsonl-once' | 'pty'
    resume: boolean
    interject: boolean
    approvals: 'flag' | 'hook' | 'mcp' | 'none'
  }
  buildSpawn(opts: {
    cwd: string
    prompt: string
    model?: string
    resumeId?: string
    permissionProfile: 'readonly' | 'ask' | 'auto'
    budgetUsd?: number
  }): { bin: string; args: string[]; env: Record<string, string> }
  /** 流式状态机：JSON 可能跨 chunk，禁止按行切 */
  parseChunk(buf: string): AgentEvent[]
  encodeInterjection(text: string): string | null
}
```

### 4.5 三种接入范式（按能力自动降级）

| 范式 | 适用 | 特点 |
|---|---|---|
| A. 长驻协议 | Claude `stream-json` 双向；Codex `app-server` | 一个进程贯穿会话，事件结构化，插话直写 stdin / `queue` |
| B. 一次性结构化 | `codex exec --json`、`opencode run` | 简单，但每轮重启，上下文靠 resume 续接 |
| C. raw PTY | 纯 TUI、无结构化输出的 CLI | xterm.js + node-pty，ANSI 剥离后启发式归类 |

**优先 A**。不要每轮重新 spawn——那样上下文与提示词缓存全丢，成本翻倍。

### 4.6 运行层：进程与会话

```ts
type AgentSession = {
  sessionId: string        // 应用侧 ID
  agentId: string          // 注册表 ID
  cliSessionId?: string    // CLI 原生会话，用于 resume
  cwd: string
  pid?: number
  status: 'starting' | 'working' | 'awaiting_approval' | 'idle' | 'exited' | 'failed'
  startedAt: number
  logsPath: string         // 容器内 / 归档到对象存储
}
```

- **会话续接**：原生 `resume` / `--session-id` 优先；不支持则本地留 transcript，新会话首包回放摘要。
- **孤儿进程**：`detached: true` + 杀进程组；容器退出时统一回收；崩溃重启后按 `session.status` 标记 `interrupted`。
- **状态推导**：进程状态 + 最近事件活跃度 → `working / idle / awaiting_approval`，喂给格 3 头部呼吸点与会话列表徽标。
- **日志**：按 jsonl 落盘 → 归档对象存储，可离线回放与审计。

### 4.7 凭证

- **共享 Agent 必须使用组织级凭证**，不能复用个人订阅登录（违反条款且额度与身份错位）。
- 推荐在前端与容器之间加**模型网关**：

```
容器内 CLI → OPENAI_BASE_URL / ANTHROPIC_BASE_URL 指向网关
网关       → 组织 key + 模型白名单 + 配额 + 审计 + 成本归集
```

好处：容器内**拿不到真实 key**（泄漏面归零），管理员「模型配置」有了唯一入口，成本可按项目/人归集。

- 用户级自定义 secrets 用 KMS / Secret Manager 加密存储，运行时注入。
- 认证类错误必须归类为 `auth`，UI 给出可操作指引，而非一段红字。

### 4.8 审批桥（Gate）

分三级，v1 只做第 1 级：

1. **档位映射**：CLI 原生权限参数 ↔ 应用设置（只读 / 需确认 / 自动）。
2. **Hook 回调**：注册 `PreToolUse` hook → 回调控制面 → 广播审批 → allow/deny。
3. **Loom MCP Server**：内置 stdio MCP，暴露 `request_approval` / `read_project_spec` / `post_message`，通过 `--mcp-config` 注入。**最通用**，一次实现所有支持 MCP 的 CLI 可用。

多用户下：审批广播给全项目，**先认领者处理**，记录审计；过期有升级策略。

---

## 5. 项目上下文：文件、知识库、记忆、规范

### 5.1 存储分层

| 内容 | 存哪 | 为什么 |
|---|---|---|
| 代码与仓内文档 | `repos/<name>/`（代码平台为真相源） | 文档跟随代码演进，不脱离版本历史 |
| **项目文档与 Office 文件** | **飞书云文档**（每项目一个文件夹） | 唯一真相；本地只留只读快照 |
| 派生文本 / 预览产物 | 对象存储 + `.derived/`（只读） | 可随时重建 |
| Agent 产物（截图 / 构建包 / 日志） | 对象存储 | 不进飞书、不索引 |
| 目录树 / 索引状态 | Postgres | 支持目录树、权限、状态过滤 |
| 向量 | **pgvector**（同库） | 少一个系统；百万级 chunk 够用，HNSW 索引 |
| RAG 服务 | 独立服务 + 异步索引队列 | 解析/切分/嵌入是重活，不阻塞 API |

**关键决策**：文件放 workspace，而不是只放数据库。Agent 最强的检索方式往往不是 RAG 而是直接读文件。让文件「就在那里」，Claude Code / Codex 用原生工具读，比绕一圈向量检索更准、更省 token。

### 5.2 三种上下文，三种语义

| | 注入方式 | 检索 | 生命周期 |
|---|---|---|---|
| **项目规范** | 启动时**确定性注入**系统提示词 | 不检索 | 版本化，随文件变更 |
| **记忆** | 结构化事实，注入 top-k | 相关性 + 时效 | 有到期 / 反思 / 去重 |
| **知识库** | **按需工具调用**检索 | 向量 + 全文混合 | 随文件增删改 |

- **规范**：生成受管内容写入 workspace 的 `AGENTS.md` / `CLAUDE.md`（各 CLI 均读取约定文件），Claude 亦可走 `--system-prompt`。现有 UI 的「加入提示词」开关即该合成器的输入。
- **记忆**：会话结束后抽事实 → 与既有记忆向量去重 → 入库（带来源、生命周期、重要度）。「自动反思规则」是定时任务：按项目规范/知识库/近期会话聚类，判断归档或保持活跃。注入时按「项目 + 相关性 + 未过期」取 top-k。
- **知识库**：文件变更 → 事件 → 解析 → 结构感知切分（markdown 按标题、代码按函数）→ 嵌入 → upsert（内容 hash 去重，避免反复烧 embedding）→ 状态回写 UI。检索 = 向量 + 全文 + 元数据过滤，可选重排，结果**必带引用**（文件 + 行号）。

### 5.3 给 Agent 的两个入口

1. **文件系统**：workspace 内直接读——精确、便宜、无幻觉；
2. **MCP 工具**：`search_knowledge(query, filters)` / `remember(fact)` / `list_specs()`——可控、带引用、可埋点统计命中率。

两个都提供，让 Agent 自行选择。

### 5.4 索引管道

- BullMQ 异步；每文档独立 job；内容 hash 未变则跳过；
- 快速连续编辑做防抖；
- 状态 `pending / indexed / failed` 回写 UI；
- `chunk` 表存 `embedding_model` + `dim`；换模型必须整库重嵌，支持新旧索引灰度并存；
- 文档删除 → 软删 + 定时清理 chunk。

---

### 5.5 RAG 方案选型（RAGFlow 及替代）

**关键判断**：RAGFlow / Dify / FastGPT 属于「一体式 RAG 应用平台」——自带 UI、对话与知识库运营后台。本产品的知识库是**内嵌在自有产品里的能力**，直接部署平台等于在系统内再跑一个系统，且多出一套 Python + Elasticsearch + MySQL + MinIO 技术栈，与 Node + Postgres 主干重复。

| 类别 | 代表项目 | 说明 |
|---|---|---|
| **嵌入式框架**（推荐） | LlamaIndex、Haystack、LangChain/LangGraph | 自己写索引与检索服务，进程内可控，无额外 UI |
| **可自托管的 RAG 服务** | R2R、LightRAG | 带 REST API，比平台轻；LightRAG 做图 + 向量混合，成本低 |
| **一体式平台**（RAGFlow 同类） | RAGFlow、Dify、FastGPT、MaxKB、AnythingLLM、Onyx、Kotaemon、Quivr | 开箱即用，但重；Onyx 偏企业搜索（含 Slack/Drive/GitHub 连接器），AnythingLLM 偏单机 |
| **托管服务** | AWS Bedrock Knowledge Bases、Azure AI Search、Google Vertex AI RAG Engine、Cloudflare AutoRAG、LlamaCloud、Pinecone Assistant、Vectara、Ragie；国内阿里云百炼、腾讯云 LKE、火山方舟 | 零运维，按量计费 |
| **向量/检索底座** | pgvector（推荐）、Qdrant、Milvus、Weaviate、Chroma、LanceDB、Vespa、Elasticsearch/OpenSearch | pgvector 与业务库同栈，百万级够用 |
| **文档解析**（RAG 质量的真正瓶颈） | Docling、MinerU、Unstructured、LlamaParse、Marker、Reducto；扫描件 OCR 用 PaddleOCR | 中文/复杂版面优先 MinerU 或 Docling |
| **记忆层** | Mem0、Letta（MemGPT）、Zep；或按本方案自建 | 本项目按 5.2 自建，字段与生命周期可控 |

**本方案选择**：

- v1 = **pgvector + 自建轻量管道 + 远程 embedding（可选 rerank）**，解析按需引入 Docling / MinerU；
- 理由：与现有 Postgres/Node 同栈；文件已直接躺在 Agent 的 workspace 里，RAG 只作「大语料 + 引用」的补充；不引入第二套产品与运维；
- **何时才该上 RAGFlow / Dify**：大量扫描件与复杂表格、需要现成的知识库运营后台、或团队没有精力维护索引管道；
- **何时该上 Onyx**：诉求是「企业内搜索」（Slack / Drive / GitHub / Confluence 连接器），而非「给 Agent 喂上下文」；
- **何时该上 LightRAG**：语料需要多跳推理与图谱关系，且能接受更高的索引成本。

**成本量级**：embedding 极便宜（10 MB 语料约 250 万 token，按 $0.02/1M 计约几美分）；rerank 可选，约 $1–2 / 千次查询；**真正贵的是 Agent 生成 token 与 PDF 解析的 CPU 时间**，不是向量检索。

### 5.6 检索质量：评测与调优

自建 RAG 的效果不取决于是否使用平台，而取决于**六个杠杆 + 一套评测**。RAGFlow 的优势主要在文档解析（版面/表格）和现成的运营后台，不是「检索算法更神」。

**效果杠杆（按性价比排序）**

| # | 杠杆 | 做法 | 预期收益 |
|---|---|---|---|
| 1 | **解析与切分** | markdown 按标题、代码按函数、表格单独处理；chunk 400–800 token，重叠 10–15% | 最大；解析错则后面全错 |
| 2 | **混合检索** | 向量 + 关键词（BM25/全文），RRF 融合（k=60） | 修复大量专名、术语、编号漏召 |
| 3 | **重排** | cross-encoder / API reranker：召回 50 → 重排留 8 | 单项提升最大 |
| 4 | **元数据过滤 + 父文档回填** | 按项目/目录/类型/时间过滤；召回小块、返回所在父段 | 降噪、补全上下文 |
| 5 | **查询改写** | 结合会话历史补全指代；必要时多查询 / 假设文档（HyDE） | 修复口语化与超短查询 |
| 6 | **Contextual retrieval** | 索引时让 LLM 为每个 chunk 生成一句上下文再接嵌入 | 中等成本，明显提升 |
| 7 | **Agentic 检索** | 检索做成工具，允许 Agent 多轮改写查询、再读原文 | 编码场景收益最大 |

**评测（没有度量就无法调优）**

- **黄金集**：50–100 条真实问题 → 期望命中的文档/小节。来自真实使用，不凭空编造。
- **指标**：检索层 Recall@k、MRR、nDCG@10；回答层看引用准确率与忠实度（faithfulness）。
- **错误分类**：解析失败 / 切分边界 / 词表不匹配 / 文档缺失 / 排序错误——每类对应不同修法，避免「凭感觉调 k 值」。
- **回归门禁**：任何管道改动跑同一套评测，指标下降不允许合入。
- **线上信号**：无结果、用户改写、点击引用、复制引用，回流成新用例。

**编码场景的特别结论**：文件本来就在 workspace 里，Agent 直接读通常优于一次性检索。RAG 只承担「大语料 + 需要引用」，因此 `search_knowledge` 必须设计成**可多次调用的工具**（可改写查询、可读原文），而不是会话开始塞一次上下文。

**中文检索的坑**：Postgres 默认分词对中文无效。BM25 需要 `pg_jieba` / `zhparser`，或引入外部检索引擎；否则「混合检索」这一杠杆等于没有。

**分阶段落地**：① 建黄金集 + 基线（纯向量）→ ② 混合检索 + 重排 → ③ 查询改写 / 父文档回填 → ④ Contextual retrieval / Agentic 检索。每阶段用同一套指标验证，避免一次性堆满无法归因。

> 完整实施细节（黄金集 schema、评测脚本、基线管道、任务拆解、验收标准）见 [云端平台-P3-知识库RAG实施-技术方案.md](云端平台-P3-知识库RAG实施-技术方案.md)。

---

### 5.7 Mock 模块 → 后端存储映射

Mock 里「项目规范 / 代码 / 知识库 / 记忆」四块，后端不是同一套存法。总原则：**每块只有一个真相源，其余都是投影**。

> **2026-10-23 变更**：文档与 Office 文件改由**飞书云文档**托管，不再有本地文档库。详见 [飞书文档接入方案](云端平台-飞书文档接入-技术方案.md)。项目规范仍按本节规则存放（代码模式 → 仓库 `docs/`，文档模式 → `specs/`）。

| Mock 模块 | 真相源（SoT） | DB 中的投影 | 索引/派生 |
|---|---|---|---|
| 项目规范 `SpecDoc` | 代码模式 → `repos/<primary>/docs/`；文档模式 → `specs/` | `files(kind='spec')` + `in_prompt` | `chunks`（可被检索） |
| 文档 / Office `DocLibrary` | **飞书云文档**（每项目一个文件夹） | `documents` + `doc_drafts` | — |
| 项目知识库 `KbFolder` / `KbDoc` | **不是独立存储**：同一批飞书文档的 RAG 索引视图 | `documents.index_*` + `chunks` | 向量 + 全文 |
| 代码 `CodeRepo` | GitLab / GitHub 仓库本体 | `repos` 绑定表 | workspace clone、只读缓存 |
| 记忆 `MemoryItem` | **Postgres**（不落文件） | `memories` | `embedding` 列 |
| 记忆设置 `MemorySettings` | Postgres | `memory_settings`（每项目一行） | — |

#### 5.7.1 项目规范

| Mock 字段 | 后端落点 |
|---|---|
| `name` | 文件名 + `files.title` |
| `note` | `files.summary` |
| `markdown` | `project-brain/specs/<slug>.md` 的正文 |
| `content[]` | **不落库**，渲染时由 markdown 解析 |
| `updatedAt` | `files.updated_at` |
| `inPrompt` | `files.in_prompt` |

- 规范是**文件**而不是数据库记录：落点跟随项目模式（代码模式 → `<repo>/docs/`，文档模式 → `specs/`）。Agent 用原生工具就能读，版本历史由 git 免费提供。
- 会话启动时，把 `in_prompt=true` 的规范按 `path` 排序合成受管段落，写入 workspace 的 `AGENTS.md` / `CLAUDE.md`（Claude 亦可走 `--system-prompt`）。**不要把它拼进每次对话的用户消息**，否则缓存失效、成本翻倍。
- 规范同时进入 RAG 索引，供 `search_knowledge` 命中。

#### 5.7.2 文档 / Office（已改飞书）

`DocLibrary` 的文档与 Office 文件改为飞书托管，字段映射如下（详见 [飞书文档接入方案 §3](云端平台-飞书文档接入-技术方案.md)）：

| Mock 字段 | 后端落点 |
|---|---|
| `DocLibrary.folders` | 飞书文件夹结构（只读镜像，不本地新建） |
| `KbDoc.title` / `folderId` | `documents.title` / `documents.parent_path` |
| `KbDoc.markdown` | 飞书文档正文；本地只存只读快照 `snapshot/{id}/{revision}.md` |
| `KbDoc.source` / `sourceRef` / `importedAt` | `documents.external_type` / `url` / `last_synced_at` |
| `KbDoc.summary` | 索引时生成，存 `documents.summary` |
| `KbDoc.content[]` | **不落库**，渲染时由快照解析 |

- 目录由飞书管理，本系统只读同步；
- 导入 = 上传到项目飞书文件夹，不做本地副本；
- 编辑 = 本地草稿 + 显式发布（仅文本类）；Office 只能跳转飞书编辑。

**项目知识库不是独立存储，而是同一批飞书文档的 RAG 索引视图**：

| 概念 | 落点 |
|---|---|
| 收录哪些文档 | `documents.index_policy`（auto / manual / off） |
| 切分与向量 | `chunks`（来源为飞书快照 + revision） |
| 索引状态 | `documents.index_status` / `indexed_revision` |
| 目录 | 直接复用飞书文件夹结构，不另建目录树 |

因此 UI 上「项目知识库」子 tab 展示的是**收录范围、索引状态与检索测试**，不提供第二套文档增删改。

#### 5.7.3 代码仓库

| Mock 字段 | 后端落点 |
|---|---|
| `name` | `repos.full_name` |
| `type`（gitlab / svn） | `repos.provider`（**v1 只做 git**，svn 保留字段，需单独适配器） |
| `branch` | `repos.default_branch` |
| `mode`（editable / readonly） | `repos.permission`：`editable → write`、`readonly → read` |
| `note` | `repos.description` |
| `syncedAt` | `repos.last_synced_at`（webhook + 定时拉取更新） |

- **代码不存进本系统**。Postgres 只存绑定关系与权限档，仓库本体仍在 GitLab / GitHub。
- 两条路径（见第 6 章）：Agent 干活 → clone 进 `workspace/repos/`；网页查看 → provider API + 缓存，**不为看代码而 clone**。
- 只读仓库用只读 token 或只读挂载：能读、push 失败，语义边界清晰。

#### 5.7.4 记忆

| Mock 字段 | 后端落点 |
|---|---|
| `content` | `memories.content` |
| `source`（会话沉淀 / 手动） | `memories.source` + `source_session_id` / `source_file_id` |
| `createdAt` | `memories.created_at` |
| `lifecycle`（活跃 / 即将过期 / 已归档） | `memories.status` + `expires_at` 派生 |
| `remainDays` | **派生**，不落库（`expires_at - now()`） |
| `reflectNote` | `memories.reflect_note` |

- 记忆**只存 Postgres**，不生成文件：它需要向量、生命周期、去重与频繁状态流转，文件不适合。
- `MemorySettings` 1:1 落到 `memory_settings`；其中 `retentionDays` / `permanent` / `expirePolicy` 决定过期扫描任务的判定，`autoReflect` / `reflectFrequency` / `reflectRules` 决定反思任务的排期。
- **去重**：规范化文本 hash（唯一索引）+ 写入前与同项目既有记忆做向量相似度比较，超过阈值则合并或跳过。
- **反思任务**：按频率跑，读近期会话 / 规范 / 知识库，产出 `reflect_note` 与状态调整，写 `memory_events` 便于审计。

#### 5.7.5 三条一致性铁律

1. **每域单一真相**：文档类 = git 文件；记忆 = Postgres；代码 = 代码平台。禁止双写。
2. **DB 是投影，可重建**：丢库后能用 workspace 重扫恢复 `files` / `chunks`（记忆除外）；这条是判断投影是否设计正确的标准。
3. **写入单向**：文件系统 → 事件 → DB。**不要反过来从 DB 同步到文件**。

#### 5.7.6 三条写入路径

**A. 网页编辑规范 / 知识文档**

```
PUT /api/projects/:id/files/*path   (If-Match: <content_hash>)
  → 权限校验 + 乐观锁
  → 写文件 + git commit（作者 = 当前用户）
  → 发 file.changed 事件
  → worker 更新 files 投影 + 增量重建该文件的 chunks
```

冲突返回 `409` + 当前内容与差异，前端提示合并，不静默覆盖。

**B. Agent 在 workspace 直接改文件**

```
容器内 watcher（chokidar）
  → POST /v1/events { type: 'file.changed', path }
  → 控制面 debounce 500ms
  → 更新 DB 投影 + 增量重索引
```

这条决定了 **DB 不能作为真相源**——Agent 会绕过 API 直接写盘。

**C. 记忆写入**（唯一不经文件的路径）

```
会话结束 → 抽取事实 → 去重 → insert memories
定时任务 → 生命周期流转（active → expiring → archived/deleted）
```

#### 5.7.7 权限

| 操作 | 项目成员 | 项目管理员 / 负责人 |
|---|:--:|:--:|
| 查看规范 / 知识 / 记忆 | ✓ | ✓ |
| 编辑规范、知识文档 | ✓（可配置为仅管理员） | ✓ |
| 开关「加入提示词」 | | ✓ |
| 添加 / 删除记忆 | ✓（仅自己的） | ✓（全部） |
| 绑定 / 解绑代码仓库、改权限档 | | ✓ |
| 重建索引 | | ✓ |

---

### 5.8 非代码文件与「知识库 / 附件」的边界

**结论：要划一个区域，但不要另起一套存储。**

一份文件存储 + 两个正交属性：`space`（归属视图）与 `index_policy`（是否进检索）。「知识库」是这份存储上的**策展视图**，不是另一个存储系统。

#### 5.8.1 为什么不另起存储

- 权限、配额、去重、备份、生命周期只需维护一套；
- Agent 需要读到附件（设计稿、需求表、截图），同处一个 workspace 才能直接用原生工具读；
- 「移到知识库」变成改一个字段，而不是复制文件 + 重索引 + 维护两处一致性；
- 存储介质本来就按类型分（文本进 git、二进制进对象存储），再叠加一层「区域」会变成二维矩阵。

#### 5.8.2 两个属性

| 属性 | 取值 | 作用 |
|---|---|---|
| `space` | `kb` / `attach` | UI 归属与默认策略；**不影响物理位置** |
| `index_policy` | `auto` / `manual` / `off` | 是否自动进入 RAG 索引 |

默认规则：

- `kb` 空间默认 `index_policy='auto'`；
- `attach` 空间默认 `'off'`，可对单个文件临时开启；
- 文件夹可设默认值，子文件继承（就近覆盖）;
- 文件从 attach 移到 kb = 改 `space` + 触发一次索引，**不复制文件**。

#### 5.8.3 为什么附件区是必要的

即使存储只有一份，也需要一个「默认不进知识库」的落点：

1. 大量二进制（设计稿、录屏、安装包）切片没有意义，只会稀释检索结果；
2. Agent 产物（截图、构建包、导出文件）变化频繁，自动索引纯属浪费；
3. 部分敏感文件需要「成员可见、但不进检索」；
4. 高频草稿会让索引长期处于「刚建好就过期」的抖动状态。

典型划分：

| 区域 | 放什么 | 默认索引 |
|---|---|---|
| **知识库 `kb`** | 规范、需求、设计说明、会议纪要、对外文档 | 自动 |
| **附件 `attach`** | 设计稿、表格原件、截图、录屏、Agent 产物、临时导出 | 关闭（可单文件开启） |

#### 5.8.4 非代码文件（已改为飞书托管）

Office 文件（docx / xlsx / pptx / pdf）与普通文档一样存**飞书项目文件夹**，在文档列表中同列展示、不做独立页面；原件不在本系统保存，对象存储只放快照与预览产物。导出解析、预览跳转、权限映射见 [飞书文档接入方案 §6](云端平台-飞书文档接入-技术方案.md)。

仍然适用的部分：

- 同步/上传 → 生成只读快照 → 按 `index_policy` 决定是否索引；
- 索引对象是快照，不是飞书原件；
- 派生产物（PDF 预览、提取文本）可随时重建，不属于真相源。

#### 5.8.5 「实时更新」怎么做才不会炸

实时更新不等于「每次保存都全量重索引」。四条约束缺一不可：

1. **事件 + 去抖**：文件变更事件 500ms 去抖；同一个文件在窗口内多次变更只保留最后一次。
2. **内容短路**：`content_hash` 未变直接跳过——打开再另存为往往不改变内容。
3. **版本对齐**：索引任务固定读 `current_version`；若任务期间出现更新版本，**丢弃本次结果并按新版本重排**。`indexed_version < current_version` 即视为过期，UI 显示「索引中 / 待更新」。
4. **任务去重**：队列以 `file_id` 为键，新任务覆盖旧任务，避免同一文件堆积。

Office 特有的版本膨胀：

- 编辑器自动保存会生成大量版本 → 在时间窗内合并为一个 `draft` 版本，或只在「关闭编辑 / 发布」时快照；
- 索引只对已快照版本执行，不对 draft 执行；
- 检索结果携带版本号，过期版本的结果直接丢弃，避免引用到旧内容。

#### 5.8.6 什么时候才真的要拆存储

出现以下任一情况，再考虑物理隔离（仍优先「同表 + 存储前缀 + 生命周期策略」，而不是第二套系统）：

1. 附件需要完全不同的保留策略（如 30 天自动清理）；
2. 需要对外公开分享，权限域与知识库不同；
3. 体量差异巨大，需要冷归档等不同介质；
4. 合规要求某些文件不得进入任何索引管道。

#### 5.8.7 UI 落点

- 知识库面板顶部两个节点：「**知识库**」「**附件**」——同一棵树的两个 `space`，不是两个页面；
- 文件行显示索引状态：`已索引 / 索引中 / 未索引 / 已过期`；
- 文件详情提供「加入知识库」开关，交互语言复用现有「加入提示词」；
- 附件区默认不参与检索；Agent 仍可通过 `read_file` 读取（可见但不被检索）。

### 5.9 写入边界：代码、文档、临时产物

**结论：文档统一进飞书；「项目模式」只决定代码落点。**

> **2026-10-23 变更**：文档与 Office 已改由飞书托管（见 [飞书文档接入方案](云端平台-飞书文档接入-技术方案.md)），本地不再有文档写入目录。本节规则只覆盖代码与临时产物。

- **文档模式**：项目没有代码仓库 → 代码写 `scratch/`；文档进飞书；
- **代码模式**：项目绑定代码仓库 → 代码写 `<primary_repo>/`；文档仍进飞书。

三条配套规则：

1. **模式由项目设置决定，不由「有没有绑仓库」推断**。新建项目时按是否关联仓库给默认值，之后可手动切换。
2. **切换只影响代码写入**，与文档无关；文档始终在飞书。
3. **代码模式必须有主仓库**（`primary_repo_id`）；未绑定则只能是文档模式。

#### 5.9.1 三类物理落点

| 落点 | 内容 | 版本 | 是否进检索 |
|---|---|---|---|
| **飞书云文档** | 全部文档与 Office 文件 | 飞书版本（revision） | 是（快照） |
| `repos/<primary>/` | **代码模式**下的代码与仓内文档 | 代码平台（GitLab/GitHub） | 是（按 include 规则） |
| `specs/` 或 `repos/<primary>/docs/` | 项目规范（`in_prompt` 注入源，不在飞书范围） | 内部 git / 代码平台 | 是 |
| `scratch/<session>/` | 一次性脚本、实验代码、临时导出 | **不版本化** | 否 |
| 对象存储（经 API） | 快照、预览产物、Agent 截图/录屏 | `file_versions` | 否 |

#### 5.9.2 路由决策表

| 产物 | 文档模式 | 代码模式 |
|---|---|---|
| 源码 / 测试 / 配置 / 迁移 | `scratch/<session>/`（不提交；需要时建仓库） | `repos/<primary>/` |
| 文档（需求 / 纪要 / 报告 / 设计说明 / Office） | **通过工具发布到飞书** | **通过工具发布到飞书** |
| 仓库内文档（README / CHANGELOG / ADR） | — | `repos/<primary>/docs/`（随代码） |
| 二进制 / 附件 | 飞书（随文档）或对象存储（Agent 产物） | 同左 |
| 一次性脚本 / 实验 | `scratch/<session>/` | `scratch/<session>/` |

关键一行：**文档不在本地落盘，模型也拿不到飞书写权限**——只能通过工具发布草稿。知识库索引飞书快照，引用指向飞书文档 + revision。

#### 5.9.3 四个消除歧义的机制

顺序很重要：**靠约定的部分尽量少，靠运行时约束的部分尽量多**。

1. **会话 / 节点级绑定（最主要）**
   每个 Agent 会话和工作流节点都有显式 `cwd` 与 `write_scope`：代码模式 `cwd = repos/<primary>`，文档模式 `cwd = scratch/<session>`；文档不走文件系统，只能通过飞书工具发布。不靠模型推断。

2. **根目录 `AGENTS.md`（模型可读）**
   workspace 根放一份由系统生成的目录约定，各 CLI 启动时都会读取。内容由服务端维护，不交给用户随意改。

3. **运行时路径校验（硬约束）**
   agent-runner 拦截写操作：越界写入直接拒绝并记录。提示词会被模型忽略，校验不会。

4. **UI 显式可见**
   会话头部显示当前工作目录与写入范围；产物列表按落点分组；跨区写入高亮提示。

#### 5.9.4 多仓库与只读仓库

| 场景 | 规则 |
|---|---|
| 未绑定仓库 | 只能是文档模式；文档进飞书，代码写 `scratch/` |
| 绑定 1 个仓库 | 该仓库即主仓库，可切换到代码模式 |
| 绑定 N 个仓库 | 必须指定 `primary_repo_id`；代码模式默认写主仓库，工作流节点可按节点覆盖 |
| 只读仓库 | 不能作为主仓库；代码模式不可用，文档仍进飞书 |

#### 5.9.5 `AGENTS.md` 模板

按项目模式生成两份不同的 `AGENTS.md`，服务端维护，不交给用户随意改：

```markdown
# 代码模式（已绑定主仓库）

## 目录约定
- repos/<primary>/    代码仓库（可提交）；仓内文档放 docs/
- scratch/            临时产物（不提交、不索引）
- .feishu-mirror/     飞书文档只读镜像（勿修改）

## 写入规则
1. 代码 / 测试 / 配置 → repos/<primary>/
2. 仓库内文档（README / CHANGELOG / ADR）→ repos/<primary>/docs/
3. 项目文档（需求 / 纪要 / 报告）→ 调用 create_doc / update_doc 发布到飞书
4. 临时脚本 → scratch/<session-id>/
5. 不要写 .feishu-mirror/，不要跨目录复制内容
```

```markdown
# 文档模式（未绑定代码仓库）

## 目录约定
- scratch/            临时产物（不提交、不索引）
- .feishu-mirror/     飞书文档只读镜像（勿修改）

## 写入规则
1. 项目文档 → 调用 create_doc / update_doc 发布到飞书
2. 临时脚本 / 实验代码 → scratch/<session-id>/
3. 不要写入任何代码仓库
4. 不要写 .feishu-mirror/
```

#### 5.9.6 为什么不能只靠提示词

- 模型在长会话中会漂移，尤其是被要求「顺手也写个说明」时；
- 路径校验是确定性的，提示词不是；
- 所有写入都记录 `session_id + path + actor`，出问题能定位到哪次会话写错了位置。

---

## 6. 代码仓库接入

### 6.1 授权模型

**使用组织级 GitHub App / GitLab OAuth Application，不使用个人 token。**

- 管理员在组织层安装 App，显式勾选可见仓库；
- 令牌为**短期 installation token**，按需签发；
- 容器内**不放用户 OAuth token**：放 git credential helper，经控制面 unix socket 换取「仅限该仓库 + 只读或读写」的短时 token；
- 只读仓库签发 `read_repository` 权限令牌或只读挂载 → Agent 能读，push 失败，语义干净。

### 6.2 两条路径

| 用途 | 做法 |
|---|---|
| Agent 干活（需 clone） | 克隆进 `workspace/repos/<name>`，按权限给读写 token |
| 网页只读查看 | **走 provider API + 服务端缓存**（tree / blob / commit / diff / MR），不为看代码而 clone |

- Webhook（push / MR）→ 失效缓存 + 更新「同步时间」；
- 树/文件/提交按需拉取，Redis + 对象存储缓存，大仓库也能快速打开；
- 代码审查面板将来要**双向写回**（在 MR 上发评论），权限模型需预留 `write` / `write+pr` 档位。

### 6.3 权限档位

```
repos.permission: read | write | write+pr
```

绑定在「项目 × 仓库」上，由项目负责人配置，管理员可限制上限；所有 clone / push 落审计。

---

## 7. 工作流引擎

### 7.1 选型

| 方案 | 适配问题 | 结论 |
|---|---|---|
| Temporal | 耐久执行/信号/定时/循环都强，但工作流**定义是代码**；图是用户用 React Flow 画的，还需通用解释器，等于套两层 | **升级路径**，不做 v1 |
| n8n / Windmill / Dify | 视觉编排现成，但节点是「短函数」模型；本项目节点是**长驻 Agent 会话**（分钟~小时）且需人工挂起，模型冲突 | 不推荐 |
| Airflow / Dagster / Prefect | 数据管道思维，无人工挂起与交互式会话 | 不适用 |
| **自研图执行器** | 语义按需求定制，图即数据，前端即真相 | ✅ 推荐 |

核心判断：**节点不是任务步骤，是有生命周期的会话**。正确抽象是「持久化状态机 + 事件日志」，不是「工作流代码」。

### 7.2 执行语义

采用 **token 传递 + 显式 join**。不要用「节点状态推进」——后者在「扇出 + 汇合 + 循环」同时存在时会死锁或重复触发。

```
节点完成 → 沿每条出边各发一个 token
  ├─ 出边多个 = 并行扇出（无需额外 parallel 节点）
  ├─ join 节点按策略消费 token：all / any / quorum(n)
  └─ 回路 = 指回上游的边，靠访问计数 + 预算护栏兜底
```

### 7.3 节点类型

| 类型 | 作用 | 关键配置 |
|---|---|---|
| `agent` | **一个独立 CLI 会话** | agent、模型、权限档、提示词、超时、重试 |
| `human` | 人工介入，挂起等待 | 表单 schema、指派角色/人、过期与升级 |
| `condition` | 条件分支 | 规则表达式，输出 branch key 选出边 |
| `join` | 并行汇合 | all / any / quorum(n) |
| `delay` | 延时 | 定时器 |
| `subflow` | 调用另一工作流 | 可复用 + 版本锁定 |
| `trigger` | cron / webhook / 手动 / 群聊消息 | 时区、补偿策略 |

### 7.4 三条硬约束

1. **循环护栏**：单节点最大访问次数 + 单次运行总时长 + token 预算 + 总节点执行数。**服务端强制执行**，不能只靠前端校验。没有这些，一个画错的条件边就能烧掉整月预算。
2. **图快照**：每次运行冻结 `graph_json` 版本。运行中改图**不影响进行中的 run**，否则行为不可复现、无法排查。
3. **分支隔离仓库**：并行分支可能同时改代码 → 每个 agent 节点跑在**独立 git worktree + 独立分支**，合并由 join 后或人工决定。否则并发 `git add` 会互相踩索引。

### 7.5 执行器

- 无状态 worker 池，从 Postgres 抢任务：`SELECT ... FOR UPDATE SKIP LOCKED`。正确性交给数据库，Redis 只做 pub/sub 与限流。
- 每次状态迁移写 `workflow_event`，UI 节点高亮、回放、审计全部由它派生。
- **心跳 + 收尸**：`node_run` 定期心跳，worker 崩溃后由 reaper 判死；重启时与容器内真实会话对账（**容器是真相，数据库是索引**）。
- **定时触发**：`schedule` 表 + 单实例分布式锁；处理时区、夏令时；停机期间默认不补跑，仅记录 missed。
- **人工节点**：落在群聊里最自然——发一条带「去处理」按钮的消息 + 通知中心；处理走后端 resume 接口，记录处理人。

### 7.6 前端对接

- React Flow：nodes 存 `data.nodeConfig`，edges 存 `condition` 与 `targetHandle`；
- 运行态通过 WS 订阅 `node_run` 状态迁移，节点描边显示 `running / waiting_human / failed`；
- 点节点查看该节点的会话流（复用格 3 渲染）；
- 另设「运行时间线」视图，本质是把 `workflow_event` 平铺。

### 7.7 升级路径

把节点执行抽象为 `NodeExecutor` 接口；将来需要跨区域、精确一次、超长定时器时，把「节点执行 + 状态推进」搬进 Temporal activity，图解释器不变。

---

## 8. 数据模型

### 8.1 组织与项目

```sql
organizations(id uuid pk, name, plan, sso_provider, created_at)

users(id uuid pk, org_id fk, email, name, avatar_url,
      role text,             -- owner | admin | member
      status, last_login_at, created_at,
      unique(org_id, email))

project_folders(id uuid pk, org_id fk, name, created_by, created_at)

projects(id uuid pk, org_id fk, name, slug, description,
         folder_id fk null, status, created_by, created_at,
         mode text not null default 'docs',   -- docs | code，决定文档落点
         primary_repo_id uuid null,           -- 代码模式必填
         image_tag, container_id, container_state, last_active_at)

project_members(project_id fk, user_id fk, role, created_at,
                primary key(project_id, user_id))
                -- role: owner | admin | member | viewer
```

### 8.2 Agent 与会话

```sql
ades(id uuid pk, project_id fk, agent_kind, cli_version, model,
     permission_profile, workdir, status, config_json)

sessions(id uuid pk, project_id fk, ade_id fk, container_id,
         cli_session_id, started_by fk, status,
         created_at, ended_at)

agent_events(id bigserial pk, session_id fk, seq bigint,
             kind, payload jsonb, created_at,
             unique(session_id, seq))
create index on agent_events (session_id, seq);
```

### 8.3 群聊与排队

```sql
-- 每项目一个单调递增 seq（可用 projects.seq_counter 或独立 sequence 表行锁递增）
messages(id uuid pk, project_id fk, session_id fk null, seq bigint,
         author_type text,      -- user | agent | system
         author_id uuid null,
         content jsonb, created_at,
         unique(project_id, seq))

run_queue(id uuid pk, session_id fk, seq bigint, user_id fk,
          content text, status, created_at)

approvals(id uuid pk, session_id fk, node_run_id uuid null,
          tool, payload jsonb, status,
          claimed_by uuid null, decided_at, created_at)
```

### 8.4 文件与知识

```sql
-- 文档与 Office 已改由飞书托管，登记表见
--   docs/云端平台-飞书文档接入-技术方案.md §3
--   （feishu_integrations / project_feishu_folders / documents / doc_drafts / doc_sync_events）

-- 项目知识库是 documents + chunks 的索引视图，不单独建表

-- 规范 / 附件文件表
files(id uuid pk, project_id fk, folder_id uuid null,
      path text not null,                   -- 逻辑路径（repo: 仓库内路径；project_docs: 相对路径）
      title text, kind text not null,       -- spec | attachment
      origin text not null,                 -- repo | project_docs | object | import
      repo_id uuid null, repo_ref text,     -- origin=repo：仓库 ID + 索引时的 commit sha
      source text,                          -- 手动 | 本地文件 | 团队 wiki | GitLab 文档
      source_ref text,                      -- 外部地址或原始路径（导入溯源）
      storage text not null,                -- workspace | object
      space text not null default 'kb',     -- kb | attach（UI 归属与默认策略，不影响物理位置）
      index_policy text not null default 'auto', -- auto | manual | off（是否自动进检索）
      indexed_version int,                   -- 已索引的版本，与 current_version 比对判断是否过期
      mime_type text, original_name text,
      size_bytes bigint,
      content_hash text not null,
      current_version int not null default 1,
      derived_path text,                     -- 派生文本 sidecar 在 workspace 的路径
      preview_status text,                   -- none | pending | ready | failed
      summary text,                         -- 导入/索引时生成，列表次级文案
      in_prompt boolean not null default false,  -- 仅 kind=spec 有效：是否注入系统提示词
      index_status text not null default 'pending', -- pending | indexing | indexed | failed
      imported_at timestamptz, updated_at timestamptz not null,
      deleted_at timestamptz,               -- 软删，便于恢复与审计
      unique(project_id, path))
create index on files (project_id, kind, folder_id);

-- 二进制版本：git 之外自成一套版本（Office / PDF / 图片 / 音视频）
file_versions(id uuid pk, file_id fk, version int not null,
              object_key text not null, content_hash text not null,
              size_bytes bigint, mime_type text, original_name text,
              created_by uuid, created_at timestamptz not null default now(),
              unique(file_id, version))

-- 预览产物缓存：由原件版本派生，可随时重建
file_renditions(version_id fk, kind text not null,   -- pdf | thumb | text
                object_key text, status text not null, created_at,
                primary key (version_id, kind))

chunks(id bigserial pk, file_id fk, project_id fk, ordinal, content,
       section_path text[], tokens, content_hash,
       embedding vector(1024), embedding_model text)
create index on chunks using hnsw (embedding vector_cosine_ops);

-- 记忆：Postgres 为唯一真相，不落文件
memories(id uuid pk, project_id fk, content text not null,
         source text not null,              -- 会话沉淀 | 手动
         source_session_id uuid null, source_file_id uuid null,
         status text not null default 'active', -- active | expiring | archived | deleted
         importance real not null default 0.5,
         reflect_note text,                 -- AI 反思备注（只读展示）
         dedupe_hash text,                  -- 去重：规范化文本 hash
         expires_at timestamptz,
         last_used_at timestamptz,
         created_at timestamptz not null default now(),
         embedding vector(1024))
create index on memories (project_id, status);
create unique index on memories (project_id, dedupe_hash) where status <> 'deleted';

-- 记忆策略：每项目一行
memory_settings(project_id uuid primary key,
                auto_collect bool not null default true,
                collect_rules text,
                retention_days int not null default 90,
                permanent bool not null default false,
                expire_policy text not null default '自动归档', -- 自动归档 | 自动删除 | 仅提醒
                auto_reflect bool not null default true,
                reflect_frequency text not null default '每周',
                reflect_rules text,
                updated_at timestamptz not null default now())

-- 记忆状态流转审计：创建 / 反思 / 归档 / 过期 / 删除
memory_events(id bigserial pk, memory_id fk, project_id fk,
              type text, payload jsonb, created_at)
```

### 8.5 Git

```sql
repos(id uuid pk, project_id fk, provider,        -- github | gitlab（svn 预留）
      external_id, full_name, description, default_branch, clone_url,
      permission text,                            -- read | write | write+pr
      credential_ref, last_commit_sha, last_synced_at, created_at)
```

### 8.6 工作流

```sql
workflows(id uuid pk, project_id fk, name, graph_json jsonb,
          version int, enabled bool, created_at)

workflow_runs(id uuid pk, workflow_id fk, graph_version int,
              trigger_type, status, context_json, budget_json,
              started_at, ended_at)

node_runs(id uuid pk, run_id fk, node_id, attempt,
          status, session_id fk null, worktree,
          input_json, output_json, started_at, ended_at, heartbeat_at)

workflow_events(id bigserial pk, run_id fk, seq bigint,
                type, payload jsonb, created_at)

human_tasks(id uuid pk, run_id fk, node_run_id fk, form_schema jsonb,
            assignee_role, assignee_user uuid null, status,
            payload jsonb, claimed_by uuid null, decided_at,
            expires_at, created_at)

schedules(id uuid pk, workflow_id fk, cron, timezone,
          next_run_at, enabled, last_fired_at)
```

### 8.7 模型与审计

```sql
model_providers(id uuid pk, org_id fk, kind, base_url,
                key_ref, models jsonb, limits jsonb)

usage_records(id bigserial pk, org_id fk, project_id fk, session_id fk,
              model, input_tokens, output_tokens, cost_usd, created_at)

audit_logs(id bigserial pk, org_id fk, actor_id uuid null,
           action, target_type, target_id, meta jsonb, created_at)
```

---

## 9. API 契约（要点）

### 9.1 REST

```
POST   /api/auth/login                 OIDC 回调换 token
GET    /api/me                         当前用户 + 组织 + 角色

GET    /api/projects                   项目列表（文件夹树）
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id
GET    /api/projects/:id/members
POST   /api/projects/:id/members

GET    /api/projects/:id/ades
POST   /api/projects/:id/ades         创建共享 Agent
POST   /api/ades/:id/sessions         启动会话
POST   /api/sessions/:id/interject    插话（入队）
POST   /api/sessions/:id/stop

GET    /api/projects/:id/messages?after_seq=...
GET    /api/projects/:id/files?path=...      项目规范 / 附件
POST   /api/projects/:id/files/:fid/reindex

GET    /api/projects/:id/documents            飞书文档列表（含同步状态）
POST   /api/projects/:id/documents/sync       手动同步飞书文件夹
POST   /api/projects/:id/documents/upload     上传文件到项目飞书文件夹
GET    /api/documents/:id                     元信息 + 只读快照
GET    /api/documents/:id/draft               读取本地草稿
PUT    /api/documents/:id/draft               保存草稿
POST   /api/documents/:id/publish             发布到飞书（携带 baseRevision）

GET    /api/projects/:id/repos
POST   /api/projects/:id/repos
GET    /api/projects/:id/repos/:rid/tree?ref=
GET    /api/projects/:id/repos/:rid/blob?path=&ref=

GET    /api/projects/:id/workflows
POST   /api/projects/:id/workflows
POST   /api/workflows/:id/runs
POST   /api/runs/:id/cancel
POST   /api/human-tasks/:id/decide    人工节点处理

GET    /api/admin/users
PATCH  /api/admin/users/:id
GET    /api/admin/model-providers
POST   /api/admin/model-providers
GET    /api/admin/audit
```

### 9.2 WebSocket

单一连接，按主题订阅：

```ts
// client → server
{ type: 'subscribe', topics: ['project:123', 'session:456', 'run:789'] }
{ type: 'ping' }

// server → client
{ type: 'message',        projectId, seq, author, content }
{ type: 'agent_event',    sessionId, seq, kind, payload }
{ type: 'session_status', sessionId, status }
{ type: 'node_run',       runId, nodeId, status }
{ type: 'approval',       approval }
{ type: 'presence',       projectId, users[] }
```

断线重连后客户端凭 `last_seq` 拉增量，保证不丢事件。

---

## 10. agent-runner 协议

容器内的常驻进程，是控制面与 CLI 之间唯一的桥梁。

- **通信**：私有 Docker 网络 + 每容器独立 bearer token；控制面不直接 exec 容器。
- **单一出口**：所有容器事件都经 runner 上报 → 控制面 → WS。好处是鉴权与审计只有一个点。

```
POST /v1/sessions                  { agentKind, cwd, prompt, model, permission, budget }
POST /v1/sessions/:id/input        { text }             插话
POST /v1/sessions/:id/stop         { force? }
GET  /v1/sessions/:id             status + cliSessionId
WS   /v1/sessions/:id/events      事件流（后端消费，不直连浏览器）
POST /v1/worktrees                 { repo, nodeId }     为工作流节点创建隔离 worktree
GET  /v1/health                    CLI 版本与能力快照
```

---

## 11. 部署与服务器规格

### 11.1 部署形态

起步用**单台 VM + Docker Compose**：

```
docker compose:
  api             Node 服务
  worker          RAG 索引 + 工作流执行器
  scheduler       定时触发
  postgres        + pgvector
  redis
  minio           可选（也可用云对象存储）
  gateway         LiteLLM / one-api
  （项目沙箱容器由 api 通过 docker socket 动态创建，不写在 compose 里）
```

隔离策略设计成可替换：`Orchestrator` 接口先实现 Docker 版，将来换成 K8s。

### 11.2 只跑一个 Agent 的服务器规格

**内存测算（单 Agent，稳态 / 峰值）**

| 组件 | 稳态 | 峰值说明 |
|---|---|---|
| OS + Docker daemon | 0.7 – 1.0 GB | — |
| Postgres(+pgvector) | 0.3 – 0.5 GB | 数据量小 |
| Redis | ~0.05 GB | — |
| API 服务 | 0.2 – 0.3 GB | — |
| Worker / 执行器 | 0.15 – 0.25 GB | 索引任务时略高 |
| 项目容器（空闲 + 1 个 CLI） | 0.3 – 0.6 GB | — |
| RAG 索引/检索（轻量方案） | 0.2 – 0.4 GB | 首次批量导入时 CPU 尖峰 |
| **构建 / 测试峰值** | — | **+1 – 2 GB**（`npm install`、`tsc`、`vite build`；含浏览器自动化再 +1 – 2 GB） |
| **合计** | **约 2.2 – 2.9 GB** | **约 4.5 – 6 GB** |

**RAG 部署路线与资源增量**

| 路线 | 额外资源 | 适用 |
|---|---|---|
| **A. 嵌入式轻量**（推荐）：pgvector 复用现有 Postgres，索引任务跑在现有 worker，嵌入走 API | +0.2 – 0.4 GB RAM；磁盘随 chunk 增长（10 万 chunk ≈ 0.5 – 1 GB 含向量与索引） | 默认方案 |
| **B. RAGFlow / Dify / FastGPT 自托管** | **+6 – 12 GB RAM**（RAGFlow 官方建议整机 ≥ 4 核 / 16 GB），额外一套 Elasticsearch/Infinity + MySQL + Redis + MinIO，磁盘 +50 GB 起 | 大量扫描件/复杂表格，或需要现成的知识库运营后台 |
| **C. 托管 RAG 服务** | 0（云端），按查询/座位计费 | 不想运维、规模不确定 |
| **D. 本地嵌入模型**（bge-m3 等） | +1 – 2 GB RAM，纯 CPU 下索引很慢；有 GPU 才实用 | 数据不能出域 |

**结论**

| 场景 | 建议配置 | 说明 |
|---|---|---|
| 最低可跑 | **2 vCPU / 4 GB / 80 GB SSD** | 能跑通，构建时偏紧，容易 OOM，不建议长期 |
| **推荐起步** | **4 vCPU / 8 GB / 100 GB SSD** | 一个 Agent 流畅；可容纳 2–3 个轻量并发任务 |
| 含浏览器自动化 / 大仓库构建 | **4 vCPU / 16 GB / 200 GB SSD** | Playwright、大型 monorepo |
| **自托管 RAGFlow / Dify** | **4 vCPU / 16 GB / 200 GB SSD** 起，多人使用建议 **8 vCPU / 32 GB** | 独立一套 Python + 搜索引擎 + MySQL + MinIO 栈 |
| 每个额外并发 Agent | **+1 – 2 GB** | 构建峰值叠加；建议构建串行 |

**CPU**：Agent 本身是 IO 密集型（等模型 API），CPU 尖峰主要来自编译与测试。2 vCPU 可用，但会和 API/构建互相抢占，4 vCPU 明显更顺。
**磁盘**：基础镜像（Node 24 + Python + git + 4 个 CLI）约 2–4 GB，Docker 层缓存 2–4 GB，workspace 仓库 1–10 GB，Postgres 5–20 GB。必须用 SSD。
**网络**：出网到模型 API 为主，5–10 Mbps 足够；需要稳定公网出网。

**参考价位（仅供参考）**：国内云 2C4G 轻量约 ¥100–200/月，4C8G 云服务器约 ¥300–600/月；海外 Hetzner CX32（4C8G）约 €8/月。

### 11.3 成本提醒

**服务器不是成本大头，模型 token 才是。** 一个 Agent 连续工作一小时，按使用强度可能消耗 $1–20 量级。因此：

- 必须做预算护栏（单次运行 token/金额上限，Claude 可加 `--max-budget-usd`）；
- 必须做空闲休眠：闲置 N 分钟暂停容器、保留 workspace 卷、有消息时秒起；
- 必须按项目/用户归集 `usage_records`，否则无法定位成本来源。

### 11.4 只有一个 Agent 时能否不用容器

技术上可以：用专用非 root 用户 + `ulimit` / `systemd` 限制直接跑子进程，省约 200 MB 内存和大量运维复杂度。**不推荐**——Agent 会执行模型生成的 shell 命令，容器是唯一清晰的隔离边界，且多用户是既定方向。容器开销相对总成本可以忽略。

### 11.5 托管沙箱备选

E2B / Daytona 这类托管沙箱可省掉隔离与调度的一大半工作，适合快速验证；缺点是按秒计费、锁定、仍需一台小 VM 放 API 与数据库。**建议：先自建 Docker 跑通，接口留出替换空间。**

---

## 12. 安全与隔离

按杀伤力排序：

1. **RCE as a Service**：用户在群里说一句话，Agent 就会在云端执行 shell。容器必须：非 root、无宿主挂载、独立网络命名空间、CPU/内存/PID/磁盘限制、出网白名单、**拿不到组织真实 key**（走网关）。
2. **凭证合规**：共享 Agent 用 API key / 企业协议，禁止用个人订阅账号。
3. **git 凭证**：短期 installation token + credential helper，不落磁盘、不进日志。
4. **自定义 CLI 模板**：只允许管理员配置，注册过的绝对路径执行，参数以数组传递不拼 shell，cwd 限定在项目工作区。
5. **危险档位**：`--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` 一律不在 UI 暴露。
6. **审计**：启动/停止 Agent、批准工具调用、读写仓库、修改模型配置全部落 `audit_logs`。

---

## 13. 现有前端迁移

| 模块 | 处理 |
|---|---|
| 组件与样式 | 保留 |
| `data/projects.ts`、`data/settings.ts` 等 | 换成 API 客户端 + TanStack Query |
| `App.tsx` 内存状态 | 上移到服务端；本地只留 UI 状态 |
| 假窗口外壳 | 移除 |
| `ChatPane` | 扩展群聊：作者头像、归属、已读、在线 |
| `TerminalPane` | 接入统一事件流；可切「原始终端」视图 |
| `SessionRail` | 保留，补状态徽标与权限门控 |
| `AdeSettingsModal` | 复用为共享 Agent 配置弹窗 |
| 设置页 | 扩展组织级管理与「本地/云端 Agent 注册表」 |
| 文档 tab（`DocLibraryView`） | 改为飞书文档列表：只读目录 + 同步状态 + 打开飞书 / 本地草稿 / 发布 |
| 工作流面板 | 换成 React Flow + 运行态订阅 |
| 通知中心 | 接入审批、人工节点、运行失败 |

新增页面：登录页、组织切换、管理员控制台、工作流编辑器。

---

## 14. 里程碑

| 阶段 | 内容 | 估时 |
|---|---|---|
| P0 | 组织/用户/RBAC + Postgres schema + OIDC 登录 | 1.5 周 |
| P1 | 基础镜像 + agent-runner + 单 Agent 容器内跑通 + WS 流式 | 2 周 |
| P2 | 群聊：定序、归属、插话队列、在线、权限门控 | 1.5 周 |
| P3 | 规范合成 + RAG 索引管道（索引源改为飞书快照；详见 [P3 实施技术方案](云端平台-P3-知识库RAG实施-技术方案.md)） | 2 周 |
| P3.5 | 飞书文档接入（F1–F8，详见 [飞书文档接入方案](云端平台-飞书文档接入-技术方案.md)） | 3 周 |
| P4 | GitLab/GitHub App 接入 + 只读代理 + 容器凭证 helper | 1.5 周 |
| P5 | 记忆与反思任务 | 1 周 |
| P6 | 工作流引擎（执行器 + 人工任务 + 定时 + React Flow 联调） | 3 周 |
| P7 | 模型网关 + 管理员控制台 | 1.5 周 |
| P8 | 隔离加固、空闲休眠、崩溃恢复、压测 | 1.5 周 |

**关键路径是 P1**：先把「一个 Agent 在容器里被 Web 端实时看到」跑通，其余都是围绕它的工程化。

**P6 建议先做「线性 + 人工挂起」的最小闭环**，再补扇出/汇合/循环——三者一起上容易在语义上反复返工。

---

## 15. 风险清单

| # | 风险 | 应对 |
|---|---|---|
| 1 | Agent 执行任意命令带来的 RCE 风险 | 容器硬隔离 + 出网白名单 + 网关隔离密钥 |
| 2 | 循环 + 扇出组合爆炸 | 三重预算护栏（访问次数 / 时长 / token），服务端强制 |
| 3 | 并行 Agent 抢同一仓库 | 每节点独立 worktree，写操作分布式锁 |
| 4 | CLI 版本漂移 | 能力从 `--help` 推导 + 版本锁定 + 不兼容时禁选 |
| 5 | JSON 流跨 chunk 解析错误 | `parseChunk` 用流式状态机，禁止按行切 |
| 6 | 长驻会话被发布打断 | runner 独立于 API，状态落库可恢复 |
| 7 | 事件流晚加入丢失历史 | 事件落库 + `last_seq` 增量拉取 |
| 8 | 人工节点卡死运行 | 过期/升级/提醒三件套 |
| 9 | RAG 幻觉与陈旧 | 强制引用 + 删除同步清理 chunk + 换模型重嵌 |
| 10 | 空闲容器成本 | 空闲休眠 + 并发上限 + 成本归集 |

---

## 16. 待决策项

| # | 问题 | 建议 |
|---|---|---|
| 1 | 部署形态：自建 Docker / K8s / 托管沙箱 | 先自建 Docker，接口留替换空间 |
| 2 | 登录源：飞书 / Google Workspace / 自建 | 有现成 IdP 优先接入 |
| 3 | 是否保留本地 Mac 版 | 本期不做，云端单轨 |
| 4 | 模型网关自研还是用 LiteLLM/one-api | 先用现成，能力不足再自研 |
| 5 | 工作流 v1 范围 | 线性 + 人工挂起，再补扇出/循环 |
| 6 | 嵌入模型与维度 | 与网关模型白名单一起定，写死在 `chunks.embedding_model` |
| 7 | RAG 部署路线 | 先用 pgvector + 自建管道；出现大量扫描件/复杂表格再评估 RAGFlow 或 MinerU |
| 8 | 飞书应用身份 | 文档由服务账号创建、项目成员同步为协作者；用户编辑走 OAuth |
| 9 | 本地编辑范围 | 仅纯文本文档；Office 一律跳转飞书编辑 |
