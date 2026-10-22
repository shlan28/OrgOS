import { useEffect, useRef, useState } from 'react'
import type { Knowledge, KbDoc, KbFolder, MemoryItem, MemorySettings } from '../../data/projects'
import { Section, Row } from '../SettingsRow'
import FormModal, { ModalField } from '../FormModal'
import StatusBadge, { type BadgeTone } from '../StatusBadge'
import Toggle from '../Toggle'
import SegmentedControl from '../SegmentedControl'
import { DocIcon, ChevronDownIcon, ChevronRightIcon, ArrowLeftIcon, FolderIcon } from '../icons'
import './KnowledgePanel.css'

interface KnowledgePanelProps {
  knowledge: Knowledge
  onUpdateKnowledge: (k: Knowledge) => void
}

const SOURCES: KbDoc['source'][] = ['团队 wiki', 'GitLab 文档', '本地文件']
const POLICIES: MemorySettings['expirePolicy'][] = ['自动归档', '自动删除', '仅提醒']
const REFLECT_FREQS: MemorySettings['reflectFrequency'][] = ['每天', '每周', '每月']

const lifecycleTone: Record<MemoryItem['lifecycle'], BadgeTone> = {
  活跃: 'success',
  即将过期: 'warning',
  已归档: 'neutral',
}

const nowStamp = () => {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 滚动到最近的可滚动祖先顶部 */
function scrollToTop(el: HTMLElement | null) {
  let node = el?.parentElement ?? null
  while (node) {
    if (node.scrollHeight > node.clientHeight) {
      node.scrollTop = 0
      return
    }
    node = node.parentElement
  }
}

/**
 * 知识记忆面板：顶部分段切换（项目知识库 / 记忆）
 */
export default function KnowledgePanel({ knowledge, onUpdateKnowledge }: KnowledgePanelProps) {
  const [segment, setSegment] = useState('kb')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollToTop(rootRef.current)
  }, [segment])

  return (
    <div className="knowledge-panel" ref={rootRef}>
      <SegmentedControl
        value={segment}
        onChange={setSegment}
        items={[
          { key: 'kb', label: '项目知识库', icon: null },
          { key: 'memory', label: '记忆', icon: null },
        ]}
      />
      {segment === 'kb'
        ? <KbSegment knowledge={knowledge} onUpdateKnowledge={onUpdateKnowledge} />
        : <MemorySegment knowledge={knowledge} onUpdateKnowledge={onUpdateKnowledge} />}
    </div>
  )
}

/* ================= 段一：项目知识库（目录树 + 文档列表） ================= */

const ALL = '__all__'

