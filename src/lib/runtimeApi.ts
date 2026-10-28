import type { AdeAgent } from '../data/projects'

export type PermissionMode = 'readonly' | 'workspace-write' | 'full'

export interface RuntimeProject {
  id: string
  name: string
  description: string
  status: string
  agentCount: number
  sessionCount: number
  createdAt: string
  updatedAt: string
}

export interface RuntimeProfile {
  id: string
  name: string
  provider: string
  baseUrl: string
  models: string[]
  hasKey: boolean
  createdAt: string
  updatedAt: string
}

export interface RuntimeAgent {
  id: string
  name: string
  role: string
  model: string
  provider: string
  permission: PermissionMode | string
  workdir: string
  projectId: string | null
  runtimeId: string | null
  /** 运行时派生状态（有 running 会话 = 工作中） */
  status?: string
  currentTask?: string
  /** 该 agent 名下的会话数（删除前提示用） */
  sessionCount?: number
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface RuntimeInfo {
  cli: { exists: boolean; path: string; version: string | null }
  keyConfigured: boolean
  baseUrl: string
  dataDir: string
  defaultWorkdir: string
}

export interface RuntimeSession {
  id: string
  agentId: string
  projectId: string | null
  externalRef: string | null
  title: string
  dshSessionId: string | null
  status: 'idle' | 'queued' | 'running' | string
  /** 创建者用户名 */
  createdBy?: string
  /** 最后一条消息时间 */
  lastMessageAt?: string | null
  /** 当前用户未读数 */
  unreadCount?: number
  createdAt: string
  updatedAt: string
}

export interface RuntimeTurn {
  id: string
  sessionId: string
  seq: number
  userContent: string
  status: 'running' | 'done' | 'error' | string
  error: string | null
  /** 本轮是否勾选了「使用知识库」 */
  useKnowledge?: boolean
  /** 本轮是否注入项目记忆 */
  useMemory?: boolean
  createdAt: string
  endedAt: string | null
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  at: string
  status?: string
  turnId?: string
  /** 用户消息发送者 */
  userName?: string
  /** agent 消息执行者 */
  agentName?: string
  /** 失败 / 取消原因 */
  error?: string
}

export interface ChatMessagePage {
  messages: ChatMessage[]
  hasMore: boolean
  nextBefore: number | null
}

export interface TurnEndReason {
  kind?: string
  error?: { message?: string; code?: string }
}

/** 会话内的持久化事件（CLI 历史回放） */
export interface SessionEvent {
  turnId: string
  turnSeq: number
  seq: number
  type: string
  payload: HarnessEvent
  at: string
}

export type HarnessEvent =
  | { type: 'session'; sessionId: string; cwd: string }
  | {
      type: 'status'
      phase: 'turn_start' | 'step_start' | 'step_end' | 'turn_end' | string
      turn?: number
      step?: number
      reason?: TurnEndReason
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    }
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; callId: string; tool: string; input: unknown }
  | { type: 'tool_result'; callId: string; status: 'completed' | 'error' | string; result: string }
  | { type: 'final'; text: string }
  | { type: 'error'; code?: string; message: string }
  | {
      type: 'kb_search'
      query: string
      chunks: { title: string; sectionPath: string; score: number }[]
      lowConfidence?: boolean
    }
  | {
      type: 'memory_recall'
      query: string
      count: number
      memories: { id: string; content: string; score: number; lifecycle: string }[]
    }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`)
  }
  return res.json() as Promise<T>
}

export const runtimeApi = {
  info: () => request<RuntimeInfo>('/api/runtime'),

  saveRuntime: (patch: { deepseekApiKey?: string; deepseekBaseUrl?: string }) =>
    request<{ keyConfigured: boolean; baseUrl: string }>('/api/runtime', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  agents: () => request<{ agents: RuntimeAgent[] }>('/api/agents'),

  runtimes: () => request<{ runtimes: RuntimeProfile[] }>('/api/runtimes'),

  createRuntime: (input: { name: string; provider?: string; baseUrl?: string; models?: string[] }) =>
    request<{ runtime: RuntimeProfile }>('/api/runtimes', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateRuntime: (id: string, patch: Partial<Pick<RuntimeProfile, 'name' | 'provider' | 'baseUrl' | 'models'>>) =>
    request<{ runtime: RuntimeProfile }>(`/api/runtimes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteRuntime: (id: string) =>
    request<{ ok: boolean }>(`/api/runtimes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  setRuntimeKey: (id: string, apiKey: string) =>
    request<{ runtime: RuntimeProfile }>(`/api/runtimes/${encodeURIComponent(id)}/key`, {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),

  /** 从 provider 的 /models 拉取模型（未保存的运行时也可用；runtimeId 用于复用已存 Key） */
  fetchModels: (input: { provider?: string; baseUrl?: string; apiKey?: string; runtimeId?: string }) =>
    request<{ models: string[] }>('/api/runtimes/models', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateAgent: (id: string, patch: Partial<RuntimeAgentInput>) =>
    request<{ agent: RuntimeAgent }>(`/api/agents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  projects: () => request<{ projects: RuntimeProject[] }>('/api/projects'),

  createProject: (input: { name: string; description?: string; status?: string }) =>
    request<{ project: RuntimeProject }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateProject: (id: string, patch: Partial<Pick<RuntimeProject, 'name' | 'description' | 'status'>>) =>
    request<{ project: RuntimeProject }>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  project: (id: string) =>
    request<{ project: RuntimeProject }>(`/api/projects/${encodeURIComponent(id)}`),

  projectAgents: (id: string) =>
    request<{ agents: RuntimeAgent[] }>(`/api/projects/${encodeURIComponent(id)}/agents`),

  projectSessions: (id: string) =>
    request<{ sessions: RuntimeSession[] }>(`/api/projects/${encodeURIComponent(id)}/sessions`),

  createProjectSession: (id: string, input?: { title?: string }) =>
    request<{ session: RuntimeSession }>(`/api/projects/${encodeURIComponent(id)}/sessions`, {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    }),

  syncAgents: (agents: RuntimeAgentInput[]) =>
    request<{ agents: RuntimeAgent[] }>('/api/agents/sync', {
      method: 'POST',
      body: JSON.stringify({ agents }),
    }),

  sessions: (agentId: string) =>
    request<{ sessions: RuntimeSession[] }>(`/api/agents/${encodeURIComponent(agentId)}/sessions`),

  createSession: (agentId: string, title?: string, opts?: { externalRef?: string; projectId?: string }) =>
    request<{ session: RuntimeSession; reused?: boolean }>(`/api/agents/${encodeURIComponent(agentId)}/sessions`, {
      method: 'POST',
      body: JSON.stringify({ title, ...(opts ?? {}) }),
    }),

  deleteSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),

  updateSession: (sessionId: string, patch: { title: string }) =>
    request<{ session: RuntimeSession }>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  sessionEvents: (sessionId: string, turns = 50) =>
    request<{ events: SessionEvent[] }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/events?turns=${turns}`,
    ),

  markSessionRead: (sessionId: string, seq?: number) =>
    request<{ ok: boolean; lastReadSeq: number }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/read`,
      { method: 'POST', body: JSON.stringify(seq == null ? {} : { seq }) },
    ),

  sessionStreamUrl: (sessionId: string) =>
    `/api/sessions/${encodeURIComponent(sessionId)}/stream`,

  messages: (sessionId: string, opts?: { before?: number | null; limit?: number }) => {
    const query = new URLSearchParams()
    if (opts?.before != null) query.set('before', String(opts.before))
    if (opts?.limit) query.set('limit', String(opts.limit))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return request<ChatMessagePage>(`/api/sessions/${encodeURIComponent(sessionId)}/messages${suffix}`)
  },

  createTurn: (sessionId: string, content: string, useKnowledge = false, useMemory = true) =>
    request<{ turn: RuntimeTurn; queuePosition: number }>(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ content, useKnowledge, useMemory }),
    }),

  cancelTurn: (turnId: string) =>
    request<{ ok: boolean }>(`/api/turns/${encodeURIComponent(turnId)}/cancel`, { method: 'POST' }),

  streamUrl: (turnId: string) => `/api/turns/${encodeURIComponent(turnId)}/stream`,
}

