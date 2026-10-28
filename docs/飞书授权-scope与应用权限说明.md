# 飞书授权：应用权限与 OAuth scope 说明

> 更新日期：2026-10-24
> 涉及：设置页「成员管理」企业授权 / 个人授权、项目「文档」导入。

## 1. 为什么个人授权也需要应用开通权限

飞书 OAuth 的授权链路是 **应用 + 用户** 两方：

```
用户点击授权 → open.feishu.cn 授权页（应用 app_id + 申请的 scope）
            → 用户本人同意 → 回调 code
            → 服务端用 app_id / app_secret 换 user_access_token
```

- `user_access_token` 决定「以谁的身份」访问数据
- `scope` 决定「这个应用代表该用户能访问什么」
- 授权页展示的 scope 必须是**应用已经在开放平台开通的权限**；应用没有开通时，飞书直接返回：

```
错误码 20027：当前应用权限不足，请联系应用管理员，前往开通以下权限
```

所以「个人授权不需要配置应用凭证」指的是：**终端用户不需要填写 app_id / app_secret**；但 OAuth 仍由这个应用发起，应用本身必须先获得权限，服务端也仍用应用凭证去换 token。两者缺一不可。

## 2. 企业授权 vs 个人授权

| | 企业授权 | 个人授权 |
|---|---|---|
| 令牌 | `tenant_access_token` | `user_access_token` |
| 代表身份 | 应用/租户 | 授权用户本人 |
| 用途 | 读取企业通讯录、导入成员 | 读取该用户可见的飞书文档 |
| 必需条件 | app_id + app_secret；通讯录权限 | 应用开通文档相关权限并发布；用户 OAuth 同意 |

两者凭证与授权状态互相独立，但**同属于一个飞书应用**，权限都在同一个应用后台配置。

## 3. 云文档需要的权限

### 3.1 只读（read 档）

| 权限 | 说明 |
|---|---|
| `docs:doc:readonly` | 查看、评论和导出文档（旧版文档） |
| `docx:document:readonly` | 查看新版文档 |
| `drive:drive:readonly` | 查看、评论和下载云空间中所有文件 |
| `wiki:wiki:readonly` | 查看知识库 |
| `contact:user.base:readonly` | 读取用户基础身份 |

### 3.2 可编辑 / 上传（write 档，写权限已包含只读）

| 权限 | 说明 |
|---|---|
| `docs:doc` | 查看、评论、编辑和管理文档 |
| `docs:document.media:upload` | 上传图片和附件到云文档 |
| `docx:document` | 创建及编辑新版文档（含查看） |
| `docx:document.block:convert` | 文本 / HTML / Markdown 转换为文档块 |
| `drive:drive` | 查看、评论、编辑和管理云空间所有文件 |
| `drive:file:upload` | 上传文件到云空间指定文件夹 |
| `wiki:wiki` | 查看、编辑和管理知识库（含查看） |
| `sheets:spreadsheet` | 查看、评论、编辑和管理电子表格 |
| `bitable:app` | 查看、评论、编辑和管理多维表格 |

### 3.3 云文档扩展（all 档）

在 write 基础上追加：

- 妙记：`minutes:minutes`、`minutes:minutes.upload:write`、`minutes:minutes.transcript:export`、`minutes:minutes.media:export`
- 白板：`board:create`、`board:read`、`board:update`、`board:delete`、`board:whiteboard:node:create/read/update/delete`
- 文档版本：`drive:drive:version`

> 权限管理（`docs:permission.*`）、事件订阅（`docs:event*`）、安全（`docs:secure`）等不属于云文档读写能力，默认不申请，避免应用获得修改协作者 / 权限设置的能力。

## 4. 开通步骤（自建应用）

