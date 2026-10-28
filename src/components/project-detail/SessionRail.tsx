import { useEffect, useRef, useState } from 'react'
import type { Project } from '../../data/projects'
import { sessionColorOf } from '../../data/projects'
import type { RuntimeSession } from '../../lib/runtimeApi'
import StatusBadge from '../StatusBadge'
import { FilterIcon } from '../icons'
import './SessionRail.css'

/** 会话时间 → MM-DD HH:mm */
const timeText = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

interface SessionRailProps {
  project: Project
  /** 项目会话（后端持久化，已按活动时间排序） */
  sessions: RuntimeSession[]
  activeSessionId: string | null
  /** 项目是否有可用 agent（无 agent 不能新建会话） */
  canCreate: boolean
  /** 新建中（防重复点击） */
  creating: boolean
  /** 列表加载中 */
  loading: boolean
  /** 会话操作错误 */
  error: string
  /** 当前登录用户（「我的」过滤） */
  currentUserName: string
  onSelect: (sessionId: string) => void
  onNewSession: () => void
  /** 打开编辑项目弹窗（原格 2 头部「编辑」迁入，改 icon） */
  onOpenEdit: () => void
}

/** 格 1：常驻会话列表（创建者 + 未读 + 执行状态 + 搜索/我的） */
export default function SessionRail({
  project, sessions, activeSessionId, canCreate, creating, loading, error,
  currentUserName, onSelect, onNewSession, onOpenEdit,
}: SessionRailProps) {
  const [query, setQuery] = useState('')
  const [mineOnly, setMineOnly] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const toolsRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭筛选菜单
  useEffect(() => {
    if (!filterOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (!toolsRef.current?.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [filterOpen])

  const keyword = query.trim().toLowerCase()
  const visible = sessions.filter((s) => {
    if (mineOnly && s.createdBy !== currentUserName) return false
    if (!keyword) return true
    return s.title.toLowerCase().includes(keyword) || (s.createdBy || '').toLowerCase().includes(keyword)
  })

  return (
    <div className="session-rail">
      <div className="rail-head">
        <span className="rail-title" title={`${project.name} · 会话`}>
          <button
            type="button"
            className="rail-proj-btn"
            title="编辑项目"
            onClick={onOpenEdit}
          >
            {project.name}
          </button>
          <span className="rail-sep">·</span>
          <span className="rail-word">会话</span>
        </span>
        <span className="rail-count">{sessions.length} 个</span>
        <button
          type="button"
          className="rail-icon-btn rail-new-btn"
          title={canCreate ? '新会话' : '请先在编辑项目中添加 agent'}
          aria-label="新会话"
          disabled={!canCreate || creating}
          onClick={onNewSession}
        >
          {creating ? '…' : '＋'}
        </button>
      </div>

      <div className="rail-tools" ref={toolsRef}>
        <input
          className="rail-search"
          value={query}
          placeholder="搜索会话 / 创建者"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className={`rail-filter-btn${mineOnly ? ' on' : ''}${filterOpen ? ' open' : ''}`}
          title="筛选会话"
          aria-haspopup="menu"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((v) => !v)}
        >
          <FilterIcon size={13} />
        </button>
        {filterOpen && (
          <div className="rail-filter-menu" role="menu">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!mineOnly}
              className={`rail-filter-item${!mineOnly ? ' active' : ''}`}
              onClick={() => { setMineOnly(false); setFilterOpen(false) }}
            >
              <span className="rail-filter-check">{!mineOnly ? '✓' : ''}</span>
              全部会话
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={mineOnly}
              className={`rail-filter-item${mineOnly ? ' active' : ''}`}
              onClick={() => { setMineOnly(true); setFilterOpen(false) }}
            >
              <span className="rail-filter-check">{mineOnly ? '✓' : ''}</span>
              我创建的
            </button>
          </div>
        )}
      </div>

      <div className="rail-body">
        {error && <p className="rail-error">{error}</p>}
        {loading && sessions.length === 0 && (
          <p className="rail-hint">加载中…</p>
        )}
        {!loading && sessions.length === 0 && (
          <p className="rail-hint">
            {canCreate ? '暂无会话，点右上角 ＋ 新建' : '项目还没有 agent，先在编辑项目里添加'}
          </p>
        )}
        {!loading && sessions.length > 0 && visible.length === 0 && (
          <p className="rail-hint">没有匹配的会话</p>
        )}
        {visible.map((s) => {
          const running = s.status === 'running'
          const queued = s.status === 'queued'
          return (
            <button
              key={s.id}
              type="button"
              className={`rail-sess${s.id === activeSessionId ? ' current' : ''}`}
              onClick={() => onSelect(s.id)}
              title={`${s.title} · ${s.createdBy || '未知'} 创建`}
            >
              <span className="rail-sava" style={{ background: sessionColorOf(s.id) }}>
                {s.title.slice(0, 2)}
              </span>
              <span className="rail-cols">
                <span className="rail-row1">
                  <span className="rail-name">{s.title}</span>
                  {(s.unreadCount ?? 0) > 0 && <span className="rail-unread">{s.unreadCount}</span>}
                </span>
                <span className="rail-row2">
                  {running && <StatusBadge tone="info">运行中</StatusBadge>}
                  {queued && <StatusBadge tone="warning">排队中</StatusBadge>}
                  <span className="rail-sub">
                    {s.createdBy || '未知'} · {timeText(s.lastMessageAt || s.updatedAt)}
                  </span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
