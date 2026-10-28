export type SandboxState =
  | 'disabled'
  | 'docker_unavailable'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'error'

export interface SandboxStatus {
  enabled: boolean
  status: SandboxState
  message: string
  sandboxDir: string | null
  container: string | null
  image: string
  limits: { cpus: string; memory: string; pids: string }
  daemon: { available: boolean; version: string; error: string }
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

export const sandboxApi = {
  status: (projectId: string) =>
    request<SandboxStatus>(`/api/projects/${encodeURIComponent(projectId)}/sandbox`),

  start: (projectId: string) =>
    request<SandboxStatus>(`/api/projects/${encodeURIComponent(projectId)}/sandbox/start`, {
      method: 'POST',
    }),

  stop: (projectId: string) =>
    request<SandboxStatus>(`/api/projects/${encodeURIComponent(projectId)}/sandbox/stop`, {
      method: 'POST',
    }),
}
