# 「项目ADE · 关联ADE 按钮」功能 - 技术方案

> 创建日期：2026-09-05
> 更新日期：2026-09-05

## 1. 背景与目标

项目中心 → 项目详情 → **项目ADE** 面板（`AgentsPanel.tsx`）目前接入 ADE 只有「+ 申请专属ADE」（新建专属 ADE）一条路径。真实产品中还存在「关联已有 ADE」的场景：用户在个人中心已创建过 ADE，可直接把现成的 ADE 关联到本项目，无需重复申请。

本次在面板**右上角增加一个「关联ADE」按钮**，点击弹出弹窗选择已有 ADE 完成关联。

## 2. 现状梳理（读代码结论）

- `AgentsPanel.tsx`：顶部 `SegmentedControl`（接入的 ADE / ADE 个性化）独占一行；段一 `AgentsSegment` 由 `Section`（分组「接入的 ADE（N 个）」+ action「+ 申请专属ADE」）+ 行列表构成；
- 行内布局参照：`SecurityPanel.css` 的 `.security-seg`（分段行容器）与详情页头部 `detail-header-right`（右侧操作按钮组）；
- `Section` 的 `action` 是分组标题行右侧区域，**不是面板右上角**；
- `AdeAgent` 数据模型含 `linkedProject`（关联项目）字段；面板 Props 目前只有 `agents` / `onUpdateAgents`，不知道当前项目名；
- 新建类操作统一走 `FormModal`（居中弹窗），下拉用 `field-select`。

## 3. 交互设计

```
项目ADE 面板
├─ 顶行（.agents-head，flex 两端对齐）：
│   ├─ 左：SegmentedControl（接入的 ADE / ADE 个性化）      ← 现有，不动
│   └─ 右：「关联ADE」按钮（text-btn，右上角）                ← 新增
│
├─ 段一「接入的 ADE」：不变（Section + 申请专属ADE + 行列表）
└─ 段二「ADE 个性化」：不变
```

### 3.1 按钮位置

- 放在**面板顶行右侧**（分段控件同一行、右对齐），对齐「右上角」直觉；与段切换联动（两个段都可见该按钮，因段二芯片列表同样受益于新关联的 ADE）；
- 样式复用 `.text-btn`（同「+ 申请专属ADE」「编辑」按钮），不引入新按钮体系。

### 3.2 「关联ADE」弹窗（FormModal，与全站新增类操作统一）

| 字段 | 控件 | 说明 |
|---|---|---|
| 选择 ADE \* | `field-select` 下拉 | 可选项 = Mock 目录中**未接入本项目**的 ADE（按名称去重，已接入的排除） |
| 角色 | `field-input` 输入 | 可空，占位「研发工程师/测试工程师…」，缺省取该 ADE 目录预置角色 |

- 未选择 ADE 时「关联」按钮禁用；
- 可选 ADE 为空（目录全部已接入）时：下拉只显示占位项「暂无可关联的 ADE」，弹窗内附一行灰色提示「已有 ADE 均已接入，可在「接入的 ADE」中申请专属 ADE」，确认按钮保持禁用；
- 确认后：
  - 新 ADE 行插入 `agents` 列表（置顶，突出刚关联的）；
  - `linkedProject` 设为**当前项目名**（区别于「申请专属ADE」默认「不关联项目」）；其余字段取目录预置值（模型/多模态模型/知识库/工具开关/adeMd）；
  - `status: '空闲'`、`currentTask: ''`；
  - 弹窗关闭，表单重置；
- 取消 / × / Escape / 点遮罩关闭不生效变更（FormModal 现有能力）。

### 3.3 与「+ 申请专属ADE」的语义区分

| | 申请专属ADE | 关联ADE |
|---|---|---|
| 来源 | 新建一个 ADE | 从已有 ADE 目录（模拟个人中心「我的 ADE」）选择 |
| 名称 | 用户输入 | 目录预置，不可改 |
| 模型等配置 | 默认值（GLM-glm-5.3 / 工具全关） | 沿用该 ADE 已有配置 |
| linkedProject | 不关联项目 | 当前项目 |

## 4. 数据模型变更（`src/data/projects.ts`）

新增 Mock 目录常量（不动 `AdeAgent` 接口本身）：

