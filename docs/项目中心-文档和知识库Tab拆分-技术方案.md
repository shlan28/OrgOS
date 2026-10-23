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
- 「记忆规则」btn 加在记忆条目分组标题右侧、**「+ 手动添加」左边**（顺序：记忆规则 · + 手动添加 · 清理过期）
- 弹窗为**左右结构**：左侧一列小标题（自动收集 / 收集规则 / 保留策略 / 反思规则），右侧显示当前选中项的具体内容
- **左侧导航可点击切换**右侧内容（四项互斥显示，草稿跨切换保持）；选中项浅灰底高亮
- 弹窗**尺寸固定 640×560**（不随右侧内容增减变化；右/左区内滚动）；收集规则 textarea **288px**（原 72px 的 4 倍）
- 弹窗底部「取消 / 保存」：保存一次性写回 `memorySettings`；表单校验（保留天数 1–3650）与原行内编辑一致
- **Esc / 点遮罩 / × 均可关闭**（与 FormModal 一致的 macOS 标准交互）
- 面板本体只留记忆条目列表（更聚焦），行内编辑交互随设置区一并移入弹窗

### 3.4 数据层

`projects.ts` 新增 `DocLibrary` 类型（`{ folders: KbFolder[]; docs: KbDoc[] }`，与项目知识库同构）与 `createEmptyDocLibrary()` 工厂；`Project` 增 `documents: DocLibrary` 字段（「文档」子 tab 数据源）；loomweb / yigou-app 补 Mock 文档数据，data-pipeline 用空库。`Knowledge` / `SpecDoc` / memories / memorySettings 结构零改动。

### 3.5 文档/知识库双栏布局修复（实施中发现）

`KnowledgePanel.css`：`.kb-tree` 由 `flex-shrink: 0` 固定 200px 改为 `flex: 0 1 200px`（窄格可收缩）+ `overflow: auto`；`.kb-main` 增 `min-width: 220px`（右栏保底可读）；分组标题与「+ 导入」btn 加 `white-space: nowrap`（窄格不竖排折行）。修复后 1280 视口下右栏 220px、标题单行、文档行标题完整。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/components/ProjectDetail.tsx` | `TAB_ITEMS` 9 项：knowledge 改名「文档和知识库」+ 新增 `memory`「记忆」（BrainIcon）；`NavKey` 加 `'memory'`；`renderPanel` 加 memory 分支并给 KnowledgePanel 传 documents |
| `src/components/project-detail/KnowledgePanel.tsx` | 重构为轻壳：分段「文档 / 项目知识库」→ 复用 `DocLibraryView` |
| `src/components/project-detail/DocLibraryView.tsx` | 新建：原 KbSegment 抽象的共享库视图（目录树 + 文档列表 + 导入/预览/编辑），文档与知识库两子 tab 同构复用 |
| `src/components/project-detail/MemoryPanel.tsx` | 新建：记忆 tab 独立面板（记忆条目 CRUD + 「记忆规则」弹窗） |
| `src/components/project-detail/MemoryPanel.css` | 新建：记忆面板 + 记忆规则弹窗（左右结构/固定尺寸）样式 |
| `src/components/project-detail/KnowledgePanel.css` | 双栏布局修复（见 3.5）；记忆段样式迁往 MemoryPanel.css |
| `src/components/icons/index.tsx` | 新增 `BrainIcon`（记忆 tab 图标） |
| `src/data/projects.ts` | `DocLibrary` 类型 + `Project.documents` + 两项目 Mock 文档数据 + 空库工厂 |
| `README.md` + 本文档 | 说明与历史更新记录 |

## 5. 验证结果（已实施完成）

1. `npm run build` 通过（tsc 类型检查）
2. Playwright（loomweb 详情页，1280×720）：
   - 格 4 tab 条 9 项含「文档和知识库」「记忆」（顺序：项目规范/代码/文档和知识库/记忆/工作流/自动化统计/代码审查/安全审查/测试）；两 tab 均可关闭（×）与 ＋ 菜单重开
   - 「文档和知识库」内部分段切换「文档 / 项目知识库」正常：文档段显示 documents Mock（产品/研发流程目录 + 3 篇），知识库段显示原 knowledge 数据（架构/组件设计/接口），互不影响
   - 文档/知识库：目录树过滤、导入弹窗、预览二级页、返回列表回归正常
   - 记忆 tab：条目列表 + 生命周期徽标 + 展开删除 + 手动添加/清理过期回归正常；记忆规则弹窗：左侧导航点击切换右侧内容（四态互斥、草稿保持、天数改 60 保存后重开回填 60）、弹窗高度四态恒定 560px、收集规则 textarea 288px、Esc/遮罩/× 关闭
3. 亲自读图复核三组截图（tab 拆分 / 文档双栏修复 / 记忆规则弹窗）：无错位、叠印、截断

> 实施备注：期间出现「记忆规则弹窗样式丢失」现象，根因是 Vite dev server 模块图缓存了「MemoryPanel.css 不存在」的失败解析（组件以临时名写入后 mv 重命名触发），HMR 不再注入新 CSS；`rm -rf node_modules/.vite` 重启 dev server 即恢复，代码与构建产物始终正确。

## 6. 待确认项（已全部由鹿鹿子大王拍板）

1. 「文档」子 tab：复用项目知识库样式（`documents` 独立数据 + `DocLibraryView` 同构视图；「项目规范」tab 保留，tab 总数 9 项）
2. 「记忆」tab 图标：大脑线框 `BrainIcon`
3. 排列位置：原「知识记忆」位置（代码后、工作流前），记忆紧跟其后

## 7. 历史更新说明

- 2026-10-23：初稿（方案待确认）→ 鹿鹿子大王拍板三点（文档子 tab 复用知识库样式 / 大脑 icon / 位置不变）→ 实施完成：格 4 9 tab + DocLibraryView 共享库视图 + documents Mock + 记忆规则弹窗四轮迭代（收进弹窗 → 左导航可点击切换 → textarea 288px → 弹窗固定 640×560 + Esc 关闭）；附带修复文档/知识库双栏窄格挤压；Playwright 全项验证 + 亲自读图复核 PASS
