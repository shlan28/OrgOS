import { useRef, useState } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatInput from './components/ChatInput'
import ContextSelector from './components/ContextSelector'
import ProjectCenter from './components/ProjectCenter'
import ProjectDetail from './components/ProjectDetail'
import SettingsPage, { type SettingsSection } from './components/SettingsPage'
import HomeGrid, { type PaneSession } from './components/home-grid/HomeGrid'
import { projects as initialProjects, projectFolders as initialFolders, createFolderMembers, type Notification, type Project, type ProjectFolder } from './data/projects'
import { createDefaultUserSettings, createDefaultInviteData, type FeishuSettings, type InviteData, type UserSettings } from './data/settings'
import { useAutomationEngine } from './hooks/useAutomationEngine'
import { MultiViewIcon } from './components/icons'

type View =
  | { type: 'home' }
  | { type: 'project-center' }
  | { type: 'project-detail'; projectId: string; initialNav?: 'workflow'; focusJobId?: string }
  | { type: 'settings' }

/** 首页多视窗初始槽位：当前会话（新对话）进左上，其余未分配 */
const INITIAL_PANES: PaneSession[] = [{ kind: 'new' }, null, null, null]

export default function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [view, setView] = useState<View>({ type: 'home' })
  const [projects, setProjects] = useState<Project[]>(initialProjects)
  const [folders, setFolders] = useState<ProjectFolder[]>(initialFolders)
  /** 首页多视窗开关（仅 home 视图语义；关闭时保留窗格分配） */
  const [multiView, setMultiView] = useState(false)
  /** 四窗格会话槽位（'new' / 'history:id' / null） */
  const [panes, setPanes] = useState<PaneSession[]>(INITIAL_PANES)
  /** 设置页当前分区（Agent 设置 / 邀请成员） */
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('agent')
  /** 进入设置页前的视图（× 关闭时回到该视图） */
  const prevViewRef = useRef<View>({ type: 'home' })
  /** 用户设置（Agent 设置面板数据，本地 state 不持久化） */
  const [userSettings, setUserSettings] = useState<UserSettings>(createDefaultUserSettings)
  /** 邀请成员数据（本地 state 不持久化） */
  const [inviteData, setInviteData] = useState<InviteData>(createDefaultInviteData)

  const engine = useAutomationEngine(projects, setProjects)

  const activeProject = view.type === 'project-detail'
    ? projects.find((p) => p.id === view.projectId) ?? null
    : null

  /** 各面板写操作的统一入口：按 updater 更新指定项目（本地 state，不持久化） */
  const handleUpdateProject = (projectId: string, updater: (p: Project) => Project) => {
    setProjects((list) => list.map((p) => (p.id === projectId ? updater(p) : p)))
  }

  /** 飞书授权状态写回（全局共享：设置页与「文档」子 tab 导入弹窗共用） */
  const handleUpdateFeishu = (updater: (f: FeishuSettings) => FeishuSettings) => {
    setUserSettings((s) => ({ ...s, feishu: updater(s.feishu) }))
  }

  /** 跳转设置页「飞书授权」分区（导入弹窗未配置凭证引导） */
  const handleGoToFeishuSettings = () => {
    prevViewRef.current = view
    setSettingsSection('feishu')
    setView({ type: 'settings' })
  }

  /** 通知跳转：进入对应项目详情 → 自动化任务 tab → 待人工处理 segment → 高亮定位任务卡片 */
  const handleGoToNotification = (n: Notification) => {
    setView({ type: 'project-detail', projectId: n.projectId, initialNav: 'workflow', focusJobId: n.jobId })
  }

  /* —— 文件夹管理（项目中心域，与 projects 同级 state） —— */

  /** 新建文件夹：创建者自动成为所有者，所选成员为普通成员 */
  const handleCreateFolder = (name: string, memberNames: string[]) => {
    setFolders((list) => [...list, { id: `f${Date.now()}`, name, members: createFolderMembers(memberNames) }])
  }

  /** 编辑文件夹：更新名称与可见成员范围（保留至少一名所有者由弹窗校验） */
  const handleUpdateFolder = (folderId: string, patch: Pick<ProjectFolder, 'name' | 'members'>) => {
    setFolders((list) => list.map((f) => (f.id === folderId ? { ...f, ...patch } : f)))
  }

  /** 删除文件夹：内部项目自动移至未分组 */
  const handleDeleteFolder = (folderId: string) => {
    setFolders((list) => list.filter((f) => f.id !== folderId))
    setProjects((list) => list.map((p) => (p.folderId === folderId ? { ...p, folderId: undefined } : p)))
  }

  /** 移动项目到文件夹（undefined = 未分组） */
  const handleMoveProject = (projectId: string, folderId: string | undefined) => {
    setProjects((list) => list.map((p) => (p.id === projectId ? { ...p, folderId } : p)))
  }

  /** 更新多视窗某格槽位（null = 关闭回未分配） */
  const handleChangePane = (index: number, session: PaneSession) => {
    setPanes((list) => list.map((p, i) => (i === index ? session : p)))
  }

  /** 多视窗底部上滑到底继续上滑：尾部追加一排 2 个空窗格（无限增加） */
  const handleGrowBottom = () => {
    setPanes((list) => [...list, null, null])
  }

  /** 切换多视窗：开启时槽位重置为初始 2×2（当前会话进左上）；关闭即重置（超 4 格分配丢弃，Mock 简化） */
  const toggleMultiView = () => {
    setMultiView((v) => {
      if (!v) setPanes(INITIAL_PANES)
      return !v
    })
  }

  /** 打开设置页（记录当前视图，供 × 关闭时返回） */
  const handleOpenSettings = () => {
    if (view.type !== 'settings') prevViewRef.current = view
    setView({ type: 'settings' })
  }

  /** 关闭设置页：回到进入前视图 */
  const handleCloseSettings = () => setView(prevViewRef.current)

  /** 更新用户设置（局部 updater） */
  const handleUpdateSettings = (updater: (s: UserSettings) => UserSettings) =>
    setUserSettings((s) => updater(s))

  /** 更新邀请成员数据（局部 updater） */
  const handleUpdateInvite = (updater: (d: InviteData) => InviteData) =>
    setInviteData((d) => updater(d))

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
            />
          )}
          <main className="main-area">
            {/* 多视窗 btn（仅首页；替代原预览/面板双 icon，激活态高亮 + 窗格数角标） */}
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
                projects={projects}
                folders={folders}
                onOpenProject={(projectId) => setView({ type: 'project-detail', projectId })}
                onCreateProject={(project) => setProjects((list) => [project, ...list])}
                onCreateFolder={handleCreateFolder}
                onUpdateFolder={handleUpdateFolder}
                onDeleteFolder={handleDeleteFolder}
                onMoveProject={handleMoveProject}
              />
            )}

            {view.type === 'project-detail' && activeProject && (
              <ProjectDetail
                key={activeProject.id}
                project={activeProject}
                projects={projects}
                folders={folders}
                onUpdateProject={handleUpdateProject}
                engine={engine}
                initialNav={view.initialNav}
                focusJobId={view.focusJobId}
                feishu={userSettings.feishu}
                onUpdateFeishu={handleUpdateFeishu}
                onGoToFeishuSettings={handleGoToFeishuSettings}
              />
            )}

            {view.type === 'settings' && (
              <SettingsPage
                section={settingsSection}
                onChangeSection={setSettingsSection}
                onClose={handleCloseSettings}
                settings={userSettings}
                onUpdateSettings={handleUpdateSettings}
                invite={inviteData}
                onUpdateInvite={handleUpdateInvite}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
