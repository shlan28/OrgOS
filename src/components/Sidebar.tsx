import { useState } from 'react'
import SegmentedControl from './SegmentedControl'
import { CodeIcon, FolderIcon, HomeIcon, PencilIcon, ProjectsIcon, SlidersIcon } from './icons'
import './Sidebar.css'

interface SidebarProps {
  /** 项目中心是否处于选中态 */
  projectCenterActive: boolean
  /** 新对话：回到首页会话框（home 视图） */
  onNewChat: () => void
  onOpenProjectCenter: () => void
}

/** 左侧边栏：分段控件 + 菜单 + 项目区 + 用户区 */
export default function Sidebar({ projectCenterActive, onNewChat, onOpenProjectCenter }: SidebarProps) {
  const [tab, setTab] = useState('code')

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          items={[
            { key: 'home', label: 'Home', icon: <HomeIcon size={14} /> },
            { key: 'code', label: 'Code', icon: <CodeIcon size={14} /> },
          ]}
        />

        <nav className="sidebar-menu">
          <button
            type="button"
            className={`menu-item${projectCenterActive ? '' : ' active'}`}
            onClick={onNewChat}
            title="回到新对话（首页会话框）"
          >
            <PencilIcon size={15} />
            <span>新对话</span>
          </button>
          <button type="button" className="menu-item">
            <SlidersIcon size={15} />
            <span>定制</span>
          </button>
          <button
            type="button"
            className={`menu-item${projectCenterActive ? ' active' : ''}`}
            onClick={onOpenProjectCenter}
          >
            <ProjectsIcon size={15} />
            <span>项目中心</span>
          </button>
        </nav>

        <div className="sidebar-section">
          <div className="section-title">项目</div>
          <button type="button" className="menu-item project-item">
            <FolderIcon size={15} />
            <span>loomweb</span>
          </button>
          <p className="empty-hint">暂无会话，点上方铅笔图标开始</p>
        </div>
      </div>

      <div className="sidebar-user">
        <span className="avatar">S</span>
        <span className="username">shilu</span>
      </div>
    </aside>
  )
}
