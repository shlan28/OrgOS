# 「项目ADE 设置」功能 - 技术方案

> 创建日期：2026-08-28
> 更新日期：2026-08-28

## 1. 背景与目标

参考织灵 Web 端「个人中心 → 我的ADE」两处截图，为 `loom-ui-mock` 的**项目ADE 面板**补全 ADE 设置能力：

1. **ADE 配置弹窗**（截图 16.57.40）：表单字段（ADE 名称/关联项目/大模型底座/多模态模型/协作模型/个人知识库/MCP 服务）+ 工具开关区（7 个工具卡片）；
2. **ADE 个性化**（截图 16.57.46）：ADE 芯片切换 + `ADE.md` Markdown 编辑器（模板占位）+ 取消/保存。

面板顶部增加分段切换「**接入的 ADE / ADE 个性化**」（复用知识记忆面板的 `SegmentedControl` 模式，对应真实产品的「我的 ADE / ADE 个性化」两页签）。

## 2. 截图内容还原清单

### 2.1 ADE 配置弹窗（截图 16.57.40）

| 截图元素 | 落地方式 |
|---|---|
| 标题栏：机器人图标 + ADE 名称 + 关闭 × | 弹窗头部（RobotIcon + 名称 + ×） |
| ADE 名称 \*（必填红星） | 输入框，为空时「确定」禁用 |
| 关联项目（下拉） | 选项：不关联项目 / loomweb / 翼构移动应用 |
| 大模型底座 \*（必填红星） | 下拉：GLM-glm-5.3 / qwen3.8-max / qwen3-max |
| 多模态模型（下拉） | 下拉：kimi/kimi-k3 / qwen3-vl-plus / GLM-glm-5.3v |
| 协作模型（下拉，占位「请选择协作模型」） | 下拉，默认空 |
| 个人知识库（多选，标签「1 ✕」样式） | 新增通用多选组件 MultiSelect（标签 + 勾选菜单） |
| MCP 服务（下拉，占位「请选择MCP服务」） | MultiSelect，默认空 |
| 工具开关标题 + 说明「关闭后，工具不可用，可优化上下文，节省Token用量」 | 标题行 + 灰色说明（「优化」「节省」蓝色高亮） |
| 标签页：全部 7 / 内置工具 5 / IM渠道 2 | 胶囊标签页，选中高亮，过滤下方卡片 |
| 右侧：已开启 1 / 7 + 全部开启（蓝）+ 全部关闭（灰） | 实时统计 + 两个文字链接 |
| 内置工具卡片：GitLab/Jenkins/禅道/Jira/Confluence + 开关 | 两列卡片网格，彩色字母徽标 + Toggle |
| IM 卡片：飞书/企业微信 +「尚未配置凭证」（橙）+「去配置 ›」（蓝） | 卡片带警示副标题 + 链接（Mock 无跳转） |
| 底部：取消 / 确定 | 右对齐；左侧放红色「移除」（承接原行内编辑的移除入口） |

### 2.2 ADE 个性化（截图 16.57.46）

| 截图元素 | 落地方式 |
|---|---|
| ADE 芯片（🤖 名称，选中高亮） | 每个 ADE 一个芯片（RobotIcon + 名称），点击切换编辑对象 |
| ADE.md \*（必填红星）标签 | 字段标签 + 红星 |
| Markdown 编辑器（模板占位，可滚动） | 等宽字体 textarea，占位模板见 §3.4 |
| 底部：取消 / 保存 | 未保存提示 + 取消还原草稿 + 保存写入（无修改或内容为空时禁用） |

## 3. 信息架构与交互

### 3.1 面板分段

```
项目ADE 面板
├─ 分段控件：[ 接入的 ADE | ADE 个性化 ]（默认选中「接入的 ADE」）
│
├─ 段一「接入的 ADE」（现有列表 + 增强）：
│   ├─ 分组「接入的 ADE（N 个）」+「+ 申请专属ADE」（不变）
│   └─ ADE 行：点击 → 弹出「ADE 配置」弹窗（替代原行内编辑）
│       （工作中 ADE 行不可点击，title 提示「工作中的 ADE 不可修改」——沿用现状）
│
└─ 段二「ADE 个性化」（新增）：
    ├─ ADE 芯片行：全部 ADE 的芯片，选中态高亮，点击切换
    ├─ ADE.md 编辑器（标签 + 红星 + textarea + 模板占位）
    └─ 底部：未保存提示 + 取消 / 保存
```

### 3.2 ADE 配置弹窗交互

- **打开**：段一点击空闲 ADE 行；
- **编辑**：所有字段先改草稿 state，点「确定」一次性保存并关闭；「取消」/ × / 点遮罩关闭不保存；
- **必填**：ADE 名称、大模型底座带红色星号；名称为空时「确定」禁用（大模型底座为下拉恒有值）；
- **工具开关**：
  - 标签页（全部 7 / 内置工具 5 / IM渠道 2）仅过滤展示，计数固定；
  - 「已开启 x / 7」实时统计开启数；
  - 「全部开启 / 全部关闭」作用于全部 7 个工具（不受当前标签页过滤影响）；
  - IM 卡片（飞书/企业微信）显示橙色「尚未配置凭证」+ 蓝色「去配置 ›」（Mock 无跳转），开关可正常切换；
