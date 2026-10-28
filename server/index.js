import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import {
  DATA_DIR,
  DEFAULT_WORKDIR,
  addOrgMember,
  clearFeishuUserToken,
  countQueuedAhead,
  createAdminAccount,
  createAuthSession,
  createProjectSession,
  createSession,
  deleteAgent,
  deleteAuthSession,
  deleteChunksByDoc,
  deleteDocSource,
  deleteExpiredAuthSessions,
  deleteFeishuDocContent,
  deleteProject,
  deleteProjectFolder,
  deleteRuntime,
  ensureSeedAgent,
  ensureSeedProjects,
  findDocSource,
  findSessionByRef,
  getAgent,
  getAdminAccount,
  getAuthSession,
  getDocSource,
  getFeishuConfig,
  getFeishuCredentials,
  getFeishuDoc,
  getFeishuDocContent,
  getFeishuDocScopeLevel,
  getFeishuRedirectUri,
  getChunkStats,
  getKbConfig,
  getProject,
  getRuntime,
  getSession,
  getSyncRun,
  getTurn,
  importOrgMembers,
  latestKbRun,
  latestSyncRun,
  listAgents,
  listChunksPage,
  listDocSources,
  listEvents,
  listFeishuDocs,
  listFeishuDocsByKb,
  listFinalsForTurns,
  listOrgMembers,
  listProjectAgents,
  listProjectFolders,
  listProjectMembers,
  listProjects,
  listProjectSessions,
  listRuntimes,
  listSessionEvents,
  listSessions,
  listTurns,
  listTurnsPage,
  markSessionRead,
  markTurnCanceled,
  readSecrets,
  recomputeSessionStatus,
  removeOrgMember,
  replaceProjectMembers,
  runtimeKey,
  saveAgent,
  saveDocSource,
  saveProject,
  saveProjectFolder,
  saveProjectWithMembers,
  saveRuntime,
  setKbConfig,
  setFeishuAuthorized,
  setFeishuConnected,
  setFeishuCredentials,
  setFeishuDocKb,
  setFeishuDocScopeLevel,
  setFeishuRedirectUri,
  setFeishuUserToken,
  setRuntimeKey,
  syncAgents,
  updateOrgMember,
  updateSessionTitle,
  verifyAdminCredentials,
  writeSecrets,
} from './db.js'
import {
  archiveProjectExpired,
  collectRuntimeAvailable,
  createManualMemory,
  getMemorySettingsForProject,
  isCollectingProject,
  listProjectMemories,
  removeMemory,
  runCollect,
  startRetentionLoop,
  updateMemorySettings,
} from './memory.js'
import {
  createProjectSpec,
  editProjectSpec,
  listProjectSpecDtos,
  removeProjectSpec,
  setProjectSpecPrompt,
} from './specs.js'
import { activeRunOf, browse, ingestDoc, startSync } from './docSync.js'
import { indexDocument, indexProject, isIndexing, search } from './kb.js'
import { bus, cancelTurn, cliInfo, killAll, running } from './runner.js'
import { deleteSessionSafe, enqueue, initQueue } from './sessionQueue.js'
import { ensureProjectSandbox } from './sandbox.js'
import { getSandboxStatus, startSandbox, stopSandbox } from './docker.js'
import { attachTerminal, closeTerminalServer } from './terminal.js'
import { fetchModels } from './models.js'
import { getTenantToken, listContacts } from './feishu.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
// 注意：不要用通用 PORT——预览/部署工具常注入 PORT 给前端，会与 Vite 抢端口
const PORT = Number(process.env.ORG_OS_API_PORT || 8791)

ensureSeedProjects()
ensureSeedAgent()
startRetentionLoop()

const app = express()
app.use(express.json({ limit: '2mb' }))

/* ---------------- 登录态（Cookie token） ---------------- */

const SESSION_COOKIE = 'org_session'
const SESSION_MAX_AGE_MS = 7 * 24 * 3600 * 1000

const parseCookies = (header = '') => Object.fromEntries(
  header.split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=')
      return i < 0 ? [pair, ''] : [pair.slice(0, i), decodeURIComponent(pair.slice(i + 1))]
    }),
)

const setAuthCookie = (res, token) => res.cookie(SESSION_COOKIE, token, {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: SESSION_MAX_AGE_MS,
  path: '/',
})

const clearAuthCookie = (res) => res.clearCookie(SESSION_COOKIE, { path: '/' })

/** 除健康检查与登录相关接口外，/api 一律要求登录态 */
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next()
  const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE] || ''
  const user = getAuthSession(token)
  if (!user) return res.status(401).json({ error: '未登录或登录已过期' })
  req.user = user
  req.authToken = token
  next()
})

/** 项目可见性：所有者/管理员看全部，成员只看自己参与的项目 */
const canAccessProject = (user, project) => Boolean(
  user && project && (
    user.permission === '所有者'
    || user.permission === '管理员'
    || project.members.some((m) => m.name === user.name)
  ),
)

const requireProject = (req, res, projectId) => {
  const project = getProject(projectId)
  if (!project) {
    res.status(404).json({ error: 'project not found' })
    return null
  }
  if (!canAccessProject(req.user, project)) {
    res.status(403).json({ error: '无权访问该项目' })
    return null
  }
  return project
}

/** 会话 → 项目 → 成员校验；失败时已写好响应 */
const requireSessionAccess = (req, res, sessionId) => {
  const session = getSession(sessionId)
  if (!session || !session.projectId) {
    res.status(404).json({ error: 'session not found' })
    return null
  }
  const project = requireProject(req, res, session.projectId)
  if (!project) return null
  return { session, project }
}

/** 向会话 SSE 频道广播（附带最新 session） */
const emitSession = (sessionId, payload = {}) => {
  const session = getSession(sessionId)
  if (!session) return
  bus.emit(`session:${sessionId}`, { ...payload, session })
}

/* ---------------- health & runtime ---------------- */

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), runningTurns: running.size })
})

app.get('/api/runtime', (_req, res) => {
  const secrets = readSecrets()
  const runtimes = listRuntimes()
  res.json({
    cli: cliInfo(),
    keyConfigured: runtimes.some((r) => r.hasKey),
    baseUrl: runtimes[0]?.baseUrl || secrets.deepseekBaseUrl || '',
    dataDir: DATA_DIR,
    defaultWorkdir: DEFAULT_WORKDIR,
  })
})

