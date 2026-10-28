import type { Project } from '../../data/projects'
import { memberColorOf } from '../../data/projects'
import './MembersDrawer.css'

interface MembersDrawerProps {
  project: Project
  /** 当前登录用户名（成员「我」标识） */
  currentUserName: string
  onClose: () => void
}

/**
 * 会话成员抽屉（格 2 覆盖式，纯只读）：
 * 成员/接入 ADE 列表 + 在线状态——添加与编辑入口在「编辑项目」弹窗（点格 1 项目名打开）。
 */
export default function MembersDrawer({ project, currentUserName, onClose }: MembersDrawerProps) {
  const members = project.members
  const agents = project.agents

  return (
    <>
      <div className="chat-drawer-mask" onClick={onClose} />
      <div className="chat-drawer" role="dialog" aria-label="项目成员">
        <div className="chat-drawer-head">
          <span className="chat-drawer-title">项目成员</span>
          <span className="chat-drawer-count">
            {members.length} 人 · {agents.length} agent
          </span>
          <button type="button" className="chat-drawer-close" aria-label="关闭" onClick={onClose}>×</button>
        </div>

        <div className="chat-drawer-body">
          {members.map((m) => {
            const isMe = m.name === currentUserName
            return (
              <div key={m.id} className="member-drawer-item">
                <div className="member-drawer-row">
                  <span className="member-drawer-avatar" style={{ background: memberColorOf(m.name) }}>
                    {m.initial}
                  </span>
                  <span className="member-drawer-text">
                    <span className="member-drawer-name">
                      {m.name}
                      {isMe && <span className="member-drawer-me">我</span>}
                    </span>
                    <span className="member-drawer-sub">
                      {[m.role, m.permission].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </div>
              </div>
            )
          })}

          {/* 项目 agent（全部可用，不按会话归属） */}
          {agents.length > 0 && (
            <>
              <div className="member-drawer-group">项目 agent（全部可用）</div>
              {agents.map((a) => (
                <div key={a.id} className="member-drawer-item">
                  <div className="member-drawer-row">
                    <span className="member-drawer-avatar member-drawer-ade" title={a.role}>
                      {a.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="member-drawer-text">
                      <span className="member-drawer-name">
                        {a.name}
                        <span className="member-drawer-role">{a.role}</span>
                      </span>
                      <span className="member-drawer-sub">
                        {a.status === '工作中' ? `工作中 · ${a.currentTask}` : '空闲'}
                      </span>
                    </span>
                    <span className="member-drawer-right">
                      <span className={`member-drawer-dot${a.status === '工作中' ? ' online' : ''}`} title={a.status} />
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}

          <p className="member-drawer-tip">成员的添加与编辑在「编辑项目」弹窗中（点击左侧项目名打开）</p>
        </div>
      </div>
    </>
  )
}