- **移除**：弹窗底部左侧红色「移除」文字按钮，点击直接移除该 ADE 并关闭（Mock 不做二次确认，与现有各面板一致）；
- **保存后联动**：行副标题「角色 · 大模型底座 · 当前：…」随保存结果刷新。

### 3.3 ADE 个性化交互

- 芯片切换选择当前编辑的 ADE（切换时草稿重置为该 ADE 已保存内容，Mock 不做未保存拦截）；
- 编辑器为草稿模式：「保存」写入 `adeMd`；「取消」还原；无修改或内容为空时「保存」禁用，有修改时左侧显示「有未保存的修改」；
- **工作中 ADE 也可编辑 ADE.md**（文档配置不影响运行中任务；配置弹窗仍受工作中限制）；
- 无 ADE 时显示空状态：「暂无 ADE，请先在「接入的 ADE」中申请」。

### 3.4 ADE.md 模板占位（逐字取自截图）

```
## 你是谁
写清楚这个 Agent 的身份、角色或人设。

例如：
你是一个温柔但直接的学习伙伴，擅长帮我拆解复杂问题。

## 你能做什么
写清楚这个 Agent 主要帮用户完成什么事。

例如：
- 帮我整理想法
- 陪我练习表达
- 提醒我重要事项
- 在我犹豫时给出建议

## 你应该怎么说话
写清楚语气、风格和表达方式。

例如：
- 说话简洁
- 不要太官方
```

## 4. 数据模型变更（`src/data/projects.ts`）

```ts
export interface AdeAgent {
  id: string
  name: string
  role: string
  model: string                  // 大模型底座
  status: '工作中' | '空闲'
  currentTask: string
  /* —— 新增 —— */
  linkedProject: string          // 关联项目（'不关联项目' | 项目名）
  multimodalModel: string        // 多模态模型
  collabModel: string            // 协作模型（空 = 未选择）
  knowledgeBases: string[]       // 个人知识库（多选）
  mcpServices: string[]          // MCP 服务（多选）
  adeMd: string                  // ADE.md 个性化内容
  tools: Record<string, boolean> // 工具开关（key 见 ADE_TOOLS）
}

/** 工具目录（内置工具 5 + IM渠道 2） */
export interface AdeTool {
  id: string
  name: string
  group: 'builtin' | 'im'
  color: string    // 徽标底色
  badge: string    // 徽标字符
  credentialReady?: boolean  // IM 渠道凭证状态（false = 尚未配置）
}

export const ADE_TOOLS: AdeTool[] = [
  { id: 'gitlab',     name: 'GitLab',     group: 'builtin', color: '#fc6d26', badge: 'G' },
  { id: 'jenkins',    name: 'Jenkins',    group: 'builtin', color: '#d24939', badge: 'J' },
  { id: 'zentao',     name: '禅道',       group: 'builtin', color: '#0fb8b0', badge: '禅' },
  { id: 'jira',       name: 'Jira',       group: 'builtin', color: '#2684ff', badge: 'J' },
  { id: 'confluence', name: 'Confluence', group: 'builtin', color: '#1d63d6', badge: 'C' },
  { id: 'feishu',     name: '飞书',       group: 'im', color: '#3370ff', badge: '飞', credentialReady: false },
  { id: 'wecom',      name: '企业微信',   group: 'im', color: '#0082ff', badge: '企', credentialReady: false },
]

export const ADE_LLM_BASES          = ['GLM-glm-5.3', 'qwen3.8-max', 'qwen3-max']
export const ADE_MULTIMODAL_MODELS  = ['kimi/kimi-k3', 'qwen3-vl-plus', 'GLM-glm-5.3v']
export const ADE_COLLAB_MODELS      = ['qwen3-max', 'GLM-glm-5.3', 'kimi/kimi-k3']
export const ADE_KNOWLEDGE_BASES    = ['研发规范库', '产品需求库', '运维手册']
export const ADE_MCP_SERVICES       = ['代码仓库 MCP', '浏览器 MCP', '数据库 MCP']
export const ADE_LINKED_PROJECTS    = ['不关联项目', 'loomweb', '翼构移动应用']
```

现有 Mock 数据（loomweb 2 个 ADE、翼构移动应用 1 个 ADE）补全新字段：翼构类 ADE 默认 `tools: { gitlab: true, 其余 false }`、`knowledgeBases: ['研发规范库']`、`adeMd` 填入示例内容；「申请专属ADE」新建的 ADE 取默认值（不关联项目 / kimi/kimi-k3 / 协作模型空 / 知识库空 / MCP 空 / 工具全关 / adeMd 空）。

## 5. 组件设计

### 5.1 新增 `src/components/MultiSelect.tsx` + `.css`（通用多选下拉）

