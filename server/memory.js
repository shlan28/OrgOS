import crypto from 'node:crypto'
import {
  advanceSessionCollectCursor,
  archiveMemories,
  countPendingMemoryTurns,
  createMemoryJobRun,
  ensureMemorySettings,
  findMemoryByHash,
  getMemory,
  getMemorySettings,
  getProject,
  getRuntime,
  getSession,
  getSessionCollectCursor,
  insertMemoriesBatch,
  insertMemory,
  insertMemoryEvent,
  listActiveMemories,
  listDoneTurnsAfter,
  listExpiredMemories,
  listFinalsForTurns,
  listMemories,
  listPendingSessionIds,
  listProjectAgents,
  listProjects,
  listProjectSessions,
  listTurns,
  memoryCounts,
  memoryExpiresAt,
  nowISO,
  saveMemorySettings,
  setMemoryStatus,
  touchMemorySettingsRun,
  touchMemoryUsage,
  updateMemoryJobRun,
  runtimeKey,
} from './db.js'
import {
  cosine,
  embedTexts,
  embeddingModel,
  embeddingReady,
  fromBuffer,
  toBuffer,
} from './embeddings.js'

const EXPIRING_DAYS = 7
const MANUAL_MAX_CHARS = 4000
const AUTO_MAX_CHARS = 200
const MAX_MEMORIES_PER_PROJECT = 5000
const RECALL_CANDIDATES = 2000
const RECALL_MAX_CHARS = 1000
const RECALL_TOP_K = 5
const RECALL_MIN_COSINE = Number(process.env.MEMORY_MIN_COSINE || 0.55)
const RECALL_RELATIVE_CUT = 0.75
const COLLECT_MAX_CHARS = 12_000
const COLLECT_MIN_CHARS = 200
const USED_AT_THROTTLE_MS = 3_600_000

const POLICIES = new Set(['自动归档', '自动删除', '仅提醒'])
const REFLECT_FREQS = new Set(['每天', '每周', '每月'])

const collecting = new Set()
const collectingProjects = new Set()
let retentionLoopStarted = false

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra })

/* ---------------- 派生与设置 ---------------- */

export function toMemoryDTO(memory, nowMs = Date.now()) {
  const dto = {
    id: memory.id,
    content: memory.content,
    source: memory.source,
    createdAt: memory.createdAt,
    status: memory.status,
    expiresAt: memory.expiresAt || undefined,
    reflectNote: memory.reflectNote || undefined,
    createdBy: memory.createdBy || undefined,
  }
  if (memory.status === 'archived') {
    dto.lifecycle = '已归档'
    return dto
  }
  const expires = memory.expiresAt ? Date.parse(memory.expiresAt) : NaN
  if (Number.isFinite(expires)) {
    const remain = Math.ceil((expires - nowMs) / 86_400_000)
    if (remain <= EXPIRING_DAYS) {
      dto.lifecycle = '即将过期'
      dto.remainDays = Math.max(0, remain)
      return dto
    }
  }
  dto.lifecycle = '活跃'
  return dto
}

export function listProjectMemories(projectId, opts = {}) {
  return {
    memories: listMemories(projectId, opts).map((m) => toMemoryDTO(m)),
    counts: memoryCounts(projectId),
  }
}

export function getMemorySettingsForProject(projectId) {
  return ensureMemorySettings(projectId)
}

function validateSettingsPatch(input = {}) {
  const patch = {}
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key)
  const booleanKeys = ['autoCollect', 'injectMemory', 'permanent', 'autoReflect']
  for (const key of booleanKeys) {
    if (!has(key)) continue
    if (typeof input[key] !== 'boolean') throw fail(400, `${key} 必须是布尔值`)
    patch[key] = input[key]
  }
  if (has('collectEvery')) {
    const value = Number(input.collectEvery)
    if (!Number.isInteger(value) || value < 1 || value > 50) throw fail(400, 'collectEvery 需为 1–50 的整数')
    patch.collectEvery = value
  }
  if (has('retentionDays')) {
    const value = Number(input.retentionDays)
    if (!Number.isInteger(value) || value < 1 || value > 3650) throw fail(400, '保留天数需为 1–3650 的整数')
    patch.retentionDays = value
  }
  if (has('expirePolicy')) {
    if (!POLICIES.has(input.expirePolicy)) throw fail(400, '无效的过期策略')
    patch.expirePolicy = input.expirePolicy
  }
  if (has('reflectFrequency')) {
    if (!REFLECT_FREQS.has(input.reflectFrequency)) throw fail(400, '无效的反思频率')
    patch.reflectFrequency = input.reflectFrequency
  }
  for (const key of ['collectRules', 'reflectRules']) {
    if (!has(key)) continue
    if (typeof input[key] !== 'string') throw fail(400, `${key} 必须是字符串`)
    if (input[key].length > 2000) throw fail(400, `${key} 不能超过 2000 字`)
    patch[key] = input[key]
  }
  return patch
}