app.put('/api/runtime', (req, res) => {
  const secrets = { ...readSecrets() }
  if (typeof req.body?.deepseekApiKey === 'string') {
    const value = req.body.deepseekApiKey.trim()
    if (value) secrets.deepseekApiKey = value
    else delete secrets.deepseekApiKey
  }
  if (typeof req.body?.deepseekBaseUrl === 'string') {
    const value = req.body.deepseekBaseUrl.trim()
    if (value) secrets.deepseekBaseUrl = value
    else delete secrets.deepseekBaseUrl
  }
  writeSecrets(secrets)
  res.json({
    keyConfigured: Boolean(secrets.deepseekApiKey),
    baseUrl: secrets.deepseekBaseUrl || '',
  })
})

/* ---------------- runtimes ---------------- */

app.get('/api/runtimes', (_req, res) => {
  res.json({ runtimes: listRuntimes() })
})

app.post('/api/runtimes', (req, res) => {
  res.json({ runtime: saveRuntime(req.body ?? {}) })
})

app.patch('/api/runtimes/:id', (req, res) => {
  const existing = getRuntime(req.params.id)
  if (!existing) return res.status(404).json({ error: 'runtime not found' })
  res.json({ runtime: saveRuntime({ ...existing, ...req.body, id: existing.id }) })
})

app.delete('/api/runtimes/:id', (req, res) => {
  if (!getRuntime(req.params.id)) return res.status(404).json({ error: 'runtime not found' })
  deleteRuntime(req.params.id)
  res.json({ ok: true })
})

app.put('/api/runtimes/:id/key', (req, res) => {
  if (!getRuntime(req.params.id)) return res.status(404).json({ error: 'runtime not found' })
  setRuntimeKey(req.params.id, typeof req.body?.apiKey === 'string' ? req.body.apiKey : '')
  res.json({ runtime: getRuntime(req.params.id) })
})

/** 从 provider 的 /models 拉取模型列表（未保存的运行时也可用） */
app.post('/api/runtimes/models', async (req, res) => {
  const body = req.body ?? {}
  const runtimeId = typeof body.runtimeId === 'string' ? body.runtimeId : ''
  const apiKey = (typeof body.apiKey === 'string' && body.apiKey.trim())
    || (runtimeId ? runtimeKey(runtimeId) : '')
  try {
    const models = await fetchModels({
      provider: typeof body.provider === 'string' ? body.provider : '',
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : '',
      apiKey,
    })
    res.json({ models })
  } catch (err) {
    res.status(502).json({ error: err?.message || '拉取模型失败' })
  }
})

/* ---------------- auth ---------------- */

const feishuAuthConfigured = () => {
  const { appId, appSecret } = getFeishuCredentials()
  return Boolean(appId && appSecret && getFeishuRedirectUri())
}

app.get('/api/auth/session', (req, res) => {
  const admin = getAdminAccount()
  const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE] || ''
  const user = getAuthSession(token)
  res.json({
    // 必须先有管理员账号（账号登录或飞书首登之后），才认为会话有效
    authenticated: Boolean(admin && user),
    needsSetup: !admin,
    user: admin ? user : null,
    feishuConfigured: feishuAuthConfigured(),
  })
})

/** 首次初始化管理员账号（只允许一次） */
app.post('/api/auth/setup', (req, res) => {
  try {
    const account = createAdminAccount(req.body?.username, req.body?.password)
    const token = createAuthSession(account.username, '所有者')
    setAuthCookie(res, token)
    res.json({ user: { name: account.username, permission: '所有者' } })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/auth/login', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!verifyAdminCredentials(username, password)) {
    return res.status(401).json({ error: '用户名或密码不正确' })
  }
  const token = createAuthSession(username.trim(), '所有者')
  setAuthCookie(res, token)
  res.json({ user: { name: username.trim(), permission: '所有者' } })
})

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE] || ''
  deleteAuthSession(token)
  clearAuthCookie(res)
  res.json({ ok: true })
})

/** 飞书扫码登录：返回授权页地址（跳转后由飞书展示二维码） */
app.get('/api/auth/feishu/url', (_req, res) => {
  if (!feishuAuthConfigured()) return res.json({ configured: false })
  const { appId } = getFeishuCredentials()
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: getFeishuRedirectUri(),
    response_type: 'code',
    state: 'login',
    scope: 'contact:user.base:readonly',
  })
  res.json({
    configured: true,
    url: `https://open.feishu.cn/open-apis/authen/v1/authorize?${params.toString()}`,
  })
})

/** 个人授权可选的云文档权限（飞书开放平台「云文档」分类）。
 * 档位在设置页「个人授权」中选择，存于 org_settings（feishu_doc_scope_level）：
 *   - none   只申请身份权限
 *   - read   只读（docs/docx/drive/wiki readonly）
 *   - write  文档 / 云空间 / 知识库 / 表格 / 多维表格 可编辑 + 上传（写权限已含只读）
 *   - all    在 write 基础上再加妙记、白板、文档版本
 * 飞书要求应用先在开放平台开通这些权限并发布版本，否则授权页返回 20027「应用权限不足」。
 * 权限管理 / 事件订阅 / 安全类 scope 不在云文档读写范围内，默认不申请。 */
const FEISHU_DOC_SCOPES_READ = [
  'docs:doc:readonly',
  'docx:document:readonly',
  'drive:drive:readonly',
  'wiki:wiki:readonly',
  'sheets:spreadsheet:readonly',
  'bitable:app:readonly',
  'drive:export:readonly',
]

const FEISHU_DOC_SCOPES_WRITE = [
  'docs:doc',
  'docs:document.media:upload',
  'docx:document',
  'docx:document.block:convert',
  'drive:drive',
  'drive:file:upload',
  'wiki:wiki',
  'sheets:spreadsheet',
  'bitable:app',
]

const FEISHU_DOC_SCOPES_EXTRA = [
  'minutes:minutes',
  'minutes:minutes.upload:write',
  'minutes:minutes.transcript:export',
  'minutes:minutes.media:export',
  // 白板：旧版的 board:create/read/update/delete 已废弃，飞书授权页会直接报 20043
  'board:whiteboard:node:create',
  'board:whiteboard:node:read',
  'board:whiteboard:node:update',
  'board:whiteboard:node:delete',
  'drive:drive:version',
]

const FEISHU_DOC_SCOPE_PROFILES = {
  none: [],
  read: FEISHU_DOC_SCOPES_READ,
  write: FEISHU_DOC_SCOPES_WRITE,
  all: [...FEISHU_DOC_SCOPES_WRITE, ...FEISHU_DOC_SCOPES_EXTRA],
}

const feishuDocScopes = () => FEISHU_DOC_SCOPE_PROFILES[getFeishuDocScopeLevel()] ?? []

const feishuPersonalScope = () => [
  'contact:user.base:readonly',
  ...feishuDocScopes(),
].join(' ')

