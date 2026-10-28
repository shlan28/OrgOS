import zlib from 'node:zlib'
import {
  getFeishuCredentials,
  getFeishuUserToken,
  setFeishuUserToken,
  getDocSource,
  getKbConfig,
  kbEmbeddingKey,
  saveDocSource,
  listDocSources,
  updateDocSourceSync,
  upsertFeishuDoc,
  markFeishuDocsMissing,
  createSyncRun,
  updateSyncRun,
  getFeishuDoc,
  setFeishuDocKb,
  saveFeishuDocContent,
} from './db.js'
import {
  createExportTask,
  downloadExport,
  downloadMedia,
  getDocRawContent,
  getDocxRawContent,
  getExportTask,
  getSheetMeta,
  getSheetValues,
  getRootFolderToken,
  getTenantTokenCached,
  getWikiNode,
  listBitableRecords,
  listBitableTables,
  listDocxBlocks,
  listFolder,
  listWikiNodes,
  listWikiSpaces,
  queryDocMetas,
  refreshUserToken,
} from './feishu.js'

const MAX_NODES = 5000
const MAX_DEPTH = 8
const MAX_CHARS = 2_000_000
const MAX_BLOCKS = 5000
const MAX_SHEET_ROWS = 500
const MAX_TABLE_ROWS = 500
const MAX_SHEET_PAGES = 20

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const nowISO = () => new Date().toISOString()
const clamp = (text) => (text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n（内容过长，已截断）` : text)

/* ---------------- 身份 ---------------- */

async function tokenFor(auth) {
  if (auth === 'user') {
    const stored = getFeishuUserToken()
    if (!stored?.accessToken) {
      throw new Error('未完成飞书个人授权（设置 → 成员管理 → 个人授权）')
    }
    const expiresAt = Number(stored.expiresAt || 0)
    if (!expiresAt || expiresAt - Date.now() > 120000) return stored.accessToken
    const { appId, appSecret } = getFeishuCredentials()
    if (stored.refreshToken && appId && appSecret) {
      try {
        const next = await refreshUserToken(stored.refreshToken, appId, appSecret)
        setFeishuUserToken({
          ...stored,
          ...next,
          expiresAt: Date.now() + (next.expiresIn || 7200) * 1000,
        })
        return next.accessToken
      } catch {
        // 刷新失败时退回旧 token，下游会给出可操作错误
      }
    }
    return stored.accessToken
  }
  const { appId, appSecret } = getFeishuCredentials()
  if (!appId || !appSecret) throw new Error('未配置飞书企业授权凭证（设置 → 成员管理 → 企业授权）')
  return getTenantTokenCached(appId, appSecret)
}

/* ---------------- 类型与时间 ---------------- */

const TYPE_ALIASES = {
  docx: 'docx',
  doc: 'doc',
  sheet: 'sheet',
  spreadsheet: 'sheet',
  bitable: 'bitable',
  bitable_app: 'bitable',
  file: 'file',
  mindnote: 'mindnote',
  slides: 'slides',
  wiki: 'wiki',
}

const normalizeType = (raw) => {
  const type = String(raw || '').toLowerCase()
  return TYPE_ALIASES[type] || type || 'file'
}

const toISO = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  const ms = n > 1e12 ? n : n * 1000
  return new Date(ms).toISOString()
}

const revisionOf = (item) => {
  const modified = item.modified_time || item.latest_modify_time || item.obj_edit_time || item.node_edit_time
  return toISO(modified) || String(modified || '')
}

/* ---------------- 同步：遍历 ---------------- */

async function collectFolder(token, source) {
  const docs = []
  const errors = []
  let visited = 0
  let partial = false
  const queue = [{ folderToken: source.token, path: [], depth: 0 }]

  while (queue.length > 0) {
    const node = queue.shift()
    let pageToken = ''
    do {
      let page
      try {
        page = await listFolder(token, node.folderToken, pageToken)
      } catch (err) {
        errors.push(`${node.path.join('/') || '根目录'}：${err?.message || err}`)
        break
      }
      for (const item of page.items) {
        if (visited >= MAX_NODES) { partial = true; break }
        visited += 1
        const name = String(item.name || '').trim() || '未命名'
        const type = normalizeType(item.type)

        if (type === 'folder') {
          if (node.depth + 1 <= MAX_DEPTH) {
            queue.push({ folderToken: item.token, path: [...node.path, name], depth: node.depth + 1 })
          }
          continue
        }

        if (type === 'wiki') {
          try {
            const wiki = await getWikiNode(token, item.token)
            if (wiki) {
              docs.push({
                externalToken: wiki.obj_token || wiki.node_token || item.token,
                externalType: normalizeType(wiki.obj_type),
                title: String(wiki.title || name).trim(),
                url: `https://feishu.cn/wiki/${wiki.node_token || item.token}`,
                parentPath: node.path.join('/'),
                parentToken: node.folderToken,
                modifiedAt: toISO(wiki.obj_edit_time || wiki.node_edit_time) || null,
                revision: revisionOf(wiki),
                sizeBytes: null,
              })
            }
          } catch (err) {
            errors.push(`${name}：${err?.message || err}`)
          }
          continue
        }

        docs.push({
          externalToken: item.token,
          externalType: type,
          title: name,
          url: item.url || '',
          parentPath: node.path.join('/'),
          parentToken: node.folderToken,
          modifiedAt: toISO(item.modified_time) || null,
          revision: revisionOf(item),
          sizeBytes: Number(item.size) || null,
        })
      }
      pageToken = page.hasMore ? page.nextToken : ''
    } while (pageToken && visited < MAX_NODES)
    if (visited >= MAX_NODES) { partial = true; break }
  }

  return { docs, errors, partial }
}

