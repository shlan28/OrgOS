import crypto from 'node:crypto'
import {
  createKbRun,
  deleteChunksByIds,
  getChunkStats,
  getFeishuDoc,
  getFeishuDocContent,
  getKbConfig,
  kbEmbeddingKey,
  listChunksByDoc,
  listChunksToEmbed,
  listChunksWithEmbeddings,
  listFeishuDocs,
  listSiblingChunks,
  insertChunk,
  searchChunksFts,
  searchChunksLike,
  setChunkEmbedding,
  setFeishuDocKb,
  updateKbRun,
} from './db.js'
import {
  embedTexts,
  embeddingReady,
  embeddingsCoolingDown as embedCoolingDown,
  fromBuffer,
  toBuffer,
} from './embeddings.js'

const TARGET_CHARS = 800
const OVERLAP_CHARS = 120
const MIN_SECTION_CHARS = 40
const MAX_TABLE_CHARS = 2000
const MAX_CHUNKS_PER_DOC = 500
const ROUTE_TOP = 40
const RRF_K = 60
const MAX_PER_DOC = 4
const EMBED_BATCH = 16

/** 融合权重与向量门限：可通过环境变量做 A/B，默认值取实验后的最优组合 */
const envNum = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}
const ROUTE_WEIGHTS = {
  bm25: envNum('KB_WEIGHT_BM25', 1),
  like: envNum('KB_WEIGHT_LIKE', 0.8),
  vector: envNum('KB_WEIGHT_VECTOR', 0.35),
}
const MIN_COSINE = envNum('KB_MIN_COSINE', 0.6)
/** always = 总是融合向量；fallback = 仅当关键词命中不足 3 条时才用向量 */
const VECTOR_MODE = process.env.KB_VECTOR_MODE || 'always'

const nowISO = () => new Date().toISOString()
const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex')

/* ================= 切分 ================= */

/**
 * markdown → 片段。规则见方案 §4：
 * 标题切节 → 过短并入上一节 → 块（段落/表格/代码）打包到 800 字 → 超长块二次切分。
 */
export function chunkMarkdown(markdown, title = '') {
  const text = String(markdown || '').replace(/\r\n/g, '\n')
  if (!text.trim()) return []

  const sections = splitSections(text)
  const merged = mergeTiny(sections)
  const out = []

  for (const section of merged) {
    const blocks = splitBlocks(section.body)
    const packed = packBlocks(blocks)
    for (const content of packed) {
      const trimmed = content.trim()
      if (!trimmed) continue
      const path = section.path.join(' › ')
      const head = [title, path].filter(Boolean).join(' › ')
      out.push({
        sectionPath: path,
        content: trimmed,
        context: head ? `${head}\n${trimmed}` : trimmed,
      })
      if (out.length >= MAX_CHUNKS_PER_DOC) return out
    }
  }
  return out
}

function splitSections(text) {
  const lines = text.split('\n')
  const sections = []
  let stack = []
  let current = { path: [], body: [] }
  let inFence = false

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence
    const m = !inFence && /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) {
      sections.push(current)
      const level = m[1].length
      stack = stack.filter((h) => h.level < level)
      stack.push({ level, text: m[2].trim() })
      current = { path: stack.map((h) => h.text), body: [] }
      continue
    }
    current.body.push(line)
  }
  sections.push(current)
  return sections
}

/** 过短的小节并入上一节，避免「只有标题」的碎片 */
function mergeTiny(sections) {
  const out = []
  for (const section of sections) {
    const body = section.body.join('\n').trim()
    if (!body) continue
    const prev = out[out.length - 1]
    if (body.length < MIN_SECTION_CHARS && prev && !section.path.length) {
      prev.body = `${prev.body}\n\n${body}`
      continue
    }
    out.push({ path: section.path, body })
  }
  return out
}

