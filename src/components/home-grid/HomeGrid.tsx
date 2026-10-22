/** 首页多视窗容器：每屏 4 格占满 + 底部「滚动继续加载更多窗口」（多视窗 btn 由 App 渲染） */

import { useEffect, useRef, useState } from 'react'
import SessionPane from './SessionPane'
import type { PaneSession } from './paneSessions'
import './HomeGrid.css'

export type { PaneSession } from './paneSessions'

interface HomeGridProps {
  /** 窗格会话槽位（App 持有；长度可无限增长，2 的倍数） */
  panes: PaneSession[]
  /** 更新某格槽位（null = 关闭回未分配） */
  onChangePane: (index: number, session: PaneSession) => void
  /** 加载更多：尾部追加一排 2 个空窗格 */
  onGrowBottom: () => void
}

/** 新增节流（自动触发防惯性连发；点击同走此节流） */
const GROW_THROTTLE = 600
/** load-more 进入视口提前量（0px：恰好露出才触发，避免初始误触） */
const LOAD_MORE_ROOT_MARGIN = '0px'

/**
 * 多视窗模式主区：2×2 占满视口（行高 = 视口半高），
 * 网格内容底部常驻 load-more 条：滚到底自动新增一排，点击立即新增，无限增加。
 */
export default function HomeGrid({ panes, onChangePane, onGrowBottom }: HomeGridProps) {
  /** 聚焦窗格下标（初始 = 0 当前会话；点击窗格切换） */
  const [focusedIndex, setFocusedIndex] = useState(0)

  const loadMoreRef = useRef<HTMLButtonElement>(null)
  /** 节流时间戳（0 = 空闲） */
  const lastGrowAt = useRef(0)

  const rowCount = Math.ceil(panes.length / 2)

  /** 触发新增（节流；自动与点击共用） */
  const tryGrow = () => {
    const now = Date.now()
    if (now - lastGrowAt.current < GROW_THROTTLE) return
    lastGrowAt.current = now
    onGrowBottom()
  }

  /* —— load-more 进入视口 → 自动新增一排 —— */
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) tryGrow()
      },
      { rootMargin: LOAD_MORE_ROOT_MARGIN },
    )
    io.observe(el)
    return () => io.disconnect()
    // 依赖 panes：新增后条下移离开视口，再滚回视口重新触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes.length, onGrowBottom])

  const openedHistoryIds = panes
    .filter((p): p is { kind: 'history'; id: string } => p?.kind === 'history')
    .map((p) => p.id)

  return (
    <div className="home-grid">
      {/* 滚动容器：container-type 使行高 cqh 以视口为基准（每屏 4 格占满） */}
      <div
        className="home-grid-scroll"
        style={{ '--hg-rows': rowCount } as React.CSSProperties}
      >
        <div className="home-grid-quad">
          {panes.map((session, index) => (
            <SessionPane
              key={index}
              index={index}
              session={session}
              focused={focusedIndex === index && session !== null}
              onFocusPane={setFocusedIndex}
              onClosePane={(i) => onChangePane(i, null)}
              onAssign={onChangePane}
              openedHistoryIds={openedHistoryIds}
            />
          ))}
        </div>

        {/* 常驻 load-more 条：滚到底自动触发 / 点击立即新增 */}
        <button type="button" className="load-more" ref={loadMoreRef} onClick={tryGrow}>
          <span className="load-more-caret">⌄</span>
          滚动继续加载更多窗口
        </button>
      </div>
    </div>
  )
}
