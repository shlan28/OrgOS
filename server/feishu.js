const OPEN_BASE = process.env.FEISHU_OPEN_BASE || 'https://open.feishu.cn'

const request = async (url, init) => {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(12000),
  })
  const raw = await res.text()
  if (raw.length > 2_000_000) throw new Error('飞书接口响应过大')
  let data
  try { data = JSON.parse(raw) } catch { throw new Error(`飞书接口返回非 JSON（HTTP ${res.status}）`) }
  if (data?.code !== 0) {
    throw new Error(`飞书接口错误 ${data?.code ?? res.status}: ${data?.msg ?? '未知错误'}`)
  }
  return data
}

/** 企业自建应用凭证换 tenant_access_token */
export async function getTenantToken(appId, appSecret) {
  if (!appId || !appSecret) throw new Error('缺少飞书应用凭证')
  const data = await request(`${OPEN_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  if (!data.tenant_access_token) throw new Error('飞书未返回 tenant_access_token')
  return data.tenant_access_token
}

/** 40004 等常见错误的可操作提示 */
const friendlyError = (err) => {
  const msg = err?.message || ''
  if (msg.includes('40004')) {
    return new Error(
      '飞书应用没有通讯录部门权限（40004）。请在飞书开发者后台 → 权限管理：'
      + '① 开通通讯录权限（contact:user.base:readonly、contact:department.base:readonly 等）；'
      + '② 在「数据权限」中把通讯录授权范围设为「全员」或包含根部门；'
      + '③ 发布应用新版本（权限变更需发布后生效）；完成后再点一次「从飞书导入成员」。',
    )
  }
  if (msg.includes('99991663') || msg.includes('invalid token')) {
    return new Error('飞书 tenant_access_token 无效，请重新保存并校验企业授权')
  }
  return err
}

async function fetchPage(token, idType, pageToken) {
  const params = new URLSearchParams({
    department_id: '0',
    department_id_type: idType,
    page_size: '50',
    user_id_type: 'open_id',
  })
  if (pageToken) params.set('page_token', pageToken)
  return request(
    `${OPEN_BASE}/open-apis/contact/v3/users/find_by_department?${params.toString()}`,
    { headers: { authorization: `Bearer ${token}` } },
  )
}

/** 用指定 department_id_type 拉取根部门成员（最多 5 页） */
async function fetchByDepartment(token, idType) {
  const contacts = []
  let pageToken = ''
  for (let page = 0; page < 5; page += 1) {
    const data = await fetchPage(token, idType, pageToken)
    const items = Array.isArray(data?.data?.items) ? data.data.items : []
    for (const item of items) {
      const name = String(item?.name ?? item?.en_name ?? '').trim()
      if (!name) continue
      contacts.push({
        name,
        department: '飞书通讯录',
        title: String(item?.job_title ?? '').trim() || '成员',
      })
    }
    if (!data?.data?.has_more || !data?.data?.page_token) break
    pageToken = data.data.page_token
  }
  return contacts
}

/**
 * 拉取通讯录成员（根部门下，最多 5 页 / 250 人）。
 * 先按 open_department_id，失败再退到 department_id；40004 给出可操作提示。
 */
export async function listContacts(appId, appSecret) {
  const token = await getTenantToken(appId, appSecret)
  let lastError = null
  for (const idType of ['open_department_id', 'department_id']) {
    try {
      return await fetchByDepartment(token, idType)
    } catch (err) {
      lastError = err
    }
  }
  throw friendlyError(lastError)
}

/* ================= 云文档 ================= */

export class FeishuError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'FeishuError'
    this.code = code
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 统一调用：拼 query、解析 code、限流退避（99991400 / HTTP 429） */
async function api(path, { token, method = 'GET', query, body, retries = 3, timeout = 20000 } = {}) {
  const url = new URL(`${OPEN_BASE}${path}`)
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }

  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let res
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      })
    } catch (err) {
      lastError = err
      if (attempt < retries) { await sleep(600 * 2 ** attempt); continue }
      throw new Error(`飞书请求失败：${err?.message || err}`)
    }

    const raw = await res.text()
    if (raw.length > 8_000_000) throw new Error('飞书接口响应过大')
    let data
    try { data = JSON.parse(raw) } catch { throw new Error(`飞书接口返回非 JSON（HTTP ${res.status}）`) }

    if (data?.code === 0) return data.data ?? {}

    const code = data?.code ?? res.status
    if ((code === 99991400 || res.status === 429) && attempt < retries) {
      await sleep(800 * 2 ** attempt)
      continue
    }
    if (code === 99991663 || code === 99991661) {
      throw new FeishuError('飞书 token 已失效，请重新授权', code)
    }
    throw new FeishuError(`飞书接口错误 ${code}: ${data?.msg ?? '未知错误'}`, code)
  }
  throw new FeishuError(lastError?.message || '飞书请求失败', 0)
}

/* —— tenant_access_token 缓存（提前 5 分钟过期） —— */

const tenantCache = new Map()

export async function getTenantTokenCached(appId, appSecret) {
  const key = `${appId}:${appSecret.slice(0, 6)}`
  const hit = tenantCache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.token
  const token = await getTenantToken(appId, appSecret)
  tenantCache.set(key, { token, expiresAt: Date.now() + 110 * 60 * 1000 })
  return token
}

export async function refreshUserToken(refreshToken, appId, appSecret) {
  if (!refreshToken) throw new Error('缺少 refresh_token')
  const data = await api('/open-apis/authen/v1/oidc/refresh_access_token', {
    method: 'POST',
    body: {
      grant_type: 'refresh_token',
      client_id: appId,
      client_secret: appSecret,
      refresh_token: refreshToken,
    },
  })
  if (!data?.access_token) throw new Error('飞书未返回新的 user_access_token')
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in || 0,
  }
}

/* —— 目录与节点 —— */

export async function listFolder(token, folderToken, pageToken = '') {
  const data = await api('/open-apis/drive/v1/files', {
    token,
    query: { folder_token: folderToken, page_size: 200, page_token: pageToken },
  })
  return {
    items: Array.isArray(data.files) ? data.files : [],
    hasMore: Boolean(data.has_more),
    nextToken: data.next_page_token || '',
  }
}

export async function listWikiNodes(token, spaceId, parentNodeToken = '', pageToken = '') {  const data = await api(`/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`, {
    token,
    query: { parent_node_token: parentNodeToken, page_size: 50, page_token: pageToken },
  })
  return {
    items: Array.isArray(data.items) ? data.items : [],
    hasMore: Boolean(data.has_more),
    nextToken: data.page_token || '',
  }
}

export async function getWikiNode(token, nodeToken) {
  const data = await api('/open-apis/wiki/v2/spaces/get_node', { token, query: { token: nodeToken } })
  return data.node || null
}

export async function listWikiSpaces(token, pageToken = '') {
  const data = await api('/open-apis/wiki/v2/spaces', {
    token,
    query: { page_size: 50, page_token: pageToken },
  })
  return {
    items: Array.isArray(data.items) ? data.items : [],
    hasMore: Boolean(data.has_more),
    nextToken: data.page_token || '',
  }
}

/** 当前身份的云空间根目录 token（租户身份 = 应用的云空间） */
export async function getRootFolderToken(token) {
  const data = await api('/open-apis/drive/explorer/v2/root_folder/meta', { token })
  return data.token || ''
}

/** 批量查询文档元信息（标题 / 修改时间 / 链接），doc_type: doc | docx | sheet | bitable | file */
export async function queryDocMetas(token, docs) {
  const data = await api('/open-apis/drive/v1/metas/batch_query', {
    token,
    method: 'POST',
    body: {
      request_docs: docs.map((d) => ({ doc_token: d.token, doc_type: d.type })),
      with_url: true,
    },
  })
  return {
    metas: Array.isArray(data.metas) ? data.metas : [],
    failed: Array.isArray(data.failed_list) ? data.failed_list : [],
  }
}

/* —— 正文 —— */

export async function listDocxBlocks(token, documentId, pageToken = '') {
  const data = await api(`/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`, {
    token,
    query: { page_size: 500, page_token: pageToken, document_revision_id: -1 },
  })
  return {
    items: Array.isArray(data.items) ? data.items : [],
    hasMore: Boolean(data.has_more),
    nextToken: data.page_token || '',
  }
}

export async function getDocxRawContent(token, documentId) {
  const data = await api(`/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`, { token })
  return data.content || ''
}

export async function getDocRawContent(token, docToken) {
  const data = await api(`/open-apis/doc/v2/${encodeURIComponent(docToken)}/raw_content`, { token })
  return data.content || ''
}

export async function getSheetMeta(token, spreadsheetToken) {
  const data = await api(`/open-apis/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/query`, { token })
  return Array.isArray(data.sheets) ? data.sheets : []
}

export async function getSheetValues(token, spreadsheetToken, range) {
  const data = await api(`/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(spreadsheetToken)}/values/${encodeURIComponent(range)}`, {
    token,
    query: { valueRenderOption: 'ToString', dateTimeRenderOption: 'FormattedString' },
  })
  const block = data.valueRange || data
  return Array.isArray(block?.values) ? block.values : []
}

export async function listBitableTables(token, appToken) {
  const data = await api(`/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`, {
    token,
    query: { page_size: 100 },
  })
  return Array.isArray(data.items) ? data.items : []
}

export async function listBitableRecords(token, appToken, tableId, pageToken = '') {
  const data = await api(`/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/search`, {
    token,
    method: 'POST',
    query: { page_size: 500, page_token: pageToken, user_id_type: 'open_id' },
    body: {},
  })
  return {
    items: Array.isArray(data.items) ? data.items : [],
    hasMore: Boolean(data.has_more),
    nextToken: data.page_token || '',
  }
}

/* —— 文件导出（Office） —— */

export async function createExportTask(token, fileToken, type, extension) {
  const data = await api('/open-apis/drive/v1/export_tasks', {
    token,
    method: 'POST',
    body: { file_extension: extension, token: fileToken, type },
  })
  if (!data?.ticket) throw new Error('飞书未返回导出任务 ticket')
  return data.ticket
}

/** 返回 { status, fileToken, error } */
export async function getExportTask(token, ticket, fileToken) {
  const data = await api(`/open-apis/drive/v1/export_tasks/${encodeURIComponent(ticket)}`, {
    token,
    query: { token: fileToken },
  })
  const result = data.result || {}
  return {
    status: result.job_status, // 0 未开始 / 1 进行中 / 2 完成 / 3 失败
    fileToken: result.file_token || '',
    error: result.job_error_msg || '',
  }
}

export async function downloadExport(token, fileToken) {
  const res = await fetch(
    `${OPEN_BASE}/open-apis/drive/v1/export_tasks/file/${encodeURIComponent(fileToken)}/download`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) },
  )
  if (!res.ok) throw new Error(`下载导出文件失败（HTTP ${res.status}）`)
  return Buffer.from(await res.arrayBuffer())
}

/** 下载云空间媒体文件（图片等） */
export async function downloadMedia(token, fileToken) {
  const res = await fetch(
    `${OPEN_BASE}/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) },
  )
  if (!res.ok) throw new Error(`下载图片失败（HTTP ${res.status}）`)
  return Buffer.from(await res.arrayBuffer())
}