```ts
/** 可关联的 ADE 目录（模拟个人中心「我的 ADE」已有列表，关联弹窗下拉用） */
export interface AdeCatalogItem {
  /** ADE 名称（去重键） */
  name: string
  /** 预置角色 */
  role: string
  /** 大模型底座 */
  model: string
  /** 多模态模型 */
  multimodalModel: string
  /** 协作模型（空 = 未选择） */
  collabModel: string
  /** 个人知识库 */
  knowledgeBases: string[]
  /** MCP 服务 */
  mcpServices: string[]
  /** ADE.md 个性化内容 */
  adeMd: string
  /** 工具开关 */
  tools: Record<string, boolean>
}

export const ADE_AGENT_CATALOG: AdeCatalogItem[] = [ …4~5 条 Mock 数据… ]
```

Mock 目录建议：研发工程师ADE、测试工程师ADE、运维工程师ADE、数据工程师ADE、文档工程师ADE（覆盖不同角色，便于演示去重逻辑——研发/测试与 loomweb 已有 ADE 同名，会被排除，验证去重生效）。

## 5. 组件变更

### 5.1 `AgentsPanel.tsx`

1. 顶行改为 flex 容器 `.agents-head`：左 `SegmentedControl` + 右「关联ADE」`text-btn`；
2. 新增关联弹窗 state：`linking`（开关）、`linkForm`（adeName / role）；
3. `AgentsPanel` 增加 prop `projectName: string`（写 `linkedProject` 用），由 `ProjectDetail.tsx` 的 `renderPanel()` 传入 `project.name`；
4. `handleLink()`：按名称在目录中取条目 → 组装 `AdeAgent`（id `a{Date.now()}`、状态空闲）→ `onUpdateAgents([a, ...agents])` 置顶插入；
5. 弹窗内可选列表 = `ADE_AGENT_CATALOG` 过滤掉 `agents` 中已有同名项；打开时默认预选第一个可选项（对齐 CodePanel「添加仓库」弹窗的预选体验）。

### 5.2 `AgentsPanel.css`

新增：

```css
.agents-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
```

### 5.3 `ProjectDetail.tsx`

`case 'agents'` 分支补传 `projectName={project.name}`。

## 6. 文件清单

| 操作 | 文件 |
|---|---|
| 修改 | `src/data/projects.ts`（新增 `AdeCatalogItem` 类型 + `ADE_AGENT_CATALOG` 目录） |
| 修改 | `src/components/project-detail/AgentsPanel.tsx`（顶行布局 + 关联弹窗 + 置顶插入） |
| 修改 | `src/components/project-detail/AgentsPanel.css`（`.agents-head`） |
| 修改 | `src/components/ProjectDetail.tsx`（传 `projectName`） |
| 修改 | `loom-ui-mock/README.md`（项目ADE 描述补「关联ADE」，更新日期） |
| 修改 | 本文档（实施后如有偏差更新） |

## 7. 实施步骤

1. `projects.ts` 新增类型与 Mock 目录；
2. `AgentsPanel.tsx` 顶行布局改造 + 关联弹窗逻辑；
3. `ProjectDetail.tsx` 传参；
4. `npm run build` 验证（TS 类型 + 构建通过）；
5. 更新 README 与本方案文档的更新日期；
6. git commit。

## 8. 验收标准

1. 项目ADE 面板右上角出现「关联ADE」按钮，两个分段下均可见；
2. 点击弹出居中弹窗：下拉仅列出未接入的 ADE（loomweb 中不出现「研发工程师ADE / 测试工程师ADE」同名项）；角色可空；未选择时确认禁用；
3. 可选项为空时显示占位与提示文案，确认禁用；
4. 确认后新 ADE 置顶出现在「接入的 ADE」列表，副标题含目录预置模型名，`linkedProject` 为当前项目名；段二出现对应芯片，可编辑 ADE.md；
5. 「+ 申请专属ADE」原有流程不受影响；
6. `npm run build` 通过；提交 commit。

## 9. 方案确认点（请鹿鹿子大王确认）

1. **按钮位置**：放在分段控件同一行右侧（面板右上角），两个分段下常驻 —— 而非仅段一分组标题行；
2. **语义**：「关联ADE」= 从已有 ADE 目录选择接入（Mock 模拟个人中心已有 ADE），与「申请专属ADE」（新建）并存；
3. **插入位置**：关联后置顶（突出刚关联项），而非追加尾部；
4. **目录去重**：按 ADE 名称与已接入列表去重（Mock 名称即唯一键）。
