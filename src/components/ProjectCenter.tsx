import { useEffect, useState } from 'react'
import type { Project, ProjectFolder } from '../data/projects'
import { createEmptyProject } from '../data/projects'
import { orgApi } from '../lib/orgApi'
import ProjectCard from './ProjectCard'
import FolderCard from './FolderCard'
import FormModal, { ModalField } from './FormModal'
import MultiSelect from './MultiSelect'
import SegmentedControl from './SegmentedControl'
import { CodeIcon, DocIcon } from './icons'
import './ProjectCenter.css'

interface ProjectCenterProps {
  projects: Project[]
  folders: ProjectFolder[]
  onOpenProject: (projectId: string) => void
  /** 新建项目（App 层置顶插入） */
  onCreateProject: (project: Project) => void
  /** 新建文件夹：memberNames 为所选可见成员（创建者自动成为所有者） */
  onCreateFolder: (name: string, memberNames: string[]) => void
  /** 编辑文件夹：更新名称与可见成员范围 */
  onUpdateFolder: (folderId: string, patch: Pick<ProjectFolder, 'name' | 'members'>) => void
  /** 删除文件夹（软删除）：内部项目自动移至未分组 */
  onDeleteFolder: (folderId: string) => void
  /** 移动项目到文件夹（undefined = 未分组） */
  onMoveProject: (projectId: string, folderId: string | undefined) => void
  /** 删除项目（软删除，后端打删除标记） */
  onDeleteProject: (projectId: string) => void
  /** 当前登录用户名（文件夹「我」标识与所有者默认值） */
  currentUserName: string
}

const STATUSES: Project['status'][] = ['规划中', '进行中', '已完成']

interface DraftForm {
  name: string
  description: string
  type: 'dev' | 'nondev'
  folderId: string
  status: Project['status']
  startDate: string
  endDate: string
}

const emptyForm: DraftForm = {
  name: '', description: '', type: 'dev', folderId: '', status: '规划中', startDate: '', endDate: '',
}

/** 新建/编辑文件夹弹窗表单（共享结构） */
interface FolderForm {
  name: string
  /** 所选成员用户名（不含所有者） */
  members: string[]
  /** 编辑模式：当前所有者名单（至少保留一名） */
  owners: string[]
}

const emptyFolderForm: FolderForm = { name: '', members: [], owners: [] }

