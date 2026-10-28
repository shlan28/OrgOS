export interface KbCounts {
  included: number
  indexed: number
  ready: number
  fetching: number
  failed: number
  stale: number
  /** 已同步但还没加入知识库的文档数 */
  off: number
}

export interface KbStatus {
  counts: KbCounts
  coverage: number
  chunks: {
    chunks: number
    docs: number
    embedded: number
    /** 当前嵌入模型已向量化的片段数 */
    embeddedCurrent: number
    /** 属于旧模型、需要重嵌的片段数 */
    embeddingStale: number
  }
  config: KbConfig
  latestRun: {
    id: string
    status: string
    chunks: number
    embedded: number
    error: string | null
    startedAt: string
    finishedAt: string | null
  } | null
  indexing: number
}

export interface KbConfig {
  baseUrl: string
  model: string
  dim: number
  glossary: string
  /** 图片转写（OCR）用的视觉模型 */
  visionModel: string
  /** 重排用的对话模型 */
  rerankModel: string
  hasKey: boolean
}

export interface KbChunk {
  id: string
  ordinal: number
  sectionPath: string
  content: string
  charCount: number
  hasEmbedding: boolean
}

export interface KbSearchHit {
  id: string
  docId: string
  ordinal: number
  sectionPath: string
  content: string
  score: number
  routes: string[]
  neighbors: { ordinal: number; content: string }[]
  doc: { title: string; url: string; externalType: string }
}

export interface KbSearchResult {
  chunks: KbSearchHit[]
  lowConfidence: boolean
  coverage: number
  reranked: boolean
  routes: { bm25: number; vector: number; like: number }
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

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/kb`

export const kbApi = {
  status: (projectId: string) => request<KbStatus>(`${base(projectId)}/status`),

  index: (projectId: string, docId?: string) =>
    request<{ queued: boolean }>(`${base(projectId)}/index`, {
      method: 'POST',
      body: JSON.stringify(docId ? { docId } : {}),
    }),

  /** 批量收录还没进知识库的文档（拉正文 + 建索引） */
  collect: (projectId: string, sourceId?: string) =>
    request<{ queued: number }>(`${base(projectId)}/collect`, {
      method: 'POST',
      body: JSON.stringify(sourceId ? { sourceId } : {}),
    }),

  chunks: (projectId: string, docId: string, limit = 20, offset = 0) =>
    request<{ chunks: KbChunk[]; limit: number; offset: number }>(
      `${base(projectId)}/docs/${encodeURIComponent(docId)}/chunks?limit=${limit}&offset=${offset}`,
    ),

  search: (projectId: string, q: string, topK = 8, rerank = false) =>
    request<KbSearchResult>(`${base(projectId)}/search`, {
      method: 'POST',
      body: JSON.stringify({ q, topK, rerank }),
    }),

  getConfig: (projectId: string) => request<{ config: KbConfig }>(`${base(projectId)}/config`),

  saveConfig: (projectId: string, input: Partial<KbConfig> & { apiKey?: string }) =>
    request<{ config: KbConfig }>(`${base(projectId)}/config`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
}