/** 个人授权：同一回调地址，用 state=personal 区分用途 */
app.get('/api/org/feishu/authorize-url', (_req, res) => {
  if (!feishuAuthConfigured()) return res.json({ configured: false })
  const { appId } = getFeishuCredentials()
  const docScopes = feishuDocScopes()
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: getFeishuRedirectUri(),
    response_type: 'code',
    state: 'personal',
    scope: feishuPersonalScope(),
  })
  res.json({
    configured: true,
    docScope: docScopes.length > 0,
    docScopes,
    docScopeLevel: getFeishuDocScopeLevel(),
    url: `https://open.feishu.cn/open-apis/authen/v1/authorize?${params.toString()}`,
  })
})

/** 个人授权范围（云文档权限档位）：在设置页「个人授权」中选择 */
app.put('/api/org/feishu/doc-scope', (req, res) => {
  const level = typeof req.body?.level === 'string' ? req.body.level.trim().toLowerCase() : ''
  if (!Object.prototype.hasOwnProperty.call(FEISHU_DOC_SCOPE_PROFILES, level)) {
    return res.status(400).json({ error: 'invalid doc scope level' })
  }
  setFeishuDocScopeLevel(level)
  res.json(getFeishuConfig())
})

/* —— 飞书 user_access_token 换取（登录 / 个人授权共用） —— */

const FEISHU_OPEN = 'https://open.feishu.cn'

const describeFeishuError = (data) => {
  const detail = data?.msg || data?.error_description || data?.error || data?.message
  const raw = detail || JSON.stringify(data ?? {}).slice(0, 200)
  return `${data?.code ?? 'unknown'}: ${raw}`
}

async function exchangeFeishuCode(code) {
  const { appId, appSecret } = getFeishuCredentials()
  const redirectUri = getFeishuRedirectUri()
  let oidcError = ''

  try {
    const res = await fetch(`${FEISHU_OPEN}/open-apis/authen/v1/oidc/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json()
    if (data?.code === 0 && data?.data?.access_token) {
      return {
        accessToken: data.data.access_token,
        refreshToken: data.data.refresh_token || '',
        expiresIn: data.data.expires_in || 0,
      }
    }
    oidcError = describeFeishuError(data)
  } catch (err) {
    oidcError = err?.message || 'OIDC 请求失败'
  }

  // v1 兜底：app_access_token + code
  const appTokenRes = await fetch(`${FEISHU_OPEN}/open-apis/auth/v3/app_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(15000),
  })
  const appToken = await appTokenRes.json()
  if (appToken?.code !== 0) {
    throw new Error(`获取 app_access_token 失败 ${describeFeishuError(appToken)}${oidcError ? `（OIDC: ${oidcError}）` : ''}`)
  }

  const v1Res = await fetch(`${FEISHU_OPEN}/open-apis/authen/v1/access_token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${appToken.app_access_token}`,
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code }),
    signal: AbortSignal.timeout(15000),
  })
  const v1 = await v1Res.json()
  if (v1?.code !== 0 || !v1?.data?.access_token) {
    throw new Error(`换取 user_access_token 失败 ${describeFeishuError(v1)}${oidcError ? `（OIDC: ${oidcError}）` : ''}`)
  }
  return {
    accessToken: v1.data.access_token,
    refreshToken: '',
    expiresIn: v1.data.expires_in || 0,
  }
}

async function fetchFeishuUser(accessToken) {
  const res = await fetch(`${FEISHU_OPEN}/open-apis/authen/v1/user_info`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json()
  if (data?.code !== 0) throw new Error(`获取飞书用户失败 ${describeFeishuError(data)}`)
  return {
    name: String(data?.data?.name || '飞书用户').trim(),
    openId: data?.data?.open_id || '',
    avatarUrl: data?.data?.avatar_url || '',
  }
}

/** 飞书 OAuth 回调：state=login 建立登录；state=personal 保存个人授权令牌 */
app.get('/api/auth/feishu/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  const state = typeof req.query.state === 'string' ? req.query.state : ''
  if (!code) return res.status(400).send('缺少授权 code')

  try {
    const tokens = await exchangeFeishuCode(code)
    const user = await fetchFeishuUser(tokens.accessToken)

    if (state === 'personal') {
      setFeishuUserToken({
        ...tokens,
        ...user,
        authorizedAt: new Date().toISOString(),
        expiresAt: Date.now() + (Number(tokens.expiresIn) || 7200) * 1000,
      })
      setFeishuAuthorized(true, user.name)
    } else {
      const member = listOrgMembers().find((m) => m.name === user.name)
      const permission = member ? member.permission : (getAdminAccount() ? '成员' : '所有者')
      const token = createAuthSession(user.name, permission)
      setAuthCookie(res, token)
    }

    res.redirect(process.env.APP_BASE_URL || 'http://localhost:5173')
  } catch (err) {
    res.status(400).send(`飞书登录失败：${err?.message || '未知错误'}`)
  }
})

/* ---------------- org members & feishu ---------------- */

const isOwner = (req) => req.user?.permission === '所有者'

/** 项目角色：组织所有者/管理员 → admin；项目负责人 → manager；其他成员 → member */
const projectRoleOf = (user, project) => {
  if (!user || !project) return null
  if (user.permission === '所有者' || user.permission === '管理员') return 'admin'
  const member = project.members.find((m) => m.name === user.name)
  if (!member) return null
  return member.permission === '项目负责人' ? 'manager' : 'member'
}

/** 当前登录身份（供成员管理展示） */
app.get('/api/org/session', (req, res) => {
  res.json({ user: req.user })
})

app.get('/api/org/members', (_req, res) => {
  res.json({ members: listOrgMembers() })
})