/** 项目中心列表页：文件夹卡片 + 项目卡片网格（Finder 式下钻） */
export default function ProjectCenter({
  projects,
  folders,
  onOpenProject,
  onCreateProject,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onMoveProject,
  onDeleteProject,
  currentUserName,
}: ProjectCenterProps) {
  /** 组织成员（文件夹可见范围候选，来自后端） */
  const [orgMemberNames, setOrgMemberNames] = useState<string[]>([])
  /** 组织成员是否已加载（未加载时不做过滤，避免误清空） */
  const [orgLoaded, setOrgLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    orgApi.members()
      .then(({ members }) => {
        if (!alive) return
        setOrgMemberNames(members.map((m) => m.name))
        setOrgLoaded(true)
      })
      .catch(() => { if (alive) setOrgLoaded(true) })
    return () => { alive = false }
  }, [])
  /** 页内层级：null = 顶层；string = 当前下钻的文件夹 id */
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<DraftForm>(emptyForm)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  /** 新建文件夹所选成员 */
  const [folderMembers, setFolderMembers] = useState<string[]>([])
  /** 正在编辑的文件夹（null = 关闭） */
  const [editingFolder, setEditingFolder] = useState<ProjectFolder | null>(null)
  /** 编辑文件夹表单 */
  const [editFolderForm, setEditFolderForm] = useState<FolderForm>(emptyFolderForm)
  const [deletingFolder, setDeletingFolder] = useState<ProjectFolder | null>(null)
  /** 待确认删除的项目（null = 关闭） */
  const [deletingProject, setDeletingProject] = useState<Project | null>(null)

  const openFolder = folders.find((f) => f.id === openFolderId) ?? null
  /** 当前视图内的项目：顶层 = 未分组；下钻 = 该文件夹内 */
  const visibleProjects = openFolder
    ? projects.filter((p) => p.folderId === openFolder.id)
    : projects.filter((p) => !p.folderId)

  const folderCount = (folderId: string) => projects.filter((p) => p.folderId === folderId).length

  const nameTaken = projects.some((p) => p.name === form.name.trim())
  const dateInvalid = !!form.startDate && !!form.endDate && form.endDate < form.startDate
  const confirmDisabled = !form.name.trim() || !form.description.trim()
    || !form.startDate || !form.endDate || nameTaken || dateInvalid

  const folderNameTaken = (name: string, excludeId?: string) =>
    folders.some((f) => f.id !== excludeId && f.name === name.trim())
  const folderConfirmDisabled = !folderName.trim() || folderNameTaken(folderName)
  /** 编辑弹窗：名称必填且不与其他文件夹重名；所有者至少保留 1 人 */
  const editOwners = editFolderForm.owners
  const editConfirmDisabled = !editFolderForm.name.trim()
    || folderNameTaken(editFolderForm.name, editingFolder?.id)
    || editOwners.length === 0

  /** 打开新建项目弹窗：文件夹内触发时默认归属当前文件夹 */
  const openCreateModal = () => {
    setForm({ ...emptyForm, folderId: openFolder?.id ?? '' })
    setCreating(true)
  }

  const handleCreate = () => {
    if (confirmDisabled) return
    onCreateProject(createEmptyProject({
      name: form.name.trim(),
      description: form.description.trim(),
      status: form.status,
      type: form.type,
      startDate: form.startDate,
      endDate: form.endDate,
      folderId: form.folderId || undefined,
    }))
    setCreating(false)
    setForm(emptyForm)
  }

  const handleCreateFolder = () => {
    if (folderConfirmDisabled) return
    onCreateFolder(folderName.trim(), folderMembers)
    setCreatingFolder(false)
    setFolderName('')
    setFolderMembers([])
  }

  /** 打开编辑文件夹弹窗：所有者/成员只保留设置页已导入的成员；没有则默认当前用户为所有者 */
  const openEditFolderModal = (folder: ProjectFolder) => {
    const isOrgMember = (name: string) => !orgLoaded || orgMemberNames.includes(name)
    const owners = folder.members.filter((m) => m.role === 'owner').map((m) => m.name).filter(isOrgMember)
    const members = folder.members.filter((m) => m.role === 'member').map((m) => m.name).filter(isOrgMember)
    const fallbackOwners = orgLoaded && !owners.includes(currentUserName) && orgMemberNames.includes(currentUserName)
      ? [currentUserName]
      : owners
    setEditFolderForm({
      name: folder.name,
      owners: fallbackOwners,
      members: members.filter((n) => !fallbackOwners.includes(n)),
    })
    setEditingFolder(folder)
  }

  /** 保存编辑：所有者区 + 成员区拼回 members 数组 */
  const handleUpdateFolder = () => {
    if (!editingFolder || editConfirmDisabled) return
    onUpdateFolder(editingFolder.id, {
      name: editFolderForm.name.trim(),
      members: [
        ...editOwners.map((name) => ({ name, role: 'owner' as const })),
        ...editFolderForm.members.map((name) => ({ name, role: 'member' as const })),
      ],
    })
    setEditingFolder(null)
  }

  const handleDeleteFolder = () => {
    if (!deletingFolder) return
    onDeleteFolder(deletingFolder.id)
    // 删除的是当前下钻的文件夹 → 退回顶层
    if (openFolderId === deletingFolder.id) setOpenFolderId(null)
    setDeletingFolder(null)
  }

  const subtitle = openFolder
    ? `${visibleProjects.length} 个项目`
    : folders.length > 0
      ? `共 ${projects.length} 个项目 · ${folders.length} 个文件夹`
      : `共 ${projects.length} 个项目`

  return (
    <div className="page">
      <div className="page-inner project-center">
        {openFolder ? (
          /* —— 文件夹内部视图（面包屑） —— */
          <div className="project-center-head">
            <div>
              <nav className="breadcrumb" aria-label="协作中心层级">
                <button type="button" className="breadcrumb-crumb" onClick={() => setOpenFolderId(null)}>
                  协作中心
                </button>
                <span className="breadcrumb-sep">›</span>
                <span className="breadcrumb-current">{openFolder.name}</span>
              </nav>
              <p className="page-subtitle">{subtitle}</p>
            </div>
            <button type="button" className="text-btn" onClick={openCreateModal}>+ 新建项目</button>
          </div>
        ) : (
          /* —— 顶层视图 —— */
          <div className="project-center-head">
            <div>
              <h1 className="page-title">协作中心</h1>
              <p className="page-subtitle">{subtitle}</p>
            </div>
            <div className="project-center-actions">
              <button type="button" className="text-btn ghost" onClick={() => setCreatingFolder(true)}>+ 新建文件夹</button>
              <button type="button" className="text-btn" onClick={openCreateModal}>+ 新建项目</button>
            </div>
          </div>
        )}

        <div className="project-grid">
          {!openFolder && folders.map((f) => (
            <FolderCard
              key={f.id}
              folder={f}
              count={folderCount(f.id)}
              onOpen={() => setOpenFolderId(f.id)}
              onEdit={() => openEditFolderModal(f)}
              onDelete={() => setDeletingFolder(f)}
            />
          ))}
          {visibleProjects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              folders={folders}
              onOpen={() => onOpenProject(p.id)}
              onMove={(folderId) => onMoveProject(p.id, folderId)}
              onDelete={() => setDeletingProject(p)}
            />
          ))}
        </div>

        {/* 空状态：文件夹内无项目 */}
        {openFolder && visibleProjects.length === 0 && (
          <div className="folder-empty">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            </svg>
            <p className="folder-empty-title">该文件夹还没有项目</p>
            <p className="folder-empty-desc">点击右上角「+ 新建项目」，所属文件夹将默认为当前文件夹</p>
          </div>
        )}
      </div>

      {/* 新建项目弹窗 */}
      {creating && (
        <FormModal
          title="新建项目"
          confirmText="创建"
          confirmDisabled={confirmDisabled}
          onConfirm={handleCreate}
          onClose={() => { setCreating(false); setForm(emptyForm) }}
        >
          <ModalField label="项目名">
            <input
              className="field-input"
              value={form.name}
              placeholder="如 loomweb"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </ModalField>
          {nameTaken && <p className="form-hint danger">项目名已存在，请换一个</p>}
          <ModalField label="简介">
            <input
              className="field-input"
              value={form.description}
              placeholder="如 Loom Web 端研发"
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </ModalField>
          <ModalField label="项目类型">
            <SegmentedControl
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v as 'dev' | 'nondev' })}
              items={[
                { key: 'dev', label: '研发项目', icon: <CodeIcon size={13} /> },
                { key: 'nondev', label: '非研发项目', icon: <DocIcon size={13} /> },
              ]}
            />
            <p className="form-hint">
              非研发项目不显示「代码」「终端」tab；项目类型创建后不可修改。
            </p>
          </ModalField>
          <ModalField label="所属文件夹">
            <select
              className="field-select"
              value={form.folderId}
              onChange={(e) => setForm({ ...form, folderId: e.target.value })}
            >
              <option value="">不放入文件夹</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}{openFolder?.id === f.id ? '（当前）' : ''}
                </option>
              ))}
            </select>
          </ModalField>
          <ModalField label="状态">
            <select
              className="field-select"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as Project['status'] })}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </ModalField>
          <ModalField label="开始日期">
            <input
              className="field-input"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </ModalField>
          <ModalField label="截止日期">
            <input
              className="field-input"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </ModalField>
          {dateInvalid && <p className="form-hint danger">截止日期不能早于开始日期</p>}
        </FormModal>
      )}

      {/* 新建文件夹弹窗 */}
      {creatingFolder && (
        <FormModal
          title="新建文件夹"
          confirmText="创建"
          confirmDisabled={folderConfirmDisabled}
          onConfirm={handleCreateFolder}
          onClose={() => { setCreatingFolder(false); setFolderName(''); setFolderMembers([]) }}
        >
          <ModalField label="文件夹名">
            <input
              className="field-input"
              value={folderName}
              placeholder="如 研发线"
              autoFocus
              onChange={(e) => setFolderName(e.target.value)}
            />
          </ModalField>
          {folderNameTaken(folderName) && <p className="form-hint danger">文件夹名已存在，请换一个</p>}
          <ModalField label="可见成员范围">
            <MultiSelect
              options={orgMemberNames.filter((n) => n !== currentUserName)}
              value={folderMembers}
              onChange={setFolderMembers}
              placeholder="选择谁可以看到这个文件夹"
            />
          </ModalField>
          <p className="form-hint">
            你将自动成为文件夹所有者；所选成员可以看到该文件夹并可在其中创建项目。
          </p>
        </FormModal>
      )}

      {/* 编辑文件夹弹窗（名称 + 可见成员范围） */}
      {editingFolder && (
        <FormModal
          title="编辑文件夹"
          confirmText="保存"
          confirmDisabled={editConfirmDisabled}
          onConfirm={handleUpdateFolder}
          onClose={() => setEditingFolder(null)}
        >
          <ModalField label="文件夹名">
            <input
              className="field-input"
              value={editFolderForm.name}
              placeholder="如 研发线"
              autoFocus
              onChange={(e) => setEditFolderForm({ ...editFolderForm, name: e.target.value })}
            />
          </ModalField>
          {folderNameTaken(editFolderForm.name, editingFolder.id) && (
            <p className="form-hint danger">文件夹名已存在，请换一个</p>
          )}
          <ModalField label="所有者">
            <MultiSelect
              options={orgMemberNames}
              value={editOwners}
              onChange={(owners) => setEditFolderForm({
                ...editFolderForm,
                owners,
                members: editFolderForm.members.filter((n) => !owners.includes(n)),
              })}
              placeholder="从设置页成员中选择所有者"
            />
          </ModalField>
          {editOwners.length === 0 && <p className="form-hint danger">文件夹至少需要一名所有者</p>}
          {orgLoaded && orgMemberNames.length === 0 && (
            <p className="form-hint">设置页还没有成员，请先到「设置 › 成员管理」导入成员。</p>
          )}
          <ModalField label="成员">
            <MultiSelect
              options={orgMemberNames.filter((n) => !editOwners.includes(n))}
              value={editFolderForm.members.filter((n) => !editOwners.includes(n))}
              onChange={(members) => setEditFolderForm({ ...editFolderForm, members })}
              placeholder="从设置页成员中选择成员"
            />
          </ModalField>
          <p className="form-hint">
            所有者可管理文件夹与查看全部项目；成员可看到文件夹、创建项目，但仅能看到自己参与的项目。
          </p>
        </FormModal>
      )}

      {/* 删除项目二次确认（软删除） */}
      {deletingProject && (
        <FormModal
          title="删除项目"
          confirmText="删除"
          confirmDanger
          onConfirm={() => {
            onDeleteProject(deletingProject.id)
            setDeletingProject(null)
          }}
          onClose={() => setDeletingProject(null)}
        >
          <p className="form-hint">确定删除项目「{deletingProject.name}」吗？</p>
          <div className="form-tips">
            <span className="form-tips-icon">i</span>
            <span className="form-tips-text">
              软删除：项目将从协作中心移除，成员 / 会话 / Agent 等数据保留在服务端。
            </span>
          </div>
        </FormModal>
      )}

      {/* 删除文件夹二次确认 */}
      {deletingFolder && (
        <FormModal
          title="删除文件夹"
          confirmText="删除"
          confirmDanger
          onConfirm={handleDeleteFolder}
          onClose={() => setDeletingFolder(null)}
        >
          <p className="form-hint">
            {folderCount(deletingFolder.id) > 0
              ? `「${deletingFolder.name}」内有 ${folderCount(deletingFolder.id)} 个项目，删除后项目将移至未分组。`
              : `确定删除空文件夹「${deletingFolder.name}」吗？`}
          </p>
          <div className="form-tips">
            <span className="form-tips-icon">i</span>
            <span className="form-tips-text">
              软删除：文件夹将从协作中心移除，数据保留在服务端。
            </span>
          </div>
        </FormModal>
      )}
    </div>
  )
}
