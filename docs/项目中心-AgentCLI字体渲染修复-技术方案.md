# 项目中心 · Agent CLI 字体渲染修复 —— 技术方案

> 创建日期：2026-10-22
> 更新日期：2026-10-22（二次诊断后方案升级：主因确认为 CSS 类名冲突导致布局塌陷，字体栈 CJK 回退为附带修复项，方案全文重写）

## 1. 问题现象

鹿鹿子大王反馈：**项目中心 → 详情页 → 格 3「Agent CLI」（TerminalPane）内容是乱码**。

预期效果：Agent CLI 终端样式，完整展示 agent 思考、执行命令、调用工具、读写文件的详细流程，行列整齐可读。

## 2. 诊断结论（二次诊断，最终版）

### 2.1 主因：CSS 类名冲突 → 布局塌陷 → 叠印成「乱码墨带」

`TitleBar.css` 定义了**全局裸类** `.tl`（macOS 红绿灯圆点：`12×12px / inline-block / 圆角 50%`）。
`TerminalPane` 的终端轨迹条目也叫 `.tl`（裸类，无 display 声明）。两者 specificity 同为 0-1-0，
TitleBar.css 先注入 → **每条终端轨迹被渲染成 12×12 的小圆点盒子**：

- 26 条轨迹在 `.term-body`（block 容器）里按 inline-block **横向流式排列**（x 严格以 12px 步进，排满换行）
- 内部 flex 行 `.tl-row` 被压到 12px 宽，`.body` 文本被 `min-width:0 + overflow:hidden` 压成 **0 宽**
- 多条轨迹叠印在同一两条水平带上（y≈145 与 y≈236），文字笔画互相覆盖糊成墨带
- 19/26 条轨迹与相邻条目发生 y 重叠（Playwright DOM 几何实测）

**视觉表现 = 用户口中的「乱码」**：无缺字方块（tofu），是布局塌陷导致的叠印；字体本身渲染正常。

### 2.2 前一轮误诊说明（已修正）

首轮诊断只测了字体宽度（中英 1.66:1 vs 2:1），未做 DOM 几何测量，误判为字体回退问题。
用户复核截图后否定，二次诊断用 vision 分析 + DOM 几何测量定位到真根因。教训：
**「乱码」类问题必须 DOM 几何测量 + 逐像素读图，不能只看文本提取与字体宽度。**

### 2.3 附带发现（保留修复）：mono 字体栈缺 CJK 回退

`.term-body` 等全部 mono 场景的字体栈 `'SF Mono', Menlo, Consolas, monospace` 在 Linux 全部缺失，
回退后中英字宽比 1.66:1（终端等宽网格要求 2:1），混合行错位。已统一补
`'Noto Sans Mono CJK SC', 'Noto Sans Mono CJK TC'` 回退（实测 ASCII 5.5px / CJK 11px @11px，精确 2:1）。

## 3. 修复方案（已实施）

### 3.1 核心修复：类名改名 + 作用域化（消除冲突）

- `TerminalPane.tsx` / `TerminalPane.css`：轨迹条目 `.tl` → **`.term-line`**，物理行 `.tl-row` → **`.term-row`**
- `.term-line` 显式声明 `display: block`（并在 CSS 注释记录冲突教训，绝后患）
- `TitleBar.css`：红绿灯 `.tl` 及三色变体全部**作用域化到 `.traffic-lights .tl`**（不再污染全局）

### 3.2 附带修复：全项目 mono 字体栈补 CJK 回退（13 处）

统一改为 `'SF Mono', Menlo, Consolas[, 'Courier New', ui-monospace], 'Noto Sans Mono CJK SC', 'Noto Sans Mono CJK TC', monospace`：

| 文件 | 处数 |
|---|---|
| `TerminalPane.css`（.term-body，本次主诉格子） | 1 |
| `App.css`（.kv-value.mono） | 1 |
| `CodeReviewPanel.css`（mono-block/diff/loc/input） | 4 |
| `SecurityPanel.css`（mono-block/finding-loc） | 2 |
| `CodePanel.css`（分支行）、`RunModal.css`（进度）、`SpecsPanel.css`（编辑器）、`WorkflowPanel.css`（kv）、`RecordingWidget.css`（计时） | 各 1 |

### 3.3 验证结果（已通过）

1. `npm run build` 通过（tsc 无错误）
2. Playwright DOM 几何测量（构建预览 4173）：
   - `display:inline-block 且 width=12px` 的 `.term-line` 数量 = **0**；首条 `display:block / width 211px`
   - 相邻 `.term-line` **y 重叠数 = 0**，全部 `x=761` 左缘对齐（横向流式消失）
   - 首行 `.body` 文本宽 152px（修复前 0px）；`.term-body` scrollHeight 1304 > clientHeight 786 正常滚动
   - 红绿灯 `.traffic-lights .tl` = 3 枚，12×12 / 圆角 50% 正常
   - 格 2 消息流、格 4 工作流 tab 无布局破坏
3. 亲自读图验收三张截图（auto / manual / 整页四格）：思考行、⚡ 工具调用、❯ 命令、原始输出、✓ 结果、
   ▸ 文件读写预览逐行清晰可读，叠印墨带彻底消失

## 4. 影响面评估

- 核心修复为**类名改名 + 选择器作用域化**：纯 CSS/类名同步，零逻辑改动，macOS/Windows/Linux 表现一致
- 附带字体栈修复仅影响无 SF Mono/Menlo 环境的回退路径
- 不动数据结构（TerminalLog）、不动渲染逻辑（runLogsOf 派生规则、插话联动等全部保留）

## 5. 历史更新说明

- 2026-10-22 初版：误判为字体回退问题，方案仅补 mono 字体栈 CJK 回退（13 处，保留为附带修复）
- 2026-10-22 二次：用户复核截图否定初版结论 → vision 逐像素分析 + DOM 几何测量定位真根因
  （TitleBar.css 全局 `.tl` 命中终端轨迹条目 → 布局塌陷叠印）→ `.tl`→`.term-line`/`.term-row` 改名 +
  显式 block + TitleBar `.tl` 作用域化 → build + 几何测量 + 亲自读图三重验收通过