app.post('/api/org/members', (req, res) => {
  try {
    res.json({ member: addOrgMember(req.body ?? {}) })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.patch('/api/org/members/:id', (req, res) => {
  try {
    const member = updateOrgMember(req.params.id, req.body ?? {})
    if (!member) return res.status(404).json({ error: '成员不存在' })
    res.json({ member })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.delete('/api/org/members/:id', (req, res) => {
  if (req.user?.permission !== '所有者') {
    return res.status(403).json({ error: '仅所有者可移除成员' })
  }
  const result = removeOrgMember(req.params.id)
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error })
  res.json({ ok: true })
})

app.post('/api/org/members/import', (req, res) => {
  if (req.user?.permission !== '所有者') {
    return res.status(403).json({ error: '仅所有者可导入成员' })
  }
  const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts : []
  if (contacts.length === 0) return res.status(400).json({ error: '没有可导入的联系人' })
  try {
    res.json(importOrgMembers(contacts, req.body?.permission))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

app.get('/api/org/feishu', (_req, res) => {
  res.json(getFeishuConfig())
})

app.put('/api/org/feishu', (req, res) => {
  if (!isOwner(req)) return res.status(403).json({ error: '仅所有者可修改企业授权' })
  const body = req.body ?? {}
  const current = getFeishuCredentials()
  const appId = typeof body.appId === 'string' ? body.appId.trim() : current.appId
  const typedSecret = typeof body.appSecret === 'string' ? body.appSecret.trim() : ''
  const appSecret = typedSecret || current.appSecret

  if (typeof body.redirectUri === 'string') setFeishuRedirectUri(body.redirectUri)

  if (!appId && !appSecret) {
    setFeishuCredentials('', '')
  } else {
    setFeishuCredentials(appId, appSecret)
  }
  // 凭证变更后需要重新校验
  setFeishuConnected(false)
  res.json(getFeishuConfig())
})

app.delete('/api/org/feishu', (_req, res) => {
  if (!isOwner(req)) return res.status(403).json({ error: '仅所有者可修改企业授权' })
  setFeishuCredentials('', '')
  setFeishuConnected(false)
  res.json(getFeishuConfig())
})

app.post('/api/org/feishu/verify', async (_req, res) => {
  if (!isOwner(req)) return res.status(403).json({ error: '仅所有者可校验企业授权' })
  const { appId, appSecret } = getFeishuCredentials()
  try {
    await getTenantToken(appId, appSecret)
    setFeishuConnected(true)
    res.json(getFeishuConfig())
  } catch (err) {
    setFeishuConnected(false)
    res.status(400).json({ error: err?.message || '企业授权校验失败' })
  }
})

app.delete('/api/org/feishu/authorize', (_req, res) => {
  clearFeishuUserToken()
  setFeishuAuthorized(false)
  res.json(getFeishuConfig())
})

app.get('/api/org/feishu/contacts', async (_req, res) => {
  if (!isOwner(req)) return res.status(403).json({ error: '仅所有者可拉取通讯录' })
  const { appId, appSecret } = getFeishuCredentials()
  if (!appId || !appSecret) return res.status(400).json({ error: '请先完成企业授权' })
  try {
    const contacts = await listContacts(appId, appSecret)
    setFeishuConnected(true)
    res.json({ contacts })
  } catch (err) {
    res.status(502).json({ error: err?.message || '拉取通讯录失败' })
  }
})

/* ---------------- projects ---------------- */

app.get('/api/projects', (req, res) => {
  const projects = listProjects().filter((p) => canAccessProject(req.user, p))
  res.json({ projects })
})

app.post('/api/projects', (req, res) => {
  const body = req.body ?? {}
  if (body.type != null && body.type !== 'dev' && body.type !== 'nondev') {
    return res.status(400).json({ error: 'invalid project type' })
  }
  const createdBy = (req.user?.name || '').trim()
  const project = saveProject({ ...body, type: body.type === 'nondev' ? 'nondev' : 'dev', createdBy })
  // 创建者自动成为项目成员，且固定为项目负责人
  const members = Array.isArray(body.members) ? [...body.members] : []
  if (createdBy) {
    const existing = members.find((m) => String(m?.name ?? '').trim() === createdBy)
    if (existing) existing.permission = '项目负责人'
    else {
      const orgMember = listOrgMembers().find((m) => m.name === createdBy)
      members.unshift({ name: createdBy, role: orgMember?.role || '', permission: '项目负责人' })
    }
  }
  replaceProjectMembers(project.id, members)
  if (project.type === 'dev') {
    try { ensureProjectSandbox(project) } catch (err) {
      console.error('[sandbox] ensure failed', err?.message || err)
    }
  }
  res.json({ project: getProject(project.id) })
})

app.put('/api/projects/:id', (req, res) => {
  const existing = requireProject(req, res, req.params.id)
  if (!existing) return
  res.json({ project: saveProjectWithMembers(existing.id, req.body ?? {}) })
})

app.get('/api/projects/:id', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  res.json({ project })
})

app.patch('/api/projects/:id', (req, res) => {
  const existing = requireProject(req, res, req.params.id)
  if (!existing) return
  res.json({ project: saveProject({ ...existing, ...req.body, id: existing.id }) })
})

app.delete('/api/projects/:id', async (req, res) => {
  const existing = requireProject(req, res, req.params.id)
  if (!existing) return
  await stopSandbox(existing)
  deleteProject(existing.id)
  res.json({ ok: true })
})

/* ---------------- project sandbox ---------------- */

app.get('/api/projects/:id/sandbox', async (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  res.json(await getSandboxStatus(project))
})

app.post('/api/projects/:id/sandbox/start', async (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  if (project.type !== 'dev') return res.status(409).json({ error: '非研发项目没有沙箱' })
  res.json(await startSandbox(project))
})

app.post('/api/projects/:id/sandbox/stop', async (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  await stopSandbox(project)
  res.json(await getSandboxStatus(project))
})

/* ---------------- project folders ---------------- */

app.get('/api/project-folders', (_req, res) => {
  res.json({ folders: listProjectFolders() })
})

app.post('/api/project-folders', (req, res) => {
  const body = req.body ?? {}
  const createdBy = (req.user?.name || '').trim()
  // 创建者自动成为文件夹成员，且固定为所有者（owner）
  const members = Array.isArray(body.members) ? body.members.map((m) => ({ ...m })) : []
  if (createdBy) {
    const existing = members.find((m) => String(m?.name ?? '').trim() === createdBy)
    if (existing) existing.role = 'owner'
    else members.unshift({ name: createdBy, role: 'owner' })
  }
  res.json({ folder: saveProjectFolder({ ...body, members }) })
})

app.patch('/api/project-folders/:id', (req, res) => {
  const existing = listProjectFolders().find((f) => f.id === req.params.id)
  if (!existing) return res.status(404).json({ error: 'folder not found' })
  res.json({ folder: saveProjectFolder({ ...existing, ...req.body, id: existing.id }) })
})

app.delete('/api/project-folders/:id', (req, res) => {
  if (!listProjectFolders().some((f) => f.id === req.params.id)) {
    return res.status(404).json({ error: 'folder not found' })
  }
  deleteProjectFolder(req.params.id)
  res.json({ ok: true })
})

app.get('/api/projects/:id/agents', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  res.json({ agents: listProjectAgents(project.id) })
})

app.get('/api/projects/:id/sessions', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  res.json({ sessions: listProjectSessions(project.id, req.user.name) })
})

app.post('/api/projects/:id/sessions', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const agent = listProjectAgents(project.id)[0]
  if (!agent) return res.status(400).json({ error: 'project has no agent' })
  // 标题由服务端生成，保证同一项目内不重复
  const session = createProjectSession(project.id, agent.id, req.user.name)
  res.json({ session })
})

/* ---------------- agents ---------------- */

app.get('/api/agents', (_req, res) => {
  res.json({ agents: listAgents() })
})

app.post('/api/agents', (req, res) => {
  res.json({ agent: saveAgent(req.body ?? {}) })
})

app.patch('/api/agents/:id', (req, res) => {
  const existing = getAgent(req.params.id)
  if (!existing) return res.status(404).json({ error: 'agent not found' })
  res.json({ agent: saveAgent({ ...existing, ...req.body, id: existing.id }) })
})

app.delete('/api/agents/:id', (req, res) => {
  if (!getAgent(req.params.id)) return res.status(404).json({ error: 'agent not found' })
  deleteAgent(req.params.id)
  res.json({ ok: true })
})

/** 设置页整表同步（前端把 myAdes 全量提交） */
app.post('/api/agents/sync', (req, res) => {
  const list = Array.isArray(req.body?.agents) ? req.body.agents : []
  res.json({ agents: syncAgents(list) })
})

/* ---------------- sessions ---------------- */

app.get('/api/agents/:id/sessions', (req, res) => {
  if (!getAgent(req.params.id)) return res.status(404).json({ error: 'agent not found' })
  res.json({ sessions: listSessions(req.params.id) })
})

app.post('/api/agents/:id/sessions', (req, res) => {
  const agent = getAgent(req.params.id)
  if (!agent) return res.status(404).json({ error: 'agent not found' })
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
  const externalRef = typeof req.body?.externalRef === 'string' ? req.body.externalRef.trim() : ''
  const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null

  if (externalRef) {
    const existing = findSessionByRef(agent.id, externalRef)
    if (existing) return res.json({ session: existing, reused: true })
  }

  try {
    res.json({ session: createSession(agent.id, title, projectId, externalRef) })
  } catch (err) {
    // 并发 ensure 时唯一索引冲突：返回已存在的那条
    const existing = externalRef ? findSessionByRef(agent.id, externalRef) : null
    if (existing) return res.json({ session: existing, reused: true })
    throw err
  }
})

app.get('/api/sessions/:id', (req, res) => {
  const access = requireSessionAccess(req, res, req.params.id)
  if (!access) return
  res.json({ session: access.session })
})

app.delete('/api/sessions/:id', async (req, res) => {
  const access = requireSessionAccess(req, res, req.params.id)
  if (!access) return
  const sessionId = access.session.id
  await deleteSessionSafe(sessionId)
  bus.emit(`session:${sessionId}`, { type: 'deleted', sessionId })
  res.json({ ok: true })
})

app.patch('/api/sessions/:id', (req, res) => {
  const access = requireSessionAccess(req, res, req.params.id)
  if (!access) return
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
  if (!title) return res.status(400).json({ error: 'title is required' })
  updateSessionTitle(access.session.id, title.slice(0, 60))
  const session = getSession(access.session.id)
  emitSession(session.id, { type: 'session' })
  res.json({ session })
})

/** 标记已读到指定 seq（缺省 = 最新） */
app.post('/api/sessions/:id/read', (req, res) => {
  const access = requireSessionAccess(req, res, req.params.id)
  if (!access) return
  const seq = markSessionRead(access.session.id, req.user.name, req.body?.seq)
  res.json({ ok: true, lastReadSeq: seq })
})

/** 会话级 SSE：新消息 / turn 状态 / 会话标题与状态 / agent 状态变化 */
app.get('/api/sessions/:id/stream', (req, res) => {
  const access = requireSessionAccess(req, res, req.params.id)
  if (!access) return

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`)
  send({ type: 'session', session: access.session })

  const channel = `session:${access.session.id}`
  const onEvent = (payload) => send(payload)
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000)
  const cleanup = () => {
    clearInterval(keepAlive)
    bus.off(channel, onEvent)
    if (!res.writableEnded) res.end()
  }

  bus.on(channel, onEvent)
  req.on('close', cleanup)
})

app.get('/api/sessions/:id/events', (req, res) => {
  const access = requireSessionAccess(req, res, req.params.id)
  if (!access) return
  const turns = Number(req.query.turns || 50)
  res.json({ events: listSessionEvents(access.session.id, turns) })
})

app.get('/api/sessions/:id/messages', (req, res) => {
  const access = requireSessionAccess(req, res, req.params.id)
  if (!access) return
  const { session } = access
  const before = req.query.before != null && req.query.before !== '' ? Number(req.query.before) : null
  const limit = Number(req.query.limit || 50)
  const { turns, hasMore } = listTurnsPage(
    session.id,
    Number.isFinite(before) ? before : null,
    limit,
  )
  const finals = listFinalsForTurns(turns.map((t) => t.id))

  const messages = []
  for (const turn of turns) {
    messages.push({
      id: `u:${turn.id}`,
      role: 'user',
      content: turn.userContent,
      at: turn.createdAt,
      status: turn.status,
      userName: turn.userName,
    })
    const final = finals.get(turn.id)
    if (final?.text) {
      messages.push({
        id: `a:${turn.id}`,
        role: 'assistant',
        content: final.text,
        at: turn.endedAt || turn.createdAt,
        status: turn.status,
        turnId: turn.id,
        agentName: turn.agentName,
      })
    } else if (turn.status === 'error' || turn.status === 'canceled') {
      messages.push({
        id: `e:${turn.id}`,
        role: 'assistant',
        content: '',
        at: turn.endedAt || turn.createdAt,
        status: turn.status,
        turnId: turn.id,
        agentName: turn.agentName,
        error: turn.status === 'canceled' ? '已取消' : (turn.error || '执行失败'),
      })
    }
  }
  res.json({
    messages,
    hasMore,
    nextBefore: turns[0]?.seq ?? null,
  })
})

/* ---------------- turns ---------------- */

app.post('/api/sessions/:id/turns', (req, res) => {
  const access = requireSessionAccess(req, res, req.params.id)
  if (!access) return

  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
  if (!content) return res.status(400).json({ error: 'content is required' })

  const useKnowledge = Boolean(req.body?.useKnowledge)
  const useMemory = req.body?.useMemory !== false
  try {
    const turn = enqueue({ sessionId: access.session.id, content, userName: req.user.name, useKnowledge, useMemory })
    res.json({
      turn,
      queuePosition: countQueuedAhead(access.session.id, turn.seq) + 1,
    })
  } catch (err) {
    res.status(500).json({ error: err?.message || '入队失败' })
  }
})

app.post('/api/turns/:id/cancel', (req, res) => {
  const turn = getTurn(req.params.id)
  if (!turn) return res.status(404).json({ error: 'turn not found' })
  const access = requireSessionAccess(req, res, turn.sessionId)
  if (!access) return

  if (turn.status === 'queued') {
    markTurnCanceled(turn.id)
    bus.emit(`turn:${turn.id}:done`, { status: 'canceled' })
    recomputeSessionStatus(turn.sessionId)
    emitSession(turn.sessionId, turn.id)
    return res.json({ ok: true })
  }
  const ok = cancelTurn(turn.id)
  res.json({ ok })
})

/** SSE：先回放已落库事件，再接实时流；排队中的 turn 会等到开始执行 */
app.get('/api/turns/:id/stream', (req, res) => {
  const turn = getTurn(req.params.id)
  if (!turn) return res.status(404).json({ error: 'turn not found' })
  if (!requireSessionAccess(req, res, turn.sessionId)) return

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`)
  for (const row of listEvents(turn.id)) send(row.payload)

  if (turn.status !== 'running' && turn.status !== 'queued') {
    res.write('event: end\ndata: {}\n\n')
    res.end()
    return
  }

  const channel = `turn:${turn.id}`
  const doneChannel = `${channel}:done`
  const onEvent = (event) => send(event)
  const onDone = () => cleanup()

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000)

  const cleanup = () => {
    clearInterval(keepAlive)
    bus.off(channel, onEvent)
    bus.off(doneChannel, onDone)
    if (!res.writableEnded) {
      res.write('event: end\ndata: {}\n\n')
      res.end()
    }
  }

  bus.on(channel, onEvent)
  bus.on(doneChannel, onDone)
  req.on('close', () => {
    clearInterval(keepAlive)
    bus.off(channel, onEvent)
    bus.off(doneChannel, onDone)
  })
})

/* ---------------- feishu docs sync ---------------- */

const docCountBySource = (projectId) => {
  const counts = new Map()
  for (const doc of listFeishuDocs(projectId)) {
    counts.set(doc.sourceId, (counts.get(doc.sourceId) || 0) + 1)
  }
  return counts
}

app.get('/api/projects/:id/doc-sources', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const counts = docCountBySource(project.id)
  res.json({
    sources: listDocSources(project.id).map((s) => ({ ...s, docCount: counts.get(s.id) || 0 })),
    latestRun: latestSyncRun(project.id),
    runningRunId: activeRunOf(project.id),
  })
})

