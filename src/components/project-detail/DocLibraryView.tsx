import { useState } from 'react'
import type { DocLibrary } from '../../data/projects'
import { Section, Row } from '../SettingsRow'
import FormModal, { ModalField } from '../FormModal'
import { DocIcon, ChevronRightIcon, ArrowLeftIcon, FolderIcon } from '../icons'
import './KnowledgePanel.css'

interface DocLibraryViewProps {
  /** 库数据（文档子 tab = project.documents；项目知识库子 tab = knowledge 的 folders/docs） */
  library: DocLibrary
  onUpdateLibrary: (lib: DocLibrary) => void
}

const SOURCES: DocLibrary['docs'][number]['source'][] = ['团队 wiki', 'GitLab 文档', '本地文件']

/** 「全部文档」伪目录 id */
const ALL = '__all__'

const nowStamp = () => {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 文档库视图（「文档和知识库」tab 内两个子 tab 的共享形态，复用项目知识库样式）：
 * 左栏目录树（多层级）+ 右栏文档列表 ⇄ 二级预览/编辑 + 导入。
 */
export default function DocLibraryView({ library, onUpdateLibrary }: DocLibraryViewProps) {
  const { docs, folders } = library
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
  const [importForm, setImportForm] = useState({ source: SOURCES[0] as DocLibrary['docs'][number]['source'], ref: '', folderId: '' })
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
    const folder: DocLibrary['folders'][number] = { id: `f${Date.now()}`, name: newFolderName.trim() }
    if (newFolderParent) folder.parentId = newFolderParent
    onUpdateLibrary({ ...library, folders: [...folders, folder] })
    setCreatingFolder(false)
    setNewFolderName('')
    setNewFolderParent('')
    setSelectedFolder(folder.id)
  }

  const handleRenameFolder = () => {
    if (!renamingFolderId || !renameName.trim()) return
    onUpdateLibrary({
      ...library,
      folders: folders.map((f) => f.id === renamingFolderId ? { ...f, name: renameName.trim() } : f),
    })
    setRenamingFolderId(null)
    setRenameName('')
    setMenuFolderId(null)
  }

  const handleDeleteFolder = () => {
    if (!deletingFolderId) return
    const removed = subtreeIds(deletingFolderId)
    onUpdateLibrary({ ...library, folders: folders.filter((f) => !removed.has(f.id)) })
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
    const doc: DocLibrary['docs'][number] = {
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
    onUpdateLibrary({ ...library, docs: [doc, ...docs] })
    setImporting(false)
    setImportForm({ source: SOURCES[0], ref: '', folderId: '' })
  }

  const handleSaveDoc = () => {
    if (!openDoc) return
    onUpdateLibrary({
      ...library,
      docs: docs.map((d) => d.id === openDoc.id
        ? { ...d, markdown: draft, updatedAt: nowStamp() }
        : d),
    })
    setEditing(false)
  }

  const handleDeleteDoc = () => {
    if (!openDoc) return
    onUpdateLibrary({ ...library, docs: docs.filter((d) => d.id !== openDoc.id) })
    setEditing(false)
    setOpenId(null)
  }

  /* ---------- 目录树（左栏，递归渲染） ---------- */
  const renderFolderNode = (folder: DocLibrary['folders'][number], depth: number) => {
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
              onChange={(e) => setImportForm({ ...importForm, source: e.target.value as DocLibrary['docs'][number]['source'] })}
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