async function collectWiki(token, source) {
  const docs = []
  const errors = []
  let visited = 0
  let partial = false
  const queue = [{ parent: '', path: [], depth: 0 }]

  while (queue.length > 0) {
    const node = queue.shift()
    let pageToken = ''
    do {
      let page
      try {
        page = await listWikiNodes(token, source.token, node.parent, pageToken)
      } catch (err) {
        errors.push(`${node.path.join('/') || '空间根目录'}：${err?.message || err}`)
        break
      }
      for (const item of page.items) {
        if (visited >= MAX_NODES) { partial = true; break }
        visited += 1
        const title = String(item.title || '').trim() || '未命名'
        const objType = normalizeType(item.obj_type)
        // wiki 节点自身就是一篇文档，同时可能有子节点
        if (objType !== 'folder') {
          docs.push({
            externalToken: item.obj_token || item.node_token,
            externalType: objType,
            title,
            url: `https://feishu.cn/wiki/${item.node_token}`,
            parentPath: node.path.join('/'),
            parentToken: node.parent,
            modifiedAt: toISO(item.obj_edit_time || item.node_edit_time) || null,
            revision: revisionOf(item),
            sizeBytes: null,
          })
        }
        if (item.has_child && node.depth + 1 <= MAX_DEPTH) {
          queue.push({ parent: item.node_token, path: [...node.path, title], depth: node.depth + 1 })
        }
      }
      pageToken = page.hasMore ? page.nextToken : ''
    } while (pageToken && visited < MAX_NODES)
    if (visited >= MAX_NODES) { partial = true; break }
  }

  return { docs, errors, partial }
}

/** 单篇文档源：只查这一篇的元信息，不带出任何目录 */
async function collectDoc(token, source) {
  const docType = source.docType || 'docx'

  if (docType === 'wiki') {
    const node = await getWikiNode(token, source.token)
    if (!node) throw new Error('文档不存在或无权访问')
    return {
      docs: [{
        externalToken: source.token,
        externalType: normalizeType(node.obj_type),
        title: String(node.title || source.name).trim(),
        url: `https://feishu.cn/wiki/${node.node_token || source.token}`,
        parentPath: '',
        parentToken: '',
        modifiedAt: toISO(node.obj_edit_time || node.node_edit_time) || null,
        revision: revisionOf(node),
        sizeBytes: null,
      }],
      errors: [],
      partial: false,
    }
  }

  const { metas, failed } = await queryDocMetas(token, [{ token: source.token, type: docType }])
  const meta = metas.find((m) => m.doc_token === source.token) || metas[0]
  if (!meta) {
    const reason = failed[0]?.reason || failed[0]?.msg || '文档不存在或无权访问'
    throw new Error(reason)
  }
  return {
    docs: [{
      externalToken: meta.doc_token || source.token,
      externalType: normalizeType(meta.doc_type || docType),
      title: String(meta.title || source.name).trim(),
      url: meta.url || source.url || '',
      parentPath: '',
      parentToken: '',
      modifiedAt: toISO(meta.latest_modify_time) || null,
      revision: toISO(meta.latest_modify_time) || '',
      sizeBytes: null,
    }],
    errors: [],
    partial: false,
  }
}

