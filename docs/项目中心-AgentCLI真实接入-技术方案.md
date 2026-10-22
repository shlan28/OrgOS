# 项目中心 - Agent CLI 真实接入（loom CLI 桥接）- 技术方案

> 创建日期：2026-10-22
> 更新日期：2026-10-22
> 状态：待鹿鹿子大王确认（确认后开工）

## 一、背景与目标

现状：`loom-org-os` 是纯前端 Mock，项目详情页四格布局中：

- 格 2 会话详情（ChatPane）：manual 会话插话后走 1.5s 假回应（`MANUAL_REPLY_DELAY` 定时器拼死文案）
- 格 3 Agent CLI（TerminalPane）：manual 会话读 `session.logs`（手写 Mock 轨迹），插话只 append `prompt`/`think` 行，无真实 agent loop

本机已安装并登录 **loom CLI 2.0.31**（`~/.npm-global/bin/loom` wrapper + `~/.loom/bin/loom` binary，`whoami`/`doctor` 全绿，ADE = 翼构 · 研发工程师）。经实测已验证能力：

1. `loom exec <prompt> --output-format json` —— 单次真回复（stdout 每行一个 JSON，取 `type === "result"` 行的 `result` 字段）
2. `loom exec <prompt> --session-id <uuid>` —— 首轮指定会话 id，返回同一 `session_id`
3. `loom exec <prompt> --resume <uuid>` —— 续同一会话（实测：轮 1 存暗号 xyz，轮 2 正确答出 xyz），**多轮上下文记忆可用**
4. Node 子进程 `spawn('loom', ['exec', ...])` 桥接验证通过（exit 0 / sid MATCH / 真实中文回复）

注意（约束记录）：wrapper 自身消费 `--verbose`，导致 `--output-format stream-json` 经 wrapper 报错「stream-json requires --verbose」不可用；直接调 binary 又缺认证 env。**本方案用 `--output-format json` + 进程退出式调用**（非流式），足够支撑「真的回复」。

目标：把格 2 / 格 3 从 Mock 回应接入真实 loom CLI——manual 会话插话后，真实 ADE 回复进消息流，格 3 Agent CLI 展示真实调用轨迹（运行中呼吸点、prompt/think/ok/err 行），会话跨多轮保持上下文。

## 二、总体架构

```
浏览器 (vite dev :5173)
  │  fetch POST /api/loom/ask
  ▼
Node 桥进程 server/loom-bridge.mjs   ← 新增（无依赖，纯 node:http）
  │  spawn 'loom exec <prompt> --session-id/--resume <sid> --output-format json'
  ▼
loom wrapper → ~/.loom/bin/loom binary → LBS（已登录凭据 ~/.loom/credentials.json）
```

为什么需要桥进程：浏览器页面无法直接 spawn 本机 CLI；vite dev server 也不代理任意子进程。新增一个极小的 Node HTTP 桥（零新依赖），由它代跑 loom CLI 并回传结果。

## 三、桥进程设计（server/loom-bridge.mjs）

- 纯 `node:http`，单文件，无第三方依赖（与「纯前端 Mock 工程」气质一致，不引 express）
- `GET /health` → `{ ok: true, loom: <version> }`（启动时探测一次 loom --version）
- `POST /api/loom/ask`，body：`{ sid?: string, prompt: string }`
  - `sid` 为空 → 生成新 uuid，传 `--session-id`；有值 → 传 `--resume`（多轮）
  - cwd 固定为 loom-org-os 项目根（与 UI 语境一致）
  - env 注入 `PATH`（含 `~/.npm-global/bin`）与 `LOOM_BINARY_PATH`（不依赖 bashrc source）
  - 子进程超时保护：默认 300s（真 agent 可能跑工具链），超时 kill 并回 504
  - 解析 stdout 逐行 JSON，取 `type === "result"` 行：`{ ok, sid: result.session_id, text: result.result, isError: result.is_error, turns, durationMs }`
  - 子进程失败/凭据失效 → `{ ok: false, error }`，HTTP 200 语义错误由 body 承载（前端好处理）
  - **并发互斥**：同一 `sid` 串行排队（Map<sid, Promise chain>），不同 sid 可并行——loom 底层会话文件按 sid 隔离
  - token 预览类非 JSON 行（如 `token_usage`）忽略即可，不影响解析
- 端口 `5174`（与 vite 5173 相邻；vite.config 已有 `allowedHosts: true, host: true`，浏览器同机访问无 CORS 问题，桥显式回 `Access-Control-Allow-Origin: *` 兜底）
- 启动方式：`npm run dev:loom` = 并行起 vite + 桥（`node server/loom-bridge.mjs &`）；README 记录单独启动命令

## 四、前端接入设计