export interface RuntimeAgentInput {
  id: string
  name: string
  role: string
  model: string
  provider: string
  permission: string
  workdir: string
  projectId?: string | null
  runtimeId?: string | null
  config: Record<string, unknown>
}

/** 后端 agent → 设置页 AdeAgent（复用现有配置弹窗） */
export function toAdeAgent(agent: RuntimeAgent): AdeAgent {
  const cfg = agent.config || {}
  const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    model: agent.model,
    status: agent.status === '工作中' ? '工作中' : '空闲',
    currentTask: str(agent.currentTask),
    sessionCount: agent.sessionCount ?? 0,
    linkedProject: str(cfg.linkedProject, '不关联项目'),
    multimodalModel: str(cfg.multimodalModel),
    collabModel: str(cfg.collabModel),
    model4: str(cfg.model4),
    knowledgeBases: strArr(cfg.knowledgeBases),
    mcpServices: strArr(cfg.mcpServices),
    adeMd: str(cfg.adeMd),
    tools: (cfg.tools && typeof cfg.tools === 'object' ? cfg.tools : {}) as Record<string, boolean>,
    provider: agent.provider,
    permission: agent.permission as AdeAgent['permission'],
    workdir: agent.workdir,
    projectId: agent.projectId ?? null,
    runtimeId: agent.runtimeId ?? null,
  }
}

/** 设置页 AdeAgent → 后端同步入参 */
export function toRuntimeInput(agent: AdeAgent): RuntimeAgentInput {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    model: agent.model,
    provider: agent.provider || 'deepseek-official',
    permission: agent.permission || 'workspace-write',
    workdir: agent.workdir || '',
    runtimeId: agent.runtimeId ?? undefined,
    // projectId 由项目详情页显式绑定；这里不传，避免设置页整表同步把绑定关系覆盖掉
    // status/currentTask 由后端按运行中会话派生，不再写入 config
    config: {
      linkedProject: agent.linkedProject,
      multimodalModel: agent.multimodalModel,
      collabModel: agent.collabModel,
      model4: agent.model4 ?? '',
      knowledgeBases: agent.knowledgeBases,
      mcpServices: agent.mcpServices,
      adeMd: agent.adeMd,
      tools: agent.tools,
    },
  }
}