/** 浏览飞书目录/知识库空间（添加同步源弹窗用） */
app.get('/api/projects/:id/doc-sources/browse', async (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const kind = req.query.kind === 'wiki_space' ? 'wiki_space' : 'folder'
  const auth = req.query.auth === 'user' ? 'user' : 'tenant'
  try {
    res.json(await browse({
      kind,
      token: typeof req.query.token === 'string' ? req.query.token : '',
      parent: typeof req.query.parent === 'string' ? req.query.parent : '',
      auth,
    }))
  } catch (err) {
    res.status(502).json({ error: err?.message || '读取飞书目录失败' })
  }
})

app.post('/api/projects/:id/doc-sources', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const body = req.body ?? {}
  const kind = body.kind === 'wiki_space' ? 'wiki_space' : body.kind === 'doc' ? 'doc' : 'folder'
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!token) return res.status(400).json({ error: '缺少飞书 token' })

  const existing = findDocSource(project.id, kind, token)
  if (existing) return res.json({ source: existing, reused: true })

  const source = saveDocSource({
    projectId: project.id,
    kind,
    token,
    name: typeof body.name === 'string' ? body.name.trim() : '',
    url: typeof body.url === 'string' ? body.url.trim() : '',
    auth: body.auth === 'user' ? 'user' : 'tenant',
    docType: typeof body.docType === 'string' ? body.docType.trim() : '',
    createdBy: req.user?.name || '',
  })
  res.json({ source })
})