async function collectWithFallback(project, source) {
  const attempts = source.auth === 'user' ? ['user', 'tenant'] : ['tenant', 'user']
  const messages = []
  for (const auth of attempts) {
    try {
      const token = await tokenFor(auth)
      const collected = source.kind === 'wiki_space'
        ? await collectWiki(token, source)
        : source.kind === 'doc'
          ? await collectDoc(token, source)
          : await collectFolder(token, source)
      return { ...collected, auth }
    } catch (err) {
      messages.push(`${auth === 'tenant' ? '应用身份' : '个人身份'}：${err?.message || err}`)
    }
  }
  throw new Error(messages.join('；'))
}

/* ---------------- 同步：执行 ---------------- */

const running = new Map() // projectId → runId

export function activeRunOf(projectId) {
  return running.get(projectId) || null
}

export function startSync({ project, sourceId = '', trigger = 'manual' }) {
  const existing = running.get(project.id)
  if (existing) return { runId: existing, reused: true }
  const runId = createSyncRun(project.id, sourceId || null, trigger)
  running.set(project.id, runId)
  void executeSync(project, sourceId, runId).finally(() => running.delete(project.id))
  return { runId, reused: false }
}

async function executeSync(project, sourceId, runId) {
  const sources = listDocSources(project.id).filter((s) => !sourceId || s.id === sourceId)
  if (sources.length === 0) {
    updateSyncRun(runId, {
      status: 'failed',
      error: '请先添加飞书同步源',
      finishedAt: nowISO(),
    })
    return
  }

  let total = 0
  let added = 0
  let updated = 0
  let removed = 0
  let failed = 0
  const errors = []

  for (const source of sources) {
    try {
      const collected = await collectWithFallback(project, source)
      if (collected.auth !== source.auth) {
        saveDocSource({ ...source, auth: collected.auth })
      }

      let sourceAdded = 0
      let sourceUpdated = 0
      for (const item of collected.docs) {
        try {
          const result = upsertFeishuDoc({ projectId: project.id, sourceId: source.id, ...item })
          if (result.created) sourceAdded += 1
          else sourceUpdated += 1
        } catch (err) {
          failed += 1
          errors.push(`${item.title}：${err?.message || err}`)
        }
      }

      // 只有完整遍历才判定删除，避免中途失败把整源清空
      const sourceRemoved = collected.partial
        ? 0
        : markFeishuDocsMissing(source.id, collected.docs.map((d) => d.externalToken))

      failed += collected.errors.length
      errors.push(...collected.errors)

      total += collected.docs.length
      added += sourceAdded
      updated += sourceUpdated
      removed += sourceRemoved

      const status = collected.errors.length > 0 ? 'partial' : 'ok'
      updateDocSourceSync(source.id, status, collected.errors[0] || null)
    } catch (err) {
      failed += 1
      errors.push(`${source.name}：${err?.message || err}`)
      updateDocSourceSync(source.id, 'failed', err?.message || '同步失败')
    }

    updateSyncRun(runId, { total, added, updated, removed, failed, error: errors[0] || null })
  }

  const okCount = added + updated + removed
  const uniqueErrors = [...new Set(errors)]
  updateSyncRun(runId, {
    status: failed === 0 ? 'ok' : okCount > 0 ? 'partial' : 'failed',
    total,
    added,
    updated,
    removed,
    failed,
    error: uniqueErrors.slice(0, 2).join('；') || null,
    finishedAt: nowISO(),
  })
}

/* ---------------- 正文摄入 ---------------- */

const contentRunning = new Set()

export function isIngesting(docId) {
  return contentRunning.has(docId)
}

/** 源身份：先按登记的身份，失败再换另一种（与同步一致） */
async function tokenForSource(source) {
  const attempts = source?.auth === 'user' ? ['user', 'tenant'] : ['tenant', 'user']
  const messages = []
  for (const auth of attempts) {
    try {
      return await tokenFor(auth)
    } catch (err) {
      messages.push(`${auth === 'tenant' ? '应用身份' : '个人身份'}：${err?.message || err}`)
    }
  }
  throw new Error(messages.join('；'))
}

