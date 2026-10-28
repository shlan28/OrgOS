import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  specsApi,
  type ProjectSpec,
  type SpecPromptUsage,
} from '../../lib/specsApi'
import { Section, Row } from '../SettingsRow'
import FormModal, { ModalField } from '../FormModal'
import Toggle from '../Toggle'
import { DocIcon, ArrowLeftIcon, ChevronRightIcon, SearchIcon } from '../icons'
import './SpecsPanel.css'

interface SpecsPanelProps {
  projectId: string
  /** 项目负责人 / 组织管理员才能编辑已入提示词的规范、切换提示词开关 */
  canManagePrompt: boolean
}

interface PreviewSection {
  heading: string
  body: string
}

const EMPTY_PROMPT: SpecPromptUsage = { count: 0, bytes: 0, maxBytes: 32 * 1024, perSpecMaxBytes: 16 * 1024 }

const msgOf = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

const stampOf = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/** 粗略换算：UTF-8 中文约 3 字节/字，英文约 1 字节/字符 */
const capacityZh = (bytes: number) => {
  const chars = bytes / 3
  return chars >= 10_000 ? `${(chars / 10_000).toFixed(1)} 万汉字` : `${Math.round(chars / 1000)} 千汉字`
}

const capacityEn = (bytes: number) =>
  bytes >= 10_000 ? `${(bytes / 10_000).toFixed(1)} 万英文字符` : `${bytes} 英文字符`