/** 批量添加（目录与单篇文档可混选）；已存在的源按复用处理，不报错 */
app.post('/api/projects/:id/doc-sources/batch', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  if (items.length === 0) return res.status(400).json({ error: '没有选择任何同步源' })
  if (items.length > 200) return res.status(400).json({ error: '一次最多添加 200 个同步源' })

  const sources = []
  const failed = []
  for (const item of items) {
    try {
      const kind = item?.kind === 'wiki_space' ? 'wiki_space' : item?.kind === 'doc' ? 'doc' : 'folder'
      const token = typeof item?.token === 'string' ? item.token.trim() : ''
      if (!token) throw new Error('缺少飞书 token')
      const existing = findDocSource(project.id, kind, token)
      if (existing) {
        sources.push(existing)
        continue
      }
      sources.push(saveDocSource({
        projectId: project.id,
        kind,
        token,
        name: typeof item.name === 'string' ? item.name.trim() : '',
        url: typeof item.url === 'string' ? item.url.trim() : '',
        auth: item.auth === 'user' ? 'user' : 'tenant',
        docType: typeof item.docType === 'string' ? item.docType.trim() : '',
        createdBy: req.user?.name || '',
      }))
    } catch (err) {
      failed.push({ name: item?.name || '', error: err?.message || String(err) })
    }
  }
  res.json({ sources, failed })
})

app.delete('/api/projects/:id/doc-sources/:sourceId', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const source = getDocSource(req.params.sourceId)
  if (!source || source.projectId !== project.id) {
    return res.status(404).json({ error: '同步源不存在' })
  }
  deleteDocSource(source.id)
  res.json({ ok: true })
})

app.post('/api/projects/:id/doc-sync', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const sourceId = typeof req.body?.sourceId === 'string' ? req.body.sourceId : ''
  if (sourceId) {
    const source = getDocSource(sourceId)
    if (!source || source.projectId !== project.id) {
      return res.status(404).json({ error: '同步源不存在' })
    }
  }
  res.json(startSync({ project, sourceId }))
})

app.get('/api/projects/:id/doc-sync/latest', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  res.json({ run: latestSyncRun(project.id), runningRunId: activeRunOf(project.id) })
})

app.get('/api/projects/:id/doc-sync/runs/:runId', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const run = getSyncRun(req.params.runId)
  if (!run || run.projectId !== project.id) {
    return res.status(404).json({ error: '同步任务不存在' })
  }
  res.json({ run })
})

