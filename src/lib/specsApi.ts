export interface ProjectSpec {
  id: string
  name: string
  note: string
  markdown: string
  inPrompt: boolean
  createdAt: string
  updatedAt: string
  bytes: number
}

export interface SpecPromptUsage {
  count: number
  bytes: number
  maxBytes: number
  perSpecMaxBytes: number
}

export interface SpecListResult {
  specs: ProjectSpec[]
  prompt: SpecPromptUsage
}

export interface SpecInput {
  name?: string
  note?: string
  markdown?: string
  inPrompt?: boolean
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

export const specsApi = {
  list: (projectId: string) => request<SpecListResult>(`${projectPath(projectId)}/specs`),

  create: (projectId: string, input: SpecInput) =>
    request<{ spec: ProjectSpec; prompt: SpecPromptUsage }>(`${projectPath(projectId)}/specs`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  update: (projectId: string, specId: string, input: SpecInput) =>
    request<{ spec: ProjectSpec; prompt: SpecPromptUsage }>(
      `${projectPath(projectId)}/specs/${encodeURIComponent(specId)}`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),

  remove: (projectId: string, specId: string) =>
    request<{ ok: boolean; prompt: SpecPromptUsage }>(
      `${projectPath(projectId)}/specs/${encodeURIComponent(specId)}`,
      { method: 'DELETE' },
    ),

  setPrompt: (projectId: string, specId: string, inPrompt: boolean) =>
    request<{ spec: ProjectSpec; prompt: SpecPromptUsage }>(
      `${projectPath(projectId)}/specs/${encodeURIComponent(specId)}/prompt`,
      { method: 'PATCH', body: JSON.stringify({ inPrompt }) },
    ),
}
