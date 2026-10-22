import { useEffect, useState } from 'react'
import type { AdeAgent, Member, Project, ProjectFolder, ProjectSession } from '../data/projects'
import { CURRENT_USER, memberColorOf, ADE_LLM_BASES, createDefaultAdeConfig } from '../data/projects'
import FormModal, { ModalField } from './FormModal'
import SpecsPanel from './project-detail/SpecsPanel'
import CodePanel from './project-detail/CodePanel'
import KnowledgePanel from './project-detail/KnowledgePanel'
import EfficiencyPanel from './project-detail/EfficiencyPanel'
import SecurityPanel from './project-detail/SecurityPanel'
import CodeReviewPanel from './project-detail/CodeReviewPanel'
import WorkflowPanel from './project-detail/WorkflowPanel'
import RunModal from './project-detail/RunModal'
import AdeSettingsModal from './project-detail/AdeSettingsModal'
import PlaceholderPanel from './PlaceholderPanel'
import ChatPane from './project-detail/ChatPane'
import SessionRail from './project-detail/SessionRail'
import TerminalPane from './project-detail/TerminalPane'
import ClosableTabs, { type TabItem } from './project-detail/ClosableTabs'
import { useResizableColumns } from '../hooks/useResizableColumns'
import type { AutomationEngine } from '../hooks/useAutomationEngine'
import {
  DocIcon, CodeIcon,
  BookIcon, ShieldIcon, FlaskIcon, ChartIcon, ChecklistIcon, WorkflowIcon,
} from './icons'
import StatusBadge from './StatusBadge'
import './ProjectDetail.css'

type NavKey = 'specs' | 'code' | 'knowledge' | 'workflow' | 'efficiency' | 'codereview' | 'security' | 'testing'

/** 格 4 tab 元数据（8 项；项目成员/ADE 管理在编辑项目弹窗，自动化任务面板移除） */
const TAB_ITEMS: TabItem[] = [
  { key: 'specs', label: '项目规范', icon: (s) => <DocIcon size={s} /> },
  { key: 'code', label: '代码', icon: (s) => <CodeIcon size={s} /> },
  { key: 'knowledge', label: '知识记忆', icon: (s) => <BookIcon size={s} /> },
  { key: 'workflow', label: '工作流', icon: (s) => <WorkflowIcon size={s} /> },
  { key: 'efficiency', label: '自动化统计', icon: (s) => <ChartIcon size={s} /> },
  { key: 'codereview', label: '代码审查', icon: (s) => <ChecklistIcon size={s} /> },
  { key: 'security', label: '安全审查', icon: (s) => <ShieldIcon size={s} /> },
  { key: 'testing', label: '测试', icon: (s) => <FlaskIcon size={s} />, soon: '敬请期待' },
]

const ALL_TAB_KEYS = TAB_ITEMS.map((t) => t.key as NavKey)

const STATUSES: Project['status'][] = ['规划中', '进行中', '已完成']

/** 编辑弹窗表单（字段与新建项目弹窗对齐） */
interface EditForm {
  name: string
  description: string
  folderId: string
  status: Project['status']
  startDate: string
  endDate: string
}

interface ProjectDetailProps {
  project: Project
  /** 全量项目列表（编辑弹窗重名校验用） */
  projects: Project[]
  /** 文件夹列表（编辑弹窗所属文件夹下拉用） */
  folders: ProjectFolder[]
  /** 各面板的写操作统一通过该回调更新项目数据（本地 state） */
  onUpdateProject: (projectId: string, updater: (p: Project) => Project) => void
  /** 自动化运行引擎（工作流面板 / 会话区使用） */
  engine: AutomationEngine
  /** 外部指定初始导航项（通知跳转直达 workflow） */
  initialNav?: NavKey
  /** 通知跳转定位的任务 id（切到对应会话） */
  focusJobId?: string | null
}

/** 四格列宽比例（flex-grow 权重）：10% / 20% / 35% / 35%——格 3 Agent CLI 与格 4 工作流占大头
 *  minWidth 取「常见视口（≥1280）下不触底」的值，保证比例精确；窄窗口才由 min 兜底防塌 */
