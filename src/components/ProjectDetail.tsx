import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AdeAgent, Member, Project, ProjectFolder, RunMessage, TerminalLog,
} from '../data/projects'
import { memberColorOf } from '../data/projects'
import { orgApi, type OrgMember } from '../lib/orgApi'
import { runtimeApi, type RuntimeSession } from '../lib/runtimeApi'
import { memoryApi } from '../lib/memoryApi'
import FormModal, { ModalField } from './FormModal'
import SpecsPanel from './project-detail/SpecsPanel'
import CodePanel from './project-detail/CodePanel'
import KnowledgePanel from './project-detail/KnowledgePanel'
import MemoryPanel from './project-detail/MemoryPanel'
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
import PtyTerminalPanel from './project-detail/PtyTerminalPanel'
import ClosableTabs, { type TabItem } from './project-detail/ClosableTabs'
import { useResizableColumns } from '../hooks/useResizableColumns'
import { useRealSession } from '../hooks/useRealSession'
import type { AutomationEngine } from '../hooks/useAutomationEngine'
import {
  DocIcon, CodeIcon,
  BookIcon, ShieldIcon, FlaskIcon, ChartIcon, ChecklistIcon, WorkflowIcon, BrainIcon, TerminalIcon,
} from './icons'
import StatusBadge from './StatusBadge'
import './ProjectDetail.css'

type NavKey = 'specs' | 'code' | 'terminal' | 'knowledge' | 'memory' | 'workflow' | 'efficiency' | 'codereview' | 'security' | 'testing'

/** 格 4 tab 元数据（项目成员/ADE 管理在编辑项目弹窗；终端默认收起，经 ＋ 菜单重开） */
const TAB_ITEMS: TabItem[] = [
  { key: 'specs', label: '项目规范', icon: (s) => <DocIcon size={s} /> },
  { key: 'code', label: '代码', icon: (s) => <CodeIcon size={s} /> },
  { key: 'terminal', label: '终端', icon: (s) => <TerminalIcon size={s} /> },
  { key: 'knowledge', label: '文档和知识库', icon: (s) => <BookIcon size={s} /> },
  { key: 'memory', label: '记忆', icon: (s) => <BrainIcon size={s} /> },
  { key: 'workflow', label: '工作流', icon: (s) => <WorkflowIcon size={s} /> },
  { key: 'efficiency', label: '自动化统计', icon: (s) => <ChartIcon size={s} /> },
  { key: 'codereview', label: '代码审查', icon: (s) => <ChecklistIcon size={s} /> },
  { key: 'security', label: '安全审查', icon: (s) => <ShieldIcon size={s} /> },
  { key: 'testing', label: '测试', icon: (s) => <FlaskIcon size={s} />, soon: '敬请期待' },
]

/** 默认打开的 tab（自动化统计 / 代码审查 / 安全审查 / 测试默认收起，经 ＋ 菜单重开） */
const DEFAULT_OPEN_TABS: NavKey[] = ['specs', 'code', 'knowledge', 'memory', 'workflow']

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
  /** 当前登录用户名（成员「我」标识） */
  currentUserName: string
  /** 设置页已配置的 Agent（项目 agent 只能从这里添加） */
  settingsAgents: AdeAgent[]
  /** 保存 Agent 配置（写回设置页 Agent） */
  onUpdateAgent: (next: AdeAgent) => void
  /** 绑定 / 解绑项目 agent（projectId = null 表示从项目移除） */
  onBindAgent: (agentId: string, projectId: string | null) => void
  /** 删除项目（软删除，成功后由 App 退回项目中心） */
  onDeleteProject: (projectId: string) => void
  /** 重新载入 Agent（后端派生的工作中/空闲状态） */
  onRefreshAgents: () => void
}

/** 四格列宽比例（flex-grow 权重）：10% / 20% / 35% / 35%——格 3 Agent CLI 与格 4 工作流占大头
 *  minWidth 取「常见视口（≥1280）下不触底」的值，保证比例精确；窄窗口才由 min 兜底防塌 */
