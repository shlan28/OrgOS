import { useState } from 'react'
import type { SpecDoc } from '../../data/projects'
import { Section, Row } from '../SettingsRow'
import FormModal, { ModalField } from '../FormModal'
import Toggle from '../Toggle'
import { DocIcon, ArrowLeftIcon, ChevronRightIcon, SearchIcon } from '../icons'
import './SpecsPanel.css'

interface SpecsPanelProps {
  specs: SpecDoc[]
  onUpdateSpecs: (specs: SpecDoc[]) => void
}

const nowStamp = () => {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 项目规范面板：搜索 + 文档列表 ↔ 预览 ⇄ 编辑 + 新建/删除
 * 每条规范带「是否加入项目提示词」开关（行右侧），点击开关弹出常驻说明提示（手动 X 关闭）
 */
export default function SpecsPanel({ specs, onUpdateSpecs }: SpecsPanelProps) {
  const [keyword, setKeyword] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newInPrompt, setNewInPrompt] = useState(true)
  /** 点击开关弹出的常驻提示（单例，null = 不显示，仅手动 X 关闭，不自动消失） */
  const [promptToast, setPromptToast] = useState<{ docName: string; on: boolean } | null>(null)

  const openDoc = specs.find((s) => s.id === openId) ?? null
  const filtered = specs.filter(
    (s) => s.name.toLowerCase().includes(keyword.trim().toLowerCase())
      || s.note.toLowerCase().includes(keyword.trim().toLowerCase()),
  )

  const handleTogglePrompt = (doc: SpecDoc, next: boolean) => {
    onUpdateSpecs(specs.map((s) => (s.id === doc.id ? { ...s, inPrompt: next } : s)))
    // 弹出常驻提示（切换文档时内容替换，不堆叠）
    setPromptToast({ docName: doc.name, on: next })
  }

  const handleSave = () => {
    if (!openDoc) return
    onUpdateSpecs(specs.map((s) => s.id === openDoc.id
      ? { ...s, markdown: draft, updatedAt: nowStamp() }
      : s))
    setEditing(false)
  }

  const handleDelete = () => {
    if (!openDoc) return
    onUpdateSpecs(specs.filter((s) => s.id !== openDoc.id))
    setEditing(false)
    setOpenId(null)
  }

  const handleCreate = () => {
    if (!newName.trim()) return
    const doc: SpecDoc = {
      id: `s${Date.now()}`,
      name: newName.trim().endsWith('.md') ? newName.trim() : `${newName.trim()}.md`,
      note: newNote.trim() || '新建文档',
      updatedAt: nowStamp(),
      markdown: '',
      content: [],
      inPrompt: newInPrompt,
    }
    onUpdateSpecs([doc, ...specs])
    setCreating(false)
    setNewName('')
    setNewNote('')
    setNewInPrompt(true)
    // 新建后进入编辑模式
    setOpenId(doc.id)
    setDraft('')
    setEditing(true)
  }

  /* ---------- 列表视图 ---------- */
  if (!openDoc) {
    return (
      <div className="specs-panel">
        {/* 点击开关后的常驻提示（不自动消失，仅 X 关闭） */}
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
                  ? 'Agent 执行任务时会遵守该文档中的约定。'
                  : 'Agent 执行任务时不再受该文档约束。'}
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
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        {/* 顶部常驻 tips：说明规范与系统提示词的机制 */}
        <div className="specs-tips">
          <span className="specs-tips-icon">i</span>
          <span className="specs-tips-text">
            开启「加入提示词」的规范文档，将进入本项目的系统提示词，Agent 执行任务时会遵守其中的约定。
          </span>
        </div>
        <Section
          label={`规范文档（${filtered.length} 份）`}
          action={<button type="button" className="text-btn" onClick={() => setCreating(true)}>+ 新建</button>}
        >
          {filtered.length === 0 && <div className="specs-empty">没有匹配的文档</div>}
          {filtered.map((doc) => (
            <Row key={doc.id} className="specs-doc-row" onClick={() => setOpenId(doc.id)}>
              <span className="settings-row-main">
                <DocIcon size={16} className="specs-doc-icon" />
                <span className="settings-row-text">
                  <span className="settings-row-title">{doc.name}</span>
                  <span className="settings-row-sub">{doc.note} · 更新于 {doc.updatedAt}</span>
                </span>
              </span>
              <span className="settings-row-right">
                <span
                  className="specs-prompt-toggle"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Toggle
                    checked={doc.inPrompt}
                    title={doc.inPrompt ? '已加入系统提示词，点击移出' : '未加入系统提示词，点击加入'}
                    onChange={(next) => handleTogglePrompt(doc, next)}
                  />
                </span>
                <ChevronRightIcon size={13} />
              </span>
            </Row>
          ))}
        </Section>

        {creating && (
          <FormModal
            title="新建文档"
            confirmText="创建"
            confirmDisabled={!newName.trim()}
            onConfirm={handleCreate}
            onClose={() => { setCreating(false); setNewName(''); setNewNote('') }}
          >
            <ModalField label="文件名">
              <input className="field-input" value={newName} placeholder="如 部署规范" onChange={(e) => setNewName(e.target.value)} />
            </ModalField>
            <ModalField label="一句话说明">
              <input className="field-input" value={newNote} placeholder="可选" onChange={(e) => setNewNote(e.target.value)} />
            </ModalField>
            <ModalField label="是否加入项目提示词">
              <span className="specs-prompt-field">
                <Toggle checked={newInPrompt} onChange={setNewInPrompt} />
                <span className="specs-prompt-hint">打开则加入系统提示词</span>
              </span>
            </ModalField>
          </FormModal>
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
            onClick={() => { setEditing(false); setOpenId(null) }}
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
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="specs-edit-actions">
          <span className="specs-dirty-hint">{dirty ? '有未保存的修改' : ''}</span>
          <span className="specs-edit-btns">
            <button type="button" className="text-btn danger" onClick={handleDelete}>删除文档</button>
            <button type="button" className="text-btn" onClick={() => setEditing(false)}>取消</button>
            <button type="button" className="btn-primary" disabled={!dirty} onClick={handleSave}>保存</button>
          </span>
        </div>
      </div>
    )
  }

  /* ---------- 预览模式 ---------- */
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
            title={openDoc.inPrompt ? '该规范已加入本项目的系统提示词' : '该规范未加入系统提示词'}
          >
            {openDoc.inPrompt ? '已加入项目提示词' : '未加入项目提示词'}
          </span>
          <button
            type="button"
            className="text-btn"
            onClick={() => { setDraft(openDoc.markdown); setEditing(true) }}
          >
            编辑
          </button>
        </span>
      </div>
      <div className="specs-preview">
        <h2 className="specs-preview-title">{openDoc.name.replace(/\.md$/i, '')}</h2>
        {openDoc.content.length === 0 && <p className="specs-preview-body">（暂无内容，点击「编辑」开始编写）</p>}
        {openDoc.content.map((sec, i) => (
          <div key={i} className="specs-preview-section">
            <h3 className="specs-preview-heading">{sec.heading}</h3>
            <p className="specs-preview-body">{sec.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