/** 按 `##` 标题切段，供现有预览样式渲染 */
function sectionsOf(markdown: string): PreviewSection[] {
  const sections: PreviewSection[] = []
  let heading = ''
  let body: string[] = []
  const flush = () => {
    const text = body.join('\n').trim()
    if (heading || text) sections.push({ heading, body: text })
    heading = ''
    body = []
  }
  for (const line of String(markdown || '').split('\n')) {
    const match = line.match(/^##\s+(.+)$/)
    if (match) {
      flush()
      heading = match[1].trim()
    } else {
      body.push(line)
    }
  }
  flush()
  return sections
}

/**
 * 项目规范面板：搜索 + 文档列表 ↔ 预览 ⇄ 编辑 + 新建/删除。
 * 数据来自 /api/projects/:id/specs；加入提示词的规范由后端写入项目 AGENTS.md。
 */
export default function SpecsPanel({ projectId, canManagePrompt }: SpecsPanelProps) {
  const [specs, setSpecs] = useState<ProjectSpec[]>([])
  const [prompt, setPrompt] = useState<SpecPromptUsage>(EMPTY_PROMPT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')

  const [keyword, setKeyword] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newInPrompt, setNewInPrompt] = useState(true)
  const [createError, setCreateError] = useState('')

  /** 点击开关后的常驻提示（不自动消失） */
  const [promptToast, setPromptToast] = useState<{ docName: string; on: boolean } | null>(null)
  /** 容量与规范建议弹窗 */
  const [helpOpen, setHelpOpen] = useState(false)

  const openDoc = specs.find((spec) => spec.id === openId) ?? null

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      const result = await specsApi.list(projectId)
      setSpecs(result.specs)
      setPrompt(result.prompt)
    } catch (err) {
      setError(msgOf(err, '加载规范失败'))
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setSpecs([])
    setPrompt(EMPTY_PROMPT)
    setOpenId(null)
    setEditing(false)
    setActionError('')
    setPromptToast(null)
    setHelpOpen(false)
    void load()
  }, [load])

  useEffect(() => {
    if (!helpOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHelpOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [helpOpen])

  const filtered = useMemo(() => specs.filter(
    (spec) => spec.name.toLowerCase().includes(keyword.trim().toLowerCase())
      || spec.note.toLowerCase().includes(keyword.trim().toLowerCase()),
  ), [specs, keyword])

  const applySpec = (next: ProjectSpec, nextPrompt: SpecPromptUsage) => {
    setSpecs((list) => {
      const exists = list.some((spec) => spec.id === next.id)
      return exists ? list.map((spec) => (spec.id === next.id ? next : spec)) : [next, ...list]
    })
    setPrompt(nextPrompt)
  }

  const handleTogglePrompt = async (doc: ProjectSpec, next: boolean) => {
    setActionError('')
    if (!canManagePrompt) {
      setActionError('仅项目负责人 / 管理员可修改「加入提示词」')
      return
    }
    try {
      const result = await specsApi.setPrompt(projectId, doc.id, next)
      applySpec(result.spec, result.prompt)
      setPromptToast({ docName: result.spec.name, on: result.spec.inPrompt })
    } catch (err) {
      setActionError(msgOf(err, '切换提示词失败'))
    }
  }

  const handleSave = async () => {
    if (!openDoc || saving) return
    setSaving(true)
    setFormError('')
    try {
      const result = await specsApi.update(projectId, openDoc.id, { markdown: draft })
      applySpec(result.spec, result.prompt)
      setEditing(false)
    } catch (err) {
      setFormError(msgOf(err, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!openDoc || saving) return
    setSaving(true)
    setFormError('')
    try {
      const result = await specsApi.remove(projectId, openDoc.id)
      setSpecs((list) => list.filter((spec) => spec.id !== openDoc.id))
      setPrompt(result.prompt)
      setEditing(false)
      setOpenId(null)
    } catch (err) {
      setFormError(msgOf(err, '删除失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    setSaving(true)
    setCreateError('')
    try {
      const result = await specsApi.create(projectId, {
        name: newName.trim(),
        note: newNote.trim(),
        markdown: '',
        inPrompt: canManagePrompt ? newInPrompt : false,
      })
      applySpec(result.spec, result.prompt)
      setCreating(false)
      setNewName('')
      setNewNote('')
      setNewInPrompt(true)
      setOpenId(result.spec.id)
      setDraft('')
      setEditing(true)
      setFormError('')
    } catch (err) {
      setCreateError(msgOf(err, '创建失败'))
    } finally {
      setSaving(false)
    }
  }

  const canEditDoc = (doc: ProjectSpec) => canManagePrompt || !doc.inPrompt

  /* ---------- 列表视图 ---------- */
  if (!openDoc) {
    return (
      <div className="specs-panel">
        {promptToast && (
          <div className="specs-toast" role="status">
            <span className={`specs-toast-icon${promptToast.on ? ' on' : ' off'}`}>
              {promptToast.on ? '✓' : '○'}
            </span>
            <span className="specs-toast-text">
              <span className="specs-toast-title">
                {`「${promptToast.docName}」${promptToast.on ? '已加入系统提示词' : '已移出系统提示词'}`}
              </span>
              <span className="specs-toast-body">
                {promptToast.on
                  ? '已写入项目 AGENTS.md，将在下一轮或新会话生效。'
                  : '已从项目 AGENTS.md 移除，后续会话不再受该文档约束。'}
              </span>
            </span>
            <button
              type="button"
              className="specs-toast-close"
              aria-label="关闭提示"
              onClick={() => setPromptToast(null)}
            >
              ×
            </button>
          </div>
        )}

        <div className="specs-search">
          <SearchIcon size={14} />
          <input
            type="text"
            value={keyword}
            placeholder="搜索规范文档"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>

        <div className="specs-tips">
          <span className="specs-tips-icon">i</span>
          <span className="specs-tips-text">
            开启「加入提示词」的规范会写入项目 AGENTS.md，在会话开始时加载；长文档建议放入项目知识库。
          </span>
        </div>

        <div className="specs-usage">
          <span>已加入提示词 {prompt.count} 份</span>
          <span className="specs-usage-right">
            <span className="specs-usage-bytes">
              {formatBytes(prompt.bytes)} / {formatBytes(prompt.maxBytes)}
            </span>
            <button
              type="button"
              className="specs-help-btn"
              aria-label="提示词容量说明"
              title="提示词容量说明"
              onClick={() => setHelpOpen(true)}
            >
              ?
            </button>
          </span>
        </div>
        <p className="specs-usage-hint">
          合计 {formatBytes(prompt.maxBytes)} ≈ {capacityZh(prompt.maxBytes)} / {capacityEn(prompt.maxBytes)}
          {' · '}
          单份 ≤ {formatBytes(prompt.perSpecMaxBytes)}
        </p>

        {actionError && <p className="specs-error">{actionError}</p>}
        {loading && <div className="specs-empty">加载中…</div>}
        {!loading && error && (
          <div className="specs-empty">
            {error}
            {' '}
            <button type="button" className="text-btn" onClick={() => void load()}>重试</button>
          </div>
        )}

        {!loading && !error && (
          <Section
            label={`规范文档（${filtered.length} 份）`}
            action={<button type="button" className="text-btn" onClick={() => { setCreateError(''); setCreating(true) }}>+ 新建</button>}
          >
            {filtered.length === 0 && <div className="specs-empty">没有匹配的文档</div>}
            {filtered.map((doc) => (
              <Row key={doc.id} className="specs-doc-row" onClick={() => setOpenId(doc.id)}>
                <span className="settings-row-main">
                  <DocIcon size={16} className="specs-doc-icon" />
                  <span className="settings-row-text">
                    <span className="settings-row-title">{doc.name}</span>
                    <span className="settings-row-sub">
                      {doc.note || '未填写说明'} · {formatBytes(doc.bytes)} · 更新于 {stampOf(doc.updatedAt)}
                    </span>
                  </span>
                </span>
                <span className="settings-row-right">
                  <span className="specs-prompt-toggle" onClick={(event) => event.stopPropagation()}>
                    <Toggle
                      checked={doc.inPrompt}
                      disabled={!canManagePrompt}
                      title={canManagePrompt
                        ? (doc.inPrompt ? '已加入系统提示词，点击移出' : '未加入系统提示词，点击加入')
                        : '仅项目负责人 / 管理员可修改'}
                      onChange={(next) => void handleTogglePrompt(doc, next)}
                    />
                  </span>
                  <ChevronRightIcon size={13} />
                </span>
              </Row>
            ))}
          </Section>
        )}

        {creating && (
          <FormModal
            title="新建文档"
            confirmText={saving ? '创建中…' : '创建'}
            confirmDisabled={!newName.trim() || saving}
            onConfirm={() => void handleCreate()}
            onClose={() => { setCreating(false); setNewName(''); setNewNote(''); setCreateError('') }}
          >
            <ModalField label="文件名">
              <input className="field-input" value={newName} placeholder="如 部署规范" onChange={(event) => setNewName(event.target.value)} />
            </ModalField>
            <ModalField label="一句话说明">
              <input className="field-input" value={newNote} placeholder="可选" onChange={(event) => setNewNote(event.target.value)} />
            </ModalField>
            <ModalField label="是否加入项目提示词">
              {canManagePrompt ? (
                <span className="specs-prompt-field">
                  <Toggle checked={newInPrompt} onChange={setNewInPrompt} />
                  <span className="specs-prompt-hint">打开则写入项目 AGENTS.md</span>
                </span>
              ) : (
                <span className="specs-prompt-hint">仅项目负责人 / 管理员可加入提示词</span>
              )}
            </ModalField>
            {createError && <p className="specs-form-error">{createError}</p>}
          </FormModal>
        )}

        {helpOpen && (
          <div
            className="modal-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setHelpOpen(false)
            }}
          >
            <div className="modal-box specs-help-modal" role="dialog" aria-modal="true" aria-label="提示词容量与规范建议">
              <div className="modal-head">
                <span className="modal-title">提示词容量与规范建议</span>
                <button type="button" className="modal-close" aria-label="关闭" onClick={() => setHelpOpen(false)}>×</button>
              </div>
              <div className="specs-help-body">
                <h4>容量大概是多少</h4>
                <ul>
                  <li>
                    合计上限 <strong>{formatBytes(prompt.maxBytes)}</strong>：约 {capacityZh(prompt.maxBytes)}，
                    或约 {capacityEn(prompt.maxBytes)}。
                  </li>
                  <li>
                    单份上限 <strong>{formatBytes(prompt.perSpecMaxBytes)}</strong>：约 {capacityZh(prompt.perSpecMaxBytes)}，
                    或约 {capacityEn(prompt.perSpecMaxBytes)}。
                  </li>
                  <li>按 UTF-8 估算：中文约 3 字节/字，英文约 1 字节/字符；Markdown 标记也占容量，实际可写略少。</li>
                  <li>只限制「加入提示词」：规范本身可以保存得更长，只是不能打开开关。</li>
                </ul>

                <h4>为什么限制</h4>
                <ul>
                  <li>Agent 的 AGENTS.md 总预算约 64 KB，需要给用户全局指令和工作区原有 AGENTS.md 留余量。</li>
                  <li>超预算时 CLI 可能丢弃或截断，规范被悄悄改变比明确拒绝更危险。</li>
                  <li>规范越长，上下文成本越高、对本轮指令的稀释越明显。</li>
                </ul>

                <h4>规范里建议放什么</h4>
                <p>
                  <strong>适合：</strong>
                  代码规范、架构决策、接口/数据约定、部署与回滚步骤、评审与安全要求、团队明确的协作约定。
                </p>
                <p>
                  <strong>不适合：</strong>
                  README 与项目介绍、长篇教程、会议记录、一次性调试过程、能从代码或知识库查到的资料。
                  长文档建议放「项目知识库」，规范只保留必须遵守的结论。
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-primary" onClick={() => setHelpOpen(false)}>知道了</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  /* ---------- 编辑模式 ---------- */
  if (editing) {
    const dirty = draft !== openDoc.markdown
    return (
      <div className="specs-panel specs-editing">
        <div className="specs-toolbar">
          <button
            type="button"
            className="specs-back"
            onClick={() => { setEditing(false); setOpenId(null); setFormError('') }}
          >
            <ArrowLeftIcon size={14} />
            返回文档列表
          </button>
          <span className="specs-mode-tag">编辑中</span>
        </div>
        <textarea
          className="specs-editor"
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
        />
        {formError && <p className="specs-form-error">{formError}</p>}
        <div className="specs-edit-actions">
          <span className="specs-dirty-hint">{dirty ? '有未保存的修改' : ''}</span>
          <span className="specs-edit-btns">
            <button
              type="button"
              className="text-btn danger"
              disabled={!canEditDoc(openDoc) || saving}
              title={canEditDoc(openDoc) ? undefined : '仅项目负责人 / 管理员可删除已入提示词的规范'}
              onClick={() => void handleDelete()}
            >
              删除文档
            </button>
            <button type="button" className="text-btn" onClick={() => { setEditing(false); setFormError('') }}>取消</button>
            <button type="button" className="btn-primary" disabled={!dirty || saving} onClick={() => void handleSave()}>
              {saving ? '保存中…' : '保存'}
            </button>
          </span>
        </div>
      </div>
    )
  }

  /* ---------- 预览模式 ---------- */
  const sections = sectionsOf(openDoc.markdown)
  return (
    <div className="specs-panel">
      <div className="specs-toolbar">
        <button type="button" className="specs-back" onClick={() => setOpenId(null)}>
          <ArrowLeftIcon size={14} />
          返回文档列表
        </button>
        <span className="specs-toolbar-right">
          <span
            className={`specs-prompt-badge${openDoc.inPrompt ? ' on' : ''}`}
            title={openDoc.inPrompt ? '该规范已加入项目提示词' : '该规范未加入提示词'}
          >
            {openDoc.inPrompt ? '已加入项目提示词' : '未加入项目提示词'}
          </span>
          <button
            type="button"
            className="text-btn"
            disabled={!canEditDoc(openDoc)}
            title={canEditDoc(openDoc) ? undefined : '仅项目负责人 / 管理员可编辑已入提示词的规范'}
            onClick={() => { setDraft(openDoc.markdown); setFormError(''); setEditing(true) }}
          >
            编辑
          </button>
        </span>
      </div>
      <div className="specs-preview">
        <h2 className="specs-preview-title">{openDoc.name.replace(/\.md$/i, '')}</h2>
        {sections.length === 0 && <p className="specs-preview-body">（暂无内容，点击「编辑」开始编写）</p>}
        {sections.map((section, index) => (
          <div key={index} className="specs-preview-section">
            {section.heading && <h3 className="specs-preview-heading">{section.heading}</h3>}
            <p className="specs-preview-body">{section.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