export function updateMemorySettings(projectId, input) {
  const patch = validateSettingsPatch(input)
  return saveMemorySettings(projectId, patch)
}

/* ---------------- 手动增删 ---------------- */

const normalizeText = (text) => text.trim().replace(/\s+/g, ' ').replace(/[A-Z]/g, (ch) => ch.toLowerCase())
const hashText = (text) => crypto.createHash('sha256').update(normalizeText(text)).digest('hex')

async function embedOne(content) {
  if (!embeddingReady()) return { embedding: null, model: '' }
  try {
    const [vector] = await embedTexts([content], { timeoutMs: 5000 })
    if (!vector) return { embedding: null, model: '' }
    return { embedding: toBuffer(vector), model: embeddingModel() }
  } catch {
    return { embedding: null, model: '' }
  }
}

export async function createManualMemory({ projectId, content, userName }) {
  const text = String(content ?? '').trim()
  if (!text) throw fail(400, '请输入记忆内容')
  if (text.length > MANUAL_MAX_CHARS) throw fail(400, `记忆内容不能超过 ${MANUAL_MAX_CHARS} 字`)
  if (memoryCounts(projectId).total >= MAX_MEMORIES_PER_PROJECT) {
    throw fail(400, `单个项目最多 ${MAX_MEMORIES_PER_PROJECT} 条记忆`)
  }
  const hash = hashText(text)
  const existing = findMemoryByHash(projectId, hash)
  if (existing) throw fail(409, '相同记忆已存在', { memory: toMemoryDTO(existing) })

  const settings = ensureMemorySettings(projectId)
  const createdAt = nowISO()
  const { embedding, model } = await embedOne(text)
  const memory = insertMemory({
    projectId,
    content: text,
    source: '手动',
    importance: 0.5,
    dedupeHash: hash,
    embedding,
    embeddingModel: model,
    expiresAt: memoryExpiresAt(createdAt, settings),
    createdBy: userName || '',
    createdAt,
  })
  insertMemoryEvent({ projectId, memoryId: memory.id, type: 'created', actor: userName || '' })
  return toMemoryDTO(memory)
}

export function removeMemory({ projectId, memoryId, userName, canDeleteAll }) {
  const memory = getMemory(memoryId)
  if (!memory || memory.projectId !== projectId) throw fail(404, '记忆不存在')
  if (memory.status === 'deleted') return { ok: true }
  const mine = Boolean(memory.createdBy) && memory.createdBy === userName
  if (!canDeleteAll && !mine) throw fail(403, '只能删除自己手动添加的记忆')
  setMemoryStatus(memoryId, 'deleted')
  insertMemoryEvent({ projectId, memoryId, type: 'deleted', actor: userName || '' })
  return { ok: true }
}

export function archiveProjectExpired(projectId, userName = '') {
  const cutoff = new Date(Date.now() + EXPIRING_DAYS * 86_400_000).toISOString()
  const ids = archiveMemories(projectId, cutoff)
  for (const id of ids) {
    insertMemoryEvent({
      projectId,
      memoryId: id,
      type: 'archived',
      actor: userName || '',
      payload: { reason: 'manual_clean' },
    })
  }
  return ids.length
}

/* ---------------- 过期流转 ---------------- */

