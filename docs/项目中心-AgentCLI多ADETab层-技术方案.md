# 项目中心 · Agent CLI 多 ADE Tab 层 —— 技术方案

> 创建日期：2026-10-22
> 更新日期：2026-10-22（实施完成：附验证结果；见第 8 节）

## 1. 需求

鹿鹿子大王：**格 3 Agent CLI 有多个 ADE 时，每个 agent 一个 tab**——在 header 下面再加一层
agent tab，切换查看不同 agent 的 CLI 轨迹。

## 2. 现状

| 项 | 现状 | 差距 |
|---|---|---|
| 轨迹数据 | `TerminalLog` 无 agent 维度；auto 会话 `runLogsOf(run)` 单桶派生、manual 会话 `session.logs` 单数组 | 无法按 agent 分视图 |
| UI | 仅头部 40px（标题 + 会话名 + 运行呼吸点 + 清空），下面直接是终端区 | 无 agent tab 层 |
| Mock 数据 | loomweb 2 个 ADE（研发/测试）、翼构 1 个、新项目 0 个 | 测试 ADE 无轨迹数据 |
| 插话联动 | ChatPane 手动会话插话 append 到 `session.logs`，无 agent 归属 | 插话应归当前选中 agent |

## 3. 方案

### 3.1 数据结构：`TerminalLog` 增加可选 `agentId`

```ts
export interface TerminalLog {
  id: string
  time: string
  kind: ...
  text: string
  /** 归属 ADE id（多 agent tab 分桶用；缺省 = 主 agent（agents[0]）） */
  agentId?: string
}
```

缺省归主 agent（`project.agents[0]`）——兼容旧数据/单 agent 项目，不需要全量补标。

### 3.2 auto 会话派生：`runLogsOf(run, agents)` 按 agent 打标

Mock 分桶规则（一个 run 由多 agent 协作，各自有独立 agent loop）：

| 行类型 | 归属 |
|---|---|
| sys 横幅（Loom Agent CLI v2.4.1 …）+ 装载任务 info | **每个 agent 桶各一份**（各自 CLI 实例启动；id 加 agentId 前缀防重复） |
| 系统消息（运行开始/结束） | 每个 agent 桶各一份 |
| `开始执行：X` 及其后续（工具/命令/输出/结果） | 步骤名含「测试」→ **测试 agent**（role 含「测试」的第一个）；否则 → 主 agent |
| 人插话 prompt + ADE 回应 | 挂「当前执行步骤」的 agent（跟步骤规则） |
| Gate 等待行 | 跟随当前步骤的 agent |

loomweb j1「每日构建」示例：拉取代码/安装依赖/构建产物 → 研发 ADE；
「单元测试」步骤（shell exec npm test 等）→ 测试 ADE；wang 插话发生在单测步骤中 → 测试 ADE。

### 3.3 manual 会话 Mock：logs 补 agentId

- **sess4（结算页灰度）**：现有 fs/gateway 轨迹挂 a1 研发；**给 a2 测试 ADE 补一段轨迹**
  （灰度回归用例准备：think/tool/out 三五行）——展示双 tab 均有内容
- **sess5（规范答疑）**：全部挂 a1；切到 a2 显示空态「❯ 等待 agent 启动…」（展示无轨迹空态）

### 3.4 组件结构：tab 层 + activeAgentId 上提

```
.terminal-pane
├── .term-head（40px：Agent CLI + 会话名 + 呼吸点 + 清空）  ← 不变
├── .term-agent-tabs（30px 新增：仅 agents.length > 1 时渲染）
│     [● 研发工程师ADE] [○ 测试工程师ADE]
│     每项 = 状态点（工作中绿呼吸/空闲灰）+ agent 名（ellipsis）
│     选中态：文字加粗 + 底部 2px 青蓝指示条
└── .term-body（轨迹 = 当前 agent 的桶）
```

- **activeAgentId 状态上提到 ProjectDetail**（与 activeSessionId 同级）：
  TerminalPane（tab 切换）与 ChatPane（插话归属）共享；默认 `agents[0]?.id`
- 切换会话不变动 activeAgentId（跨会话保留选中 agent）
- **单 agent / 0 agent 项目不渲染 tab 层**——翼构移动应用、新项目保持现状（40px 头 + 终端区）

### 3.5 插话联动（ChatPane）

