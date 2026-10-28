export type DocSourceKind = 'folder' | 'wiki_space' | 'doc'
export type DocSyncAuth = 'tenant' | 'user'
export type DocSyncStatus = 'synced' | 'failed' | 'deleted'
export type DocKbState = 'off' | 'fetching' | 'ready' | 'indexed' | 'failed'

export interface DocSource {
  id: string
  projectId: string
  kind: DocSourceKind
  token: string
  name: string
  url: string
  auth: DocSyncAuth
  /** 单篇源（kind=doc）的飞书文档类型：docx / sheet / bitable / file / wiki */
  docType: string
  lastSyncedAt: string | null
  lastStatus: '' | 'ok' | 'partial' | 'failed'
  lastError: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  docCount?: number
}

export interface SyncDoc {
  id: string
  projectId: string
  sourceId: string
  externalToken: string
  externalType: string
  title: string
  url: string
  parentPath: string
  parentToken: string
  modifiedAt: string | null
  revision: string
  sizeBytes: number | null
  syncStatus: DocSyncStatus
  syncError: string | null
  lastSyncedAt: string
  kbState: DocKbState
  kbError: string | null
  kbRevision: string | null
  kbFetchedAt: string | null
  deletedAt: string | null
  /** 快照落后于飞书当前版本 */
  stale: boolean
}

export interface SyncRun {
  id: string
  projectId: string
  sourceId: string | null
  trigger: string
  status: 'running' | 'ok' | 'partial' | 'failed'
  total: number
  added: number
  updated: number
  removed: number
  failed: number
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface DocSourcesResponse {
  sources: DocSource[]
  latestRun: SyncRun | null
  runningRunId: string | null
}

export interface BrowseItem {
  token: string
  nodeToken?: string
  name: string
  type: 'folder' | 'doc' | 'space' | string
  objType?: string
  hasChildren: boolean
  url?: string
}

export interface BrowseResponse {
  auth: DocSyncAuth
  /** 当前层级的 token（目录 token / 空间 id），用于「选择当前目录」 */
  token: string
  items: BrowseItem[]
}

export interface DocContent {
  docId: string
  revision: string
  format: 'markdown' | 'text'
  content: string
  charCount: number
  fetchedAt: string
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let message = `${res.status} ${res.statusText}`
    try {
      const parsed = JSON.parse(body)
      if (parsed?.error) message = parsed.error
    } catch {
      if (body) message = `${message}: ${body.slice(0, 200)}`
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`

export const docSyncApi = {
  sources: (projectId: string) => request<DocSourcesResponse>(`${base(projectId)}/doc-sources`),

  browse: (projectId: string, params: {
    kind: DocSourceKind
    token?: string
    parent?: string
    auth?: DocSyncAuth
  }) => {
    const query = new URLSearchParams({ kind: params.kind, auth: params.auth || 'tenant' })
    if (params.token) query.set('token', params.token)
    if (params.parent) query.set('parent', params.parent)
    return request<BrowseResponse>(`${base(projectId)}/doc-sources/browse?${query.toString()}`)
  },

  addSource: (projectId: string, input: {
    kind: DocSourceKind
    token: string
    name: string
    url?: string
    auth?: DocSyncAuth
    docType?: string
  }) => request<{ source: DocSource; reused?: boolean }>(`${base(projectId)}/doc-sources`, {
    method: 'POST',
    body: JSON.stringify(input),
  }),

  /** 批量添加：目录与单篇文档混选 */
  addSources: (projectId: string, items: {
    kind: DocSourceKind
    token: string
    name: string
    url?: string
    auth?: DocSyncAuth
    docType?: string
  }[]) => request<{ sources: DocSource[]; failed: { name: string; error: string }[] }>(
    `${base(projectId)}/doc-sources/batch`,
    { method: 'POST', body: JSON.stringify({ items }) },
  ),

  removeSource: (projectId: string, sourceId: string) =>
    request<{ ok: true }>(`${base(projectId)}/doc-sources/${encodeURIComponent(sourceId)}`, { method: 'DELETE' }),

  startSync: (projectId: string, sourceId?: string) =>
    request<{ runId: string; reused: boolean }>(`${base(projectId)}/doc-sync`, {
      method: 'POST',
      body: JSON.stringify({ sourceId: sourceId || '' }),
    }),

  latestRun: (projectId: string) =>
    request<{ run: SyncRun | null; runningRunId: string | null }>(`${base(projectId)}/doc-sync/latest`),

  getRun: (projectId: string, runId: string) =>
    request<{ run: SyncRun }>(`${base(projectId)}/doc-sync/runs/${encodeURIComponent(runId)}`),

  docs: (projectId: string, params: { sourceId?: string; kb?: boolean; q?: string } = {}) => {
    const query = new URLSearchParams()
    if (params.sourceId) query.set('sourceId', params.sourceId)
    if (params.kb) query.set('kb', '1')
    if (params.q) query.set('q', params.q)
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return request<{ docs: SyncDoc[] }>(`${base(projectId)}/docs${suffix}`)
  },

  addToKb: (projectId: string, docId: string) =>
    request<{ doc: SyncDoc }>(`${base(projectId)}/docs/${encodeURIComponent(docId)}/kb`, { method: 'POST' }),

  removeFromKb: (projectId: string, docId: string) =>
    request<{ doc: SyncDoc }>(`${base(projectId)}/docs/${encodeURIComponent(docId)}/kb`, { method: 'DELETE' }),

  content: (projectId: string, docId: string) =>
    request<{ content: DocContent }>(`${base(projectId)}/docs/${encodeURIComponent(docId)}/content`),
}
