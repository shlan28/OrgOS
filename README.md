# Org-OS

面向组织的 Agent 平台。

Org-OS 让一个组织在云端运行自己的 AI Agent 团队：成员在「项目」里以群聊方式协作，共享同一批 Agent CLI（Claude Code、Codex、opencode、DeepSeek harness 等）；Agent 读取项目的知识库、记忆与规范，接入 GitLab / GitHub 仓库，并通过可视化工作流编排多个 Agent 协同完成任务；管理员在组织层统一管理成员权限、模型与用量。

> 界面为高保真 React 实现；**Agent 控制台已接通真实 DeepSeek Harness 运行时**（Node 后端 + SQLite 持久化）。云端多租户平台仍在方案阶段。界面原型内部沿用 `Loom` 命名。

## 核心能力

| 能力 | 说明 |
|---|---|
| 多用户协作 | 项目即群聊：消息定序、插话排队、在线状态、精确的消息归属 |
| 共享 Agent | 项目内可同时运行多个 Agent，各自独立会话与执行轨迹 |
| 项目上下文 | 项目文件即知识库（RAG）、记忆与项目规范，自动注入 Agent |
| 代码仓库 | 关联 GitLab / GitHub，支持只读查看与 Agent 读写 |
| 工作流 | 可视化编排，节点即 Agent 会话，支持人工介入、条件分支、并行、定时与循环 |
| 组织治理 | 统一登录、角色权限、模型网关与配额、审计日志 |

## 项目状态

- **界面 Mock**：已完成，可直接运行
- **Agent 运行时**：已接通本地 DeepSeek Harness（真实子进程 + NDJSON 事件流 + 持久化）
- **云端平台**：方案已定，待实施 → [总体技术方案](docs/云端Agent协作平台-总体技术方案.md)

## 技术栈

- React 18 + TypeScript
- Vite 5
- CSS（组件级样式，无 UI 库依赖）
- Node 22+（Express + 内置 `node:sqlite`）本地运行时
- DeepSeek Harness CLI（`@deepseek-ai/dsh --profile headless`）

## 快速开始

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run preview
```

开发模式默认地址 `http://localhost:5173`。`npm run dev` 会同时启动 Vite 与本地 API（`http://127.0.0.1:8791`）；也可分别用 `npm run dev:web` / `npm run dev:api`。

API Key 在「设置 → Agent 设置 → 运行时」填入，或启动前 `export DEEPSEEK_API_KEY=...`。

## 目录结构

```
├── docs/          # 文档、设计图、截图
├── server/        # 本地 Agent 运行时（Express + SQLite + dsh 子进程）
│   └── data/      # 运行时数据：app.db / secrets.json / dsh home（gitignore）
├── src/
│   ├── data/      # Mock 数据与类型
│   ├── lib/       # 运行时 API 客户端
│   ├── hooks/     # 自定义 hook
│   └── components/# UI 组件
├── index.html
├── vite.config.ts
└── tsconfig.json
```

## Agent 控制台（真实运行）

侧边栏「Agent 控制台」→ 选择 Agent → 新建会话 → 发送任务。

- **运行时**：`dsh --profile headless --json`，逐行 NDJSON 事件（`session / status / thinking / text / tool_call / tool_result / final`）
- **会话续接**：首轮记录 harness `sessionId`，后续 turn 自动追加 `--session-id`
- **持久化**：`server/data/app.db`（`agents / sessions / turns / events`）
- **凭证**：`server/data/secrets.json`（0600），只注入子进程，不回传前端
- **权限档**：只读 / 工作区可写 / 完全访问，映射到 `DSH_PERMISSION_MODE` 与审批策略
- **模型配置**：设置页「我的 ADE」可改模型、模型服务、权限档、工作目录，改动自动持久化

## 文档

完整的产品说明、功能清单、仓库结构、全部技术方案与设计图索引见 **[docs/index.md](docs/index.md)**。

- [云端 Agent 协作平台 - 总体技术方案](docs/云端Agent协作平台-总体技术方案.md)
- [Mock 阶段技术方案](docs/loom-ui-mock-技术方案.md)
- [项目中心技术方案](docs/项目中心-技术方案.md)
