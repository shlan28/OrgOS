# 项目中心 · 文档子 tab 飞书化（OAuth 导入 + 跳转）—— 技术方案

> 创建日期：2026-10-23
> 更新日期：2026-10-23（**实施完成**：原型确认 + 追加①导入弹窗改**多选**（checkbox 三态：目录全选/半选、文档单选，勾目录 = 导入其全部子文档）②文档 tab UI **对齐项目知识库 kbi 样式体系**（kbi 双栏/树/行/徽标）③icon 优化（树内目录 = 文件夹 icon、文档 = 文档 icon、导入 btn = 下载箭头）；Playwright + 读图 PASS，见第 8 节）

## 1. 需求

鹿鹿子大王：「文档和知识库」tab 的**「文档」子 tab**：

1. **去掉文档详情二级页**：文档行不再点击进预览/编辑，改为行尾一个**跳转 icon**，点击**跳转到飞书**（Mock 外链）；
2. **导入改为飞书 OAuth 个人授权流程**：授权后选择**飞书目录**导入；
3. 飞书 **App ID / App Secret** 配置加在**设置页左下角**（新增「飞书授权」设置分区）。

## 2. 现状与差距

| 项 | 现状 | 差距 |
|---|---|---|
| DocLibraryView | 文档行点击 → 预览/编辑二级页（openId/editing/draft + handleSaveDoc/handleDeleteDoc） | 移除二级页与编辑态；行尾改跳转 icon |
| 导入 | FormModal：来源(团队 wiki/GitLab/本地文件) + 地址 + 所属目录 | 改 OAuth 授权步骤弹窗（未授权 → 授权中 → 选飞书目录 → 导入） |
| 数据 | `DocLibrary.docs[].sourceRef` 无跳转语义 | 跳转 = `https://feishu.cn/wiki/{sourceRef}`（Mock 占位外链，新窗口打开） |
| 设置页 | 左导航：Agent 设置 / 邀请成员（`SettingsPage` + `settings.ts`） | 新增第三分区「飞书授权」：App ID / App Secret 表单 + 授权状态 |
| 全局联动 | — | 设置里配置的 appid/secret 与「文档」子 tab 导入弹窗联动（未配置时导入弹窗引导去设置） |

## 3. 方案

### 3.1 文档行：跳转 icon 替代详情

- 删二级页（预览/编辑两个 return 分支）与 openId/editing/draft/handleSaveDoc/handleDeleteDoc 状态
- **左侧目录树多层级**（`documents.folders` 本就支持 parentId 嵌套，渲染改为 ▸/▾ 逐层展开 + 点选过滤右栏；**飞书导入的层级路径映射为本地目录层级**，如 wiki/产品研发/移动端 → 产品研发 → 移动端 两级 folder）
- 文档行结构不变（图标 + 标题/摘要），行尾 `ChevronRightIcon` 换 **`ExternalIcon`**（⇗ 外发箭头）跳转按钮：
  - 点击 = `window.open(飞书链接, '_blank')`；整行不再可点击（hover 行仅微底色）
  - `title="在飞书中打开"`
- 链接规则：`https://feishu.cn/wiki/{sourceRef || doc.id}`（Mock；sourceRef 为空也兜底）

### 3.2 导入：飞书 OAuth 授权流程弹窗

新导入弹窗（替换原 FormModal 三字段）**分步状态机**：

```
未授权 → [去授权]（OAuth 弹窗/模拟跳转 800ms）→ 授权成功（显示授权账号）
       → 选择飞书目录（Mock 目录树：wiki/产品研发、wiki/运营、wiki/知识库…）
       → [导入]（1s 模拟解析）→ 写入 docs（source = '团队 wiki'、sourceRef = 所选目录路径）
```

- **未配置 App ID/Secret**（settings.feishu 为空）：弹窗顶部警示条「尚未配置飞书应用凭证」+ [去设置] 按钮（跳转设置页「飞书授权」分区——App 层视图切 settings + section='feishu'）
- 已配置未授权：步骤 1 授权卡（App ID 尾号脱敏显示 + [授权] 按钮 → 800ms 授权中 → 授权成功徽标）
- 已授权：步骤 2 **飞书目录树（多层级）**：还原飞书云文档目录层级——▸/▾ 折叠箭头逐层展开（产品研发 → 移动端 → 文档），目录行（飞标 icon + 名称 + 篇数）与文档行（📄）均可点选为导入目标（选中蓝描边 + radio）；选中目录 = 导入该目录全部文档
- 导入完成：新增 doc 顶插入（`source: '团队 wiki'`，`sourceRef` = 完整层级路径）；**飞书目录层级映射为本地 documents.folders 层级**（选「wiki/产品研发/移动端」目录导入 → 自动创建/复用 产品研发 → 移动端 folder 结构，文档挂到末级目录）
- **授权状态存 `UserSettings.feishu`**（App 层 state，跨项目共享：授权一次处处可用）

### 3.3 设置页：飞书授权分区（左导航第三项）

`SettingsPage` 左导航加「飞书授权」（新 `LinkIcon` 或飞书蓝图标）；新面板 `FeishuPanel.tsx`：

