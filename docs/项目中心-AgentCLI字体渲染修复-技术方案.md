# 项目中心 · Agent CLI 字体渲染修复 —— 技术方案

> 创建日期：2026-10-22
> 更新日期：2026-10-22

## 1. 问题现象

鹿鹿子大王反馈：**项目中心 → 详情页 → 格 3「Agent CLI」（TerminalPane）内容是乱码**。

预期效果：Agent CLI 终端样式，完整展示 agent 思考、执行命令、调用工具、读写文件的详细流程，行列整齐可读。

## 2. 诊断结论

### 2.1 DOM 内容无乱码

Playwright 提取 `.terminal-pane` 全部文本：中文、命令、路径、工具调用均正常（`git fetch…`、`npm test…`、`fs(write) -- …` 等轨迹完整）。**乱码不在数据层**。

### 2.2 根因：字体栈在 Linux 全部缺失 → 回退导致字宽失衡

`.term-body` 的 `font-family: 'SF Mono', Menlo, Consolas, 'Courier New', monospace` 在 Linux 环境全部不可用，fontconfig 回退：

- ASCII/数字/符号 → **DejaVu Sans Mono**（6.625px/字 @11px）
- 中文 → 逐字形二级回退到 **CJK 字体**（11px/字，非终端等宽字体）

实测中英字宽比 = **1.66 : 1**（终端网格要求 2 : 1）：

| 字符串 | 原栈（回退后） | Noto Sans Mono CJK SC |
|---|---|---|
| `宽度测试ABC123中文` | 106px | 99px |
| `ABCDEFGHIJKL` | 79px | 66px |

混合行每个中文字符比 2 个 ASCII 格少 2.25px，累计 10 个中文错位 ≈ 22.5px（约 3.4 个 ASCII 格），且 CJK 用比例字体渲染时基线/字宽与 ASCII 等宽字体不齐 —— 表现为**行错位、列对不齐、中英文字挤成一团**的「乱码」观感。

### 2.3 本机可用修复字体

`Noto Sans Mono CJK SC`（NotoSansCJK-Regular.ttc）已安装：ASCII 5.5px、CJK 11px，**精确 2:1 等宽对齐**，中英文统一在同一字体渲染，基线一致。

## 3. 修复方案

### 3.1 字体栈补充 CJK 等宽回退（核心，一行 CSS）

`TerminalPane.css` 中 `.term-body`：

```css
font-family: 'SF Mono', Menlo, Consolas, 'Courier New',
             'Noto Sans Mono CJK SC', 'Noto Sans Mono CJK TC', monospace;
```

- macOS/Windows 用户零影响（SF Mono/Menlo 优先命中）
- Linux 回退到 Noto Sans Mono CJK SC，中英文同字体、2:1 等宽、基线一致
- 系统无该字体时最终仍回退 generic monospace（行为与现状一致，不会更差）

### 3.2 联动排查同类隐患（同一根因的面）

项目中所有 mono 场景统一补 CJK 回退，避免其他格子未来出现同类问题：

| 文件 | 作用 |
|---|---|
| `TerminalPane.css` `.term-body` | 格 3 Agent CLI 终端（本次主诉） |
| `ChatMessage.css` 结果块/代码片段 | 格 2 会话消息 mono 元素 |
| `ProjectCenter.css`（若有 mono 样式） | 代码审查文件:行号、安全审查代码片段 |
| `App.css` 全局（若有 mono 定义） | 全局兜底 |

以 grep `font-family` 中的 mono 字体栈为准，逐一核对补齐。

### 3.3 验证方式

1. `npm run build` 通过（tsc 无错误）
2. Playwright 打开页面 → 项目中心 → loomweb 详情页：
   - 截图格 3：确认中文行与命令行对齐、无错位
   - `page.evaluate` 测量 `.term-body` 下中英字符串宽度比 ≈ 2:1
   - 对比修复前后截图（修复前 `tmp/cli-diag-pane.png`）
3. auto 会话（sess1 运行中）与 manual 会话（sess4 结算页灰度）各验证一次

## 4. 影响面评估

- 改动范围：**纯 CSS，1 个文件 1 处核心修改**（联动文件以 grep 结果为准）
- 风险：无逻辑改动；macOS/Windows 字体优先级不变；最坏情况回退 generic monospace 与现状持平
- 不动数据结构（TerminalLog）、不动渲染组件（TerminalPane.tsx）

## 5. 后续（可选，本次不做）

- 若需更严格的终端观感（网格对齐、tab 渲染），可评估 `white-space: pre` + 逐行布局，当前 flex 行结构已可读，暂不需要
