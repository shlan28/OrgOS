export interface OrgUser {
  name: string
  permission: '所有者' | '管理员' | '成员'
}

export interface OrgMember {
  id: string
  name: string
  role: string
  permission: '所有者' | '管理员' | '成员'
  online: boolean
  lastActive: string
  source: 'manual' | 'feishu' | string
  createdAt: string
}

export interface OrgFeishuConfig {
  appId: string
  hasSecret: boolean
  redirectUri: string
  connected: boolean
  connectedAt: string
  authorized: boolean
  account: string
  authorizedAt: string
  /** 个人授权申请的云文档权限档位 */
  docScopeLevel: DocScopeLevel
}

export type DocScopeLevel = 'none' | 'read' | 'write' | 'all'

export interface FeishuContact {
  name: string
  department: string
  title: string
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

export const orgApi = {
  session: () => request<{ user: OrgUser | null }>('/api/org/session'),

  members: () => request<{ members: OrgMember[] }>('/api/org/members'),

  addMember: (input: { name: string; role?: string; permission?: string }) =>
    request<{ member: OrgMember }>('/api/org/members', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateMember: (id: string, patch: { role?: string; permission?: string }) =>
    request<{ member: OrgMember }>(`/api/org/members/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  removeMember: (id: string) =>
    request<{ ok: boolean }>(`/api/org/members/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  importMembers: (contacts: FeishuContact[], permission: '管理员' | '成员') =>
    request<{ imported: number; skipped: number }>('/api/org/members/import', {
      method: 'POST',
      body: JSON.stringify({ contacts, permission }),
    }),

  feishu: () => request<OrgFeishuConfig>('/api/org/feishu'),

  saveFeishu: (input: { appId: string; appSecret?: string; redirectUri?: string }) =>
    request<OrgFeishuConfig>('/api/org/feishu', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  verifyFeishu: () =>
    request<OrgFeishuConfig>('/api/org/feishu/verify', { method: 'POST' }),

  clearFeishu: () =>
    request<OrgFeishuConfig>('/api/org/feishu', { method: 'DELETE' }),

  /** 个人授权跳转地址（state=personal，复用同一回调地址） */
  authorizeUrl: () =>
    request<{ configured: boolean; docScope?: boolean; docScopes?: string[]; docScopeLevel?: DocScopeLevel; url?: string }>(
      '/api/org/feishu/authorize-url',
    ),

  /** 设置个人授权申请范围（none / read / write / all） */
  setFeishuDocScope: (level: DocScopeLevel) =>
    request<OrgFeishuConfig>('/api/org/feishu/doc-scope', {
      method: 'PUT',
      body: JSON.stringify({ level }),
    }),

  unauthorizeFeishu: () =>
    request<OrgFeishuConfig>('/api/org/feishu/authorize', { method: 'DELETE' }),

  contacts: () => request<{ contacts: FeishuContact[] }>('/api/org/feishu/contacts'),
}
