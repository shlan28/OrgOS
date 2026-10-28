export interface BackendProjectMember {
  id: string
  projectId: string
  name: string
  role: string
  permission: string
  online: boolean
  lastActive: string
}

export interface BackendProject {
  id: string
  name: string
  description: string
  status: string
  /** 项目类型：dev = 研发，nondev = 非研发 */
  type: 'dev' | 'nondev'
  workspaceMode: 'none' | 'serial' | 'worktree'
  startDate: string
  endDate: string
  folderId: string | null
  createdBy: string
  agentCount: number
  sessionCount: number
  createdAt: string
  updatedAt: string
  members: BackendProjectMember[]
}

export interface BackendFolderMember {
  name: string
  role: 'owner' | 'member'
}

export interface BackendFolder {
  id: string
  name: string
  members: BackendFolderMember[]
  createdAt: string
  updatedAt: string
}

export interface ProjectInput {
  name: string
  description?: string
  status?: string
  type?: 'dev' | 'nondev'
  workspaceMode?: 'none' | 'serial' | 'worktree'
  startDate?: string
  endDate?: string
  folderId?: string | null
  members?: { name: string; role?: string; permission?: string; online?: boolean; lastActive?: string }[]
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

export const projectsApi = {
  projects: () => request<{ projects: BackendProject[] }>('/api/projects'),

  createProject: (input: ProjectInput) =>
    request<{ project: BackendProject }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateProject: (id: string, input: ProjectInput) =>
    request<{ project: BackendProject }>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  folders: () => request<{ folders: BackendFolder[] }>('/api/project-folders'),

  createFolder: (input: { name: string; members: BackendFolderMember[] }) =>
    request<{ folder: BackendFolder }>('/api/project-folders', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateFolder: (id: string, input: { name?: string; members?: BackendFolderMember[] }) =>
    request<{ folder: BackendFolder }>(`/api/project-folders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteFolder: (id: string) =>
    request<{ ok: boolean }>(`/api/project-folders/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