/** 拉取正文并落快照；失败写 kb_state=failed，成功写 ready（待索引） */
export async function ingestDoc(docId) {
  const doc = getFeishuDoc(docId)
  if (!doc) throw new Error('文档不存在')
  if (doc.kbState === 'fetching') return
  contentRunning.add(docId)
  setFeishuDocKb(docId, { kbState: 'fetching', kbError: null })
  try {
    const source = getDocSource(doc.sourceId)
    const token = await tokenForSource(source)
    const { markdown, format } = await docToMarkdown(token, doc)
    saveFeishuDocContent(docId, { revision: doc.revision, format, content: markdown })
    setFeishuDocKb(docId, {
      kbState: 'ready',
      kbError: null,
      kbRevision: doc.revision,
      kbFetchedAt: nowISO(),
    })
  } catch (err) {
    setFeishuDocKb(docId, { kbState: 'failed', kbError: err?.message || '拉取正文失败' })
    throw err
  } finally {
    contentRunning.delete(docId)
  }
}

async function docToMarkdown(token, doc) {
  const type = doc.externalType
  if (type === 'docx') {
    const markdown = await docxToMarkdown(token, doc.externalToken)
    return { markdown: clamp(markdown || ''), format: 'markdown' }
  }
  if (type === 'doc') {
    const text = await getDocRawContent(token, doc.externalToken)
    return { markdown: clamp(plainTextToMarkdown(text)), format: 'markdown' }
  }
  if (type === 'sheet') {
    return { markdown: clamp(await sheetToMarkdown(token, doc.externalToken)), format: 'markdown' }
  }
  if (type === 'bitable') {
    return { markdown: clamp(await bitableToMarkdown(token, doc.externalToken)), format: 'markdown' }
  }
  if (type === 'file' || type === 'image') {
    const text = await fileToText(token, doc)
    return { markdown: clamp(plainTextToMarkdown(text)), format: 'markdown' }
  }
  throw new Error(`暂不支持收录「${type}」类型文档`)
}

/* ---------------- docx blocks → markdown ---------------- */