手动会话插话 append 的 `prompt` 行挂 `activeAgentId`；1.5s 后 ADE 回应
（`think` 行 + 消息）也挂同一 agent——插给谁、谁回应。

### 3.6 清空按钮（manual 会话）

按当前选中 agent 清空：`logs = logs.filter(l => agentIdOf(l) !== activeAgentId)`
（只删当前 agent 的行，另一 agent 轨迹保留）。

### 3.7 四格头部对齐说明

tab 层（30px）加在 40px 头部**之下**：头部 40px 底线仍与其他三格对齐，
格 3 内容区顶部比其他格低 30px（用户明确要求加层，可接受；单 agent 项目不受影响）。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/data/projects.ts` | `TerminalLog.agentId?`；`runLogsOf(run, agents)` 打标派生；sess4 补测试 ADE 轨迹、sess4/5 logs 补 agentId |
| `src/components/project-detail/TerminalPane.tsx` | tab 层渲染 + 按 activeAgentId 分桶过滤 + 清空按 agent |
| `src/components/project-detail/TerminalPane.css` | `.term-agent-tabs` / tab 项 / 状态点 / 选中态样式 |
| `src/components/ProjectDetail.tsx` | `activeAgentId` state 上提 + 传参 |
| `src/components/project-detail/ChatPane.tsx` | 插话/回应 append 挂 activeAgentId |
| `README.md` + 本文档 | 说明更新 |

## 5. 验证方式

1. `npm run build` 通过
2. Playwright（loomweb 详情页）：
   - tab 层渲染：2 个 tab（研发/测试）+ 状态点（绿呼吸/灰）
   - 切 tab → 轨迹内容切换（研发：拉取/安装/构建 + banner；测试：单测轨迹 + banner）
   - manual 会话 sess4：切测试 tab 有灰度回归轨迹；sess5 切测试 tab 为空态
   - 插话（sess4，选中测试 ADE）→ 测试 tab 的 CLI 出现 prompt 行 + 1.5s 回应
   - 清空只清当前 agent 行
   - 翼构移动应用项目：无 tab 层，布局与现状一致
3. 亲自读图：双 tab + 两个 agent 轨迹各一张截图

## 6. 待确认项（默认按此实施，如有异议请指出）

- tab 层高度 30px、仅多 ADE 项目显示（单 ADE 不占空间）
- 测试 ADE 在 auto 会话中只承接「测试类步骤」（Mock 协作分工）
- 切会话时保留 agent 选中态

## 7. 历史更新说明

- 2026-10-22 初版：多 ADE tab 层方案（TerminalLog.agentId + runLogsOf 分桶 + activeAgentId 上提 + 30px tab 条）
- 2026-10-22 实施完成：新增 `logAgentIdOf` 兜底函数（log.agentId 缺省归主 agent）；
  `runLogsOf` sys 横幅带 agent 身份（name · model · role）；切会话保留 agent 选中态；
  「选中 agent 被移除」时兜底回主 agent（useEffect 监听 project.agents）

## 8. 验证结果（已通过）

Playwright 14 步验证（13 PASS + 1 项 mock 数据缺失）：

| 验证组 | 结果 |
|---|---|
| A tab 层渲染 | ✅ 30px 高 / 2 tab / a1 busy 绿呼吸点 / 默认选中主 agent |
| B auto 会话切 tab | ✅ a1 桶 = GLM banner + 拉取/安装/构建；a2 桶 = qwen banner + npm test PASS + wang 插话（归属当前执行步骤 agent） |
| C manual sess4 双桶 | ✅ a1 = fs/gateway/minutes；a2 = kb search + regression.spec.ts + 灰度回归就绪；跨会话保留 tab 选中 |
| D sess5 空态 | ✅ a2 tab 显示「等待 agent 启动…」+ 闪烁光标 |
| E 插话归属 | ✅ sess4 选 a2 插话 → prompt + 1.5s think 回应只入 a2 桶（a1 无）；清空只清 a2 桶（a1 15 行轨迹保留） |
| F 单 agent 项目 | ✅ 翼构移动应用不渲染 tab 层、40px 头正常（banner 缺失为该项目 mock 无会话数据，非 tab 层缺陷） |

亲自读图验收 4 张截图（agenttab-auto-a1 / agenttab-auto-a2 / agenttab-manual-a2 / agenttab-single）：
tab 层视觉（状态点 + 选中底条 + 名字）、双桶轨迹内容、空态、单 agent 布局全部符合设计。