export async function runRetention(projectId, { trigger = 'auto' } = {}) {
  const settings = ensureMemorySettings(projectId)
  if (settings.permanent) {
    touchMemorySettingsRun(projectId, 'retention')
    return { changed: 0 }
  }
  const expired = listExpiredMemories(projectId)
  if (expired.length === 0) {
    touchMemorySettingsRun(projectId, 'retention')
    return { changed: 0 }
  }
  if (settings.expirePolicy === '仅提醒') {
    touchMemorySettingsRun(projectId, 'retention')
    return { changed: 0, reminded: expired.length }
  }
  const jobId = createMemoryJobRun({ projectId, kind: 'retention', trigger })
  let changed = 0
  try {
    if (settings.expirePolicy !== '仅提醒') {
      for (const memory of expired) {
        const next = settings.expirePolicy === '自动删除' ? 'deleted' : 'archived'
        setMemoryStatus(memory.id, next)
        insertMemoryEvent({
          projectId,
          memoryId: memory.id,
          type: 'expired',
          actor: 'system',
          payload: { policy: settings.expirePolicy, status: next },
        })
        changed += 1
      }
    }
    updateMemoryJobRun(jobId, {
      status: 'done',
      scanned: expired.length,
      changed,
      detail: { policy: settings.expirePolicy },
    })
  } catch (err) {
    updateMemoryJobRun(jobId, { status: 'error', error: err?.message || 'retention failed' })
    throw err
  }
  touchMemorySettingsRun(projectId, 'retention')
  return { changed }
}

export function startRetentionLoop() {
  if (retentionLoopStarted) return
  retentionLoopStarted = true
  const running = new Set()
  const tick = () => {
    for (const project of listProjects()) {
      if (running.has(project.id)) continue
      running.add(project.id)
      void runRetention(project.id)
        .catch((err) => console.error('[memory] retention failed', project.id, err?.message || err))
        .finally(() => running.delete(project.id))
    }
  }
  setTimeout(tick, 30_000).unref?.()
  setInterval(tick, 3_600_000).unref?.()
}

/* ---------------- 召回 ---------------- */

const STOP_TERMS = new Set(['怎么', '如何', '可以', '这个', '那个', '我们', '你们', '他们', '什么', '一下', '现在', '继续', '还是', '然后', '就是'])

function queryTerms(text) {
  const terms = new Set()
  const lower = text.toLowerCase()
  for (const match of lower.matchAll(/[a-z0-9_]{2,}/g)) terms.add(match[0])
  for (const match of text.matchAll(/[一-龥]{2,}/g)) {
    const word = match[0]
    for (let i = 0; i < word.length - 1; i += 1) {
      const bigram = word.slice(i, i + 2)
      if (!STOP_TERMS.has(bigram)) terms.add(bigram)
    }
  }
  return [...terms]
}

const recencyOf = (createdAt, nowMs) => {
  const created = Date.parse(createdAt)
  if (!Number.isFinite(created)) return 0
  return Math.exp(-Math.max(0, nowMs - created) / (90 * 86_400_000))
}

const importanceOf = (memory) => {
  const value = Number(memory.importance)
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5
}