export function blocksToMarkdown(blocks) {
  const byId = new Map(blocks.map((b) => [b.block_id, b]))
  const lines = []

  const inline = (elements) => (elements || []).map((el) => {
    if (el.text_run) return el.text_run.content || ''
    if (el.mention_doc) return el.mention_doc.title || ''
    if (el.mention_user) return `@${el.mention_user.name || '用户'}`
    if (el.equation) return el.equation.content || ''
    if (el.url_style) return el.url_style.title || ''
    return ''
  }).join('')

  const textOf = (block, key) => inline(block?.[key]?.elements)
  const todoDone = (block) => Boolean(block?.todo?.style?.done)

  const render = (block, depth = 0) => {
    if (!block) return
    const type = Number(block.block_type)
    const children = (block.children || []).map((id) => byId.get(id)).filter(Boolean)

    if (type >= 3 && type <= 11) {
      const level = type - 2
      lines.push(`${'#'.repeat(level)} ${textOf(block, `heading${level}`)}`, '')
    } else if (type === 2) {
      lines.push(textOf(block, 'text'), '')
    } else if (type === 12) {
      lines.push(`- ${textOf(block, 'bullet')}`)
    } else if (type === 13) {
      lines.push(`1. ${textOf(block, 'ordered')}`)
    } else if (type === 14) {
      const lang = block.code?.style?.language ?? ''
      lines.push('```' + (lang > 0 ? String(lang) : ''), textOf(block, 'code'), '```', '')
    } else if (type === 15) {
      lines.push(`> ${textOf(block, 'quote')}`, '')
    } else if (type === 17) {
      lines.push(`- [${todoDone(block) ? 'x' : ' '}] ${textOf(block, 'todo')}`)
    } else if (type === 22) {
      lines.push('---', '')
    } else if (type === 27) {
      lines.push(`\u0001IMG:${block.image?.token || ''}\u0001`, '')
    } else if (type === 31) {
      const cellIds = block.table?.cells || []
      const columnSize = Number(block.table?.property?.column_size) || 1
      const rows = []
      for (let i = 0; i < cellIds.length; i += columnSize) {
        rows.push(cellIds.slice(i, i + columnSize))
      }
      if (rows.length > 0) {
        lines.push(`| ${rows[0].map(() => ' ').join(' | ')} |`)
        lines.push(`| ${rows[0].map(() => '---').join(' | ')} |`)
        for (const row of rows) {
          const cells = row.map((cellId) => {
            const cell = byId.get(cellId)
            const texts = (cell?.children || [])
              .map((id) => byId.get(id))
              .filter(Boolean)
              .map((child) => textOf(child, 'text') || '')
              .join(' ')
            return texts.replace(/\|/g, '\\|').trim()
          })
          lines.push(`| ${cells.join(' | ')} |`)
        }
        lines.push('')
      }
    } else if (Array.isArray(block.children) && block.children.length > 0 && depth < 20) {
      for (const child of children) render(child, depth + 1)
      return
    }

    for (const child of children) render(child, depth + 1)
  }

  const roots = blocks.filter((b) => Number(b.block_type) === 1)
  if (roots.length > 0) {
    for (const root of roots) {
      for (const id of root.children || []) render(byId.get(id))
    }
  } else {
    for (const block of blocks) render(block)
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

async function docxToMarkdown(token, documentId) {
  const blocks = []
  let pageToken = ''
  do {
    const page = await listDocxBlocks(token, documentId, pageToken)
    blocks.push(...page.items)
    pageToken = page.hasMore && blocks.length < MAX_BLOCKS ? page.nextToken : ''
  } while (pageToken)

  const markdown = blocksToMarkdown(blocks)
  const enriched = markdown.includes('\u0001IMG:')
    ? await replaceImageMarkers(markdown, async (imgToken) => {
      if (!imgToken) throw new Error('图片缺少 token')
      const buffer = await downloadMedia(token, imgToken)
      return ocrImage(buffer)
    })
    : markdown

  if (enriched.trim()) return enriched
  return getDocxRawContent(token, documentId)
}

/* ---------------- 图片转写（视觉模型） ---------------- */

const IMG_MARKER = /\u0001IMG:([^\u0001]*)\u0001/g
const MAX_OCR_IMAGES = 20
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'])
const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
}

/** 用视觉模型转写图片文字；未配置模型时抛错，由调用方降级为占位 */
async function ocrImage(buffer, mime = 'image/png') {
  const cfg = getKbConfig()
  const key = kbEmbeddingKey()
  if (!cfg.visionModel) throw new Error('未配置图片转写模型（知识库 → 索引设置）')
  if (!cfg.baseUrl || !key) throw new Error('缺少模型接口地址或 Key，无法转写图片')

  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: cfg.visionModel,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '请逐字转写图片中的全部文字，按阅读顺序输出，不要添加解释。若没有文字，返回空。' },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } },
        ],
      }],
      max_tokens: 2000,
    }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200)
    throw new Error(`图片转写失败 HTTP ${res.status}${body ? `：${body}` : ''}`)
  }
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content || ''
  return String(text).trim().slice(0, 4000)
}

/**
 * 把 markdown 里的图片标记替换成转写文字。
 * 单篇最多转写 limit 张，超出与失败的都退化为「（图片）」。
 */
export async function replaceImageMarkers(markdown, ocrFn, limit = MAX_OCR_IMAGES) {
  const tokens = [...new Set([...markdown.matchAll(IMG_MARKER)].map((m) => m[1]).filter(Boolean))]
    .slice(0, limit)
  if (tokens.length === 0) return markdown.replace(IMG_MARKER, '（图片）')

  const texts = new Map()
  for (const imgToken of tokens) {
    try {
      texts.set(imgToken, await ocrFn(imgToken))
    } catch (err) {
      console.error('[kb] ocr failed', imgToken.slice(0, 12), err?.message || err)
      texts.set(imgToken, '')
    }
  }
  return markdown.replace(IMG_MARKER, (_m, imgToken) => {
    const text = texts.get(imgToken)
    return text ? `（图片文字）${text}` : '（图片）'
  })
}

/* ---------------- 表格 ---------------- */

