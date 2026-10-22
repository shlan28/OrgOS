import { useState } from 'react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatInput from './components/ChatInput'
import ContextSelector from './components/ContextSelector'
import ProjectCenter from './components/ProjectCenter'
import ProjectDetail from './components/ProjectDetail'
import HomeGrid, { type PaneSession } from './components/home-grid/HomeGrid'
import { projects as initialProjects, projectFolders as initialFolders, createFolderMembers, type Notification, type Project, type ProjectFolder } from './data/projects'
import { useAutomationEngine } from './hooks/useAutomationEngine'
import { MultiViewIcon } from './components/icons'

type View =
  | { type: 'home' }
  | { type: 'project-center' }
  | { type: 'project-detail'; projectId: string; initialNav?: 'workflow'; focusJobId?: string }

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

  const engine = useAutomationEngine(projects, setProjects)

  const activeProject = view.type === 'project-detail'
    ? projects.find((p) => p.id === view.projectId) ?? null
    : null

  /** 各面板写操作的统一入口：按 updater 更新指定项目（本地 state，不持久化） */
  const handleUpdateProject = (projectId: string, updater: (p: Project) => Project) => {
    setProjects((list) => list.map((p) => (p.id === projectId ? updater(p) : p)))
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
              projectCenterActive={view.type !== 'home'}
              onNewChat={() => setView({ type: 'home' })}
              onOpenProjectCenter={() => setView({ type: 'project-center' })}
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
              />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