- **应用凭证**卡片：App ID / App Secret 输入（Secret 输入框密码态 + 显隐切换）+ [保存]（写回 `settings.feishu`）+ [清除]
- **授权状态**卡片：未授权 = [去授权]（与导入弹窗同款 800ms 授权流）；已授权 = 账号行（Mock：shilu@aicoda.tech）+ 授权时间 + [取消授权]
- 提示文案：凭证用于文档导入的个人身份授权（user_access_token），仅本人可见

### 3.4 数据层

```ts
// settings.ts 新增（UserSettings 字段）
export interface FeishuSettings {
  /** 飞书应用凭证（左下角设置页配置） */
  appId: string
  appSecret: string
  /** 个人授权状态（OAuth Mock：授权时间 + 授权账号） */
  authorized: boolean
  authorizedAccount: string   // Mock：shilu@aicoda.tech
  authorizedAt: string
}
UserSettings 增 feishu: FeishuSettings（初值：已配置 appId=cli_a3f8…（脱敏 Mock）/ 未授权）
```

- `createDefaultUserSettings()` 补 `feishu` 初值（已配凭证、未授权——演示「配置了但未授权」初始态）
- projects.ts `documents` Mock 不变（sourceRef 已是 wiki 路径样式）

### 3.5 App 层接线

- `App.tsx`：`view` 状态机 settings 分支带 `section` 定位（现有 `settingsSection` state），新增从导入弹窗「去设置」跳转：`setView settings + setSettingsSection('feishu')`
- SettingsPage 左导航 `SettingsSection` 类型加 `'feishu'`；渲染三分支

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/data/settings.ts` | `FeishuSettings` 接口 + UserSettings.feishu + 默认值 |
| `src/components/SettingsPage.tsx` | 左导航加「飞书授权」项；`SettingsSection` 加 `'feishu'` |
| `src/components/settings/FeishuPanel.tsx` | 新建：凭证配置 + 授权状态面板 |
| `src/components/project-detail/DocLibraryView.tsx` | 删二级页/编辑态；行尾跳转 icon；导入弹窗改 OAuth 流程（含未配置引导跳设置） |
| `src/components/project-detail/KnowledgePanel.tsx` | 传递 settings/跳设置回调（props 扩展）→ 转发 DocLibraryView |
| `src/components/ProjectDetail.tsx` | 转发 feishu 设置与 onGoToSettings 回调 |
| `src/App.tsx` | settings 分支支持定位 feishu section（导入弹窗「去设置」跳转） |
| `README.md` + 本文档 | 说明更新 |

## 5. 验证结果（已实施完成）

1. `npm run build` 通过
2. Playwright（loomweb 详情页，1280×720）：
   - 文档行点击无二级页（`.kb-detail/.specs-preview` 均为 0）；⇗ 点击 `window.open('https://feishu.cn/wiki/docs/prd-v3.md')` 实测捕获
   - 导入弹窗：未授权 → 授权 800ms → 已授权徽标 + 账号；**多选**：勾「移动端」目录（3 篇全选）+ 单勾「PRD v3」→ 按钮「导入所选（2 项）」、「Web 端」半选态（—）；导入 1s → 左树新增 产品研发 4 → 移动端 3 + Web 端 1、4 篇文档顶插入（sourceRef = wiki 层级路径）
   - 未配置凭证：警示条 + [去设置] → 直达设置页飞书授权分区（active nav = 飞书授权）
   - 设置页：三分区导航、凭证卡（脱敏 + 显隐）、未授权/去授权/取消授权状态流转
   - **UI 对齐**：文档 tab 复用 kbi 双栏/树/行/徽标体系（`.doclib-two-col` + `.kbi-tree` + `.kbi-row` + `.kbi-badge` + ⇗）；树内目录 = FolderIcon、文档 = DocIcon、导入 btn = DownloadIcon（下载箭头）
3. 亲自读图：文档列表 / 导入弹窗（多选 + 文件夹 icon）/ 设置面板 截图复核无错位

## 6. 待确认项（已全部由鹿鹿子大王拍板）

1. 文档行只读（⇗ 跳转）✔ 2. OAuth Mock 800ms ✔ 3. 多层级飞书目录树 ✔ 4. 「去设置」直达分区 ✔ 5. Secret 脱敏 ✔ 6. **导入多选**（checkbox 三态）✔ 7. **UI 对齐项目知识库** ✔ 8. **icon 优化**（文件夹/文档/下载箭头）✔

## 7. 历史更新说明

- 2026-10-23：方案 + 原型图 → 确认（含飞书目录层级体现 + 左树多层级）→ 实施：DocLibraryView 重构（删详情页、⇗ 跳飞书、左树多层级、OAuth 导入弹窗）+ FeishuSettings/FeishuPanel 设置分区 + App 接线；追加迭代：导入改**多选**（目录三态 checkbox）、UI 对齐 kbi 体系、icon 优化（FolderIcon/DocIcon/DownloadIcon）；Playwright 全链路（跳转 URL 捕获/多选半选/层级映射/去设置直达）+ 读图 PASS