function bigramSet(text) {
  const set = new Set()
  const lower = text.toLowerCase()
  for (const match of lower.matchAll(/[a-z0-9_]{2,}/g)) set.add(match[0])
  for (const match of text.matchAll(/[一-龥]{2,}/g)) {
    const word = match[0]
    for (let i = 0; i < word.length - 1; i += 1) set.add(word.slice(i, i + 2))
  }
  return set
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const item of a) if (b.has(item)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

function nearDuplicate(a, b) {
  if (a.embedding && b.embedding && a.embeddingModel && a.embeddingModel === b.embeddingModel) {
    const similarity = cosine(fromBuffer(a.embedding), fromBuffer(b.embedding))
    if (similarity >= 0.92) return true
  }
  return jaccard(bigramSet(a.content), bigramSet(b.content)) >= 0.85
}

function buildRecallQuery(query, sessionId) {
  let text = String(query ?? '').trim()
  if (text.length < 8 && sessionId) {
    const previous = listTurns(sessionId)
      .filter((turn) => turn.status === 'done' && turn.userContent.trim())
      .at(-1)
    if (previous) text = `${previous.userContent}\n${text}`
  }
  return text.slice(0, 500)
}

export async function recallMemories(projectId, query, { topK = RECALL_TOP_K, sessionId } = {}) {
  const text = buildRecallQuery(query, sessionId)
  if (!text) return []
  const candidates = listActiveMemories(projectId, RECALL_CANDIDATES)
  if (candidates.length === 0) return []

  const nowMs = Date.now()
  const scored = []
  let usedVector = false

  if (embeddingReady()) {
    const model = embeddingModel()
    const vectorCandidates = candidates.filter((m) => m.embedding && m.embeddingModel === model)
    if (vectorCandidates.length > 0) {
      try {
        const [queryVector] = await embedTexts([text], { timeoutMs: 3000 })
        if (queryVector) {
          usedVector = true
          for (const memory of vectorCandidates) {
            const similarity = cosine(queryVector, fromBuffer(memory.embedding))
            if (similarity < RECALL_MIN_COSINE) continue
            scored.push({
              memory,
              score: 0.65 * similarity + 0.20 * recencyOf(memory.createdAt, nowMs) + 0.15 * importanceOf(memory),
            })
          }
        }
      } catch {
        usedVector = false
      }
    }
  }

  if (!usedVector) {
    const terms = queryTerms(text)
    if (terms.length === 0) return []
    for (const memory of candidates) {
      const content = memory.content.toLowerCase()
      let hits = 0
      for (const term of terms) if (content.includes(term)) hits += 1
      if (hits === 0) continue
      const keyword = hits / terms.length
      scored.push({
        memory,
        score: 0.60 * keyword + 0.25 * recencyOf(memory.createdAt, nowMs) + 0.15 * importanceOf(memory),
      })
    }
  }

  if (scored.length === 0) return []
  scored.sort((a, b) => b.score - a.score)
  const floor = scored[0].score * RECALL_RELATIVE_CUT
  const selected = []
  for (const item of scored) {
    if (selected.length >= Math.max(1, Math.min(Number(topK) || RECALL_TOP_K, 10))) break
    if (item.score < floor) break
    if (selected.some((chosen) => nearDuplicate(chosen.memory, item.memory))) continue
    selected.push(item)
  }

  let chars = 0
  const hits = []
  for (const item of selected) {
    const content = item.memory.content.slice(0, AUTO_MAX_CHARS)
    if (chars + content.length > RECALL_MAX_CHARS) break
    chars += content.length
    hits.push({
      id: item.memory.id,
      content,
      score: Number(item.score.toFixed(4)),
      lifecycle: toMemoryDTO(item.memory).lifecycle,
    })
  }

  const now = nowISO()
  const toTouch = selected
    .map((item) => item.memory)
    .filter((memory) => !memory.lastUsedAt || Date.now() - Date.parse(memory.lastUsedAt) >= USED_AT_THROTTLE_MS)
    .map((memory) => memory.id)
  if (toTouch.length > 0) touchMemoryUsage(toTouch, now)

  return hits
}

export function buildMemoryBlock(hits) {
  const list = hits.map((hit, index) => `[记忆 ${index + 1}] ${hit.content}（${hit.lifecycle}）`).join('\n')
  return [
    '以下是项目记忆，按与当前问题的相关度排序。',
    '记忆可能过时或不完整；如与当前代码、项目知识库或用户本轮说明冲突，',
    '以当前内容为准，不要仅凭记忆下结论。',
    '',
    list,
  ].join('\n')
}

/* ---------------- 自动收集 ---------------- */

const COLLECT_SYSTEM_PROMPT = `你是项目记忆抽取器。从对话中提取值得长期保留、未来仍然有用的项目事实。
只输出 JSON：{"memories":[{"content":"...","importance":0.0}]}

规则：
1. 每条是一句独立、自包含的事实，不超过 200 字；
2. 只保留：代码规范、架构决策、接口/数据约定、第三方坑、业务规则、用户明确偏好；
3. 忽略：寒暄、临时调试、一次性命令、未确认的猜测；
4. 绝不记录密钥、密码、token、个人隐私信息；
5. 最多 5 条；没有值得保留的内容返回 {"memories":[]}。`

function buildCollectMessages({ project, settings, transcript }) {
  return [
    { role: 'system', content: COLLECT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `项目：${project.name}`,
        `项目描述：${project.description || '无'}`,
        `项目记忆收集规则：${settings.collectRules || '无，按通用规则'}`,
        '对话：',
        transcript,
      ].join('\n'),
    },
  ]
}