/** 段落 / 表格 / 代码块 三种原子块 */
function splitBlocks(body) {
  const lines = body.split('\n')
  const blocks = []
  let buf = []
  let inFence = false
  let fenceLang = ''

  const flush = () => {
    const text = buf.join('\n').trim()
    if (text) blocks.push(text)
    buf = []
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const fence = /^\s*```(.*)$/.exec(line)

    if (inFence) {
      buf.push(line)
      if (fence) {
        inFence = false
        const text = buf.join('\n').trim()
        if (text) blocks.push({ kind: 'code', text, lang: fenceLang })
        buf = []
      }
      continue
    }
    if (fence) {
      flush()
      inFence = true
      fenceLang = fence[1].trim()
      buf.push(line)
      continue
    }
    if (/^\s*\|/.test(line)) {
      flush()
      const table = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        table.push(lines[i])
        i += 1
      }
      i -= 1
      blocks.push({ kind: 'table', text: table.join('\n') })
      continue
    }
    if (!line.trim()) { flush(); continue }
    buf.push(line)
  }
  flush()
  return blocks
}

/** 把块打包成不超过目标长度的片段；超长块单独切分 */
function packBlocks(blocks) {
  const out = []
  let current = ''

  const push = (text) => {
    const value = text.trim()
    if (!value) return
    if (!current) { current = value; return }
    if (current.length + value.length + 2 <= TARGET_CHARS) {
      current = `${current}\n\n${value}`
      return
    }
    out.push(current)
    current = value
  }

  for (const block of blocks) {
    const text = typeof block === 'string' ? block : block.text
    if (text.length <= TARGET_CHARS) { push(text); continue }
    if (current) { out.push(current); current = '' }
    for (const piece of splitOversized(text, typeof block === 'string' ? undefined : block.kind)) {
      out.push(piece)
    }
  }
  if (current) out.push(current)
  return out
}

/** 超长块：表格按行切并重复表头，代码按空行切，普通文本按段落切带重叠 */
function splitOversized(text, kind) {
  const limit = kind === 'table' ? MAX_TABLE_CHARS : TARGET_CHARS
  if (kind === 'code') {
    // 超长代码块：按行切，每段都要自带围栏，否则中间片段渲染成纯文本
    const lines = text.split('\n')
    const open = lines[0] || '```'
    const last = lines[lines.length - 1] || ''
    const closed = lines.length > 1 && last.trim() === '```'
    const close = closed ? last : '```'
    const body = closed ? lines.slice(1, -1) : lines.slice(1)
    const out = []
    let buf = []
    let size = open.length + close.length + 2
    for (const line of body) {
      if (buf.length > 0 && size + line.length + 1 > limit) {
        out.push([open, ...buf, close].join('\n'))
        buf = []
        size = open.length + close.length + 2
      }
      buf.push(line)
      size += line.length + 1
    }
    if (buf.length > 0) out.push([open, ...buf, close].join('\n'))
    return out
  }
  if (kind === 'table') {
    const lines = text.split('\n')
    const header = lines.slice(0, 2)
    const rows = lines.slice(2)
    const out = []
    let buf = [...header]
    let size = header.join('\n').length
    for (const row of rows) {
      if (size + row.length > limit && buf.length > header.length) {
        out.push(buf.join('\n'))
        buf = [...header]
        size = header.join('\n').length
      }
      buf.push(row)
      size += row.length + 1
    }
    if (buf.length > header.length) out.push(buf.join('\n'))
    return out
  }

  const paragraphs = text.split(/\n\s*\n/).filter(Boolean)
  const out = []
  let buf = ''
  for (const para of paragraphs) {
    if (para.length > limit) {
      if (buf) { out.push(buf); buf = '' }
      let pos = 0
      while (pos < para.length) {
        const end = cutPoint(para, pos, limit)
        out.push(para.slice(pos, end))
        if (end >= para.length) break
        // 重叠段也从句子开头起，避免片段以半句话开头
        pos = Math.max(overlapStart(para, end - OVERLAP_CHARS, end), pos + 1)
      }
      continue
    }
    if (buf && buf.length + para.length + 2 > limit) {
      out.push(buf)
      buf = buf.slice(-OVERLAP_CHARS)
    }
    buf = buf ? `${buf}\n\n${para}` : para
  }
  if (buf) out.push(buf)
  return out
}

/** 在容量窗口内尽量切在句末标点，避免把词切两半 */
function cutPoint(text, start, limit) {
  const end = Math.min(start + limit, text.length)
  const earliest = start + Math.floor(limit * 0.6)
  for (let i = end; i > earliest; i -= 1) {
    if (/[。！？；\n]/.test(text[i - 1])) return i
  }
  return end
}

