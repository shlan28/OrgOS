import { getKbConfig, kbEmbeddingKey } from './db.js'

const DEFAULT_TIMEOUT_MS = 30_000

/** 嵌入接口失败后的冷却期：避免每次检索/每篇文档都重复打一个注定失败的请求 */
let cooldownUntil = 0
export const embeddingsCoolingDown = () => Date.now() < cooldownUntil
const markFailure = () => { cooldownUntil = Date.now() + 60_000 }

export const embeddingReady = () => {
  const cfg = getKbConfig()
  return Boolean(cfg.baseUrl && cfg.model && kbEmbeddingKey())
}

export const embeddingModel = () => getKbConfig().model || ''

/**
 * 批量嵌入。返回归一化后的 Float32Array 列表；未配置时返回 null。
 * 归一化后点积即余弦相似度。
 */
export async function embedTexts(texts, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const cfg = getKbConfig()
  const key = kbEmbeddingKey()
  if (!cfg.baseUrl || !cfg.model || !key) return null
  if (embeddingsCoolingDown()) throw new Error('嵌入接口暂不可用（冷却中），已跳过向量')

  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/embeddings`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: cfg.model, input: texts }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    markFailure()
    throw err
  }
  if (!res.ok) {
    markFailure()
    const body = (await res.text()).slice(0, 200)
    throw new Error(`嵌入接口 HTTP ${res.status}${body ? `：${body}` : ''}`)
  }
  const data = await res.json()
  const list = Array.isArray(data?.data) ? data.data : []
  if (list.length !== texts.length) {
    markFailure()
    throw new Error('嵌入接口返回数量不匹配')
  }
  return list.map((item) => normalize(item.embedding || []))
}

export function normalize(vec) {
  let sum = 0
  for (const v of vec) sum += v * v
  const norm = Math.sqrt(sum) || 1
  return Float32Array.from(vec, (v) => v / norm)
}

export const toBuffer = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)

export const fromBuffer = (buf) => new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))

/** 归一化向量的余弦相似度 = 点积；维度不一致返回 -1 */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return -1
  let dot = 0
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i]
  return dot
}
