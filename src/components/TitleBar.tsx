import { SidebarIcon } from './icons'
import Notifications from './Notifications'
import type { Notification } from '../data/projects'
import './TitleBar.css'

interface TitleBarProps {
  onToggleSidebar: () => void
  notifications: Notification[]
  onApproveNotification: (n: Notification) => void
  onRejectNotification: (n: Notification) => void
  onGoToNotification: (n: Notification) => void
}

/** 窗口标题栏：交通灯按钮 + 通知铃铛 + 侧边栏切换图标 */
export default function TitleBar({
  onToggleSidebar,
  notifications,
  onApproveNotification,
  onRejectNotification,
  onGoToNotification,
}: TitleBarProps) {
  return (
    <header className="titlebar">
      <div className="traffic-lights">
        <span className="tl close" />
        <span className="tl minimize" />
        <span className="tl maximize" />
      </div>
      <div className="titlebar-actions">
        <Notifications
          notifications={notifications}
          onApprove={onApproveNotification}
          onReject={onRejectNotification}
          onGoTo={onGoToNotification}
        />
        <button
          type="button"
          className="titlebar-icon"
          title="切换侧边栏"
          onClick={onToggleSidebar}
        >
          <SidebarIcon size={17} />
        </button>
      </div>
    </header>
  )
}