/** 重叠区的起点：从 end 往前找最近一个句首 */
function overlapStart(text, from, to) {
  for (let i = to - 1; i >= from; i -= 1) {
    if (/[。！？；\n]/.test(text[i])) return i + 1
  }
  return from
}

const chunkIdOf = (docId, sectionPath, ordinal, content) =>
  `kbc_${sha1(`${docId}|${sectionPath}|${ordinal}|${content}`).slice(0, 24)}`

/* ================= 嵌入 ================= */

async function embedAndStore(chunks) {
  if (!embeddingReady() || chunks.length === 0 || embedCoolingDown()) return 0
  const cfg = getKbConfig()
  let embedded = 0
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH)
    const vectors = await embedTexts(batch.map((c) => c.context))
    if (!vectors) break
    batch.forEach((chunk, index) => {
      setChunkEmbedding(chunk.id, toBuffer(vectors[index]), cfg.model)
      embedded += 1
    })
  }
  return embedded
}

/* ================= 索引 ================= */

const indexing = new Set()

export function isIndexing(docId) {
  return indexing.has(docId)
}

/** 单篇文档建索引：按 content_hash 复用未变化片段 */
export async function indexDocument(docId, { trigger = 'manual' } = {}) {
  const doc = getFeishuDoc(docId)
  if (!doc) throw new Error('文档不存在')
  if (doc.kbState === 'off') throw new Error('文档未收录进知识库')
  const content = getFeishuDocContent(docId)
  if (!content?.content) throw new Error('还没有正文快照，先重新拉取正文')

  if (indexing.has(docId)) return { skipped: true }
  indexing.add(docId)
  const runId = createKbRun(doc.projectId, docId, trigger)

  try {
    const chunks = chunkMarkdown(content.content, doc.title)
    if (chunks.length === 0) throw new Error('切分后没有可用片段')

    const existing = listChunksByDoc(docId)
    const reusable = new Map(existing.map((c) => [c.contentHash, c]))
    const usedIds = new Set()
    const toInsert = []

    chunks.forEach((chunk, ordinal) => {
      const path = chunk.sectionPath
      const hash = sha1(chunk.content)
      const hit = reusable.get(hash)
      if (hit && !usedIds.has(hit.id)) {
        usedIds.add(hit.id)
        return
      }
      toInsert.push({
        id: chunkIdOf(docId, path, ordinal, chunk.content),
        projectId: doc.projectId,
        docId,
        revision: content.revision,
        ordinal,
        sectionPath: path,
        content: chunk.content,
        context: chunk.context,
        contentHash: hash,
      })
    })

    const staleIds = existing.filter((c) => !usedIds.has(c.id)).map((c) => c.id)
    deleteChunksByIds(staleIds)

    const inserted = []
    for (const chunk of toInsert) {
      try {
        insertChunk(chunk)
        inserted.push(chunk)
      } catch (err) {
        // 同一 hash 重复（重复段落）时忽略主键冲突
        if (!String(err?.message || '').includes('UNIQUE')) throw err
      }
    }

    let embedded = 0
    if (embeddingReady()) {
      try {
        embedded = await embedAndStore(inserted)
        const pending = listChunksToEmbed(doc.projectId, getKbConfig().model, 200)
          .filter((c) => c.docId === docId)
        embedded += await embedAndStore(pending)
      } catch (err) {
        // 嵌入失败不阻断索引：先可检索，后补向量
        console.error('[kb] embed failed', docId, err?.message || err)
      }
    }

    setFeishuDocKb(docId, {
      kbState: 'indexed',
      kbError: null,
      kbRevision: content.revision,
      kbFetchedAt: doc.kbFetchedAt || nowISO(),
    })
    updateKbRun(runId, {
      status: 'ok',
      chunks: chunks.length,
      embedded,
      finishedAt: nowISO(),
    })
    return { runId, chunks: chunks.length, embedded, reused: usedIds.size }
  } catch (err) {
    setFeishuDocKb(docId, { kbState: 'failed', kbError: err?.message || '索引失败' })
    updateKbRun(runId, { status: 'failed', error: err?.message || '索引失败', finishedAt: nowISO() })
    throw err
  } finally {
    indexing.delete(docId)
  }
}