入口：[飞书开放平台](https://open.feishu.cn/) → 开发者后台 → 选中本项目的自建应用。

### 4.1 权限管理 → API 权限

左侧「权限管理」默认就是 **API 权限**（不是「数据权限」）：

1. 搜索框按权限名称或 scope 搜索，按要启用的档位逐个开通（见第 3 节）：
   - 只读：查看、评论和导出文档（`docs:doc:readonly`）等 4 个
   - 可编辑 / 上传：`docs:doc`、`docs:document.media:upload`、`docx:document`、`docx:document.block:convert`、`drive:drive`、`drive:file:upload`、`wiki:wiki`、`sheets:spreadsheet`、`bitable:app`
   - 全部：再加妙记、白板、文档版本相关 scope
2. 每个权限点右侧「开通 / 申请开通」，弹出面板里勾选**用户身份**（user_access_token）；只勾应用身份不够，个人授权走的是用户身份
3. 需要填写申请理由的按提示填写；提交后状态为「申请中」，等管理员审批
4. 状态变为「已开通」表示权限本身已授予（还未发布时不会生效）

> 通讯录类权限（`contact:user.base:readonly`）在「数据权限」里还有部门/成员可见范围；**文档类权限没有数据范围**，能读到哪些文档由授权用户本人的文档权限决定，不需要额外配置「应用范围」。

### 4.2 版本管理与发布

1. 左侧「版本管理与发布」→「创建版本」
2. 填写版本号、更新说明（如「开通文档读取权限」），提交申请
3. 企业管理员在飞书管理后台「应用管理 → 应用审核」中通过
4. 版本状态变为「已发布 / 已上线」后，新权限才真正生效

### 4.3 在设置页选择授权范围并重新授权

设置 → 成员管理 → 个人授权 → 「授权范围」下拉选择档位，然后点「去授权」。

> 权限没开通或版本没发布时，授权页会显示 20027；此时不要反复重试，先按上面步骤确认「已开通」+「已发布」。

## 5. 授权范围配置（设置页）

授权范围不再通过环境变量配置，改为在 **设置 → 成员管理 → 个人授权 → 授权范围** 下拉中选择，存于后端 `org_settings.feishu_doc_scope_level`：

| 档位 | 效果 |
|---|---|
| `none` 仅身份 | 只申请 `contact:user.base:readonly` |
| `read` 只读 | 身份 + 云文档**只读**（4 个） |
| `write` 可编辑 / 上传 | 身份 + 云文档**可编辑 / 上传**（9 个，写权限已含只读） |
| `all` 全部云文档 | write + 妙记 / 白板 / 文档版本（共 22 个） |

- 修改档位后服务端会重置授权状态，页面显示「未授权」，需要重新「去授权」
- 授权链接由 [server/index.js](../server/index.js) 的 `GET /api/org/feishu/authorize-url` 生成，按当前档位拼接 scope
- 保存档位：`PUT /api/org/feishu/doc-scope`，body `{ "level": "read|write|all|none" }`
- 接口返回 `docScopes`（具体 scope 列表），设置页会显示「当前会申请 N 项云文档权限」

> 在没有开通应用权限之前把 scope 加进授权链接，会直接触发 20027；建议先选「仅身份」确认 OAuth 链路正常，再逐步提高档位。

## 6. 排查清单

| 现象 | 原因 | 处理 |
|---|---|---|
| 20027 应用权限不足 | 应用未开通 scope 或未发布版本 | 开放平台开通并发布；等待审批 |
| 授权页提示 redirect_uri 不匹配 | 重定向 URL 与后台不一致 | 统一设置页与开放平台配置 |
| 授权成功但文档读取 403 | 用户本人无该文档权限，或 token 过期 | 重新授权；检查文档权限范围 |
| 换企业凭证后个人授权失效 | 应用变了 / 密钥变更 | 重新发起个人授权 |

## 7. 相关代码

- `server/index.js`：`/api/org/feishu/authorize-url`、`/api/auth/feishu/callback`
- `server/feishu.js`：`tenant_access_token`、通讯录拉取
- `src/lib/orgApi.ts`：`authorizeUrl()` 返回 `{ configured, docScope, url }`
- `src/components/settings/FeishuPanel.tsx`：个人授权面板与提示文案
