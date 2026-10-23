# Org-OS

面向组织的 Agent 平台。

Org-OS 让一个组织在云端运行自己的 AI Agent 团队：成员在「项目」里以群聊方式协作，共享同一批 Agent CLI（Claude Code、Codex、opencode、DeepSeek harness 等）；Agent 读取项目的知识库、记忆与规范，接入 GitLab / GitHub 仓库，并通过可视化工作流编排多个 Agent 协同完成任务；管理员在组织层统一管理成员权限、模型与用量。

> 当前仓库为界面与交互的高保真 React Mock（纯前端，无后端、无持久化），后端架构方案已完成，待实施。界面原型内部沿用 `Loom` 命名。

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
- **云端平台**：方案已定，待实施 → [总体技术方案](docs/云端Agent协作平台-总体技术方案.md)

## 技术栈

- React 18 + TypeScript
- Vite 5
- CSS（组件级样式，无 UI 库依赖）

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

开发模式默认地址 `http://localhost:5173`。

## 目录结构

```
├── docs/          # 文档、设计图、截图
├── src/
│   ├── data/      # Mock 数据与类型
│   ├── hooks/     # 自定义 hook
│   └── components/# UI 组件
├── index.html
├── vite.config.ts
└── tsconfig.json
```

## 文档

完整的产品说明、功能清单、仓库结构、全部技术方案与设计图索引见 **[docs/index.md](docs/index.md)**。

- [云端 Agent 协作平台 - 总体技术方案](docs/云端Agent协作平台-总体技术方案.md)
- [Mock 阶段技术方案](docs/loom-ui-mock-技术方案.md)
- [项目中心技术方案](docs/项目中心-技术方案.md)