/** 批量索引：串行，单篇失败不影响其他 */
export async function indexProject(projectId, { trigger = 'manual' } = {}) {
  const docs = listFeishuDocs(projectId).filter((d) => d.kbState !== 'off')
  const result = { total: docs.length, ok: 0, failed: 0, chunks: 0, embedded: 0, errors: [] }
  for (const doc of docs) {
    try {
      const r = await indexDocument(doc.id, { trigger })
      result.ok += 1
      result.chunks += r.chunks || 0
      result.embedded += r.embedded || 0
    } catch (err) {
      result.failed += 1
      result.errors.push(`${doc.title}：${err?.message || err}`)
    }
  }
  return result
}

/* ================= 检索 ================= */

const normalizeQuery = (q) => String(q || '')
  .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  .replace(/　/g, ' ')
  .trim()

/** 术语表："ADE=Agent 开发环境"，每行一条 */
function glossaryTerms(query) {
  const raw = getKbConfig().glossary || ''
  const extra = []
  for (const line of raw.split('\n')) {
    const [key, ...rest] = line.split('=')
    const term = (key || '').trim()
    const value = rest.join('=').trim()
    if (term && value && query.toLowerCase().includes(term.toLowerCase())) extra.push(value)
  }
  return extra
}

/**
 * 查询词 → FTS5 MATCH 表达式。
 * trigram 索引按 3 字滑窗切分，因此查询也要切成 3 字窗口后用 OR 召回；
 * 整句当短语去匹配会导致"灰度发布怎么做"在"灰度发布分三步"里一条都命中不了。
 */
const STOP_WINDOWS = new Set([
  '怎么做', '怎么办', '是什么', '为什么', '怎么样', '如何做',
  '多少', '哪些', '是否', '有没有', '可以吗',
])

/** LIKE 兜底的停用词：单字与疑问虚词命中率太高，会把真正相关的片段挤掉 */
const LIKE_STOP = new Set([
  '什么', '怎么', '如何', '哪些', '多少', '是否', '为什么',
  '这个', '那个', '可以', '我们', '你们', '他们', '一下', '请问', '然后', '以及',
])

const likeable = (term) => term.length >= 2 && !LIKE_STOP.has(term)

