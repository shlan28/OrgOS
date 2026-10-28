export type MemoryLifecycle = '活跃' | '即将过期' | '已归档'

export interface MemoryRecord {
  id: string
  content: string
  source: '会话沉淀' | '手动' | string
  createdAt: string
  lifecycle: MemoryLifecycle
  remainDays?: number
  reflectNote?: string
  status: 'active' | 'archived' | 'deleted' | string
  expiresAt?: string
  createdBy?: string
}

export interface MemoryCounts {
  total: number
  expiring: number
  archived: number
}

export interface MemorySettingsDto {
  autoCollect: boolean
  injectMemory: boolean
  collectRules: string
  collectEvery: number
  retentionDays: number
  permanent: boolean
  expirePolicy: '自动归档' | '自动删除' | '仅提醒' | string
  autoReflect: boolean
  reflectFrequency: '每天' | '每周' | '每月' | string
  reflectRules: string
  lastRetentionAt?: string | null
  lastReflectAt?: string | null
  updatedAt: string
}

export interface MemoryListResult {
  memories: MemoryRecord[]
  counts: MemoryCounts
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

const projectPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`

export const memoryApi = {
  list: (projectId: string, opts?: { status?: string; q?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams()
    if (opts?.status) query.set('status', opts.status)
    if (opts?.q) query.set('q', opts.q)
    if (opts?.limit) query.set('limit', String(opts.limit))
    if (opts?.offset) query.set('offset', String(opts.offset))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return request<MemoryListResult>(`${projectPath(projectId)}/memories${suffix}`)
  },

  create: (projectId: string, content: string) =>
    request<{ memory: MemoryRecord }>(`${projectPath(projectId)}/memories`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  remove: (projectId: string, memoryId: string) =>
    request<{ ok: boolean }>(`${projectPath(projectId)}/memories/${encodeURIComponent(memoryId)}`, {
      method: 'DELETE',
    }),

  archiveExpired: (projectId: string) =>
    request<{ archived: number }>(`${projectPath(projectId)}/memories/archive-expired`, {
      method: 'POST',
    }),

  collect: (projectId: string) =>
    request<{ queued: boolean; reason?: string }>(`${projectPath(projectId)}/memories/collect`, {
      method: 'POST',
    }),

  settings: (projectId: string) =>
    request<{ settings: MemorySettingsDto }>(`${projectPath(projectId)}/memory-settings`),

  saveSettings: (projectId: string, patch: Partial<MemorySettingsDto>) =>
    request<{ settings: MemorySettingsDto }>(`${projectPath(projectId)}/memory-settings`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
}
