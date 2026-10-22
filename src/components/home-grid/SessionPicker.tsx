/** 空窗格「＋ 打开会话」选择浮层：搜索 + 空白新对话 + 历史会话列表 */

import { useEffect, useRef, useState } from 'react'
import { PANE_HISTORY_SESSIONS, type PaneBadge } from './paneSessions'
import { ChatIcon, PencilIcon, SearchIcon } from '../icons'

interface SessionPickerProps {
  /** 已在其他窗格打开的历史会话 id（列表置灰不可选） */
  openedHistoryIds: string[]
  /** 选中「空白新对话」 */
  onNewChat: () => void
  /** 选中某个历史会话 */
  onPickHistory: (id: string) => void
  /** 关闭浮层（点击外部 / Esc） */
  onClose: () => void
}

const badgeClass: Record<PaneBadge, string> = {
  Gate: 'picker-badge info',
  运行中: 'picker-badge success',
  手动: 'picker-badge neutral',
}

export default function SessionPicker({
  openedHistoryIds, onNewChat, onPickHistory, onClose,
}: SessionPickerProps) {
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // 点击外部 / Esc 关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const keyword = query.trim()
  const filtered = PANE_HISTORY_SESSIONS.filter((s) => !keyword || s.name.includes(keyword))

  return (
    <div className="session-picker" ref={rootRef}>
      <div className="picker-search">
        <SearchIcon size={12} />
        <input
          autoFocus
          placeholder="搜索会话…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="picker-group-label">新对话</div>
      <button type="button" className="picker-item" onClick={onNewChat}>
        <PencilIcon size={13} />
        <span className="picker-name">空白新对话</span>
      </button>

      <div className="picker-group-label">历史会话 · loomweb</div>
      <div className="picker-list">
        {filtered.length === 0 && <div className="picker-empty">没有匹配的会话</div>}
        {filtered.map((s) => {
          const opened = openedHistoryIds.includes(s.id)
          return (
            <button
              type="button"
              key={s.id}
              className={`picker-item${opened ? ' disabled' : ''}`}
              disabled={opened}
              title={opened ? '已在其他窗格打开' : undefined}
              onClick={() => onPickHistory(s.id)}
            >
              <ChatIcon size={13} />
              <span className="picker-name">{s.name}</span>
              <span className={badgeClass[s.badge]}>{s.badge}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