### 4.1 新增 hook：`src/hooks/useLoomCli.ts`

状态机（每个 manual 会话独立）：

```
idle → thinking（请求中，格 3 出现 think 行 + 呼吸点 + ChatPane 输入禁用）→ idle（回复落库）
```

- `ask(projectId, sessionId, prompt)`：发请求 → 成功后一次性写回 session：
  - `messages` append：ADE 回复一条（sender 用现有 `ADE_SENDER`）
  - `logs` append：真实轨迹行（见 4.2）
  - `cliSid`（新增字段，存 loom 会话 uuid，支持 `--resume` 续聊）
- 失败路径：`err` 行 + ChatPane 错误提示条（不弹 alert，行内提示），状态回 idle
- 空闲态输入转任务指令的原有 Mock 语义**保留**，但 manual 会话一律走真实 CLI（这是本次目标）

### 4.2 轨迹行映射（格 3）

| 时机 | 行类型 | 内容 |
|---|---|---|
| 发送插话 | `prompt` | 用户文本（现状已有） |
| 请求发出 | `think` | 「连接 Loom Agent CLI（会话 <sid前8>）…」 |
| 返回成功 | `ok` | `✓ 已回复（N 轮 · 耗时 X.Xs · session <sid前8>）` |
| 返回失败 | `err` | `✗ <错误摘要>` |

（`sys` 横幅行首次真实调用成功后补一条：`Loom Agent CLI v<实际版本> 已连接 · ADE 翼构`，版本从 `/health` 取。）

### 4.3 数据层改动（src/data/projects.ts）

- `ProjectSession` 增加可选字段 `cliSid?: string`（loom 会话 id；纯增量，不影响 Mock 数据）
- 不动 auto 会话 / engine 逻辑（`runLogsOf` 派生链零改动）

### 4.4 ChatPane 改动

- manual 会话 `handleSend`：删掉 `MANUAL_REPLY_DELAY` 假回应分支，改调 `loom.ask(...)`
- `thinking` 期间输入框禁用 + 发送按钮转「思考中…」态（沿用现有样式类，不新造）
- 失败时 append 一条 `role: '系统'` 消息提示错误（与现有系统消息样式一致）

### 4.5 TerminalPane 改动

- manual 会话：新增「正在等待 agent」态渲染（think 行 + 呼吸点已支持，`running` 判定从 `isAuto` 扩为 `isAuto || loomThinking`）
- 头部徽标：真实连接后显示 `已连接 loom CLI`（小徽标，复用 `.term-running-dot` 样式语言）

### 4.6 桥不可用降级

`/health` 不通时：manual 会话插话回退到现有假回应逻辑（保底可用），格 3 出 `info` 行「loom CLI 桥未启动，回退本地演示模式」。UI 顶部不打扰。

## 五、文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `server/loom-bridge.mjs` | 新增 | Node HTTP 桥（零依赖） |
| `package.json` | 修改 | scripts 增 `dev:loom`（桥+vite 并起）、`bridge`（单起桥） |
| `src/hooks/useLoomCli.ts` | 新增 | 请求/状态机/会话写回 |
| `src/data/projects.ts` | 修改 | `ProjectSession.cliSid?: string`（一处接口） |
| `src/components/project-detail/ChatPane.tsx` | 修改 | handleSend 接 hook，假回应改降级路径 |
| `src/components/project-detail/TerminalPane.tsx` | 修改 | thinking 态 + running 判定 + 连接徽标 |
| `README.md` | 修改 | 运行说明 + 更新日志 |

不新增 CSS 文件（复用现有类；至多 TerminalPane.css 补 2-3 行徽标样式）。

## 六、验证计划

1. `npm run build`（tsc 严格模式）通过
2. 起 `dev:loom`，Playwright：进详情页 → manual 会话（sess4）插话 → 断言消息流出现真实 ADE 回复（非固定文案）→ 格 3 出现 prompt/think/ok 行 → 再次插话（续聊断言上下文，问「刚才我第一句说了什么」类问题）
3. 桥关闭场景：插话回退假回应，不白屏不报错
4. 验收读图：格 2 / 格 3 截图人工复核

## 七、风险与边界

- loom 真回复延迟数秒~数十秒（走 LBS + LLM），thinking 态必须明确；不设「假流式」——宁真勿快
- `stream-json` 经 wrapper 不可用（已实测），json 结果式已满足；未来 loom CLI 修复 verbose 透传后可平滑升级为流式（桥的接口形态不变）
- 凭据有效期：token 失效时桥返回明确错误，UI 引导「重新 loom login」（文案给鹿鹿子大王提示即可，本环境不自动续）
- auto 会话（引擎 Mock）本次不动，边界清晰
