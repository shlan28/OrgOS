# 「项目中心 → 代码」tab：可编辑仓库 + 只读仓库 - 技术方案

> 创建日期：2026-08-31
> 更新日期：2026-08-31（v3：添加弹窗仓库类型置顶；仓库名/分支改为下拉联动）

## 1. 背景与目标

项目详情页「代码」tab 当前为占位面板（敬请期待）。本次需求：

- 代码 tab 需要管理**两种仓库**：
  1. **可编辑仓库**：ADE 可直接读写（提交代码）的代码仓库，是项目的开发主仓；
  2. **只读仓库**：ADE 不可写、仅作为**上下文**提供给 Agent 的仓库（如依赖的底层库、参考实现、平台 SDK 源码）。
- 两种仓库在面板中**分组展示**，各自有独立的添加入口与操作语义。

## 2. 改动设计

### 2.1 数据模型（`src/data/projects.ts`）

新增类型：

```ts
/** 代码仓库（代码 tab） */
export interface CodeRepo {
  id: string
  /** 仓库名（如 loomweb） */
  name: string
  /** 仓库类型：gitlab / svn */
  type: 'gitlab' | 'svn'
  /** 默认分支 */
  branch: string
  /** editable = 可编辑仓库；readonly = 只读仓库（仅给 Agent 提供上下文） */
  mode: 'editable' | 'readonly'
  /** 一句话说明（可编辑 = 用途；只读 = 给 Agent 提供什么上下文） */
  note: string
  /** 最近同步时间（Mock 文案） */
  syncedAt: string
}
```

`Project` 新增字段 `repos: CodeRepo[]`；`createEmptyProject` 工厂补 `repos: []`。

**Mock 数据**（loomweb 项目）：

- 可编辑仓库 2 个：`loomweb`（主仓，dev 分支）、`loomweb-docs`（文档站，main 分支）；
- 只读仓库 2 个：`loom-ui`（组件库源码——给 Agent 提供组件 API 上下文）、`platform-sdk`（平台 SDK——给 Agent 提供接口签名上下文）。

yigou-app / data-pipeline 项目给少量差异化数据（yigou-app 1 可编辑 + 1 只读；data-pipeline 空数组，验证空状态）。

### 2.2 组件（新建 `src/components/project-detail/CodePanel.tsx` + `CodePanel.css`）

**布局**：顶部分段控件（SegmentedControl，与「知识记忆」「项目ADE」面板同构）切换两种仓库，**一次只显示一组**，不上下堆叠：

```
┌─────────────┬─────────────┐
│ 可编辑仓库(2) │  只读仓库(2) │   ← SegmentedControl
└─────────────┴─────────────┘
ADE 可读取并提交代码的仓库              ← 当前组说明文案
┌────────────────────────── [+ 添加] ┐
│ 📦 loomweb      dev · 最近同步 08-31 │
│    git@gitlab…:fe/loomweb.git · 项目主仓 │
│ 📦 loomweb-docs main · 最近同步 08-30 │
└─────────────────────────────────────┘
```

切换到「只读仓库」段时：说明文案变为「仅作为上下文提供给 Agent，ADE 不可写入」，行右侧带 🔒「只读」徽标。

**交互**：

| 操作 | 说明 |
|---|---|
| 分段切换 | 「可编辑仓库 / 只读仓库」两个段，切换只影响展示过滤（`mode`），数据同存 `repos` |
| 添加（可编辑段） | FormModal 字段顺序：**仓库类型**（gitlab/svn 下拉，默认 gitlab，置顶）→ **仓库名**（下拉，选项 = 该类型下可选仓库目录，切换类型时重置）→ **默认分支**（下拉，选项 = 所选仓库的分支列表，切换仓库时重置）→ 说明 |
| 添加（只读段） | 同上字段，但说明字段占位文案为「给 Agent 提供什么上下文」；mode 固定 readonly |
| 移除 | 行右侧「移除」文字按钮（danger），点击直接移除该仓库；**仓库添加后不可编辑** |
| 行右侧 | 只读段显示 🔒 徽标（StatusBadge neutral「只读」）；类型徽标（GitLab / SVN）；分支名；同步时间 |
| 空状态 | 当前段无仓库时显示「暂无仓库」（data-pipeline 两段都空） |