- 触发器：`field-select` 同款外观，内部显示已选项标签（`名称 ✕`，点 ✕ 移除）或占位文字 + 下拉箭头；
- 菜单：选项列表带勾选标记，点击切换选中（菜单保持打开），点击外部关闭；
- Props：`options / value / onChange / placeholder`；后续其他面板可复用。

### 5.2 新增 `src/components/project-detail/AdeSettingsModal.tsx` + `.css`（ADE 配置弹窗）

- 结构参照 `RunModal`（遮罩 + 680px 圆角容器 + 头部/可滚动主体/底部），浅色风格；
- 头部：RobotIcon + ADE 名称 + 关闭 ×；
- 主体上部：**两列表单网格**（字段顺序）：

  | 左列 | 右列 |
  |---|---|
  | ADE 名称 \*（输入） | 角色（输入） |
  | 关联项目（下拉） | 大模型底座 \*（下拉） |
  | 多模态模型（下拉） | 协作模型（下拉） |
  | 个人知识库（MultiSelect） | MCP 服务（MultiSelect） |

- 主体下部：**工具开关区**（标题 + 说明 / 标签页 + 统计与全开全关 / 分组小标题 + 两列卡片网格）；
- 底部：左红色「移除」+ 右「取消」「确定」。

### 5.3 改造 `AgentsPanel.tsx` + `.css`

- 顶部加 `SegmentedControl`（接入的 ADE / ADE 个性化，切换滚动回顶，同知识记忆面板）；
- 段一：移除行内编辑逻辑，行点击改为打开 `AdeSettingsModal`（草稿在弹窗内部管理）；
- 段二：芯片行 + ADE.md 编辑器 + 保存/取消（样式参照 SpecsPanel 编辑模式）；
- 「申请专属ADE」弹窗不变，新建时补默认字段。

## 6. 文件清单

| 操作 | 文件 |
|---|---|
| 修改 | `src/data/projects.ts`（AdeAgent 扩展 + 常量 + Mock 数据） |
| 新增 | `src/components/MultiSelect.tsx` / `MultiSelect.css` |
| 新增 | `src/components/project-detail/AdeSettingsModal.tsx` / `AdeSettingsModal.css` |
| 修改 | `src/components/project-detail/AgentsPanel.tsx` / `AgentsPanel.css` |
| 修改 | `docs/项目中心-技术方案.md`（④ 节 + 验收标准 + 文件树，更新日期） |
| 修改 | `loom-ui-mock/README.md`（功能描述，更新日期） |

## 7. 实施步骤

1. `projects.ts`：扩展类型 + 常量 + 补全 3 个项目的 Mock ADE 数据；
2. 新增 `MultiSelect` 组件；
3. 新增 `AdeSettingsModal` 组件（表单 + 工具开关 + 底部操作）；
4. 改造 `AgentsPanel`（分段 + 弹窗接入 + 个性化段）；
5. `npm run build` 验证；
6. 更新技术方案文档与 README；
7. 提交 git commit。

## 8. 验收标准

1. 项目ADE 面板顶部出现「接入的 ADE / ADE 个性化」分段控件，默认选中「接入的 ADE」，切换正常、滚动回顶；
2. 段一：点击空闲 ADE 行弹出「ADE 配置」弹窗；工作中 ADE 行不可点击且有提示；「+ 申请专属ADE」流程不变（新 ADE 带默认配置）；
3. 弹窗表单两列布局、字段齐全（名称\*/角色/关联项目/大模型底座\*/多模态模型/协作模型/个人知识库/MCP 服务）；名称为空时「确定」禁用；保存后行副标题模型名联动刷新；
4. 工具开关：三个标签页计数与过滤正确；「已开启 x / 7」实时统计；「全部开启/全部关闭」生效；IM 卡片显示「尚未配置凭证」（橙）+「去配置 ›」（蓝）；
5. 弹窗底部「移除」可移除 ADE 并关闭弹窗；
6. 段二：芯片切换正常；ADE.md 编辑器带模板占位；「保存/取消/未保存提示」正确；保存后切换芯片再切回内容保留；
7. 构建通过，代码提交 commit。

## 9. 方案确认点（请鹿鹿子大王确认）

1. **落点**：做在「项目中心 → 项目详情 → 项目ADE」面板内（分段切换），而非独立的全局「我的ADE」页面 —— 与当前 Mock 结构一致；
2. **行内编辑移除**：原「点击行展开角色/模型行内编辑」被配置弹窗取代（弹窗含完整编辑能力），「移除」入口移入弹窗底部；
3. **「角色」字段保留**：截图表单无「角色」，为保留现有能力将其纳入弹窗表单（补齐两列网格）；
4. **ADE.md 编辑不受工作中限制**：配置弹窗仅空闲 ADE 可开，ADE.md 所有 ADE 均可编辑。

## 10. 风险与说明

- 纯 Mock：「去配置 ›」无跳转、工具开关不产生真实效果、凭证状态固定为「尚未配置」；
- 多选下拉为新增通用组件，样式与现有 `field-select` 一致；
- 弹窗内容较多（表单 + 7 张工具卡片），主体区可滚动，最大高度 `min(720px, 85vh)`。
