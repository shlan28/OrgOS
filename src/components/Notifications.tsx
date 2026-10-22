import { useEffect, useRef, useState } from 'react'
import type { Notification } from '../data/projects'
import { CURRENT_USER } from '../data/projects'
import { BellIcon } from './icons'
import './Notifications.css'

interface NotificationsProps {
  notifications: Notification[]
  /** 批准（确认型通知内快捷操作） */
  onApprove: (n: Notification) => void
  /** 拒绝 */
  onReject: (n: Notification) => void
  /** 跳转处理（点击通知项 / 输入型「去处理」） */
  onGoTo: (n: Notification) => void
}

/** 处理人文案：当前用户 → 「需要你确认/填写」，否则「需要 xx 确认/填写」 */
const approverText = (n: Notification): string => {
  const verb = n.type === '等待确认' ? '确认' : '填写'
  if (!n.approver) return ''
  return n.approver.name === CURRENT_USER.name ? `需要你${verb}` : `需要 ${n.approver.name} ${verb}`
}

/** 标题栏通知：铃铛 + 角标 + 下拉列表（点击整条跳转待人工处理；确认型可快捷批准/拒绝） */
export default function Notifications({ notifications, onApprove, onReject, onGoTo }: NotificationsProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  return (
    <div className="notifications" ref={rootRef}>
      <button
        type="button"
        className="titlebar-icon notifications-trigger"
        title="通知"
        onClick={() => setOpen((v) => !v)}
      >
        <BellIcon size={17} />
        {notifications.length > 0 && (
          <span className="notifications-badge">{notifications.length}</span>
        )}
      </button>

      {open && (
        <div className="notifications-menu">
          <div className="notifications-head">
            通知{notifications.length > 0 ? `（${notifications.length} 条待处理）` : ''}
          </div>
          {notifications.length === 0 && (
            <div className="notifications-empty">暂无待处理通知</div>
          )}
          {notifications.map((n) => (
            <div
              key={n.id}
              className="notification-item"
              role="button"
              tabIndex={0}
              title="跳转到待人工处理"
              onClick={() => { onGoTo(n); setOpen(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { onGoTo(n); setOpen(false) } }}
            >
              <div className="notification-title-row">
                <span className={`notification-type type-${n.type === '等待确认' ? 'confirm' : 'input'}`}>
                  {n.type}
                </span>
                <span className="notification-title">{n.title}</span>
              </div>
              <p className="notification-desc">{n.description}</p>
              <div className="notification-foot">
                <span className="notification-meta">
                  {n.approver && (
                    <span className="notification-approver">
                      <span
                        className="notification-approver-avatar"
                        style={{ background: n.approver.color ?? '#5b7ba6' }}
                        title={n.approver.name}
                      >
                        {n.approver.initial}
                      </span>
                      {approverText(n)}
                    </span>
                  )}
                  <span className="notification-time">{n.time}</span>
                </span>
                {n.type === '等待确认' ? (
                  <span className="notification-actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="text-btn" onClick={() => onReject(n)}>拒绝</button>
                    <button type="button" className="btn-primary notification-confirm-btn" onClick={() => onApprove(n)}>批准</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-btn notification-go"
                    onClick={(e) => { e.stopPropagation(); onGoTo(n); setOpen(false) }}
                  >
                    去处理 →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