const cellText = (cell) => {
  if (cell == null) return ''
  if (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') return String(cell)
  if (Array.isArray(cell)) return cell.map(cellText).join('')
  if (typeof cell === 'object') return cell.text ?? cell.name ?? cell.link ?? ''
  return ''
}

const escapeCell = (text) => String(text).replace(/\|/g, '\\|').replace(/\n+/g, ' ')

function valuesToMarkdown(values) {
  const rows = (values || []).slice(0, MAX_SHEET_ROWS).map((row) => (row || []).map(cellText))
  if (rows.length === 0) return '（空表）'
  const width = Math.max(...rows.map((r) => r.length))
  const pad = (row) => Array.from({ length: width }, (_, i) => escapeCell(row[i] ?? ''))
  const [head, ...body] = rows.map(pad)
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

async function sheetToMarkdown(token, spreadsheetToken) {
  const sheets = await getSheetMeta(token, spreadsheetToken)
  const parts = []
  for (const sheet of sheets.slice(0, MAX_SHEET_PAGES)) {
    const title = sheet.title || sheet.sheet_id
    try {
      const values = await getSheetValues(token, spreadsheetToken, `${sheet.sheet_id}!A1:Z${MAX_SHEET_ROWS}`)
      parts.push(`## ${title}`, '', valuesToMarkdown(values))
    } catch (err) {
      parts.push(`## ${title}`, '', `（读取失败：${err?.message || err}）`)
    }
  }
  return parts.join('\n\n') || '（空表格）'
}

async function bitableToMarkdown(token, appToken) {
  const tables = await listBitableTables(token, appToken)
  const parts = []
  for (const table of tables.slice(0, MAX_SHEET_PAGES)) {
    const rows = []
    let pageToken = ''
    do {
      const page = await listBitableRecords(token, appToken, table.table_id, pageToken)
      rows.push(...page.items.map((item) => item.fields || {}))
      pageToken = page.hasMore && rows.length < MAX_TABLE_ROWS ? page.nextToken : ''
    } while (pageToken)

    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    if (headers.length === 0) {
      parts.push(`## ${table.name || table.table_id}`, '', '（空表）')
      continue
    }
    const body = rows.slice(0, MAX_TABLE_ROWS).map((row) => headers.map((h) => escapeCell(cellText(row[h]))))
    parts.push(
      `## ${table.name || table.table_id}`,
      '',
      [
        `| ${headers.map(escapeCell).join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...body.map((line) => `| ${line.join(' | ')} |`),
      ].join('\n'),
    )
  }
  return parts.join('\n\n') || '（空多维表格）'
}

/* ---------------- Office 文件 ---------------- */

const EXPORT_SPEC = {
  docx: { type: 'docx', ext: 'docx' },
  doc: { type: 'doc', ext: 'docx' },
  xlsx: { type: 'sheet', ext: 'xlsx' },
  pptx: { type: 'slides', ext: 'pptx' },
}

async function fileToText(token, doc) {
  const ext = String(doc.title.split('.').pop() || '').toLowerCase()

  if (IMAGE_EXT.has(ext)) {
    const buffer = await downloadMedia(token, doc.externalToken)
    return ocrImage(buffer, IMAGE_MIME[ext] || 'image/png')
  }

  const spec = EXPORT_SPEC[ext]
  if (!spec) throw new Error(`暂不支持收录 .${ext || '未知'} 文件（支持 docx / doc / xlsx / pptx / png / jpg）`)

  const ticket = await createExportTask(token, doc.externalToken, spec.type, spec.ext)
  const deadline = Date.now() + 60000
  let fileToken = ''
  while (Date.now() < deadline) {
    const job = await getExportTask(token, ticket, doc.externalToken)
    if (job.status === 2) { fileToken = job.fileToken; break }
    if (job.status === 3) throw new Error(`飞书导出失败${job.error ? `：${job.error}` : ''}`)
    await sleep(1500)
  }
  if (!fileToken) throw new Error('飞书导出超时（60s）')

  const buffer = await downloadExport(token, fileToken)
  return officeTextOf(buffer, ext)
}

/* —— 极简 zip 读取 + 文本抽取（无第三方依赖） —— */

function readZipEntries(buffer) {
  const entries = new Map()
  let offset = 0
  while (offset + 30 < buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break
    const method = buffer.readUInt16LE(offset + 8)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const name = buffer.slice(nameStart, nameStart + nameLength).toString('utf8')
    const dataStart = nameStart + nameLength + extraLength
    const data = buffer.slice(dataStart, dataStart + compressedSize)
    try {
      entries.set(name, method === 0 ? data : zlib.inflateRawSync(data))
    } catch {
      // 加密或损坏的条目跳过
    }
    offset = dataStart + compressedSize
  }
  return entries
}

const xmlToText = (xml) => xml
  .replace(/<w:p[ >]/g, '\n<w:p ')
  .replace(/<a:p>/g, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

function docxText(entries) {
  const xml = entries.get('word/document.xml')
  return xml ? xmlToText(xml.toString('utf8')) : ''
}

function pptxText(entries) {
  const slides = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1] || 0) - Number(b.match(/slide(\d+)/)?.[1] || 0))
  return slides.map((name, index) => {
    const xml = entries.get(name).toString('utf8')
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1])
    return `## 第 ${index + 1} 页\n\n${texts.join('\n')}`
  }).join('\n\n')
}

function xlsxText(entries) {
  const sharedXml = entries.get('xl/sharedStrings.xml')
  const shared = sharedXml
    ? [...sharedXml.toString('utf8').matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1])
    : []

  const sheets = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/sheet(\d+)/)?.[1] || 0) - Number(b.match(/sheet(\d+)/)?.[1] || 0))

  return sheets.map((name, index) => {
    const xml = entries.get(name).toString('utf8')
    const lines = []
    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = []
      for (const cellMatch of rowMatch[1].matchAll(/<c[^>]*?(?:t="([^"]*)")?[^>]*>([\s\S]*?)<\/c>/g)) {
        const type = cellMatch[1]
        const inner = cellMatch[2]
        const value = inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? inner.match(/<t[^>]*>([^<]*)<\/t>/)?.[1] ?? ''
        cells.push(type === 's' ? (shared[Number(value)] ?? '') : value)
      }
      if (cells.length > 0) lines.push(cells.join('\t'))
    }
    return `## Sheet ${index + 1}\n\n${lines.join('\n')}`
  }).join('\n\n')
}