**仓库目录 Mock**（`projects.ts` 导出 `CODE_REPO_CATALOG`）：按类型预置可选仓库及其分支，模拟从代码平台拉取的仓库列表：

```ts
/** 可选仓库目录（添加弹窗下拉用，Mock） */
export const CODE_REPO_CATALOG: { type: 'gitlab' | 'svn'; name: string; branches: string[] }[] = [
  { type: 'gitlab', name: 'loomweb', branches: ['dev', 'main', 'feature/login'] },
  { type: 'gitlab', name: 'loomweb-docs', branches: ['main'] },
  { type: 'gitlab', name: 'loom-ui', branches: ['main', 'v2.3.1', 'v2.2.0'] },
  { type: 'gitlab', name: 'yigou-app', branches: ['main', 'release/2.4'] },
  { type: 'svn', name: 'platform-sdk', branches: ['trunk', 'branches/2.4'] },
  { type: 'svn', name: 'pay-gateway', branches: ['trunk', 'release/2.4'] },
]
```

- 仓库名下拉选项 = `CODE_REPO_CATALOG` 中当前类型的仓库（已添加到当前段的仓库仍可选，重名校验拦截）；
- 分支下拉选项 = 所选仓库的 `branches`，默认第一项。

**校验**：仓库名必填；同组内重名拦截（弹窗内红字提示）；地址格式不强制校验（Mock）。

### 2.3 接线（`ProjectDetail.tsx`）

- `NAV_ITEMS` 中 `code` 项 `ready: true`（去掉「敬请期待」角标）；
- `renderPanel()` 增加 `case 'code'`：渲染 `<CodePanel repos={project.repos} onUpdateRepos={...} />`，写操作走统一的 `onUpdateProject`。

### 2.4 样式（`CodePanel.css`）

- `.code-panel`：纵向布局（分段控件 + 说明文案 + 列表）；
- `.code-seg-hint`：当前段说明文案（灰色，随分段切换变化，表达「可写 / 仅上下文」语义差异）；
- `.code-repo-icon`：仓库图标（FolderIcon 复用）；
- `.code-lock-badge`：只读徽标；
- `.code-type-badge`：仓库类型徽标（GitLab / SVN）；
- `.code-branch`：分支行（图标 + 分支名）；
- 其余复用 App.css 的 settings-row / field-input 体系与 SegmentedControl 组件。

### 2.5 文档更新

- `loom-ui-mock/README.md`：详情页新增「代码」面板描述，更新日期。

## 3. 实施步骤

1. `projects.ts`：新增 `CodeRepo` 类型、`Project.repos` 字段、Mock 数据、工厂函数补默认值；
2. 新建 `CodePanel.tsx` / `CodePanel.css`（分段切换 + 单组列表）；
3. `ProjectDetail.tsx`：导航 ready + case 接线；
4. `README.md` 更新；
5. `npm run build` 验证；
6. 浏览器自检：分段切换、添加（两种）、行内编辑、移除、只读徽标、空状态；
7. git commit。

## 4. 验收标准

1. 「代码」tab 不再显示「敬请期待」，进入后为分段切换面板（可编辑仓库 / 只读仓库）；
2. 添加弹窗字段顺序：仓库类型（置顶）→ 仓库名（下拉）→ 默认分支（下拉）→ 说明；
3. 仓库名选项随仓库类型联动（gitlab/svn 各自的仓库列表），分支选项随仓库名联动；
4. 仓库行**不可编辑**（无行内编辑），只能移除；
5. 分段切换时说明文案随之变化，清晰表达「可写 / 仅上下文」语义差异；
6. 同段重名拦截；data-pipeline 空状态正常；
7. 构建通过，代码提交 commit。

## 5. 风险与说明

- 纯 Mock 改动，无后端影响；
- 仓库「最近同步时间」为静态 Mock 文案，不做真实同步逻辑；
- 只读/可编辑的权限差异仅体现在 UI 语义（徽标 + 说明文案），Mock 不模拟 Agent 实际读写行为。