app.get('/api/projects/:id/docs', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const kbOnly = req.query.kb === '1' || req.query.kb === 'on'
  const sourceId = typeof req.query.sourceId === 'string' ? req.query.sourceId : ''
  let docs = kbOnly ? listFeishuDocsByKb(project.id) : listFeishuDocs(project.id, { sourceId })
  if (kbOnly && sourceId) docs = docs.filter((d) => d.sourceId === sourceId)
  const keyword = String(req.query.q || '').trim().toLowerCase()
  if (keyword) {
    docs = docs.filter((d) => (
      d.title.toLowerCase().includes(keyword) || d.parentPath.toLowerCase().includes(keyword)
    ))
  }
  res.json({ docs })
})

/** 加入知识库：异步拉正文，状态先置 fetching，前端轮询 docs */
app.post('/api/projects/:id/docs/:docId/kb', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const doc = getFeishuDoc(req.params.docId)
  if (!doc || doc.projectId !== project.id || doc.deletedAt) {
    return res.status(404).json({ error: '文档不存在' })
  }
  if (doc.kbState !== 'fetching') {
    void ingestDoc(doc.id)
      .then(() => indexDocument(doc.id, { trigger: 'ingest' }))
      .catch((err) => {
        console.error('[doc-sync] ingest/index failed', doc.id, err?.message || err)
      })
  }
  res.status(202).json({ doc: getFeishuDoc(doc.id) })
})

app.delete('/api/projects/:id/docs/:docId/kb', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const doc = getFeishuDoc(req.params.docId)
  if (!doc || doc.projectId !== project.id) {
    return res.status(404).json({ error: '文档不存在' })
  }
  deleteFeishuDocContent(doc.id)
  deleteChunksByDoc(doc.id)
  setFeishuDocKb(doc.id, { kbState: 'off', kbError: null, kbRevision: null, kbFetchedAt: null })
  res.json({ doc: getFeishuDoc(doc.id) })
})

app.get('/api/projects/:id/docs/:docId/content', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const doc = getFeishuDoc(req.params.docId)
  if (!doc || doc.projectId !== project.id) {
    return res.status(404).json({ error: '文档不存在' })
  }
  const content = getFeishuDocContent(doc.id)
  if (!content) return res.status(409).json({ error: '该文档尚未收录正文' })
  res.json({ content })
})

/* ---------------- knowledge base ---------------- */

const kbOverview = (projectId) => {
  const all = listFeishuDocs(projectId)
  const docs = all.filter((d) => d.kbState !== 'off')
  const counts = { included: docs.length, indexed: 0, ready: 0, fetching: 0, failed: 0, stale: 0, off: all.length - docs.length }
  for (const doc of docs) {
    if (doc.kbState === 'indexed') {
      counts.indexed += 1
      if (doc.stale) counts.stale += 1
    } else if (doc.kbState === 'ready') counts.ready += 1
    else if (doc.kbState === 'fetching') counts.fetching += 1
    else if (doc.kbState === 'failed') counts.failed += 1
  }
  return {
    counts,
    // 覆盖率按「所有已同步文档」算，未收录的文档会拉低它，避免看起来一切就绪
    coverage: all.length > 0 ? Number((counts.indexed / all.length).toFixed(2)) : 0,
  }
}

app.get('/api/projects/:id/kb/status', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const overview = kbOverview(project.id)
  const config = getKbConfig()
  res.json({
    ...overview,
    chunks: getChunkStats(project.id, config.model),
    config: { ...config, hasKey: config.hasKey },
    latestRun: latestKbRun(project.id),
    indexing: listFeishuDocs(project.id).filter((d) => isIndexing(d.id)).length,
  })
})

/** 建/重建索引：不传 docId 则重建该知识库全部文档，异步执行 */
app.post('/api/projects/:id/kb/index', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const docId = typeof req.body?.docId === 'string' ? req.body.docId : ''

  if (docId) {
    const doc = getFeishuDoc(docId)
    if (!doc || doc.projectId !== project.id) return res.status(404).json({ error: '文档不存在' })
    if (doc.kbState === 'off') return res.status(409).json({ error: '文档未收录进知识库' })
    if (isIndexing(docId)) return res.json({ queued: true, docId })
    void indexDocument(docId, { trigger: 'manual' }).catch((err) => {
      console.error('[kb] index failed', docId, err?.message || err)
    })
    return res.status(202).json({ queued: true, docId })
  }

  void indexProject(project.id, { trigger: 'manual' }).catch((err) => {
    console.error('[kb] project index failed', err?.message || err)
  })
  res.status(202).json({ queued: true })
})

/** 批量收录：把还没进知识库的文档逐篇拉正文 + 建索引，异步执行 */
app.post('/api/projects/:id/kb/collect', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const sourceId = typeof req.body?.sourceId === 'string' ? req.body.sourceId : ''
  const targets = listFeishuDocs(project.id).filter((d) => (
    d.kbState === 'off' && (!sourceId || d.sourceId === sourceId)
  ))
  if (targets.length === 0) return res.json({ queued: 0 })

  void (async () => {
    for (const doc of targets) {
      try {
        await ingestDoc(doc.id)
        await indexDocument(doc.id, { trigger: 'collect' })
      } catch (err) {
        console.error('[kb] collect failed', doc.id, err?.message || err)
      }
    }
  })()
  res.status(202).json({ queued: targets.length })
})

app.get('/api/projects/:id/kb/docs/:docId/chunks', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const doc = getFeishuDoc(req.params.docId)
  if (!doc || doc.projectId !== project.id) return res.status(404).json({ error: '文档不存在' })

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const chunks = listChunksPage(doc.id, limit, offset)
  res.json({
    chunks: chunks.map((c) => ({
      id: c.id,
      ordinal: c.ordinal,
      sectionPath: c.sectionPath,
      content: c.content,
      charCount: c.charCount,
      hasEmbedding: Boolean(c.embedding),
    })),
    limit,
    offset,
  })
})

app.post('/api/projects/:id/kb/search', async (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const query = typeof req.body?.q === 'string' ? req.body.q.trim() : ''
  if (!query) return res.status(400).json({ error: '请输入查询内容' })
  const topK = Math.min(Math.max(Number(req.body?.topK) || 8, 1), 20)
  const useRerank = Boolean(req.body?.rerank)

  try {
    const result = await search(project.id, query, { topK, useRerank })
    const docIds = [...new Set(result.chunks.map((c) => c.docId))]
    const docs = new Map(docIds.map((id) => {
      const doc = getFeishuDoc(id)
      return [id, doc ? { title: doc.title, url: doc.url, externalType: doc.externalType } : { title: '已删除文档', url: '', externalType: '' }]
    }))
    res.json({
      ...result,
      chunks: result.chunks.map((c) => ({ ...c, doc: docs.get(c.docId) })),
    })
  } catch (err) {
    res.status(500).json({ error: err?.message || '检索失败' })
  }
})

app.get('/api/projects/:id/kb/config', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  res.json({ config: getKbConfig() })
})