function officeTextOf(buffer, ext) {
  const entries = readZipEntries(buffer)
  if (entries.size === 0) throw new Error('无法解析 Office 文件（可能已加密）')
  if (ext === 'docx' || ext === 'doc') return docxText(entries) || '（未能提取到文本）'
  if (ext === 'pptx') return pptxText(entries) || '（未能提取到文本）'
  if (ext === 'xlsx') return xlsxText(entries) || '（未能提取到文本）'
  throw new Error(`暂不支持解析 .${ext} 文件`)
}

/* ---------------- 文本规整 ---------------- */

function plainTextToMarkdown(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ---------------- 浏览（添加同步源用） ---------------- */

/**
 * 按层浏览飞书目录：
 * - kind=folder：sourceToken 为空时从云空间根目录开始；parent 为当前层的 folder_token
 * - kind=wiki_space：sourceToken 为空时列出可访问的知识库空间；否则列出空间内 parent 节点的子节点
 * 返回实际生效的身份 auth，前端登记源时回传。
 */
export async function browse({ kind = 'folder', token: sourceToken = '', parent = '', auth = 'tenant' }) {
  const attempts = auth === 'user' ? ['user', 'tenant'] : ['tenant', 'user']
  const messages = []

  for (const useAuth of attempts) {
    let accessToken
    try {
      accessToken = await tokenFor(useAuth)
    } catch (err) {
      messages.push(`${useAuth === 'tenant' ? '应用身份' : '个人身份'}：${err?.message || err}`)
      continue
    }

    try {
      if (kind === 'wiki_space') {
        if (!sourceToken) {
          const page = await listWikiSpaces(accessToken)
          return {
            auth: useAuth,
            token: '',
            items: page.items.map((space) => ({
              token: space.space_id,
              name: space.name || space.space_id,
              type: 'space',
              hasChildren: true,
            })),
          }
        }
        const page = await listWikiNodes(accessToken, sourceToken, parent)
        return {
          auth: useAuth,
          token: sourceToken,
          items: page.items.map((node) => ({
            token: node.obj_token || node.node_token,
            nodeToken: node.node_token,
            name: node.title || node.node_token,
            type: node.has_child && node.obj_type === 'folder' ? 'folder' : 'doc',
            objType: node.obj_type || '',
            hasChildren: Boolean(node.has_child),
          })),
        }
      }

      let folderToken = parent || sourceToken
      if (!folderToken) folderToken = await getRootFolderToken(accessToken)
      const page = await listFolder(accessToken, folderToken)
      return {
        auth: useAuth,
        token: folderToken,
        items: page.items.map((item) => ({
          token: item.token,
          name: item.name,
          type: item.type === 'folder' ? 'folder' : 'doc',
          objType: item.type,
          hasChildren: item.type === 'folder',
          url: item.url || '',
        })),
      }
    } catch (err) {
      messages.push(`${useAuth === 'tenant' ? '应用身份' : '个人身份'}：${err?.message || err}`)
    }
  }
  throw new Error(messages.join('；') || '无法读取飞书目录')
}
