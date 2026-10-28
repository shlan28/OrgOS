import fs from 'node:fs'
import path from 'node:path'
import {
  deleteProjectSpec,
  findProjectSpecByName,
  getProjectSpec,
  insertProjectSpec,
  listProjectAgents,
  listProjectSpecs,
  updateProjectSpec,
} from './db.js'

export const SPEC_PROMPT_MAX_BYTES = Number(process.env.ORG_OS_SPEC_PROMPT_MAX_BYTES) || 32 * 1024
export const SPEC_PROMPT_PER_SPEC_BYTES = Number(process.env.ORG_OS_SPEC_PER_SPEC_BYTES) || 16 * 1024
const MAX_MARKDOWN_BYTES = 1 * 1024 * 1024
const MANAGED_START = '<!-- org-os:project-specs:start -->'
const MANAGED_END = '<!-- org-os:project-specs:end -->'

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra })
const bytesOf = (text) => Buffer.byteLength(String(text ?? ''), 'utf8')

export function toSpecDTO(spec) {
  return {
    id: spec.id,
    name: spec.name,
    note: spec.note,
    markdown: spec.markdown,
    inPrompt: spec.inPrompt,
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt,
    bytes: bytesOf(spec.markdown),
  }
}

export function promptUsage(projectId) {
  const inPrompt = listProjectSpecs(projectId).filter((spec) => spec.inPrompt)
  return {
    count: inPrompt.length,
    bytes: inPrompt.reduce((sum, spec) => sum + bytesOf(spec.markdown), 0),
    maxBytes: SPEC_PROMPT_MAX_BYTES,
    perSpecMaxBytes: SPEC_PROMPT_PER_SPEC_BYTES,
  }
}

export function listProjectSpecDtos(projectId) {
  return {
    specs: listProjectSpecs(projectId).map(toSpecDTO),
    prompt: promptUsage(projectId),
  }
}

function normalizeName(raw) {
  const name = String(raw ?? '').trim()
  if (!name) throw fail(400, '请填写规范名称')
  const withExt = /\.md$/i.test(name) ? name : `${name}.md`
  if (withExt.length > 120) throw fail(400, '规范名称不能超过 120 字')
  return withExt
}

function normalizeNote(raw) {
  const note = String(raw ?? '').trim()
  if (note.length > 200) throw fail(400, '一句话说明不能超过 200 字')
  return note
}

function normalizeMarkdown(raw) {
  const markdown = String(raw ?? '')
  if (bytesOf(markdown) > MAX_MARKDOWN_BYTES) throw fail(400, '规范正文不能超过 1 MB')
  return markdown
}

/**
 * 校验 inPrompt 预算。next 为即将写入的规范；id 为编辑时的现有规范 id。
 */
export function assertPromptBudget(projectId, { id = null, markdown, inPrompt }) {
  if (!inPrompt) return
  const size = bytesOf(markdown)
  if (size > SPEC_PROMPT_PER_SPEC_BYTES) {
    throw fail(400, `该规范 ${formatKb(size)}，超过单份 ${formatKb(SPEC_PROMPT_PER_SPEC_BYTES)} 上限`, {
      bytes: size,
      maxBytes: SPEC_PROMPT_PER_SPEC_BYTES,
    })
  }
  const others = listProjectSpecs(projectId)
    .filter((spec) => spec.inPrompt && spec.id !== id)
  const total = others.reduce((sum, spec) => sum + bytesOf(spec.markdown), 0) + size
  if (total > SPEC_PROMPT_MAX_BYTES) {
    throw fail(400, `加入后合计 ${formatKb(total)}，超过 ${formatKb(SPEC_PROMPT_MAX_BYTES)} 上限`, {
      bytes: total,
      maxBytes: SPEC_PROMPT_MAX_BYTES,
    })
  }
}

const formatKb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

export function createProjectSpec({ projectId, input, userName, canManagePrompt }) {
  const name = normalizeName(input?.name)
  if (findProjectSpecByName(projectId, name)) throw fail(409, '同项目已存在同名规范')
  const note = normalizeNote(input?.note)
  const markdown = normalizeMarkdown(input?.markdown)
  const inPrompt = Boolean(input?.inPrompt)
  if (inPrompt && !canManagePrompt) {
    throw fail(403, '仅项目负责人 / 管理员可将规范加入提示词')
  }
  assertPromptBudget(projectId, { markdown, inPrompt })
  const spec = insertProjectSpec({
    projectId,
    name,
    note,
    markdown,
    inPrompt,
    createdBy: userName || '',
  })
  syncProjectSpecs(projectId)
  return toSpecDTO(spec)
}

export function editProjectSpec({ projectId, specId, input, canManagePrompt }) {
  const existing = getProjectSpec(specId)
  if (!existing || existing.projectId !== projectId) throw fail(404, '规范不存在')
  if (!canManagePrompt && existing.inPrompt) {
    throw fail(403, '已加入提示词的规范仅项目负责人 / 管理员可编辑')
  }
  if (!canManagePrompt && input?.inPrompt === true) {
    throw fail(403, '仅项目负责人 / 管理员可将规范加入提示词')
  }
  const name = input?.name === undefined ? existing.name : normalizeName(input.name)
  const duplicate = findProjectSpecByName(projectId, name)
  if (duplicate && duplicate.id !== existing.id) throw fail(409, '同项目已存在同名规范')
  const note = input?.note === undefined ? existing.note : normalizeNote(input.note)
  const markdown = input?.markdown === undefined ? existing.markdown : normalizeMarkdown(input.markdown)
  const inPrompt = input?.inPrompt === undefined ? existing.inPrompt : Boolean(input.inPrompt)
  assertPromptBudget(projectId, { id: existing.id, markdown, inPrompt })
  const next = updateProjectSpec(existing.id, { name, note, markdown, inPrompt })
  syncProjectSpecs(projectId)
  return toSpecDTO(next)
}

