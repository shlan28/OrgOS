const DEFAULT_BASE = {
  'deepseek-official': 'https://api.deepseek.com',
}

/**
 * 从 OpenAI 兼容的 /models 接口拉取模型列表。
 * - deepseek-official 默认 base 为 api.deepseek.com
 * - base 以 /v1 结尾时直接拼 /models，否则先试 /models，404 再试 /v1/models
 */
export async function fetchModels({ provider, baseUrl, apiKey }) {
  const base = (baseUrl || DEFAULT_BASE[provider] || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('请填写 Base URL（该 provider 没有默认地址）')
  if (!/^https?:\/\//i.test(base)) throw new Error('Base URL 必须是 http(s) 地址')
  if (!apiKey) throw new Error('需要 API Key 才能拉取模型')

  const candidates = base.endsWith('/v1')
    ? [`${base}/models`]
    : [`${base}/models`, `${base}/v1/models`]

  let lastError = null
  for (let i = 0; i < candidates.length; i += 1) {
    const url = candidates[i]
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      })
      if (res.status === 404 && i < candidates.length - 1) continue
      if (!res.ok) {
        const text = (await res.text()).slice(0, 200)
        throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`)
      }
      const raw = await res.text()
      if (raw.length > 2_000_000) throw new Error('模型列表响应过大')
      let data
      try { data = JSON.parse(raw) } catch { throw new Error('接口返回不是合法 JSON') }
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : []
      const models = list
        .map((item) => (typeof item === 'string' ? item : item?.id))
        .filter((id) => typeof id === 'string' && id.trim())
        .map((id) => id.trim())
      if (models.length === 0) throw new Error('接口返回里没有模型列表')
      return Array.from(new Set(models))
    } catch (err) {
      lastError = err
      if (err?.name === 'TimeoutError') lastError = new Error('请求超时（12s）')
      if (i < candidates.length - 1 && err instanceof Error && err.message.startsWith('HTTP 404')) continue
    }
  }
  throw new Error(lastError?.message || '拉取模型失败')
}