async function chatComplete({ runtime, key, model, messages, timeoutMs = 30_000 }) {
  const base = String(runtime.baseUrl || '').replace(/\/+$/, '')
  const candidates = base.endsWith('/v1') ? [base] : [base, `${base}/v1`]
  let lastError = null
  for (let i = 0; i < candidates.length; i += 1) {
    try {
      const res = await fetch(`${candidates[i]}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 800 }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 404 && i < candidates.length - 1) continue
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200)
        throw new Error(`模型接口 HTTP ${res.status}${body ? `：${body}` : ''}`)
      }
      const data = await res.json()
      const content = data?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) throw new Error('模型返回为空')
      return content
    } catch (err) {
      lastError = err
      if (i < candidates.length - 1 && String(err?.message || '').includes('HTTP 404')) continue
      throw err
    }
  }
  throw lastError || new Error('模型调用失败')
}

function parseExtraction(text) {
  let raw = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.memories) ? data.memories : null
  if (!list) return null
  return list.slice(0, 5).map((item) => {
    if (typeof item === 'string') return { content: item.trim(), importance: 0.5 }
    if (!item || typeof item.content !== 'string') return null
    return { content: item.content.trim(), importance: Number(item.importance) }
  }).filter(Boolean)
}

async function runCollectSession({ project, agent, session, settings }) {
  const cursor = getSessionCollectCursor(session.id)
  const pending = listDoneTurnsAfter(session.id, cursor)
  if (pending.length === 0) return { scanned: 0, changed: 0, skipped: 'empty' }

  const picked = []
  let chars = 0
  for (const turn of pending) {
    if (picked.length >= settings.collectEvery) break
    const length = (turn.userContent || '').length
    if (picked.length > 0 && chars + length > COLLECT_MAX_CHARS) break
    picked.push(turn)
    chars += length
  }
  if (picked.length === 0) return { scanned: 0, changed: 0, skipped: 'empty' }

  const lastSeq = picked[picked.length - 1].seq
  const finals = listFinalsForTurns(picked.map((turn) => turn.id))
  const transcript = picked
    .map((turn) => `用户：${turn.userContent}\n助手：${finals.get(turn.id)?.text ?? ''}`)
    .join('\n\n')
    .slice(-COLLECT_MAX_CHARS)

  if (transcript.trim().length < COLLECT_MIN_CHARS) {
    advanceSessionCollectCursor(session.id, lastSeq)
    return { scanned: picked.length, changed: 0, skipped: 'short' }
  }

  const runtime = agent?.runtimeId ? getRuntime(agent.runtimeId) : null
  const key = runtime ? runtimeKey(runtime.id) : ''
  if (!runtime?.baseUrl || !agent?.model || !key) {
    return { scanned: picked.length, changed: 0, skipped: 'no_runtime' }
  }

  const raw = await chatComplete({
    runtime,
    key,
    model: agent.model,
    messages: buildCollectMessages({ project, settings, transcript }),
  })
  const items = parseExtraction(raw)
  if (!items) throw fail(502, '模型返回不是合法 JSON')

  const seen = new Set()
  const accepted = []
  let duplicates = 0
  let dropped = 0
  for (const item of items) {
    const content = item.content.trim()
    if (!content || content.length > AUTO_MAX_CHARS) {
      dropped += 1
      continue
    }
    const hash = hashText(content)
    if (seen.has(hash) || findMemoryByHash(project.id, hash, { includeDeleted: true })) {
      duplicates += 1
      continue
    }
    seen.add(hash)
    const importance = Number(item.importance)
    accepted.push({
      content,
      hash,
      importance: Number.isFinite(importance) ? Math.max(0, Math.min(1, importance)) : 0.5,
    })
  }

  if (accepted.length === 0) {
    advanceSessionCollectCursor(session.id, lastSeq)
    return { scanned: picked.length, changed: 0, detail: { duplicates, dropped } }
  }

  const currentSettings = getMemorySettings(project.id) || settings
  let vectors = null
  if (embeddingReady()) {
    try {
      vectors = await embedTexts(accepted.map((item) => item.content), { timeoutMs: 10_000 })
    } catch {
      vectors = null
    }
  }
  const model = vectors ? embeddingModel() : ''
  const createdAt = nowISO()
  const rows = accepted.map((item, index) => ({
    projectId: project.id,
    content: item.content,
    source: '会话沉淀',
    sourceSessionId: session.id,
    sourceTurnId: picked[picked.length - 1].id,
    importance: item.importance,
    dedupeHash: item.hash,
    embedding: vectors?.[index] ? toBuffer(vectors[index]) : null,
    embeddingModel: vectors?.[index] ? model : '',
    expiresAt: memoryExpiresAt(createdAt, currentSettings),
    createdBy: '',
    createdAt,
  }))
  const inserted = insertMemoriesBatch(rows)
  for (const memory of inserted) {
    insertMemoryEvent({
      projectId: project.id,
      memoryId: memory.id,
      type: 'collected',
      actor: 'system',
      payload: { turnId: picked[picked.length - 1].id, model: agent.model },
    })
  }
  advanceSessionCollectCursor(session.id, lastSeq)
  return {
    scanned: picked.length,
    changed: inserted.length,
    detail: { duplicates, dropped },
  }
}

export async function maybeCollectIfDue({ agent, session }) {
  if (!session?.projectId || !agent) return
  const settings = ensureMemorySettings(session.projectId)
  if (!settings.autoCollect) return
  if (countPendingMemoryTurns(session.id) < settings.collectEvery) return
  if (collecting.has(session.id)) return
  const runtime = agent.runtimeId ? getRuntime(agent.runtimeId) : null
  if (!runtime?.baseUrl || !agent.model || !runtimeKey(runtime.id)) return

  collecting.add(session.id)
  const jobId = createMemoryJobRun({ projectId: session.projectId, kind: 'collect', trigger: 'threshold' })
  try {
    const project = getProject(session.projectId)
    if (!project) {
      updateMemoryJobRun(jobId, { status: 'skipped', error: 'project not found' })
      return
    }
    const result = await runCollectSession({ project, agent, session, settings })
    updateMemoryJobRun(jobId, {
      status: result.skipped ? 'skipped' : 'done',
      scanned: result.scanned,
      changed: result.changed,
      detail: { ...(result.detail || {}), skipped: result.skipped || undefined },
    })
  } catch (err) {
    updateMemoryJobRun(jobId, { status: 'error', error: err?.message || 'collect failed' })
    throw err
  } finally {
    collecting.delete(session.id)
  }
}

/** 手动收集：处理项目内所有有积压的会话，每个会话一个窗口 */
export async function runCollect(projectId, { trigger = 'manual' } = {}) {
  if (collectingProjects.has(projectId)) return { sessions: 0, changed: 0, running: true }
  const project = getProject(projectId)
  if (!project) throw fail(404, '项目不存在')
  if (!collectRuntimeAvailable(projectId)) throw fail(400, '未配置可用的模型运行时')
  collectingProjects.add(projectId)
  try {
    return await runCollectProject(project, { trigger })
  } finally {
    collectingProjects.delete(projectId)
  }
}

export const isCollectingProject = (projectId) => collectingProjects.has(projectId)

/** 项目是否有可用的收集模型（Agent 运行时 + Key + 模型） */
export function collectRuntimeAvailable(projectId) {
  const agent = listProjectAgents(projectId)[0]
  if (!agent?.runtimeId || !agent.model) return false
  const runtime = getRuntime(agent.runtimeId)
  return Boolean(runtime?.baseUrl && runtimeKey(runtime.id))
}

async function runCollectProject(project, { trigger }) {
  const sessionIds = listPendingSessionIds(project.id)
  if (sessionIds.length === 0) return { sessions: 0, changed: 0 }

  const settings = ensureMemorySettings(project.id)
  const agent = listProjectAgents(project.id)[0] || null
  const jobId = createMemoryJobRun({ projectId: project.id, kind: 'collect', trigger })
  let scanned = 0
  let changed = 0
  const errors = []
  for (const sessionId of sessionIds) {
    if (collecting.has(sessionId)) continue
    const session = getSession(sessionId)
    if (!session) continue
    collecting.add(sessionId)
    try {
      const result = await runCollectSession({ project, agent, session, settings })
      scanned += result.scanned || 0
      changed += result.changed || 0
    } catch (err) {
      errors.push(`${sessionId}: ${err?.message || 'collect failed'}`)
    } finally {
      collecting.delete(sessionId)
    }
  }
  updateMemoryJobRun(jobId, {
    status: errors.length > 0 ? 'error' : 'done',
    scanned,
    changed,
    detail: { sessions: sessionIds.length },
    error: errors.length > 0 ? errors.join('; ') : null,
  })
  return { sessions: sessionIds.length, changed, errors }
}

/** 供会话列表等复用：项目里还有多少待收集轮次 */
export function pendingTurnsOfProject(projectId) {
  return listProjectSessions(projectId).reduce((sum, session) => sum + countPendingMemoryTurns(session.id), 0)
}