const COLUMN_SPECS = [
  { ratio: 14, minWidth: 128 }, // 格 1 会话列表（创建者/未读/状态）
  { ratio: 18, minWidth: 180 }, // 格 2 会话详情
  { ratio: 33, minWidth: 160 }, // 格 3 Agent CLI
  { ratio: 35, minWidth: 240 }, // 格 4 工作流
]

/** ISO 时间 → HH:mm:ss */
const clockText = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 项目详情页：四格布局（格 1 会话列表 / 格 2 会话详情 / 格 3 Agent CLI / 格 4 工作流 tab）。
 * activeSessionId 状态在此（三格共享）；编辑项目弹窗（含成员 + ADE 管理）留在此处。
 */
export default function ProjectDetail({
  project, projects, folders, onUpdateProject, engine, initialNav,
  currentUserName, settingsAgents, onUpdateAgent, onBindAgent,
  onDeleteProject, onRefreshAgents,
}: ProjectDetailProps) {
  // —— 会话：后端持久化（格 1/2/3 共享） ——
  const [sessions, setSessions] = useState<RuntimeSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [creatingSession, setCreatingSession] = useState(false)
  /** 项目是否开启记忆注入（决定会话输入框「记忆」开关是否可用） */
  const [memoryInjectEnabled, setMemoryInjectEnabled] = useState(true)
  /** 会话相关操作错误（加载 / 创建 / 改名 / 发送） */
  const [sessionError, setSessionError] = useState('')
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  /** 加载项目会话；selectId 指定选中项（新建会话后使用） */
  const loadSessions = useCallback(async (selectId?: string) => {
    try {
      const { sessions: list } = await runtimeApi.projectSessions(project.id)
      setSessions(list)
      setActiveSessionId((prev) => {
        if (selectId) return selectId
        if (prev && list.some((s) => s.id === prev)) return prev
        return list[0]?.id ?? null
      })
      setSessionError('')
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : '加载会话失败')
    } finally {
      setSessionsLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    setSessions([])
    setActiveSessionId(null)
    setSessionsLoading(true)
    void loadSessions()
  }, [loadSessions])

  useEffect(() => {
    let alive = true
    setMemoryInjectEnabled(true)
    memoryApi.settings(project.id)
      .then(({ settings }) => {
        if (alive) setMemoryInjectEnabled(settings.injectMemory)
      })
      .catch(() => {
        if (alive) setMemoryInjectEnabled(true)
      })
    return () => { alive = false }
  }, [project.id])

  /** 项目主 agent（项目内所有 agent 都可参与会话，自动执行用主 agent） */
  const primaryAgent = project.agents[0] ?? null

  const real = useRealSession(activeSessionId, () => { void loadSessions(); void onRefreshAgents() }, currentUserName)

  // 进入项目 / 开始运行时刷新 agent 状态（工作中 ↔ 空闲由后端按 running 会话派生）
  useEffect(() => { void onRefreshAgents() }, [project.id, onRefreshAgents])
  useEffect(() => { if (real.busy) void onRefreshAgents() }, [real.busy, onRefreshAgents])

  // 会话列表轮询（覆盖其他人的新建/改名/状态变化；P1 实时方案的兜底）
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadSessions()
        void onRefreshAgents()
      }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [loadSessions, onRefreshAgents])

  // 当前会话 SSE：他人消息、排队/运行状态、标题变化
  useEffect(() => {
    if (!activeSessionId) return
    const es = new EventSource(runtimeApi.sessionStreamUrl(activeSessionId))
    let reloadTimer: number | null = null
    const scheduleReload = () => {
      if (reloadTimer) window.clearTimeout(reloadTimer)
      reloadTimer = window.setTimeout(() => { void real.reload() }, 250)
    }
    es.onmessage = (ev) => {
      let payload: { type?: string; session?: RuntimeSession; turn?: { status?: string }; sessionId?: string }
      try { payload = JSON.parse(ev.data) } catch { return }
      if (payload.type === 'deleted') {
        es.close()
        void loadSessions()
        return
      }
      if (payload.session) {
        setSessions((list) => list.map((s) => (s.id === payload.session!.id ? { ...s, ...payload.session } : s)))
      }
      if (payload.type === 'session' || payload.type === 'turn') {
        scheduleReload()
        void loadSessions()
        void onRefreshAgents()
        void runtimeApi.markSessionRead(activeSessionId)
          .then(() => setSessions((list) => list.map((s) => (
            s.id === activeSessionId ? { ...s, unreadCount: 0 } : s
          ))))
          .catch(() => {})
      }
    }
    return () => {
      if (reloadTimer) window.clearTimeout(reloadTimer)
      es.close()
    }
  }, [activeSessionId, real.reload, loadSessions, onRefreshAgents])

  const { cellStyle, startResize, reset } = useResizableColumns(COLUMN_SPECS)
  /** 右侧 Agent CLI 格子是否收起（按钮在会话格右上角） */
  const [cliCollapsed, setCliCollapsed] = useState(false)

  /** 非研发项目隐藏代码/终端 tab */
  const visibleItems = useMemo(
    () => (project.type === 'nondev'
      ? TAB_ITEMS.filter((t) => t.key !== 'code' && t.key !== 'terminal')
      : TAB_ITEMS),
    [project.type],
  )
  const visibleKeys = useMemo(() => visibleItems.map((t) => t.key as NavKey), [visibleItems])
  const defaultOpenTabs = useMemo(
    () => DEFAULT_OPEN_TABS.filter((k) => visibleKeys.includes(k)),
    [visibleKeys],
  )

  const [openTabs, setOpenTabs] = useState<NavKey[]>(() => defaultOpenTabs)
  const [activeTab, setActiveTab] = useState<NavKey>(() => (
    initialNav && visibleKeys.includes(initialNav) ? initialNav : (defaultOpenTabs[0] ?? 'specs')
  ))
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditForm>({
    name: '', description: '', folderId: '', status: '规划中', startDate: '', endDate: '',
  })
  /** 成员添加/编辑弹窗（编辑项目弹窗内）：editId = null 表新增、有值表编辑 */
  const [memberModal, setMemberModal] = useState<'add' | { editId: string } | null>(null)
  const [memberForm, setMemberForm] = useState({ name: '', role: '', permission: '无' })
  /** 组织成员（设置页已导入的成员，项目成员只能从中选择） */
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([])
  /** 项目 agent 选择弹窗（从设置页 Agent 中挑选） */
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  /** 删除项目二次确认 */
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  /** ADE 配置弹窗（点 ADE 行打开，复用 AdeSettingsModal） */
  const [adeEditingId, setAdeEditingId] = useState<string | null>(null)
  /** 工作流 tab 打开的运行弹窗任务 id */
  const [wfModalJobId, setWfModalJobId] = useState<string | null>(null)
  const activeItem = visibleItems.find((t) => t.key === activeTab) ?? visibleItems[0]
  /** 已关闭的 tab（+ 菜单数据源；只包含当前项目可见 tab） */
  const closedTabs = visibleKeys.filter((k) => !openTabs.includes(k))
  /** 工作流 tab 弹窗对应任务 */
  const wfModalJob = project.autoJobs.find((j) => j.id === wfModalJobId) ?? null

  // 组织成员：项目成员只能从设置页已导入的成员中选择
  useEffect(() => {
    let alive = true
    orgApi.members()
      .then(({ members }) => { if (alive) setOrgMembers(members) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  /* —— 会话操作（格 1 新建 / 选中；数据来自后端） —— */

  /** 选中会话并标记已读 */
  const selectSession = (sessionId: string) => {
    setActiveSessionId(sessionId)
    setSessions((list) => list.map((s) => (s.id === sessionId ? { ...s, unreadCount: 0 } : s)))
    void runtimeApi.markSessionRead(sessionId).catch(() => {})
  }

  /** 新建会话：写入后端并选中（agent 归属项目，不按会话选择） */
  const handleNewSession = async () => {
    if (creatingSession || project.agents.length === 0) return
    setCreatingSession(true)
    setSessionError('')
    try {
      const { session } = await runtimeApi.createProjectSession(project.id)
      setSessions((list) => [session, ...list])
      setActiveSessionId(session.id)
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : '新建会话失败')
    } finally {
      setCreatingSession(false)
    }
  }

  /** 会话改名：写回后端 */
  const handleRenameSession = async (sessionId: string, title: string) => {
    try {
      const { session } = await runtimeApi.updateSession(sessionId, { title })
      setSessions((list) => list.map((s) => (s.id === session.id ? session : s)))
      setSessionError('')
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : '会话改名失败')
    }
  }

  /** 发送：入队后刷新列表（排队/运行状态与最后活动时间） */
  const handleSend = async (text: string, useKnowledge = false, useMemory = true) => {
    await real.send(text, useKnowledge, useMemory)
    void loadSessions()
    void onRefreshAgents()
  }

  /** 会话消息 → 视图模型（发送者来自后端记录） */
  const chatMessages: RunMessage[] = useMemo(
    () => real.messages.map((m) => {
      const isUser = m.role === 'user'
      const name = isUser
        ? (m.userName || '未知成员')
        : (m.agentName || primaryAgent?.name || 'Agent')
      const text = m.status === 'canceled'
        ? '本轮已取消'
        : m.error
          ? `执行失败：${m.error}`
          : m.content
      return {
        id: m.id,
        role: isUser ? ('人' as const) : ('ADE' as const),
        text,
        time: clockText(m.at),
        sender: {
          name,
          initial: name.charAt(0).toUpperCase(),
          color: memberColorOf(name),
        },
      }
    }),
    [real.messages, primaryAgent],
  )

  /** 真实事件 → Agent CLI 行 */
  const terminalLogs: TerminalLog[] = useMemo(
    () => real.lines.map((l) => ({
      id: l.key,
      time: l.at,
      kind: l.kind as TerminalLog['kind'],
      text: l.text,
    })),
    [real.lines],
  )

  // 外部指定初始导航（如通知跳转）时同步：目标 tab 若已关闭先重开
  useEffect(() => {
    if (!initialNav || !visibleKeys.includes(initialNav)) return
    setOpenTabs((open) => (open.includes(initialNav) ? open : [...open, initialNav]))
    setActiveTab(initialNav)
  }, [initialNav, visibleKeys])

  // 项目类型导致 tab 不可见时，回退到第一个可见 tab
  useEffect(() => {
    if (!visibleKeys.includes(activeTab)) {
      setActiveTab(defaultOpenTabs[0] ?? visibleKeys[0] ?? 'specs')
    }
  }, [visibleKeys, activeTab, defaultOpenTabs])

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

  /** 组织权限 → 项目权限默认值 */
  const projectPermissionOf = (m: OrgMember): string =>
    m.permission === '所有者' ? '项目负责人' : m.permission === '管理员' ? '管理员' : '无'

  const resetMemberForm = () => setMemberForm({ name: '', role: '', permission: '无' })

  /** 可添加的组织成员（排除已在项目中的） */
  const addableOrgMembers = orgMembers.filter(
    (m) => !project.members.some((it) => it.name === m.name),
  )

  /** 打开添加成员弹窗 */
  const openAddMember = () => {
    const first = addableOrgMembers[0]
    setMemberForm(first
      ? { name: first.name, role: first.role, permission: projectPermissionOf(first) }
      : { name: '', role: '', permission: '无' })
    setMemberModal('add')
  }

  /** 选择组织成员：职位与权限按组织成员预填 */
  const handlePickOrgMember = (name: string) => {
    const m = orgMembers.find((it) => it.name === name)
    setMemberForm({
      name,
      role: m?.role || '',
      permission: m ? projectPermissionOf(m) : '无',
    })
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

  /* —— 项目 agent 管理（来源 = 设置页已配置的 Agent，绑定到本项目） —— */

  const editingAgent = project.agents.find((a) => a.id === adeEditingId) ?? null

  /** 可添加的设置页 Agent（排除已绑定到本项目的） */
  const addableAgents = settingsAgents.filter(
    (a) => !project.agents.some((it) => it.id === a.id),
  )

  /** 添加项目 agent：把设置页 Agent 绑定到本项目 */
  const handleAddAgent = (agentId: string) => {
    onBindAgent(agentId, project.id)
    setAgentPickerOpen(false)
  }

  /** 保存 Agent 配置（写回设置页 Agent） */
  const handleSaveAde = (next: AdeAgent) => {
    onUpdateAgent(next)
    setAdeEditingId(null)
  }

  /** 从项目移除 agent（只解绑，不删除设置页里的 Agent） */
  const handleRemoveAde = (id: string) => {
    onBindAgent(id, null)
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
      case 'terminal':
        return <PtyTerminalPanel projectId={project.id} />
      case 'knowledge':
        return <KnowledgePanel projectId={project.id} />
      case 'memory':
        return (
          <MemoryPanel
            projectId={project.id}
            onSettingsChange={(next) => setMemoryInjectEnabled(next.injectMemory)}
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
            sessions={sessions}
            activeSessionId={activeSessionId}
            canCreate={project.agents.length > 0}
            creating={creatingSession}
            loading={sessionsLoading}
            error={sessionError}
            currentUserName={currentUserName}
            onSelect={selectSession}
            onNewSession={handleNewSession}
            onOpenEdit={openEditModal}
          />
        </div>
        {renderResizer(0)}
        <div className="detail-cell" style={cellStyle(1)}>
          <ChatPane
            project={project}
            session={activeSession}
            agent={primaryAgent}
            messages={chatMessages}
            busy={real.busy}
            queued={real.queued}
            queuePosition={real.queuePosition}
            error={real.error}
            currentUserName={currentUserName}
            hasMore={real.hasMore}
            loadingOlder={real.loadingOlder}
            onLoadOlder={real.loadOlder}
            onSend={handleSend}
            onRename={handleRenameSession}
            memoryInjectEnabled={memoryInjectEnabled}
            cliOpen={!cliCollapsed}
            onToggleCli={() => setCliCollapsed((v) => !v)}
          />
        </div>
        {renderResizer(1)}
        {!cliCollapsed && (
          <>
            <div className="detail-cell" style={cellStyle(2)}>
              <TerminalPane
                session={activeSession}
                agent={primaryAgent}
                logs={terminalLogs}
                busy={real.busy}
              />
            </div>
            {renderResizer(2)}
          </>
        )}
        {/* 格 4：项目配置（同行走比例分配，不再单独 flex 吸收） */}
        <div className="detail-cell detail-config" style={cellStyle(3)}>
          <ClosableTabs
            items={visibleItems}
            openKeys={openTabs}
            activeKey={activeTab}
            closedKeys={closedTabs}
            onSelect={(key) => setActiveTab(key as NavKey)}
            onClose={(key) => handleCloseTab(key as NavKey)}
            onReopen={(key) => handleReopenTab(key as NavKey)}
          />
          {/* 工作流 / 终端为画布/终端型面板：去 padding 贴边渲染 */}
          <div className={`detail-panel${activeTab === 'workflow' || activeTab === 'terminal' ? ' bare' : ''}`}>
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
          <ModalField label="项目类型">
            <input
              className="field-input"
              value={project.type === 'nondev' ? '非研发项目' : '研发项目'}
              disabled
              readOnly
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
                const isMe = m.name === currentUserName
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
                        {[m.role, m.permission].filter(Boolean).join(' · ')}
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

          {/* 项目 agent：来源 = 设置页已配置的 Agent（绑定到本项目） */}
          <div className="modal-field">
            <div className="modal-field-label-row">
              <div className="modal-field-label">项目 agent</div>
              <button
                type="button"
                className="member-add-btn"
                onClick={() => setAgentPickerOpen(true)}
                disabled={addableAgents.length === 0}
                title={addableAgents.length === 0
                  ? (settingsAgents.length === 0 ? '设置页还没有 Agent，请先新建' : '设置页的 Agent 都已接入本项目')
                  : '从设置页已配置的 Agent 中添加'}
              >
                ＋ 添加 agent
              </button>
            </div>
            <div className="edit-member-list">
              {project.agents.length === 0 && (
                <div className="edit-ade-empty">
                  {settingsAgents.length === 0
                    ? '设置页还没有 Agent，先到「设置 › Agent 设置」新建'
                    : '暂无 agent 接入本项目'}
                </div>
              )}
              {project.agents.map((a) => {
                const busy = a.status === '工作中'
                return (
                  <button
                    key={a.id}
                    type="button"
                    className="edit-ade-row"
                    onClick={() => { if (!busy) setAdeEditingId(a.id) }}
                    title={busy ? '工作中的 agent 不可修改' : '点击配置 agent'}
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

          {/* 删除项目（软删除） */}
          <div className="modal-field">
            <button
              type="button"
              className="text-btn danger"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              删除项目
            </button>
            <div className="form-tips">
              <span className="form-tips-icon">i</span>
              <span className="form-tips-text">
                软删除：项目将从协作中心移除，成员 / 会话 / Agent 等数据保留在服务端。
              </span>
            </div>
          </div>
        </FormModal>
      )}

      {/* 删除项目二次确认 */}
      {deleteConfirmOpen && (
        <FormModal
          title="删除项目"
          confirmText="删除"
          confirmDanger
          onConfirm={() => onDeleteProject(project.id)}
          onClose={() => setDeleteConfirmOpen(false)}
        >
          <p className="form-hint">
            确定删除项目「{project.name}」吗？删除后将不再出现在协作中心（软删除，服务端数据保留）。
          </p>
        </FormModal>
      )}

      {/* 项目 agent 选择弹窗（从设置页已配置的 Agent 中添加） */}
      {agentPickerOpen && (
        <FormModal
          title="添加项目 agent"
          confirmText="关闭"
          onConfirm={() => setAgentPickerOpen(false)}
          onClose={() => setAgentPickerOpen(false)}
        >
          {addableAgents.length === 0 ? (
            <p className="form-hint">设置页没有可添加的 Agent（已全部接入本项目，或尚未新建）。</p>
          ) : (
            <div className="edit-member-list">
              {addableAgents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="edit-ade-row"
                  onClick={() => handleAddAgent(a.id)}
                  title="添加到本项目"
                >
                  <span className="edit-member-avatar edit-ade-avatar">A</span>
                  <span className="edit-member-text">
                    <span className="edit-member-name">{a.name}</span>
                    <span className="edit-member-sub">{a.role} · {a.model}</span>
                  </span>
                  <span className="settings-row-right">
                    <StatusBadge tone="neutral">{a.status}</StatusBadge>
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="form-hint">Agent 在「设置 › Agent 设置」中创建与配置，这里只负责把它接入当前项目。</p>
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
          {memberModal === 'add' ? (
            <ModalField label="成员">
              {addableOrgMembers.length > 0 ? (
                <select
                  className="field-select"
                  value={memberForm.name}
                  onChange={(e) => handlePickOrgMember(e.target.value)}
                >
                  {addableOrgMembers.map((m) => (
                    <option key={m.id} value={m.name}>{m.name}（{m.permission}）</option>
                  ))}
                </select>
              ) : (
                <p className="form-hint">
                  {orgMembers.length === 0
                    ? '设置页还没有成员，请先到「设置 › 成员管理」从飞书导入成员。'
                    : '设置页已导入的成员都已在本项目中。'}
                </p>
              )}
            </ModalField>
          ) : (
            <ModalField label="姓名">
              <input className="field-input" value={memberForm.name} disabled />
            </ModalField>
          )}
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
