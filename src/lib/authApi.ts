export interface AuthUser {
  name: string
  permission: string
}

export interface AuthSession {
  authenticated: boolean
  needsSetup: boolean
  user: AuthUser | null
  feishuConfigured: boolean
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

export const authApi = {
  session: () => request<AuthSession>('/api/auth/session'),

  setup: (username: string, password: string) =>
    request<{ user: AuthUser }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  login: (username: string, password: string) =>
    request<{ user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  feishuUrl: () =>
    request<{ configured: boolean; url?: string }>('/api/auth/feishu/url'),
}
