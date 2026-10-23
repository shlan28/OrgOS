# 项目中心 · 文档和知识库 Tab 拆分 —— 技术方案

> 创建日期：2026-10-23
> 更新日期：2026-10-23（实施完成 + **追加需求**：记忆 tab 规则设置区收进「记忆规则」弹窗——左右结构（左小标题 / 右内容），「记忆规则」btn 放「手动添加」左边）

## 1. 需求

鹿鹿子大王：在详情页格 4（工作流 tab 区）——

1. **记忆单独拿出来做一个新的 tab**（顶级 tab「记忆」）；
2. 原「知识记忆」tab **改名为「文档和知识库」**，内部 2 个子 tab：**「文档」** 和 **「项目知识库」**。

## 2. 现状

| 项 | 现状 | 差距 |
|---|---|---|
| 格 4 tab | `TAB_ITEMS` 8 项：项目规范 / 代码 / **知识记忆** / 工作流 / 自动化统计 / 代码审查 / 安全审查 / 测试 | 无独立「记忆」tab；knowledge tab 名不对 |
| KnowledgePanel | 顶部 `SegmentedControl` 分段：`kb`（项目知识库）/ `memory`（记忆） | 记忆需拆出；分段项要改为「文档 / 项目知识库」 |
| KbSegment | 左目录树 + 右文档列表（导入/预览/编辑/删除） | 原样保留，作为「项目知识库」子 tab |
| MemorySegment | 设置区（自动收集/收集规则/保留策略/自动反思）+ 记忆条目 CRUD | 原样迁出为独立 tab 内容 |
| 项目规范 tab（specs） | `SpecsPanel`：搜索 + 规范文档列表（提示词开关）+ 预览/编辑 | 与「文档」子 tab 定位重叠（见待确认项） |
| 数据 | `Project.knowledge`（folders/docs/memories/memorySettings）+ `Project.specs` | **不变**，纯 UI 层重组 |

## 3. 方案

### 3.1 格 4 tab 层变化（ProjectDetail.tsx）

```
现在：项目规范 | 代码 | 知识记忆 | 工作流 | 自动化统计 | 代码审查 | 安全审查 | 测试
改后（推荐 A）：代码 | 文档和知识库 | 记忆 | 工作流 | 自动化统计 | 代码审查 | 安全审查 | 测试
```

- `{ key: 'knowledge', label: '文档和知识库', icon: BookIcon }`（原「知识记忆」改名，icon 不换）
- **新增** `{ key: 'memory', label: '记忆', icon: BrainIcon }`（icons 新增大脑线框图标）
- `NavKey` 类型加 `'memory'`；`renderPanel` 加 `case 'memory'`
- tab 可关闭/重开/＋菜单机制零改动（`ClosableTabs` 是通用组件，数据驱动）

### 3.2 「文档和知识库」面板（KnowledgePanel 重构）

- 顶部分段切换改为：**「文档」 / 「项目知识库」**（复用 `SegmentedControl`）
- **项目知识库**子 tab = 现 `KbSegment` 原样（目录树 + 文档列表）
- **文档**子 tab 内容 **待确认**（见第 6 节）：
  - 方案 A（推荐）：迁入现「项目规范」文档（`SpecsPanel` 内容：搜索 + 文档列表 + 提示词开关 + 预览/编辑），格 4 移除「项目规范」顶级 tab
  - 方案 B：「文档」为全新独立文档列表（Mock 新结构），「项目规范」tab 保留不动

### 3.3 「记忆」tab（新组件 MemoryPanel.tsx）

- `MemorySegment` 原样迁出为 `src/components/project-detail/MemoryPanel.tsx`
- props 不变：`knowledge: Knowledge` + `onUpdateKnowledge`
- 原 KnowledgePanel 中的记忆段代码整体搬移，逻辑零改动

**追加（2026-10-23 鹿鹿子大王）**：记忆 tab 上半部分规则设置区（自动收集开关 / 收集记忆规则 / 保留策略 / 自动反思规则）**收进「记忆规则」弹窗**：
- 「记忆规则」btn 加在记忆条目分组标题右侧、**「+ 手动添加」左边**
- 弹窗为**左右结构**：左侧一列小标题（自动收集 / 收集规则 / 保留策略 / 反思规则），右侧对应具体内容（开关 / textarea / 数字+永久+策略 / 启停+频率+自定义规则）
- 弹窗底部「取消 / 保存」：保存一次性写回 `memorySettings`；表单校验（保留天数 1–3650）与原行内编辑一致
- 面板本体只留记忆条目列表（更聚焦），行内编辑交互随设置区一并移入弹窗

### 3.4 数据层

**零改动**。`Knowledge` / `SpecDoc` 等结构与 `projects.ts` Mock 数据均不动（方案 A 下 `project.specs` 改由「文档」子 tab 消费）。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/components/ProjectDetail.tsx` | `TAB_ITEMS`：knowledge 改名 + 新增 memory 项（含方案 A 下移除 specs）；`NavKey` 加 `'memory'`；`renderPanel` 加 memory 分支（specs 分支按方案处理） |
| `src/components/project-detail/KnowledgePanel.tsx` | 重构：分段改「文档 / 项目知识库」；`MemorySegment` 迁出；`KbSegment` 保留；（方案 A）`DocsSegment` = SpecsPanel 逻辑并入或直接复用 SpecsPanel |
| `src/components/project-detail/MemoryPanel.tsx` | 新建：记忆面板（原 MemorySegment 搬移） |
| `src/components/icons/index.tsx` | 新增 `BrainIcon`（记忆 tab 图标） |
| `README.md` + 本文档 | 说明与历史更新记录 |

## 5. 验证方式

1. `npm run build` 通过（tsc 类型检查）
2. Playwright（loomweb 详情页）：
   - 格 4 tab 条出现「文档和知识库」「记忆」；记忆 tab 可切换、可关闭/重开
   - 「文档和知识库」内部分段切换「文档 / 项目知识库」两子 tab 正常
   - 项目知识库子 tab：目录树过滤/导入/预览/编辑回归正常
   - 记忆 tab：自动收集开关/规则编辑/条目增删/清理过期回归正常
3. 亲自读图：两张截图（文档和知识库 · 两个子 tab 各一张 + 记忆 tab 一张）

## 6. 待确认项（默认按方案 A 实施，如有异议请指出）

1. **「文档」子 tab 的内容来源**（关键）：
   - **方案 A（推荐）**：放入现有「项目规范」文档（README.md / AGENTS.md / 编码规范.md 这些），格 4 移除「项目规范」顶级 tab——文档类内容统一收进「文档和知识库」，tab 总数维持 8 项；
   - **方案 B**：「文档」为全新文档列表（需要鹿鹿子大王补充其内容定位），「项目规范」tab 保留，tab 总数变 9 项。
2. 「记忆」tab 图标：新增大脑线框图标（`BrainIcon`），如需换成其他样式可指出。
3. 「文档和知识库」tab 排列位置：默认放原「知识记忆」位置（代码后、工作流前）；如需调整顺序请指出。

## 7. 历史更新说明

（暂无）