function KbSegment({ knowledge, onUpdateKnowledge }: KnowledgePanelProps) {
  const { docs, folders } = knowledge
  // 目录树状态
  const [selectedFolder, setSelectedFolder] = useState<string>(ALL)
  const [collapsedIds, setCollapsedIds] = useState<string[]>([])
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderParent, setNewFolderParent] = useState('')
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null)
  // 文档列表状态
  const [importing, setImporting] = useState(false)
  const [importForm, setImportForm] = useState({ source: SOURCES[0] as KbDoc['source'], ref: '', folderId: '' })
  // 二级视图：当前打开的文档
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  /* ---------- 目录树派生逻辑 ---------- */
  /** 目录的子孙 id 集合（含自身） */
  const subtreeIds = (folderId: string): Set<string> => {
    const ids = new Set<string>([folderId])
    let grew = true
    while (grew) {
      grew = false
      for (const f of folders) {
        if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
          ids.add(f.id)
          grew = true
        }
      }
    }
    return ids
  }

  /** 目录路径文案：架构 / 组件设计 */
  const folderPathLabel = (folderId: string): string => {
    const parts: string[] = []
    let cur = folders.find((f) => f.id === folderId)
    while (cur) {
      parts.unshift(cur.name)
      cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined
    }
    return parts.join(' / ')
  }

  /** 目录下的文档数（含子孙目录） */
  const countIn = (folderId: string) => {
    const ids = subtreeIds(folderId)
    return docs.filter((d) => ids.has(d.folderId)).length
  }

  const openDoc = docs.find((d) => d.id === openId) ?? null
  const visibleDocs = selectedFolder === ALL
    ? docs
    : docs.filter((d) => subtreeIds(selectedFolder).has(d.folderId))
  const folderName = selectedFolder === ALL
    ? '全部文档'
    : folderPathLabel(selectedFolder)

  /* ---------- 目录管理 ---------- */
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return
    const folder: KbFolder = { id: `f${Date.now()}`, name: newFolderName.trim() }
    if (newFolderParent) folder.parentId = newFolderParent
    onUpdateKnowledge({ ...knowledge, folders: [...folders, folder] })
    setCreatingFolder(false)
    setNewFolderName('')
    setNewFolderParent('')
    setSelectedFolder(folder.id)
  }

  const handleRenameFolder = () => {
    if (!renamingFolderId || !renameName.trim()) return
    onUpdateKnowledge({
      ...knowledge,
      folders: folders.map((f) => f.id === renamingFolderId ? { ...f, name: renameName.trim() } : f),
    })
    setRenamingFolderId(null)
    setRenameName('')
    setMenuFolderId(null)
  }

  const handleDeleteFolder = () => {
    if (!deletingFolderId) return
    const removed = subtreeIds(deletingFolderId)
    onUpdateKnowledge({ ...knowledge, folders: folders.filter((f) => !removed.has(f.id)) })
    // 选中目录在被删子树内 → 回退「全部文档」
    if (selectedFolder !== ALL && removed.has(selectedFolder)) setSelectedFolder(ALL)
    setDeletingFolderId(null)
    setMenuFolderId(null)
  }

  /* ---------- 文档管理 ---------- */
  const handleImport = () => {
    if (!importForm.ref.trim()) return
    const folderId = importForm.folderId
      || (selectedFolder !== ALL ? selectedFolder : folders[0]?.id ?? '')
    const doc: KbDoc = {
      id: `d${Date.now()}`,
      title: importForm.ref.trim().split('/').pop() || importForm.ref.trim(),
      source: importForm.source,
      sourceRef: importForm.ref.trim(),
      folderId,
      importedAt: nowStamp(),
      updatedAt: nowStamp(),
      markdown: '',
      content: [],
      summary: '（摘要生成中……导入的文档将在解析后可查看摘要。）',
    }
    onUpdateKnowledge({ ...knowledge, docs: [doc, ...docs] })
    setImporting(false)
    setImportForm({ source: SOURCES[0], ref: '', folderId: '' })
  }

  const handleSaveDoc = () => {
    if (!openDoc) return
    onUpdateKnowledge({
      ...knowledge,
      docs: docs.map((d) => d.id === openDoc.id
        ? { ...d, markdown: draft, updatedAt: nowStamp() }
        : d),
    })
    setEditing(false)
  }

  const handleDeleteDoc = () => {
    if (!openDoc) return
    onUpdateKnowledge({ ...knowledge, docs: docs.filter((d) => d.id !== openDoc.id) })
    setEditing(false)
    setOpenId(null)
  }

  /* ---------- 目录树（左栏，递归渲染） ---------- */
  const renderFolderNode = (folder: KbFolder, depth: number) => {
    const children = folders.filter((f) => f.parentId === folder.id)
    const collapsed = collapsedIds.includes(folder.id)
    return (
      <div key={folder.id}>
        <div className="kb-tree-node">
          <button
            type="button"
            className={`kb-tree-item${selectedFolder === folder.id ? ' active' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => setSelectedFolder(folder.id)}
          >
            {children.length > 0 ? (
              <span
                className={`kb-tree-toggle${collapsed ? '' : ' open'}`}
                title={collapsed ? '展开' : '折叠'}
                onClick={(e) => {
                  e.stopPropagation()
                  setCollapsedIds(collapsed
                    ? collapsedIds.filter((id) => id !== folder.id)
                    : [...collapsedIds, folder.id])
                }}
              >
                <ChevronRightIcon size={12} />
              </span>
            ) : (
              <span className="kb-tree-toggle-spacer" />
            )}
            <FolderIcon size={14} />
            <span className="kb-tree-name">{folder.name}</span>
            <span className="kb-tree-count">{countIn(folder.id)}</span>
            <span
              className="kb-tree-menu-btn"
              title="目录操作"
              onClick={(e) => {
                e.stopPropagation()
                setMenuFolderId(menuFolderId === folder.id ? null : folder.id)
              }}
            >
              ⋯
            </span>
          </button>
          {menuFolderId === folder.id && (
            <div className="kb-tree-menu" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="kb-tree-menu-item"
                onClick={() => { setRenamingFolderId(folder.id); setRenameName(folder.name); setMenuFolderId(null) }}
              >
                重命名
              </button>
              <button
                type="button"
                className="kb-tree-menu-item danger"
                disabled={countIn(folder.id) > 0 || children.length > 0}
                title={countIn(folder.id) > 0 || children.length > 0 ? '请先移出或删除目录下的文档与子目录' : '删除该目录'}
                onClick={() => { setDeletingFolderId(folder.id); setMenuFolderId(null) }}
              >
                删除
              </button>
            </div>
          )}
        </div>
        {!collapsed && children.map((c) => renderFolderNode(c, depth + 1))}
      </div>
    )
  }

  const folderTree = (
    <div className="kb-tree">
      <div className="kb-tree-head">
        <span className="kb-tree-title">目录</span>
        <button type="button" className="text-btn" onClick={() => setCreatingFolder(true)}>+ 新建目录</button>
      </div>
      <button
        type="button"
        className={`kb-tree-item${selectedFolder === ALL ? ' active' : ''}`}
        onClick={() => setSelectedFolder(ALL)}
      >
        <span className="kb-tree-toggle-spacer" />
        <DocIcon size={14} />
        <span className="kb-tree-name">全部文档</span>
        <span className="kb-tree-count">{docs.length}</span>
      </button>
      {folders.filter((f) => !f.parentId).map((f) => renderFolderNode(f, 0))}
    </div>
  )

  /* ---------- 二级视图：预览模式（占满右栏，目录树保留） ---------- */
  if (openDoc && !editing) {
    return (
      <div className="kb-segment kb-two-col">
        {folderTree}
        <div className="kb-main kb-detail">
          <div className="specs-toolbar">
            <button type="button" className="specs-back" onClick={() => setOpenId(null)}>
              <ArrowLeftIcon size={14} />
              返回文档列表
            </button>
            <button
              type="button"
              className="text-btn"
              onClick={() => { setDraft(openDoc.markdown); setEditing(true) }}
            >
              编辑
            </button>
          </div>
          <div className="specs-preview">
            <h2 className="specs-preview-title">{openDoc.title}</h2>
            {openDoc.content.length === 0 && <p className="specs-preview-body">（暂无内容，点击「编辑」开始编写）</p>}
            {openDoc.content.map((sec, i) => (
              <div key={i} className="specs-preview-section">
                <h3 className="specs-preview-heading">{sec.heading}</h3>
                <p className="specs-preview-body">{sec.body}</p>
              </div>
            ))}
            <p className="kb-source-line">
              来源：{openDoc.source}{openDoc.sourceRef ? `（${openDoc.sourceRef}）` : ''} · 导入于 {openDoc.importedAt}
            </p>
          </div>
        </div>
      </div>
    )
  }

  /* ---------- 二级视图：编辑模式 ---------- */
  if (openDoc && editing) {
    const dirty = draft !== openDoc.markdown
    return (
      <div className="kb-segment kb-two-col">
        {folderTree}
        <div className="kb-main kb-detail kb-editing">
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
              <button type="button" className="text-btn danger" onClick={handleDeleteDoc}>删除</button>
              <button type="button" className="text-btn" onClick={() => setEditing(false)}>取消</button>
              <button type="button" className="btn-primary" disabled={!dirty} onClick={handleSaveDoc}>保存</button>
            </span>
          </div>
        </div>
      </div>
    )
  }

  /* ---------- 列表视图（左目录树 + 右文档列表） ---------- */
  return (
    <div className="kb-segment kb-two-col">
      {folderTree}
      <div className="kb-main">
        <Section
          label={`${folderName}（${visibleDocs.length} 篇）`}
          action={(
            <button type="button" className="text-btn" onClick={() => setImporting(true)}>+ 导入</button>
          )}
        >
          {visibleDocs.length === 0 && <div className="knowledge-empty">该目录下暂无文档</div>}
          {visibleDocs.map((doc) => (
            <Row
              key={doc.id}
              className="knowledge-row"
              onClick={() => {
                setOpenId(doc.id)
                setEditing(false)
              }}
            >
              <span className="settings-row-main">
                <DocIcon size={16} className="knowledge-icon" />
                <span className="settings-row-text">
                  <span className="settings-row-title">{doc.title}</span>
                  <span className="settings-row-sub">{doc.summary} · {doc.source} · 更新于 {doc.updatedAt}</span>
                </span>
              </span>
              <span className="settings-row-right">
                <ChevronRightIcon size={13} className="knowledge-chevron" />
              </span>
            </Row>
          ))}
        </Section>
      </div>

      {creatingFolder && (
        <FormModal
          title="新建目录"
          confirmText="创建"
          confirmDisabled={!newFolderName.trim()}
          onConfirm={handleCreateFolder}
          onClose={() => { setCreatingFolder(false); setNewFolderName(''); setNewFolderParent('') }}
        >
          <ModalField label="目录名">
            <input className="field-input" value={newFolderName} placeholder="如 架构" onChange={(e) => setNewFolderName(e.target.value)} />
          </ModalField>
          <ModalField label="上级目录">
            <select
              className="field-select"
              value={newFolderParent}
              onChange={(e) => setNewFolderParent(e.target.value)}
            >
              <option value="">无（根目录）</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{folderPathLabel(f.id)}</option>)}
            </select>
          </ModalField>
        </FormModal>
      )}

      {renamingFolderId && (
        <FormModal
          title="重命名目录"
          confirmText="保存"
          confirmDisabled={!renameName.trim()}
          onConfirm={handleRenameFolder}
          onClose={() => { setRenamingFolderId(null); setRenameName('') }}
        >
          <ModalField label="目录名">
            <input className="field-input" value={renameName} onChange={(e) => setRenameName(e.target.value)} />
          </ModalField>
        </FormModal>
      )}

      {deletingFolderId && (
        <FormModal
          title="删除目录"
          confirmText="删除"
          onConfirm={handleDeleteFolder}
          onClose={() => setDeletingFolderId(null)}
        >
          <p className="kb-confirm-text">
            确定删除目录「{folders.find((f) => f.id === deletingFolderId)?.name}」吗？
          </p>
        </FormModal>
      )}

      {importing && (
        <FormModal
          title="导入文档"
          confirmText="导入"
          confirmDisabled={!importForm.ref.trim()}
          onConfirm={handleImport}
          onClose={() => { setImporting(false); setImportForm({ source: SOURCES[0], ref: '', folderId: '' }) }}
        >
          <ModalField label="来源">
            <select
              className="field-select"
              value={importForm.source}
              onChange={(e) => setImportForm({ ...importForm, source: e.target.value as KbDoc['source'] })}
            >
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </ModalField>
          <ModalField label="地址或文件名">
            <input
              className="field-input"
              value={importForm.ref}
              placeholder="如 wiki/loom/arch 或 设计文档.md"
              onChange={(e) => setImportForm({ ...importForm, ref: e.target.value })}
            />
          </ModalField>
          <ModalField label="所属目录">
            <select
              className="field-select"
              value={importForm.folderId || (selectedFolder !== ALL ? selectedFolder : folders[0]?.id ?? '')}
              onChange={(e) => setImportForm({ ...importForm, folderId: e.target.value })}
            >
              {folders.map((f) => <option key={f.id} value={f.id}>{folderPathLabel(f.id)}</option>)}
            </select>
          </ModalField>
        </FormModal>
      )}
    </div>
  )
}

/* ================= 段二：记忆 ================= */

function MemorySegment({ knowledge, onUpdateKnowledge }: KnowledgePanelProps) {
  const { memories, memorySettings } = knowledge
  const [editingRules, setEditingRules] = useState(false)
  const [rulesDraft, setRulesDraft] = useState('')
  const [editingPolicy, setEditingPolicy] = useState(false)
  const [policyDraft, setPolicyDraft] = useState<MemorySettings>(memorySettings)
  const [editingReflect, setEditingReflect] = useState(false)
  const [reflectDraft, setReflectDraft] = useState<MemorySettings>(memorySettings)
  const [adding, setAdding] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const expiringCount = memories.filter((m) => m.lifecycle === '即将过期').length

  const policyText = memorySettings.permanent
    ? `永久保留 · 过期${memorySettings.expirePolicy}`
    : `保留 ${memorySettings.retentionDays} 天 · 过期${memorySettings.expirePolicy}`

  const reflectText = memorySettings.autoReflect
    ? `已开启 · ${memorySettings.reflectFrequency}反思 · AI 根据项目内容判断归档与活跃`
    : '未开启 · 记忆仅按时间规则处理'

  const daysValid = Number.isInteger(Number(policyDraft.retentionDays))
    && Number(policyDraft.retentionDays) >= 1
    && Number(policyDraft.retentionDays) <= 3650
  const policySaveDisabled = !policyDraft.permanent && !daysValid

  const handleToggleCollect = (next: boolean) => {
    onUpdateKnowledge({ ...knowledge, memorySettings: { ...memorySettings, autoCollect: next } })
  }

  const handleSaveRules = () => {
    onUpdateKnowledge({ ...knowledge, memorySettings: { ...memorySettings, collectRules: rulesDraft.trim() } })
    setEditingRules(false)
  }

  const handleSavePolicy = () => {
    onUpdateKnowledge({ ...knowledge, memorySettings: { ...policyDraft } })
    setEditingPolicy(false)
  }

  const handleSaveReflect = () => {
    onUpdateKnowledge({
      ...knowledge,
      memorySettings: {
        ...memorySettings,
        autoReflect: reflectDraft.autoReflect,
        reflectFrequency: reflectDraft.reflectFrequency,
        reflectRules: reflectDraft.reflectRules.trim(),
      },
    })
    setEditingReflect(false)
  }

  const handleAddMemory = () => {
    if (!newContent.trim()) return
    const item: MemoryItem = {
      id: `mem${Date.now()}`,
      content: newContent.trim(),
      source: '手动',
      createdAt: nowStamp(),
      lifecycle: '活跃',
    }
    onUpdateKnowledge({ ...knowledge, memories: [item, ...memories] })
    setAdding(false)
    setNewContent('')
  }

  const handleCleanExpired = () => {
    onUpdateKnowledge({
      ...knowledge,
      memories: memories.map((m) => m.lifecycle === '即将过期'
        ? { ...m, lifecycle: '已归档' as const, remainDays: undefined }
        : m),
    })
  }

  const handleDeleteMemory = (id: string) => {
    onUpdateKnowledge({ ...knowledge, memories: memories.filter((m) => m.id !== id) })
    setExpandedId(null)
  }

  return (
    <div className="memory-segment">
      {/* 设置区 */}
      <div className="section-card">
        <Row>
          <span className="settings-row-main">
            <span className="settings-row-text">
              <span className="settings-row-title">自动从会话收集记忆</span>
              <span className="settings-row-sub">会话结束后自动提炼要点写入记忆</span>
            </span>
          </span>
          <span className="settings-row-right">
            <Toggle checked={memorySettings.autoCollect} onChange={handleToggleCollect} />
          </span>
        </Row>
        <Row
          className={`memory-rules-row${editingRules ? ' expandable' : ''}${!memorySettings.autoCollect ? ' disabled' : ''}`}
          title={!memorySettings.autoCollect ? '自动收集已关闭' : undefined}
          onClick={() => {
            if (!memorySettings.autoCollect || editingRules) return
            setRulesDraft(memorySettings.collectRules)
            setEditingRules(true)
          }}
        >
          <span className="settings-row-main">
            <span className="settings-row-text">
              <span className="settings-row-title">收集记忆规则</span>
              <span className="settings-row-sub">{memorySettings.collectRules || '未设定，将自动提炼通用要点'}</span>
            </span>
          </span>
          <span className="settings-row-right">
            <ChevronDownIcon size={13} className={`knowledge-chevron${editingRules ? ' open' : ''}`} />
          </span>
          {editingRules && (
            <div className="inline-edit" onClick={(e) => e.stopPropagation()}>
              <textarea
                className="field-input rules-textarea"
                value={rulesDraft}
                spellCheck={false}
                placeholder="如 只收集代码规范、架构决策相关的要点，忽略闲聊与临时调试内容"
                onChange={(e) => setRulesDraft(e.target.value)}
              />
              <div className="inline-edit-actions">
                <button type="button" className="text-btn" onClick={() => setEditingRules(false)}>取消</button>
                <button type="button" className="btn-primary" onClick={handleSaveRules}>保存</button>
              </div>
            </div>
          )}
        </Row>
        <Row
          className={`policy-row${editingPolicy ? ' expandable' : ''}`}
          onClick={() => {
            if (editingPolicy) return
            setPolicyDraft({ ...memorySettings })
            setEditingPolicy(true)
          }}
        >
          <span className="settings-row-main">
            <span className="settings-row-text">
              <span className="settings-row-title">记忆保留策略</span>
              <span className="settings-row-sub">{policyText}</span>
            </span>
          </span>
          <span className="settings-row-right">
            <ChevronDownIcon size={13} className={`knowledge-chevron${editingPolicy ? ' open' : ''}`} />
          </span>
          {editingPolicy && (
            <div className="inline-edit" onClick={(e) => e.stopPropagation()}>
              <div className="inline-edit-fields">
                <input
                  className="field-input policy-days-input"
                  type="number"
                  min={1}
                  max={3650}
                  value={policyDraft.retentionDays}
                  disabled={policyDraft.permanent}
                  onChange={(e) => setPolicyDraft({ ...policyDraft, retentionDays: Number(e.target.value) })}
                />
                <span className="policy-days-unit">天</span>
                <label className="policy-permanent">
                  <Toggle
                    checked={policyDraft.permanent}
                    onChange={(next) => setPolicyDraft({ ...policyDraft, permanent: next })}
                  />
                  永久保留
                </label>
                <select
                  className="field-select"
                  value={policyDraft.expirePolicy}
                  onChange={(e) => setPolicyDraft({ ...policyDraft, expirePolicy: e.target.value as MemorySettings['expirePolicy'] })}
                >
                  {POLICIES.map((p) => <option key={p} value={p}>过期{p}</option>)}
                </select>
              </div>
              <div className="inline-edit-actions">
                <button type="button" className="text-btn" onClick={() => setEditingPolicy(false)}>取消</button>
                <button type="button" className="btn-primary" disabled={policySaveDisabled} onClick={handleSavePolicy}>保存</button>
              </div>
            </div>
          )}
        </Row>
        <Row
          className={`reflect-row${editingReflect ? ' expandable' : ''}`}
          onClick={() => {
            if (editingReflect) return
            setReflectDraft({ ...memorySettings })
            setEditingReflect(true)
          }}
        >
          <span className="settings-row-main">
            <span className="settings-row-text">
              <span className="settings-row-title">自动反思规则</span>
              <span className="settings-row-sub">{reflectText}</span>
            </span>
          </span>
          <span className="settings-row-right">
            <ChevronDownIcon size={13} className={`knowledge-chevron${editingReflect ? ' open' : ''}`} />
          </span>
          {editingReflect && (
            <div className="inline-edit" onClick={(e) => e.stopPropagation()}>
              <div className="reflect-field">
                <Toggle
                  checked={reflectDraft.autoReflect}
                  onChange={(next) => setReflectDraft({ ...reflectDraft, autoReflect: next })}
                />
                <span className="reflect-field-label">启用自动反思</span>
              </div>
              <div className="reflect-field">
                <span className="reflect-field-label">反思频率</span>
                <div className="reflect-freq">
                  {REFLECT_FREQS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={reflectDraft.reflectFrequency === f ? 'active' : ''}
                      onClick={() => setReflectDraft({ ...reflectDraft, reflectFrequency: f })}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                className="field-input reflect-textarea"
                value={reflectDraft.reflectRules}
                spellCheck={false}
                placeholder="自定义反思规则（可选），如 与当前规范冲突或引用已废弃方案的记忆自动归档，关键链路经验保持活跃"
                onChange={(e) => setReflectDraft({ ...reflectDraft, reflectRules: e.target.value })}
              />
              <p className="reflect-hint">
                AI 将结合项目规范、知识库文档与近期会话，定期评估记忆时效性：过时的自动归档，仍有效的保持活跃。
              </p>
              <div className="inline-edit-actions">
                <button type="button" className="text-btn" onClick={() => setEditingReflect(false)}>取消</button>
                <button type="button" className="btn-primary" onClick={handleSaveReflect}>保存</button>
              </div>
            </div>
          )}
        </Row>
      </div>

      {/* 记忆条目 */}
      <Section
        label={`记忆条目（${memories.length} 条 · ${expiringCount} 条即将过期）`}
        action={(
          <>
            <button type="button" className="text-btn" onClick={() => setAdding(true)}>+ 手动添加</button>
            <button
              type="button"
              className="text-btn"
              disabled={expiringCount === 0}
              title={expiringCount === 0 ? '没有可清理的条目' : '将即将过期的条目归档'}
              onClick={handleCleanExpired}
            >
              清理过期
            </button>
          </>
        )}
      >
        {memories.length === 0 && <div className="knowledge-empty">暂无记忆条目</div>}
        {memories.map((m) => {
          const expanded = expandedId === m.id
          const archived = m.lifecycle === '已归档'
          return (
            <Row
              key={m.id}
              className={`memory-row${expanded ? ' expandable' : ''}${archived ? ' archived' : ''}`}
              onClick={() => setExpandedId(expanded ? null : m.id)}
            >
              <span className="settings-row-main">
                <span className="settings-row-text">
                  <span className="settings-row-title">{m.content}</span>
                  <span className="settings-row-sub">
                    {m.source} · 收集于 {m.createdAt}
                    {m.lifecycle === '即将过期' && m.remainDays !== undefined ? ` · 剩 ${m.remainDays} 天` : ''}
                  </span>
                </span>
              </span>
              <span className="settings-row-right">
                <StatusBadge tone={lifecycleTone[m.lifecycle]}>{m.lifecycle}</StatusBadge>
                <ChevronDownIcon size={13} className={`knowledge-chevron${expanded ? ' open' : ''}`} />
              </span>
              {expanded && (
                <div className="memory-expand" onClick={(e) => e.stopPropagation()}>
                  <p className="knowledge-summary">{m.content}</p>
                  {m.reflectNote && (
                    <p className="reflect-note"><strong>AI 反思：</strong>{m.reflectNote}</p>
                  )}
                  <div className="memory-expand-actions">
                    <button type="button" className="text-btn danger" onClick={() => handleDeleteMemory(m.id)}>删除记忆</button>
                  </div>
                </div>
              )}
            </Row>
          )
        })}
      </Section>

      {adding && (
        <FormModal
          title="添加记忆"
          confirmText="添加"
          confirmDisabled={!newContent.trim()}
          onConfirm={handleAddMemory}
          onClose={() => { setAdding(false); setNewContent('') }}
        >
          <ModalField label="记忆内容">
            <textarea
              className="field-input memory-textarea"
              value={newContent}
              spellCheck={false}
              placeholder="如 支付回调需幂等处理；用户偏好简洁回复；部署前需跑全量回归……"
              onChange={(e) => setNewContent(e.target.value)}
            />
          </ModalField>
        </FormModal>
      )}
    </div>
  )
}