function queryWindows(terms) {
  const windows = []
  for (const term of terms) {
    const clean = String(term).replace(/["\s]+/g, ' ').trim()
    if (clean.length < 3) continue
    if (clean.length === 3) {
      if (!STOP_WINDOWS.has(clean)) windows.push(clean)
      continue
    }
    for (let i = 0; i + 3 <= clean.length; i += 1) {
      const win = clean.slice(i, i + 3)
      if (STOP_WINDOWS.has(win)) continue
      if (!/[\p{L}\p{N}]/u.test(win)) continue
      windows.push(win)
    }
  }
  return [...new Set(windows)].slice(0, 24)
}

function buildMatch(windows) {
  if (windows.length === 0) return ''
  return windows.map((w) => `"${w}"`).join(' OR ')
}

function rrfMerge(routes, limit) {
  const scores = new Map()
  for (const route of routes) {
    const weight = ROUTE_WEIGHTS[route.name] ?? 1
    route.items.forEach((item, index) => {
      const entry = scores.get(item.id) || { item, score: 0, routes: [] }
      entry.score += weight / (RRF_K + index + 1)
      entry.routes.push(route.name)
      scores.set(item.id, entry)
    })
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({ ...entry.item, score: entry.score, routes: entry.routes }))
}

/**
 * LLM 重排：给候选片段打 0-5 分相关性。
 * 失败或未配置模型时返回 null，由调用方沿用融合顺序。
 */
async function rerankChunks(query, chunks) {
  const cfg = getKbConfig()
  if (!cfg.rerankModel || !cfg.baseUrl) return null
  const key = kbEmbeddingKey()
  if (!key) return null

  // 专用重排模型（模型名含 reranker）走 /v1/rerank：更快更准，返回 relevance_score
  if (/reranker/i.test(cfg.rerankModel)) {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/rerank`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: cfg.rerankModel,
        query,
        documents: chunks.map((c) => String(c.content).slice(0, 600)),
        top_n: chunks.length,
        return_documents: false,
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200)
      throw new Error(`重排接口 HTTP ${res.status}${body ? `：${body}` : ''}`)
    }
    const data = await res.json()
    const results = Array.isArray(data?.results) ? data.results : []
    if (results.length === 0) throw new Error('重排结果为空')
    const scores = new Map(results.map((r) => [Number(r.index), Number(r.relevance_score) || 0]))
    return chunks
      .map((chunk, index) => ({ ...chunk, rerankScore: scores.get(index) ?? 0 }))
      .sort((a, b) => b.rerankScore - a.rerankScore)
  }

  const list = chunks.map((c, i) => `[${i}] ${String(c.content).slice(0, 300)}`).join('\n\n')
  const prompt = [
    '你是检索重排器。根据用户问题，给下面每个片段打 0-5 分相关性（5=直接回答，3=部分相关，0=无关）。',
    '只输出 JSON 数组，不要解释，格式：[{"i":0,"s":5},...]',
    '',
    `问题：${query}`,
    '',
    `片段：`,
    list,
  ].join('\n')

  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: cfg.rerankModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 800,
    }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200)
    throw new Error(`重排接口 HTTP ${res.status}${body ? `：${body}` : ''}`)
  }
  const data = await res.json()
  const content = String(data?.choices?.[0]?.message?.content || '')
  const start = content.indexOf('[')
  const end = content.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('重排结果不是 JSON 数组')

  const parsed = JSON.parse(content.slice(start, end + 1))
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('重排结果为空')

  const scores = new Map()
  for (const item of parsed) {
    const index = Number(item?.i)
    const score = Number(item?.s)
    if (Number.isInteger(index) && Number.isFinite(score)) scores.set(index, score)
  }
  if (scores.size === 0) throw new Error('重排结果没有有效分数')

  return chunks
    .map((chunk, index) => ({ ...chunk, rerankScore: scores.get(index) ?? 0 }))
    .sort((a, b) => b.rerankScore - a.rerankScore)
}

/**
 * 检索：BM25（FTS5 trigram）+ 短查询 LIKE 兜底 + 可选向量，RRF 融合；可选 LLM 重排。
 * 返回 { chunks, lowConfidence, routes }。
 */
export async function search(projectId, rawQuery, { topK = 8, useVector = true, useRerank = false } = {}) {
  const query = normalizeQuery(rawQuery)
  if (!query) return { chunks: [], lowConfidence: true, routes: { bm25: 0, vector: 0 } }

  const extras = glossaryTerms(query)
  const terms = [...query.split(/\s+/).filter(Boolean), ...extras]

  // ① BM25
  const windows = queryWindows(terms)
  const match = buildMatch(windows)
  let bm25 = []
  if (match) {
    try {
      bm25 = searchChunksFts(projectId, match, ROUTE_TOP).map((row) => ({
        id: row.id,
        docId: row.doc_id,
        ordinal: row.ordinal,
        sectionPath: row.section_path,
        content: row.content,
        rawScore: Number(-row.rank),
      }))
    } catch (err) {
      console.error('[kb] fts failed', err?.message || err)
    }
  }

  // ② 短词兜底（<3 字，trigram 无法命中）；整句 BM25 全空时，再用 2 字切分兜底
  const shortTerms = terms.filter((t) => t.length < 3 && likeable(t))
  const rescueTerms = bm25.length === 0
    ? [...new Set(terms.flatMap(cjkBigrams))].filter(likeable)
    : []
  const likeMap = new Map()
  for (const term of [...new Set([...shortTerms, ...rescueTerms])]) {
    for (const row of searchChunksLike(projectId, term, ROUTE_TOP)) {
      const hit = likeMap.get(row.id) || {
        id: row.id,
        docId: row.doc_id,
        ordinal: row.ordinal,
        sectionPath: row.section_path,
        content: row.content,
        hits: 0,
      }
      hit.hits += countOccurrences(row.content, term)
      likeMap.set(row.id, hit)
    }
  }
  const likeHits = [...likeMap.values()]
    .sort((a, b) => b.hits - a.hits)
    .slice(0, ROUTE_TOP)
    .map(({ hits, ...rest }) => ({ ...rest }))
  const routeList = []
  if (bm25.length > 0) routeList.push({ name: 'bm25', items: bm25 })
  if (likeHits.length > 0) routeList.push({ name: 'like', items: dedupe(likeHits) })

  // ③ 向量
  let vectorHits = []
  let bestCosine = 0
  const skipVector = VECTOR_MODE === 'fallback' && bm25.length >= 3
  if (useVector && !skipVector && embeddingReady() && !embedCoolingDown()) {
    try {
      const [qvec] = await embedTexts([query])
      const rows = listChunksWithEmbeddings(projectId, getKbConfig().model)
      vectorHits = rows
        .map((row) => {
          const vec = fromBuffer(row.embedding)
          let dot = 0
          const len = Math.min(vec.length, qvec.length)
          for (let i = 0; i < len; i += 1) dot += vec[i] * qvec[i]
          return { row, cosine: dot }
        })
        // 低于门限的向量命中直接丢弃：这批语料里无相关段落也能到 0.5，必须卡掉
        .filter((hit) => hit.cosine >= MIN_COSINE)
        .sort((a, b) => b.cosine - a.cosine)
        .slice(0, ROUTE_TOP)
        .map(({ row, cosine }) => {
          bestCosine = Math.max(bestCosine, cosine)
          return {
            id: row.id,
            docId: row.doc_id,
            ordinal: row.ordinal,
            sectionPath: row.section_path,
            content: row.content,
            rawScore: cosine,
          }
        })
      if (vectorHits.length > 0) routeList.push({ name: 'vector', items: vectorHits })
    } catch (err) {
      console.error('[kb] vector failed', err?.message || err)
    }
  }

  const fused = rrfMerge(routeList, Math.max(topK * 3, 20))

  // 同文档限量，避免单篇霸屏；先留够候选给重排
  const candidateN = Math.max(topK * 3, 20)
  const perDoc = new Map()
  let candidates = []
  for (const item of fused) {
    const count = perDoc.get(item.docId) || 0
    if (count >= MAX_PER_DOC) continue
    perDoc.set(item.docId, count + 1)
    candidates.push(item)
    if (candidates.length >= candidateN) break
  }

  let reranked = false
  if (useRerank) {
    try {
      const ordered = await rerankChunks(query, candidates)
      if (ordered && ordered.length > 0) {
        candidates = ordered
        reranked = true
      }
    } catch (err) {
      console.error('[kb] rerank failed', err?.message || err)
    }
  }

  const picked = candidates.slice(0, topK)

  // 置信度：BM25 的绝对分数随语料规模漂移，不用它做阈值；
  // 改用「实际用于检索的探针（3 字窗口 / 兜底词）在命中片段中的覆盖率」
  const top = picked[0]
  const probes = [...new Set([...windows, ...shortTerms, ...rescueTerms])]
  const covered = probes.filter((t) => top && (
    String(top.content).includes(t) || String(top.sectionPath).includes(t)
  )).length
  const coverage = probes.length > 0 ? covered / probes.length : 0
  const lowConfidence = picked.length === 0
    || (vectorHits.length > 0 ? bestCosine < MIN_COSINE : coverage < 0.3)

  return {
    chunks: picked.map((item) => ({
      id: item.id,
      docId: item.docId,
      ordinal: item.ordinal,
      sectionPath: item.sectionPath,
      content: item.content,
      score: Number(item.score.toFixed(4)),
      routes: item.routes || [],
      neighbors: listSiblingChunks(item.docId, item.ordinal, 1)
        .filter((c) => c.id !== item.id)
        .map((c) => ({ ordinal: c.ordinal, content: c.content })),
    })),
    lowConfidence,
    coverage: Number(coverage.toFixed(2)),
    reranked,
    routes: { bm25: bm25.length, vector: vectorHits.length, like: likeHits.length },
  }
}

function dedupe(list) {
  const seen = new Set()
  return list.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

const countOccurrences = (text, term) => {
  if (!term) return 0
  let count = 0
  let index = text.indexOf(term)
  while (index >= 0) { count += 1; index = text.indexOf(term, index + term.length) }
  return count
}

/** CJK 串按 2 字切：用于整句 BM25 落空时的兜底召回 */
function cjkBigrams(term) {
  const runs = String(term).match(/[一-鿿]+/g) || []
  const out = []
  for (const run of runs) {
    if (run.length <= 3) { out.push(run); continue }
    for (let i = 0; i + 2 <= run.length; i += 2) out.push(run.slice(i, i + 2))
  }
  return out
}

export function kbStats(projectId) {
  return getChunkStats(projectId, getKbConfig().model)
}