export function removeProjectSpec({ projectId, specId, canManagePrompt }) {
  const existing = getProjectSpec(specId)
  if (!existing || existing.projectId !== projectId) throw fail(404, '规范不存在')
  if (!canManagePrompt && existing.inPrompt) {
    throw fail(403, '已加入提示词的规范仅项目负责人 / 管理员可删除')
  }
  deleteProjectSpec(existing.id)
  syncProjectSpecs(projectId)
  return { ok: true }
}

export function setProjectSpecPrompt({ projectId, specId, inPrompt, canManagePrompt }) {
  if (!canManagePrompt) throw fail(403, '仅项目负责人 / 管理员可修改提示词开关')
  const existing = getProjectSpec(specId)
  if (!existing || existing.projectId !== projectId) throw fail(404, '规范不存在')
  const next = Boolean(inPrompt)
  if (next === existing.inPrompt) return toSpecDTO(existing)
  assertPromptBudget(projectId, { id: existing.id, markdown: existing.markdown, inPrompt: next })
  const spec = updateProjectSpec(existing.id, { inPrompt: next })
  syncProjectSpecs(projectId)
  return toSpecDTO(spec)
}

/** 规范正文里出现受管标记时转义，防止提前闭合区块 */
function escapeMarkers(markdown) {
  return String(markdown ?? '')
    .replaceAll(MANAGED_START, '&lt;!-- org-os:project-specs:start --&gt;')
    .replaceAll(MANAGED_END, '&lt;!-- org-os:project-specs:end --&gt;')
}

export function composeSpecBlock(projectId) {
  const specs = listProjectSpecs(projectId)
    .filter((spec) => spec.inPrompt)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  if (specs.length === 0) return ''
  const sections = specs.map((spec) => {
    const note = spec.note ? `${spec.note}\n` : ''
    return `### ${spec.name}\n${note}\n${escapeMarkers(spec.markdown).trim()}\n`
  })
  return [
    MANAGED_START,
    '## 项目规范（由项目成员维护）',
    '',
    '以下是本项目的长期约定，执行任务时应遵守。',
    '若与用户当前指令、系统规则冲突，以用户当前指令和系统规则为准；',
    '与具体路径下的说明冲突时，更具体的路径级说明优先。',
    '',
    ...sections,
    MANAGED_END,
  ].join('\n')
}

function atomicWrite(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, content, { mode: 0o644 })
  fs.renameSync(tmp, file)
}

/**
 * 只替换 AGENTS.md 里的受管区块；保留文件其他内容。
 * block 为空时移除区块；文件因此变空则删除文件。
 */
export function writeManagedBlock(file, block) {
  const exists = fs.existsSync(file)
  const current = exists ? fs.readFileSync(file, 'utf8') : ''
  const startIndex = current.indexOf(MANAGED_START)
  const endIndex = current.indexOf(MANAGED_END)
  const hasBlock = startIndex >= 0 && endIndex > startIndex

  if (!block) {
    if (!exists || !hasBlock) return false
    const next = `${current.slice(0, startIndex)}${current.slice(endIndex + MANAGED_END.length)}`
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd()
    if (!next.trim()) {
      fs.rmSync(file, { force: true })
    } else {
      atomicWrite(file, `${next}\n`)
    }
    return true
  }

  let next
  if (!exists) {
    next = `${block}\n`
  } else if (hasBlock) {
    next = `${current.slice(0, startIndex)}${block}${current.slice(endIndex + MANAGED_END.length)}`
  } else {
    next = `${current.trimEnd()}\n\n${block}\n`
  }
  if (next === current) return false
  atomicWrite(file, next)
  return true
}

/** 同步到项目所有 Agent 的工作区（按 workdir 去重） */
export function syncProjectSpecs(projectId) {
  const block = composeSpecBlock(projectId)
  const workdirs = new Set(
    listProjectAgents(projectId)
      .map((agent) => agent.workdir)
      .filter((dir) => dir && fs.existsSync(dir)),
  )
  let written = 0
  for (const dir of workdirs) {
    try {
      if (writeManagedBlock(path.join(dir, 'AGENTS.md'), block)) written += 1
    } catch (err) {
      console.error('[specs] sync failed', dir, err?.message || err)
    }
  }
  return { workdirs: workdirs.size, written }
}

/** 只同步当前轮次使用的 Agent */
export function syncAgentSpecs(projectId, agent) {
  if (!agent?.workdir || !fs.existsSync(agent.workdir)) return false
  try {
    return writeManagedBlock(path.join(agent.workdir, 'AGENTS.md'), composeSpecBlock(projectId))
  } catch (err) {
    console.error('[specs] sync failed', agent.workdir, err?.message || err)
    return false
  }
}