const COLUMN_SPECS = [
  { ratio: 10, minWidth: 96 },  // 格 1 会话列表（1280 下 10% ≈ 98px，不触底）
  { ratio: 20, minWidth: 180 }, // 格 2 会话详情（1280 下 20% ≈ 195px，不触底）
  { ratio: 35, minWidth: 160 }, // 格 3 Agent CLI
  { ratio: 35, minWidth: 240 }, // 格 4 工作流
]

/**
 * 项目详情页：四格布局（格 1 会话列表 / 格 2 会话详情 / 格 3 Agent CLI / 格 4 工作流 tab）。
 * activeSessionId 状态在此（三格共享）；编辑项目弹窗（含成员 + ADE 管理）留在此处。
 */
export default function ProjectDetail({
  project, projects, folders, onUpdateProject, engine, initialNav, focusJobId,
}: ProjectDetailProps) {
  // —— 当前会话（格 1/2/3 共享；默认 order 最大，无会话 null） ——
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    [...project.sessions].sort((a, b) => b.order - a.order)[0]?.id ?? null
  )
  const activeSession = project.sessions.find((s) => s.id === activeSessionId) ?? null
  // —— 当前选中 ADE（格 2 插话归属 / 格 3 agent tab 共享；默认主 agent） ——
  const [activeAgentId, setActiveAgentId] = useState<string | null>(project.agents[0]?.id ?? null)
  // 选中 agent 被移除或切项目后不存在时，兜底回主 agent
  useEffect(() => {
    if (activeAgentId && !project.agents.some((a) => a.id === activeAgentId)) {
      setActiveAgentId(project.agents[0]?.id ?? null)
    }
  }, [project.agents, activeAgentId])
  // auto 会话关联的任务（消息/日志实时取 run）
  const job = activeSession?.source === 'auto' && activeSession.jobId
    ? project.autoJobs.find((j) => j.id === activeSession.jobId) ?? null
    : null

  const { cellStyle, startResize, reset } = useResizableColumns(COLUMN_SPECS)

  const [openTabs, setOpenTabs] = useState<NavKey[]>(ALL_TAB_KEYS)
  const [activeTab, setActiveTab] = useState<NavKey>(
    initialNav && ALL_TAB_KEYS.includes(initialNav) ? initialNav : 'specs',
  )
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditForm>({
    name: '', description: '', folderId: '', status: '规划中', startDate: '', endDate: '',
  })
  /** 成员添加/编辑弹窗（编辑项目弹窗内）：editId = null 表新增、有值表编辑 */
  const [memberModal, setMemberModal] = useState<'add' | { editId: string } | null>(null)
  const [memberForm, setMemberForm] = useState({ name: '', role: '', permission: '无' })
  /** ADE 申请弹窗（编辑项目弹窗内） */
  const [adeApplying, setAdeApplying] = useState(false)
  const [adeForm, setAdeForm] = useState({ name: '', role: '' })
  /** ADE 配置弹窗（点 ADE 行打开，复用 AdeSettingsModal） */
  const [adeEditingId, setAdeEditingId] = useState<string | null>(null)
  /** 工作流 tab 打开的运行弹窗任务 id */
  const [wfModalJobId, setWfModalJobId] = useState<string | null>(null)
  /** 工作流「在会话格打开本步骤会话」请求（stamp 保证重复点击也触发） */
  const [sessionFocus, setSessionFocus] = useState<{ jobId: string; stamp: number } | null>(null)
  const activeItem = TAB_ITEMS.find((t) => t.key === activeTab)!
  /** 已关闭的 tab（+ 菜单数据源；顺序 = 全量顺序） */
  const closedTabs = ALL_TAB_KEYS.filter((k) => !openTabs.includes(k))
  /** 工作流 tab 弹窗对应任务 */
  const wfModalJob = project.autoJobs.find((j) => j.id === wfModalJobId) ?? null

  /* —— 会话选择（格 1 点击 / 通知跳转 / 工作流跳转共用） —— */

  /** 选中会话（清未读） */
  const selectSession = (sessionId: string) => {
    setActiveSessionId(sessionId)
    const s = project.sessions.find((it) => it.id === sessionId)
    if (s && s.unread > 0) {
      onUpdateProject(project.id, (p) => ({
        ...p,
        sessions: p.sessions.map((it) => (it.id === sessionId ? { ...it, unread: 0 } : it)),
      }))
    }
  }

  /** 新建手动会话（置顶 + 切为当前） */
  const handleNewSession = () => {
    const session: ProjectSession = {
      id: `sess${Date.now()}`,
      name: `新对话 ${project.sessions.filter((s) => s.source === 'manual').length + 1}`,
      source: 'manual',
      originText: '手动会话 · 刚刚',
      messages: [],
      logs: [],
      unread: 0,
      order: (Math.max(0, ...project.sessions.map((s) => s.order))) + 100,
    }
    onUpdateProject(project.id, (p) => ({ ...p, sessions: [session, ...p.sessions] }))
    setActiveSessionId(session.id)
  }

  // 通知跳转：切到目标任务对应会话
  useEffect(() => {
    if (!focusJobId) return
    const target = project.sessions.find((s) => s.jobId === focusJobId)
    if (target) selectSession(target.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusJobId])

  // 工作流「在会话格打开本步骤会话」：切到目标任务对应会话（stamp 变更重复触发）
  useEffect(() => {
    if (!sessionFocus) return
    const target = project.sessions.find((s) => s.jobId === sessionFocus.jobId)
    if (target) selectSession(target.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionFocus?.stamp])

  // 外部指定初始导航（如通知跳转）时同步：目标 tab 若已关闭先重开
  // 注：focusJobId 变化（同项目内再次点击通知）时也强制回到 workflow，即使用户已切到其他 tab
  useEffect(() => {
    if (!initialNav) return
    setOpenTabs((open) => (open.includes(initialNav) ? open : [...open, initialNav]))
    setActiveTab(initialNav)
  }, [initialNav, focusJobId])

  /* —— tab 开关 —— */

  /** 关闭 tab：若是当前激活项则激活相邻（优先右侧，无则左侧） */
  const handleCloseTab = (key: NavKey) => {
    if (openTabs.length <= 1) return
    const idx = openTabs.indexOf(key)
    const nextTabs = openTabs.filter((k) => k !== key)
    setOpenTabs(nextTabs)
    if (activeTab === key) {
      const next = nextTabs[Math.min(idx, nextTabs.length - 1)] ?? nextTabs[0]
      setActiveTab(next)
    }
  }

  /** 重新打开：追加到末尾并激活 */
  const handleReopenTab = (key: NavKey) => {
    setOpenTabs((open) => (open.includes(key) ? open : [...open, key]))
    setActiveTab(key)
  }

  /* —— 编辑项目弹窗 —— */

  /** 打开编辑弹窗：预填当前项目字段 */
  const openEditModal = () => {
    setEditForm({
      name: project.name,
      description: project.description,
      folderId: project.folderId ?? '',
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
    })
    setEditing(true)
  }

  /** 项目名与其他项目重名（排除自身） */
  const nameTaken = projects.some((p) => p.id !== project.id && p.name === editForm.name.trim())
  const dateInvalid = !!editForm.startDate && !!editForm.endDate && editForm.endDate < editForm.startDate
  const editDisabled = !editForm.name.trim() || !editForm.description.trim()
    || !editForm.startDate || !editForm.endDate || nameTaken || dateInvalid

  const handleSaveEdit = () => {
    if (editDisabled) return
    onUpdateProject(project.id, (p) => ({
      ...p,
      name: editForm.name.trim(),
      description: editForm.description.trim(),
      status: editForm.status,
      startDate: editForm.startDate,
      endDate: editForm.endDate,
      folderId: editForm.folderId || undefined,
    }))
    setEditing(false)
  }

  /* —— 成员管理（编辑项目弹窗内：添加 / 弹窗编辑 / 移除） —— */

  const PERMISSIONS = ['无', '管理员', '项目负责人']

  const resetMemberForm = () => setMemberForm({ name: '', role: '', permission: '无' })

  /** 打开添加成员弹窗 */
  const openAddMember = () => {
    resetMemberForm()
    setMemberModal('add')
  }

  /** 打开编辑成员弹窗（预填） */
  const openEditMember = (m: Member) => {
    setMemberForm({ name: m.name, role: m.role, permission: m.permission ?? '无' })
    setMemberModal({ editId: m.id })
  }

  /** 添加/编辑保存（编辑时姓名不可改） */
  const handleSaveMember = () => {
    if (!memberForm.name.trim() || !memberForm.role.trim()) return
    if (memberModal === 'add') {
      const m: Member = {
        id: `m${Date.now()}`,
        name: memberForm.name.trim(),
        initial: memberForm.name.trim().charAt(0).toUpperCase(),
        role: memberForm.role.trim(),
        permission: memberForm.permission === '无' ? undefined : memberForm.permission,
        online: false,
        lastActive: '刚刚',
      }
      onUpdateProject(project.id, (p) => ({ ...p, members: [...p.members, m] }))
    } else if (memberModal) {
      const id = memberModal.editId
      onUpdateProject(project.id, (p) => ({
        ...p,
        members: p.members.map((it) => (it.id === id
          ? { ...it, role: memberForm.role.trim(), permission: memberForm.permission === '无' ? undefined : memberForm.permission }
          : it)),
      }))
    }
    setMemberModal(null)
    resetMemberForm()
  }

  /** 移除成员（唯一项目负责人保护：项目负责人只剩一人时不可移除） */
  const handleRemoveMember = (m: Member) => {
    if (m.permission === '项目负责人') {
      const owners = project.members.filter((it) => it.permission === '项目负责人')
      if (owners.length <= 1) return
    }
    onUpdateProject(project.id, (p) => ({ ...p, members: p.members.filter((it) => it.id !== m.id) }))
    setMemberModal(null)
  }

  /* —— ADE 管理（编辑项目弹窗内：申请 / 配置弹窗 / 移除；迁自原「项目ADE」tab） —— */

  const editingAgent = project.agents.find((a) => a.id === adeEditingId) ?? null

  /** 申请专属 ADE（迁自 AgentsSegment.handleApply） */
  const handleApplyAde = () => {
    if (!adeForm.name.trim()) return
    const a: AdeAgent = {
      id: `a${Date.now()}`,
      name: adeForm.name.trim(),
      role: adeForm.role.trim() || '研发工程师',
      model: ADE_LLM_BASES[0],
      status: '空闲',
      currentTask: '',
      ...createDefaultAdeConfig(),
    }
    onUpdateProject(project.id, (p) => ({ ...p, agents: [...p.agents, a] }))
    setAdeApplying(false)
    setAdeForm({ name: '', role: '' })
  }

  /** 保存 ADE 配置（AdeSettingsModal 确定） */
  const handleSaveAde = (next: AdeAgent) => {
    onUpdateProject(project.id, (p) => ({ ...p, agents: p.agents.map((a) => (a.id === next.id ? next : a)) }))
    setAdeEditingId(null)
  }

  /** 移除 ADE */
  const handleRemoveAde = (id: string) => {
    onUpdateProject(project.id, (p) => ({ ...p, agents: p.agents.filter((a) => a.id !== id) }))
    setAdeEditingId(null)
  }

  const renderPanel = () => {
    switch (activeTab) {
      case 'specs':
        return (
          <SpecsPanel
            specs={project.specs}
            onUpdateSpecs={(specs) => onUpdateProject(project.id, (p) => ({ ...p, specs }))}
          />
        )
      case 'code':
        return (
          <CodePanel
            repos={project.repos}
            onUpdateRepos={(repos) => onUpdateProject(project.id, (p) => ({ ...p, repos }))}
          />
        )
      case 'knowledge':
        return (
          <KnowledgePanel
            knowledge={project.knowledge}
            onUpdateKnowledge={(knowledge) => onUpdateProject(project.id, (p) => ({ ...p, knowledge }))}
          />
        )
      case 'workflow':
        return (
          <WorkflowPanel
            jobs={project.autoJobs}
            onRun={(jobId) => engine.trigger(project.id, jobId)}
            onPause={(jobId) => engine.pause(project.id, jobId)}
            onStop={(jobId) => engine.cancel(project.id, jobId)}
            onResume={(jobId) => engine.resume(project.id, jobId)}
            onRestart={(jobId) => engine.restart(project.id, jobId)}
            onApprove={(jobId) => engine.approve(project.id, jobId)}
            onReject={(jobId) => engine.reject(project.id, jobId)}
            onOpenRunModal={(jobId) => setWfModalJobId(jobId)}
            onOpenSession={(jobId) => setSessionFocus({ jobId, stamp: Date.now() })}
          />
        )
      case 'efficiency':
        return <EfficiencyPanel projectId={project.id} />
      case 'codereview':
        return (
          <CodeReviewPanel
            data={project.codereview}
            onUpdateData={(codereview) => onUpdateProject(project.id, (p) => ({ ...p, codereview }))}
          />
        )
      case 'security': {
        // 审查范围 = 首个可编辑仓库（名 · 分支），无仓库时用项目名兜底
        const mainRepo = project.repos.find((r) => r.mode === 'editable')
        return (
          <SecurityPanel
            security={project.security}
            scope={mainRepo ? `${mainRepo.name} · ${mainRepo.branch}` : project.name}
            onUpdateSecurity={(security) => onUpdateProject(project.id, (p) => ({ ...p, security }))}
          />
        )
      }
      default:
        return <PlaceholderPanel icon={activeItem.icon(48)} name={activeItem.label} />
    }
  }

  /** 拖拽条（index = 左侧格下标） */
  const renderResizer = (index: number) => (
    <div
      key={`resizer-${index}`}
      className="cell-resizer"
      role="separator"
      aria-orientation="vertical"
      title="拖动调节列宽（双击重置）"
      onMouseDown={(e) => startResize(index, e)}
      onDoubleClick={reset}
    />
  )

  return (
    <div className="page detail-page">
      {/* 四格：格 1 会话列表 / 格 2 会话详情 / 格 3 Agent CLI / 格 4 工作流（拖拽条 = 间隙）
          宽度统一走 flex 比例（10/20/35/35），拖拽后该格固定 px、其余格按比例重分配 */}
      <div className="detail-grid">
        <div className="detail-cell" style={cellStyle(0)}>
          <SessionRail
            project={project}
            sessions={project.sessions}
            activeSessionId={activeSessionId}
            onSelect={selectSession}
            onNewSession={handleNewSession}
            onOpenEdit={openEditModal}
          />
        </div>
        {renderResizer(0)}
        <div className="detail-cell" style={cellStyle(1)}>
          <ChatPane
            project={project}
            activeSession={activeSession}
            job={job}
            activeAgentId={activeAgentId}
            onUpdateProject={onUpdateProject}
            engine={engine}
          />
        </div>
        {renderResizer(1)}
        <div className="detail-cell" style={cellStyle(2)}>
          <TerminalPane
            project={project}
            activeSession={activeSession}
            activeAgentId={activeAgentId}
            onSelectAgent={(id) => setActiveAgentId(id)}
          />
        </div>
        {renderResizer(2)}
        {/* 格 4：项目配置（同行走比例分配，不再单独 flex 吸收） */}
        <div className="detail-cell detail-config" style={cellStyle(3)}>
          <ClosableTabs
            items={TAB_ITEMS}
            openKeys={openTabs}
            activeKey={activeTab}
            closedKeys={closedTabs}
            onSelect={(key) => setActiveTab(key as NavKey)}
            onClose={(key) => handleCloseTab(key as NavKey)}
            onReopen={(key) => handleReopenTab(key as NavKey)}
          />
          {/* 工作流为画布型面板：去 padding 贴边渲染 */}
          <div className={`detail-panel${activeTab === 'workflow' ? ' bare' : ''}`}>
            {renderPanel()}
          </div>
        </div>
      </div>

      {/* 工作流 tab 打开的运行详情弹窗（RunModal） */}
      {wfModalJobId && wfModalJob && (
        <RunModal
          job={wfModalJob}
          onClose={() => setWfModalJobId(null)}
          onApprove={(jobId) => engine.approve(project.id, jobId)}
          onReject={(jobId) => engine.reject(project.id, jobId)}
          onSubmit={(jobId, values) => engine.submit(project.id, jobId, values)}
          onCancelRun={(jobId) => engine.cancel(project.id, jobId)}
          onTrigger={(jobId) => engine.trigger(project.id, jobId)}
          onSendMessage={(jobId, text) => engine.sendMessage(project.id, jobId, text)}
        />
      )}

      {/* 编辑项目弹窗（字段与新建项目弹窗对齐，预填当前值；含项目成员 + 项目 ADE 区块） */}
      {editing && (
        <FormModal
          title="编辑项目"
          confirmText="保存"
          confirmDisabled={editDisabled}
          onConfirm={handleSaveEdit}
          onClose={() => setEditing(false)}
          wide
        >
          <ModalField label="项目名">
            <input
              className="field-input"
              value={editForm.name}
              placeholder="如 loomweb"
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
          </ModalField>
          {nameTaken && <p className="form-hint danger">项目名已存在，请换一个</p>}
          <ModalField label="简介">
            <input
              className="field-input"
              value={editForm.description}
              placeholder="如 Loom Web 端研发"
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            />
          </ModalField>
          <ModalField label="所属文件夹">
            <select
              className="field-select"
              value={editForm.folderId}
              onChange={(e) => setEditForm({ ...editForm, folderId: e.target.value })}
            >
              <option value="">不放入文件夹</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </ModalField>
          <ModalField label="状态">
            <select
              className="field-select"
              value={editForm.status}
              onChange={(e) => setEditForm({ ...editForm, status: e.target.value as Project['status'] })}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </ModalField>
          <ModalField label="开始日期">
            <input
              className="field-input"
              type="date"
              value={editForm.startDate}
              onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })}
            />
          </ModalField>
          <ModalField label="截止日期">
            <input
              className="field-input"
              type="date"
              value={editForm.endDate}
              onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })}
            />
          </ModalField>
          {dateInvalid && <p className="form-hint danger">截止日期不能早于开始日期</p>}

          {/* 项目成员：添加 + 弹窗编辑/移除（会话成员抽屉为只读） */}
          <div className="modal-field">
            <div className="modal-field-label-row">
              <div className="modal-field-label">项目成员</div>
              <button type="button" className="member-add-btn" onClick={openAddMember}>＋ 添加成员</button>
            </div>
            <div className="edit-member-list">
              {project.members.map((m) => {
                const isMe = m.name === CURRENT_USER.name
                return (
                  <div key={m.id} className="edit-member-row">
                    <span className="edit-member-avatar" style={{ background: memberColorOf(m.name) }}>
                      {m.initial}
                    </span>
                    <span className="edit-member-text">
                      <span className="edit-member-name">
                        {m.name}
                        {isMe && <span className="edit-member-me">我</span>}
                      </span>
                      <span className="edit-member-sub">
                        {m.permission ? `${m.role} · ${m.permission}` : m.role}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="text-btn edit-member-btn"
                      onClick={() => openEditMember(m)}
                    >
                      编辑
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 项目 ADE：申请 + 配置弹窗（迁自原「项目ADE」tab） */}
          <div className="modal-field">
            <div className="modal-field-label-row">
              <div className="modal-field-label">项目 ADE</div>
              <button
                type="button"
                className="member-add-btn"
                onClick={() => { setAdeApplying(true); setAdeForm({ name: '', role: '' }) }}
              >
                ＋ 申请专属ADE
              </button>
            </div>
            <div className="edit-member-list">
              {project.agents.length === 0 && (
                <div className="edit-ade-empty">暂无 ADE 接入本项目</div>
              )}
              {project.agents.map((a) => {
                const busy = a.status === '工作中'
                return (
                  <button
                    key={a.id}
                    type="button"
                    className="edit-ade-row"
                    onClick={() => { if (!busy) setAdeEditingId(a.id) }}
                    title={busy ? '工作中的 ADE 不可修改' : '点击配置 ADE'}
                  >
                    <span className="edit-member-avatar edit-ade-avatar">A</span>
                    <span className="edit-member-text">
                      <span className="edit-member-name">{a.name}</span>
                      <span className="edit-member-sub">
                        {a.role} · {a.model} · {busy ? `当前：${a.currentTask}` : '空闲'}
                      </span>
                    </span>
                    <span className="settings-row-right">
                      <StatusBadge tone={busy ? 'info' : 'neutral'}>{a.status}</StatusBadge>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </FormModal>
      )}

      {/* ADE 申请弹窗（编辑项目弹窗之上） */}
      {adeApplying && (
        <FormModal
          title="申请专属ADE"
          confirmText="申请"
          confirmDisabled={!adeForm.name.trim()}
          onConfirm={handleApplyAde}
          onClose={() => { setAdeApplying(false); setAdeForm({ name: '', role: '' }) }}
        >
          <ModalField label="ADE 名称">
            <input
              className="field-input"
              value={adeForm.name}
              placeholder="如 研发工程师ADE"
              onChange={(e) => setAdeForm({ ...adeForm, name: e.target.value })}
            />
          </ModalField>
          <ModalField label="角色">
            <input
              className="field-input"
              value={adeForm.role}
              placeholder="研发工程师/测试工程师…"
              onChange={(e) => setAdeForm({ ...adeForm, role: e.target.value })}
            />
          </ModalField>
        </FormModal>
      )}

      {/* ADE 配置弹窗（点 ADE 行打开，与原「项目ADE」tab 同源） */}
      {editingAgent && (
        <AdeSettingsModal
          agent={editingAgent}
          onSave={handleSaveAde}
          onRemove={handleRemoveAde}
          onClose={() => setAdeEditingId(null)}
        />
      )}

      {/* 成员添加/编辑弹窗（编辑项目弹窗之上） */}
      {memberModal && (
        <FormModal
          title={memberModal === 'add' ? '添加成员' : '编辑成员'}
          confirmText={memberModal === 'add' ? '添加' : '保存'}
          confirmDisabled={!memberForm.name.trim() || !memberForm.role.trim()}
          onConfirm={handleSaveMember}
          onClose={() => { setMemberModal(null); resetMemberForm() }}
        >
          <ModalField label="姓名">
            <input
              className="field-input"
              value={memberForm.name}
              placeholder={memberModal === 'add' ? '如 zhang' : '姓名不可修改'}
              disabled={memberModal !== 'add'}
              onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })}
            />
          </ModalField>
          <ModalField label="职位">
            <input
              className="field-input"
              value={memberForm.role}
              placeholder="如 前端"
              onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value })}
            />
          </ModalField>
          <ModalField label="权限">
            <select
              className="field-select"
              value={memberForm.permission}
              onChange={(e) => setMemberForm({ ...memberForm, permission: e.target.value })}
            >
              {PERMISSIONS.map((p) => <option key={p} value={p}>{p === '无' ? '权限：无' : p}</option>)}
            </select>
          </ModalField>
          <p className="member-perm-hint">
            成员权限说明：<b>项目负责人</b> = 项目的最终负责人，Gate 等人工介入点默认指派给其处理，每项目至少保留一名；
            <b>管理员</b> = 可管理项目的配置与成员（新建任务、编辑规范等）；<b>无</b> = 普通成员，可参与会话与查看项目。
          </p>
          {memberModal !== 'add' && (
            <button
              type="button"
              className="text-btn danger edit-member-remove"
              onClick={() => handleRemoveMember(project.members.find((m) => m.id === (memberModal as { editId: string }).editId)!)}
            >
              移除成员
            </button>
          )}
        </FormModal>
      )}
    </div>
  )
}