app.put('/api/projects/:id/kb/config', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  if (!isOwner(req) && req.user?.permission !== '管理员') {
    return res.status(403).json({ error: '仅所有者/管理员可修改检索配置' })
  }
  const body = req.body ?? {}
  res.json({ config: setKbConfig({
    baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
    model: typeof body.model === 'string' ? body.model : undefined,
    dim: body.dim,
    glossary: typeof body.glossary === 'string' ? body.glossary : undefined,
    visionModel: typeof body.visionModel === 'string' ? body.visionModel : undefined,
    rerankModel: typeof body.rerankModel === 'string' ? body.rerankModel : undefined,
    apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
  }) })
})

/* ---------------- project specs ---------------- */

const sendSpecError = (res, err) => {
  const status = Number(err?.status) || 500
  const body = { error: err?.message || '规范操作失败' }
  if (err?.bytes != null) body.bytes = err.bytes
  if (err?.maxBytes != null) body.maxBytes = err.maxBytes
  res.status(status).json(body)
}

app.get('/api/projects/:id/specs', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  res.json(listProjectSpecDtos(project.id))
})

app.post('/api/projects/:id/specs', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const role = projectRoleOf(req.user, project)
  try {
    const spec = createProjectSpec({
      projectId: project.id,
      input: req.body ?? {},
      userName: req.user?.name || '',
      canManagePrompt: role === 'admin' || role === 'manager',
    })
    res.status(201).json({ spec, prompt: listProjectSpecDtos(project.id).prompt })
  } catch (err) {
    sendSpecError(res, err)
  }
})

app.put('/api/projects/:id/specs/:specId', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const role = projectRoleOf(req.user, project)
  try {
    const spec = editProjectSpec({
      projectId: project.id,
      specId: req.params.specId,
      input: req.body ?? {},
      canManagePrompt: role === 'admin' || role === 'manager',
    })
    res.json({ spec, prompt: listProjectSpecDtos(project.id).prompt })
  } catch (err) {
    sendSpecError(res, err)
  }
})

app.delete('/api/projects/:id/specs/:specId', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const role = projectRoleOf(req.user, project)
  try {
    const result = removeProjectSpec({
      projectId: project.id,
      specId: req.params.specId,
      canManagePrompt: role === 'admin' || role === 'manager',
    })
    res.json({ ...result, prompt: listProjectSpecDtos(project.id).prompt })
  } catch (err) {
    sendSpecError(res, err)
  }
})

app.patch('/api/projects/:id/specs/:specId/prompt', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  if (typeof req.body?.inPrompt !== 'boolean') {
    return res.status(400).json({ error: 'inPrompt 必须是布尔值' })
  }
  const role = projectRoleOf(req.user, project)
  try {
    const spec = setProjectSpecPrompt({
      projectId: project.id,
      specId: req.params.specId,
      inPrompt: req.body.inPrompt,
      canManagePrompt: role === 'admin' || role === 'manager',
    })
    res.json({ spec, prompt: listProjectSpecDtos(project.id).prompt })
  } catch (err) {
    sendSpecError(res, err)
  }
})

/* ---------------- memories ---------------- */

const sendMemoryError = (res, err) => {
  const status = Number(err?.status) || 500
  const body = { error: err?.message || '记忆操作失败' }
  if (err?.memory) body.memory = err.memory
  res.status(status).json(body)
}

app.get('/api/projects/:id/memories', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const status = typeof req.query.status === 'string' ? req.query.status : 'all'
  if (!['all', 'active', 'archived', 'deleted'].includes(status)) {
    return res.status(400).json({ error: '无效的记忆状态' })
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  res.json(listProjectMemories(project.id, {
    status,
    q: typeof req.query.q === 'string' ? req.query.q : '',
    limit,
    offset,
  }))
})

app.post('/api/projects/:id/memories', async (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  try {
    const memory = await createManualMemory({
      projectId: project.id,
      content: req.body?.content,
      userName: req.user?.name || '',
    })
    res.status(201).json({ memory })
  } catch (err) {
    sendMemoryError(res, err)
  }
})

app.delete('/api/projects/:id/memories/:memoryId', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const role = projectRoleOf(req.user, project)
  try {
    res.json(removeMemory({
      projectId: project.id,
      memoryId: req.params.memoryId,
      userName: req.user?.name || '',
      canDeleteAll: role === 'admin' || role === 'manager',
    }))
  } catch (err) {
    sendMemoryError(res, err)
  }
})

app.post('/api/projects/:id/memories/archive-expired', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  try {
    res.json({ archived: archiveProjectExpired(project.id, req.user?.name || '') })
  } catch (err) {
    sendMemoryError(res, err)
  }
})

app.post('/api/projects/:id/memories/collect', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const role = projectRoleOf(req.user, project)
  if (role !== 'admin' && role !== 'manager') {
    return res.status(403).json({ error: '仅项目负责人 / 管理员可手动收集' })
  }
  if (!collectRuntimeAvailable(project.id)) {
    return res.status(400).json({ error: '未配置可用的模型运行时' })
  }
  if (isCollectingProject(project.id)) {
    return res.json({ queued: false, reason: 'running' })
  }
  void runCollect(project.id, { trigger: 'manual' }).catch((err) => {
    console.error('[memory] manual collect failed', project.id, err?.message || err)
  })
  res.status(202).json({ queued: true })
})

app.get('/api/projects/:id/memory-settings', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  res.json({ settings: getMemorySettingsForProject(project.id) })
})

app.put('/api/projects/:id/memory-settings', (req, res) => {
  const project = requireProject(req, res, req.params.id)
  if (!project) return
  const role = projectRoleOf(req.user, project)
  if (role !== 'admin' && role !== 'manager') {
    return res.status(403).json({ error: '仅项目负责人 / 管理员可修改记忆规则' })
  }
  try {
    res.json({ settings: updateMemorySettings(project.id, req.body ?? {}) })
  } catch (err) {
    sendMemoryError(res, err)
  }
})

/* ---------------- static (production preview) ---------------- */

const distDir = path.join(REPO_ROOT, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: err?.message || 'internal error' })
})

deleteExpiredAuthSessions()
initQueue()

const server = app.listen(PORT, '127.0.0.1', () => {
  const info = cliInfo()
  console.log(`[org-os] api on http://127.0.0.1:${PORT}`)
  console.log(`[org-os] dsh: ${info.exists ? info.path : 'NOT FOUND'} ${info.version ?? ''}`)
  console.log(`[org-os] data: ${DATA_DIR}`)
})
attachTerminal(server)

const shutdown = () => {
  closeTerminalServer()
  killAll()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
