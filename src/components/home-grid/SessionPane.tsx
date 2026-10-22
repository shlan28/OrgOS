/** 多视窗单个窗格：标题栏 + 中间区三分发（未分配 / 新对话 / 历史会话）+ 底部简化输入条 */

import { useState } from 'react'
import type { RunMessage } from '../../data/projects'
import { ChatIcon, PencilIcon } from '../icons'
import MiniInputBar from './MiniInputBar'
import SessionPicker from './SessionPicker'
import { paneHistoryOf, type PaneSession } from './paneSessions'

interface SessionPaneProps {
  /** 该格会话槽位（null = 未分配） */
  session: PaneSession
  /** 会话来源类型（分发渲染用） */
  index: number
  /** 聚焦态（当前会话/最近点击的窗格带绿描边） */
  focused: boolean
  /** 点击窗格任意区域切换聚焦 */
  onFocusPane: (index: number) => void
  /** 该格 × 关闭（置 null） */
  onClosePane: (index: number) => void
  /** 装入会话（选择器选中） */
  onAssign: (index: number, session: PaneSession) => void
  /** 已在其他窗格打开的历史会话 id（选择器置灰） */
  openedHistoryIds: string[]
}

/** 消息流单条渲染（缩放版：ADE 左灰泡 / 人右绿泡 / 系统居中灰字） */
function PaneMessage({ message, prev }: { message: RunMessage; prev?: RunMessage }) {
  if (message.role === '系统') {
    return <div className="pm-system">{message.text}</div>
  }
  const sender = message.sender ?? (message.role === '人'
    ? { name: 'shilu', initial: 'S', color: '#5b7ba6' }
    : { name: '研发工程师ADE', initial: 'A', color: '#7c66d8' })
  const sameSpeaker = prev?.role === message.role && prev?.sender?.name === message.sender?.name
  const mine = message.role === '人'
  return (
    <div className={`pm-row${mine ? ' mine' : ''}`}>
      {!sameSpeaker && <span className={`pm-name${mine ? ' mine' : ''}`}>{sender.name}</span>}
      <div className={`pm-content${mine ? ' mine' : ''}`}>
        {mine && <div className="pm-bubble mine"><span className="pm-text">{message.text}</span></div>}
        <span className="pm-avatar" style={{ background: sender.color ?? '#5b7ba6' }} title={sender.name}>
          {sender.initial}
        </span>
        {!mine && <div className="pm-bubble ade"><span className="pm-text">{message.text}</span></div>}
      </div>
    </div>
  )
}

export default function SessionPane({
  session, index, focused, onFocusPane, onClosePane, onAssign, openedHistoryIds,
}: SessionPaneProps) {
  /** 选择器浮层展开态（未分配窗格内） */
  const [pickerOpen, setPickerOpen] = useState(false)

  const history = session?.kind === 'history' ? paneHistoryOf(session.id) : undefined

  /* —— 标题栏内容 —— */
  const titleIcon = session === null
    ? null
    : session.kind === 'new' ? <PencilIcon size={13} /> : <ChatIcon size={13} />
  const titleText = session === null ? '未分配' : session.kind === 'new' ? '新对话' : history?.name ?? '会话'
  const badge = session?.kind === 'new'
    ? <span className="pane-badge info">当前会话</span>
    : history
      ? <span className={`pane-badge ${history.badge === 'Gate' ? 'info' : history.badge === '运行中' ? 'success' : 'neutral'}`}>
          {history.badgeText ?? history.badge}
        </span>
      : null

  return (
    <section
      className={`pane${focused ? ' focus' : ''}${session === null ? ' unassigned' : ''}`}
      onMouseDown={() => session !== null && onFocusPane(index)}
    >
      {/* 标题栏 */}
      <div className="pane-head">
        <span className="pane-title">
          {titleIcon}
          <span className="pane-title-text">{titleText}</span>
        </span>
        {badge}
        <button
          type="button"
          className="pane-x"
          title="关闭窗格"
          onClick={() => {
            if (session !== null) onClosePane(index)
            else setPickerOpen(false)
          }}
        >
          ×
        </button>
      </div>

      {/* 中间区：三分发 */}
      {session === null ? (
        <div className="pane-empty">
          <ChatIcon size={26} />
          <span className="pe-text">此窗格还没有会话</span>
          <span className="pe-hint">打开一个历史会话，或新开对话</span>
          <button type="button" className="pe-btn" onClick={() => setPickerOpen((v) => !v)}>
            ＋ 打开会话
          </button>
        </div>
      ) : session.kind === 'new' ? (
        <div className="pane-empty-stream">
          <span className="es-icon"><ChatIcon size={17} /></span>
          <span className="es-text">发送消息，开始新对话</span>
          <span className="es-hint">📁 loomweb · ⎇ dev</span>
        </div>
      ) : (
        <div className="pane-stream">
          {history?.messages.map((m, i) => (
            <PaneMessage key={m.id} message={m} prev={history.messages[i - 1]} />
          ))}
        </div>
      )}

      {/* 底部简化输入条（未分配窗格不渲染） */}
      {session !== null && (
        <MiniInputBar placeholder={session.kind === 'new' ? '消息…' : '插话…'} />
      )}

      {/* 会话选择浮层（未分配窗格） */}
      {session === null && pickerOpen && (
        <SessionPicker
          openedHistoryIds={openedHistoryIds}
          onNewChat={() => { setPickerOpen(false); onAssign(index, { kind: 'new' }) }}
          onPickHistory={(id) => { setPickerOpen(false); onAssign(index, { kind: 'history', id }) }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  )
}
