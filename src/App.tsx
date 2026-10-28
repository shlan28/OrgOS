import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatInput from './components/ChatInput'
import ContextSelector from './components/ContextSelector'
import ProjectCenter from './components/ProjectCenter'
import ProjectDetail from './components/ProjectDetail'
import FormModal from './components/FormModal'
import SettingsPage, { type SettingsSection } from './components/SettingsPage'
import LoginPage from './components/auth/LoginPage'
import { authApi, type AuthUser } from './lib/authApi'
import HomeGrid, { type PaneSession } from './components/home-grid/HomeGrid'
import {
  projects as initialProjects,
  createEmptyProject,
  type AdeAgent,
  type Notification,
  type Project,
  type ProjectFolder,
} from './data/projects'
import { createDefaultUserSettings, initialOf, type UserSettings } from './data/settings'
import { projectsApi, type BackendProject } from './lib/projectsApi'
import { orgApi } from './lib/orgApi'
import { useAutomationEngine } from './hooks/useAutomationEngine'
import { MultiViewIcon } from './components/icons'
import { runtimeApi, toAdeAgent, toRuntimeInput, type RuntimeInfo } from './lib/runtimeApi'

type View =
  | { type: 'home' }
  | { type: 'project-center' }
  | { type: 'project-detail'; projectId: string; initialNav?: 'workflow' }
  | { type: 'settings' }

/** 首页多视窗初始槽位：当前会话（新对话）进左上，其余未分配 */
const INITIAL_PANES: PaneSession[] = [{ kind: 'new' }, null, null, null]

/** 后端管理的项目字段（用于判断是否需要回写） */
const projectMetaOf = (p: Project) => ({
  name: p.name,
  description: p.description,
  status: p.status,
  startDate: p.startDate,
  endDate: p.endDate,
  folderId: p.folderId ?? null,
  members: p.members.map((m) => ({
    name: m.name,
    role: m.role,
    permission: m.permission ?? '',
    online: m.online,
    lastActive: m.lastActive,
  })),
})

/** 后端项目 + Mock 详情（会话/规范/工作流等）合并成页面使用的 Project
 *  orgNames = 设置页已导入的成员名单；传 null 表示名单未知（不过滤） */
const mergeBackendProject = (bp: BackendProject, orgNames: Set<string> | null): Project => {
  const base = initialProjects.find((p) => p.id === bp.id) ?? createEmptyProject({
    name: bp.name,
    description: bp.description,
    status: bp.status as Project['status'],
    type: bp.type,
    workspaceMode: bp.workspaceMode,
    startDate: bp.startDate,
    endDate: bp.endDate,
    folderId: bp.folderId ?? undefined,
  })
  return {
    ...base,
    id: bp.id,
    name: bp.name,
    description: bp.description,
    status: bp.status as Project['status'],
    type: bp.type === 'nondev' ? 'nondev' : 'dev',
    workspaceMode: bp.workspaceMode ?? base.workspaceMode,
    startDate: bp.startDate,
    endDate: bp.endDate,
    folderId: bp.folderId ?? undefined,
    members: bp.members
      .filter((m) => !orgNames || orgNames.has(m.name))
      .map((m) => ({
      id: m.id,
      name: m.name,
      initial: initialOf(m.name),
      role: m.role,
      permission: m.permission || undefined,
      online: m.online,
      lastActive: m.lastActive,
    })),
  }
}

export default function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [view, setView] = useState<View>({ type: 'home' })
  const [projects, setProjects] = useState<Project[]>([])
  const [folders, setFolders] = useState<ProjectFolder[]>([])
  /** 后端已有项目 id（用于区分未创建成功的本地项目） */
  const backendProjectIdsRef = useRef<Set<string>>(new Set())
  /** 每个项目上次同步到后端的元信息 hash */
  const projectSyncHashRef = useRef<Map<string, string>>(new Map())
  /** 首页多视窗开关（仅 home 视图语义；关闭时保留窗格分配） */
  const [multiView, setMultiView] = useState(false)
  /** 四窗格会话槽位（'new' / 'history:id' / null） */
  const [panes, setPanes] = useState<PaneSession[]>(INITIAL_PANES)
  /** 设置页当前分区（Agent 设置 / 成员管理） */
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('agent')
  /** 进入设置页前的视图（× 关闭时回到该视图） */
  const prevViewRef = useRef<View>({ type: 'home' })
  /** 用户设置（Agent 配置由后端载入并回写） */
  const [userSettings, setUserSettings] = useState<UserSettings>(createDefaultUserSettings)

  /** 运行时（DeepSeek Harness）状态 */
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  /** 登录状态 */
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [feishuConfigured, setFeishuConfigured] = useState(false)

  /** 首次从后端载入 Agent 后才允许回写，避免把默认 Mock 覆盖到服务端 */
  const agentsHydratedRef = useRef(false)
  const agentSyncTimerRef = useRef<number | null>(null)

  const engine = useAutomationEngine(projects, setProjects)

  /** 项目 agent = 设置页 Agent 中绑定到该项目的那些（单一数据源，避免与 Mock 双轨） */
  const projectsView = useMemo(
    () => projects.map((p) => ({
      ...p,
      agents: userSettings.myAdes.filter((a) => a.projectId === p.id),
    })),
    [projects, userSettings.myAdes],
  )

  const activeProject = view.type === 'project-detail'
    ? projectsView.find((p) => p.id === view.projectId) ?? null
    : null

  /** 各面板写操作的统一入口：按 updater 更新指定项目（本地 state，不持久化） */
  const handleUpdateProject = (projectId: string, updater: (p: Project) => Project) => {
    setProjects((list) => list.map((p) => (p.id === projectId ? updater(p) : p)))
  }

  /** 飞书授权状态写回（全局共享） */
  /** 重新读取运行时状态（CLI 版本 / Key 是否配置） */
  const refreshRuntime = () => {
    runtimeApi.info().then(setRuntime).catch((err) => console.error('[runtime] info failed', err))
  }

  /** 重新载入 Agent（含后端派生的工作中/空闲状态与当前任务） */
  const refreshAgents = useCallback(async () => {
    try {
      const { agents } = await runtimeApi.agents()
      const ades = agents.map(toAdeAgent)
      setUserSettings((s) => ({
        ...s,
        myAdes: ades,
        defaultAdeId: ades.some((a) => a.id === s.defaultAdeId) ? s.defaultAdeId : (ades[0]?.id ?? ''),
      }))
    } catch (err) {
      console.error('[runtime] agents refresh failed', err)
    }
  }, [])

  /** 载入后端项目与文件夹，并与 Mock 详情合并 */
  const loadProjectsAndFolders = useCallback(async () => {
    try {
      const [{ projects: backendProjects }, { folders: backendFolders }, orgMemberList] = await Promise.all([
        projectsApi.projects(),
        projectsApi.folders(),
        // 名单拿不到时不过滤，避免误隐藏全部成员
        orgApi.members().then((r) => r.members).catch(() => null),
      ])
      const orgNames = orgMemberList ? new Set(orgMemberList.map((m) => m.name)) : null
      const merged = backendProjects.map((bp) => mergeBackendProject(bp, orgNames))
      backendProjectIdsRef.current = new Set(merged.map((p) => p.id))
      projectSyncHashRef.current = new Map(
        merged.map((p) => [p.id, JSON.stringify(projectMetaOf(p))]),
      )
      setProjects(merged)
      setFolders(backendFolders.map((f) => ({
        id: f.id,
        name: f.name,
        members: f.members.map((m) => ({ name: m.name, role: m.role })),
      })))
    } catch (err) {
      console.error('[projects] load failed', err)
    }
  }, [])

  /* —— 启动：检查登录状态 —— */
  useEffect(() => {
    let alive = true
    authApi.session()
      .then((session) => {
        if (!alive) return
        setAuthUser(session.authenticated ? session.user : null)
        setNeedsSetup(session.needsSetup)
        setFeishuConfigured(session.feishuConfigured)
      })
      .catch(() => {})
      .finally(() => { if (alive) setAuthLoading(false) })
    return () => { alive = false }
  }, [])

  /* —— 登录后：载入真实 Agent 配置（替换 Mock myAdes）+ 运行时状态 + 项目 —— */
  useEffect(() => {
    if (!authUser) return
    let alive = true
    agentsHydratedRef.current = false
    void loadProjectsAndFolders()
    Promise.all([runtimeApi.info(), runtimeApi.agents()])
      .then(([info, { agents }]) => {
        if (!alive) return
        setRuntime(info)
        const ades = agents.map(toAdeAgent)
        setUserSettings((s) => ({
          ...s,
          myAdes: ades,
          defaultAdeId: ades.some((a) => a.id === s.defaultAdeId) ? s.defaultAdeId : (ades[0]?.id ?? ''),
        }))
      })
      .catch((err) => console.error('[runtime] load failed', err))
      .finally(() => { agentsHydratedRef.current = true })
    return () => { alive = false }
  }, [authUser, loadProjectsAndFolders])

  /* —— 项目元信息 / 成员改动 → 后端持久化（防抖，仅后端已有的项目） —— */
  useEffect(() => {
    if (!authUser) return
    const timers: number[] = []
    for (const project of projects) {
      if (!backendProjectIdsRef.current.has(project.id)) continue
      const meta = projectMetaOf(project)
      const hash = JSON.stringify(meta)
      if (projectSyncHashRef.current.get(project.id) === hash) continue
      const timer = window.setTimeout(() => {
        projectsApi.updateProject(project.id, meta)
          .then(() => projectSyncHashRef.current.set(project.id, hash))
          .catch((err) => console.error('[projects] sync failed', err))
      }, 400)
      timers.push(timer)
    }
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [projects, authUser])

  /* —— 设置页 Agent 改动 → 后端持久化（防抖整表同步） —— */
  useEffect(() => {
    if (!authUser || !agentsHydratedRef.current) return
    if (agentSyncTimerRef.current) window.clearTimeout(agentSyncTimerRef.current)
    agentSyncTimerRef.current = window.setTimeout(() => {
      runtimeApi.syncAgents(userSettings.myAdes.map(toRuntimeInput))
        .catch((err) => console.error('[runtime] sync failed', err))
    }, 400)
    return () => {
      if (agentSyncTimerRef.current) window.clearTimeout(agentSyncTimerRef.current)
    }
  }, [userSettings.myAdes])

  /** 保存运行时凭证（API Key / Base URL） */
  const handleSaveRuntime = async (patch: { deepseekApiKey?: string; deepseekBaseUrl?: string }) => {
    const res = await runtimeApi.saveRuntime(patch)
    setRuntime((r) => (r ? { ...r, keyConfigured: res.keyConfigured, baseUrl: res.baseUrl } : r))
  }

  /** 通知跳转：进入对应项目详情 → 工作流 tab */
  const handleGoToNotification = (n: Notification) => {
    setView({ type: 'project-detail', projectId: n.projectId, initialNav: 'workflow' })
  }

  /* —— 文件夹管理 —— */

  const handleCreateFolder = async (name: string, memberNames: string[]) => {
    const currentName = authUser?.name ?? 'admin'
    const members = [
      { name: currentName, role: 'owner' as const },
      ...memberNames
        .filter((n) => n !== currentName)
        .map((n) => ({ name: n, role: 'member' as const })),
    ]
    try {
      await projectsApi.createFolder({ name, members })
      await loadProjectsAndFolders()
    } catch (err) {
      console.error('[folders] create failed', err)
    }
  }

  const handleUpdateFolder = async (folderId: string, patch: Pick<ProjectFolder, 'name' | 'members'>) => {
    try {
      await projectsApi.updateFolder(folderId, { name: patch.name, members: patch.members })
      await loadProjectsAndFolders()
    } catch (err) {
      console.error('[folders] update failed', err)
    }
  }

  const handleDeleteFolder = async (folderId: string) => {
    try {
      await projectsApi.deleteFolder(folderId)
      await loadProjectsAndFolders()
    } catch (err) {
      console.error('[folders] delete failed', err)
    }
  }

  /** 移动项目：先本地更新，由同步 effect 回写后端 */
  const handleMoveProject = (projectId: string, folderId: string | undefined) => {
    setProjects((list) => list.map((p) => (p.id === projectId ? { ...p, folderId } : p)))
  }

  /** 删除项目（软删除）：成功后刷新列表；若正在该项目详情页则退回项目中心 */
  const handleDeleteProject = async (projectId: string) => {
    try {
      await projectsApi.deleteProject(projectId)
      await loadProjectsAndFolders()
      setView((v) => (v.type === 'project-detail' && v.projectId === projectId
        ? { type: 'project-center' }
        : v))
    } catch (err) {
      console.error('[projects] delete failed', err)
    }
  }

  /* —— 首页多视窗 —— */

  const handleChangePane = (index: number, session: PaneSession) => {
    setPanes((list) => list.map((p, i) => (i === index ? session : p)))
  }

  const handleGrowBottom = () => {
    setPanes((list) => [...list, null, null])
  }

  const toggleMultiView = () => {
    setMultiView((v) => {
      if (!v) setPanes(INITIAL_PANES)
      return !v
    })
  }

  /* —— 设置页 —— */

  const handleOpenSettings = () => {
    void refreshAgents()
    if (view.type !== 'settings') prevViewRef.current = view
    setView({ type: 'settings' })
  }

  const handleCloseSettings = () => setView(prevViewRef.current)

  const handleUpdateSettings = (updater: (s: UserSettings) => UserSettings) =>
    setUserSettings((s) => updater(s))

  /** 项目 agent 配置写回设置页（myAdes 同步 effect 会持久化到后端） */
  const handleUpdateAgent = (next: AdeAgent) => {
    setUserSettings((s) => ({ ...s, myAdes: s.myAdes.map((a) => (a.id === next.id ? next : a)) }))
  }

  /** 绑定 / 解绑项目 agent（projectId = null 表示从项目移除，不删除 Agent 本身） */
  const handleBindAgent = async (agentId: string, projectId: string | null) => {
    try {
      await runtimeApi.updateAgent(agentId, { projectId })
      setUserSettings((s) => ({
        ...s,
        myAdes: s.myAdes.map((a) => (a.id === agentId ? { ...a, projectId } : a)),
      }))
    } catch (err) {
      console.error('[agents] bind failed', err)
    }
  }

  /** 退出登录二次确认 */
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  /** 退出登录：清除服务端登录身份，回到登录页 */
  const handleLogout = async () => {
    try {
      await authApi.logout()
    } catch {
      /* 忽略网络错误，前端仍然登出 */
    }
    setAuthUser(null)
    setView({ type: 'home' })
    setSidebarVisible(true)
  }

  if (authLoading) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <p className="login-foot">正在检查登录状态…</p>
        </div>
      </div>
    )
  }

  if (!authUser) {
    return (
      <LoginPage
        needsSetup={needsSetup}
        feishuConfigured={feishuConfigured}
        onAuthenticated={(user) => {
          setAuthUser(user)
          setNeedsSetup(false)
        }}
      />
    )
  }

  return (
    <div className="desktop">
      <div className="window">
        <TitleBar
          onToggleSidebar={() => setSidebarVisible((v) => !v)}
          notifications={engine.notifications}
          onApproveNotification={(n) => engine.approve(n.projectId, n.jobId)}
          onRejectNotification={(n) => engine.reject(n.projectId, n.jobId)}
          onGoToNotification={handleGoToNotification}
        />
        <div className="window-body">
          {sidebarVisible && (
            <Sidebar
              projectCenterActive={view.type === 'project-center' || view.type === 'project-detail'}
              onNewChat={() => setView({ type: 'home' })}
              onOpenProjectCenter={() => setView({ type: 'project-center' })}
              onOpenSettings={handleOpenSettings}
              onLogout={() => setLogoutConfirmOpen(true)}
              userName={authUser.name}
              userInitial={authUser.name.charAt(0).toUpperCase()}
            />
          )}
          <main className="main-area">
            {view.type === 'home' && (
              <div className="main-toolbar">
                <button
                  type="button"
                  className={`main-icon-btn multiview${multiView ? ' active' : ''}`}
                  title="多视窗：切换 2×2 四窗格（上滑到底可无限加排）"
                  onClick={toggleMultiView}
                >
                  <MultiViewIcon size={17} />
                  {multiView && panes.some((p) => p !== null) && (
                    <span className="mv-count">{panes.filter((p) => p !== null).length}</span>
                  )}
                </button>
              </div>
            )}

            {view.type === 'home' && !multiView && (
              <div className="main-center">
                <h1 className="main-title">
                  要在 <span className="title-project">loomweb</span> 中构建什么？
                </h1>
                <ChatInput />
                <ContextSelector />
              </div>
            )}

            {view.type === 'home' && multiView && (
              <HomeGrid panes={panes} onChangePane={handleChangePane} onGrowBottom={handleGrowBottom} />
            )}

            {view.type === 'project-center' && (
              <ProjectCenter
                projects={projectsView}
                folders={folders}
                onOpenProject={(projectId) => setView({ type: 'project-detail', projectId })}
                onCreateProject={async (project) => {
                  try {
                    await projectsApi.createProject({
                      name: project.name,
                      description: project.description,
                      status: project.status,
                      type: project.type,
                      startDate: project.startDate,
                      endDate: project.endDate,
                      folderId: project.folderId ?? null,
                      members: [],
                    })
                    await loadProjectsAndFolders()
                  } catch (err) {
                    console.error('[projects] create failed', err)
                  }
                }}
                onCreateFolder={handleCreateFolder}
                onUpdateFolder={handleUpdateFolder}
                onDeleteFolder={handleDeleteFolder}
                onMoveProject={handleMoveProject}
                onDeleteProject={handleDeleteProject}
                currentUserName={authUser.name}
              />
            )}

            {view.type === 'project-detail' && activeProject && (
              <ProjectDetail
                key={activeProject.id}
                project={activeProject}
                projects={projectsView}
                folders={folders}
                onUpdateProject={handleUpdateProject}
                engine={engine}
                initialNav={view.initialNav}
                currentUserName={authUser.name}
                currentUserPermission={authUser.permission}
                settingsAgents={userSettings.myAdes}
                onUpdateAgent={handleUpdateAgent}
                onBindAgent={handleBindAgent}
                onDeleteProject={handleDeleteProject}
                onRefreshAgents={refreshAgents}
              />
            )}

            {view.type === 'settings' && (
              <SettingsPage
                section={settingsSection}
                onChangeSection={setSettingsSection}
                onClose={handleCloseSettings}
                settings={userSettings}
                onUpdateSettings={handleUpdateSettings}
                runtime={runtime}
                onSaveRuntime={handleSaveRuntime}
                onRefreshRuntime={refreshRuntime}
              />
            )}
          </main>
        </div>

        {/* 退出登录二次确认 */}
        {logoutConfirmOpen && (
          <FormModal
            title="退出登录"
            confirmText="退出登录"
            confirmDanger
            onConfirm={() => {
              setLogoutConfirmOpen(false)
              void handleLogout()
            }}
            onClose={() => setLogoutConfirmOpen(false)}
          >
            <p className="form-hint">确定要退出当前账号吗？退出后需要重新登录。</p>
          </FormModal>
        )}
      </div>
    </div>
  )
}
