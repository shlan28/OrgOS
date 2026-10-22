import { useEffect, useRef, type ReactNode } from 'react'
import './ClosableTabs.css'

export interface TabItem {
  key: string
  label: string
  icon: (size: number) => ReactNode
  /** 徽标计数（如 automation 待处理数；undefined = 不显示） */
  count?: number
  /** 未实现提示（如「敬请期待」） */
  soon?: string
}

interface ClosableTabsProps {
  /** 全量 tab 元数据（含已关闭项，供 + 菜单渲染） */
  items: TabItem[]
  /** 打开中的 tab key（按打开顺序渲染） */
  openKeys: string[]
  activeKey: string
  /** 已关闭的 tab key（按关闭时间倒序，+ 菜单数据源） */
  closedKeys: string[]
  onSelect: (key: string) => void
  onClose: (key: string) => void
  onReopen: (key: string) => void
}

/**
 * 右栏可关闭横向 tab 条：
 * - 选中项黑字加粗 + 底部 2px 下划线；溢出横向滚动；
 * - 每个 tab 带 ×（仅剩 1 个打开项时隐藏，避免全空）；
 * - 末尾 ＋ 打开「已关闭的 tab」菜单，点条目重新打开。
 */
export default function ClosableTabs({
  items, openKeys, activeKey, closedKeys, onSelect, onClose, onReopen,
}: ClosableTabsProps) {
  const tabsRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const plusRef = useRef<HTMLButtonElement>(null)

  // 选中项滚入可视区（tab 多时横向滚动定位）
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>('.config-tab.active')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeKey, openKeys.join(',')])

  // 点击菜单外部 / Esc 关闭 + 菜单
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)
        && !plusRef.current?.contains(e.target as Node)) {
        menuRef.current.classList.remove('show')
      }
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') menuRef.current?.classList.remove('show')
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [])

  const byKey = (key: string) => items.find((t) => t.key === key)!
  const closable = openKeys.length > 1

  const renderTab = (key: string) => {
    const item = byKey(key)
    const active = key === activeKey
    return (
      <button
        key={key}
        type="button"
        className={`config-tab${active ? ' active' : ''}`}
        onClick={() => onSelect(key)}
        title={item.label}
      >
        {item.icon(14)}
        <span className="config-tab-label">{item.label}</span>
        {item.soon && <span className="config-tab-soon">{item.soon}</span>}
        {item.count !== undefined && item.count > 0 && (
          <span className={`config-tab-count${item.count > 0 && key === 'automation' ? ' hot' : ''}`}>{item.count}</span>
        )}
        {/* 仅选中 tab 显示 ×（hover/激活即当前项可关，非选中保持简洁） */}
        {active && closable && (
          <span
            className="config-tab-x"
            role="button"
            aria-label={`关闭 ${item.label}`}
            title={`关闭 ${item.label}`}
            onClick={(e) => {
              e.stopPropagation()
              onClose(key)
            }}
          >
            ×
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="config-tabs-wrap">
      <div className="config-tabs" ref={tabsRef}>
        {openKeys.map(renderTab)}
      </div>
      {/* ＋ 固定最右侧（不随 tab 溢出滚动） */}
      <button
        type="button"
        className="tab-plus"
        title="重新打开已关闭的 tab"
        ref={plusRef}
        onClick={(e) => {
          e.stopPropagation()
          menuRef.current?.classList.toggle('show')
        }}
      >
        ＋
      </button>

      {/* ＋ 菜单：已关闭的 tab */}
      <div className="tab-plus-menu" ref={menuRef}>
        <div className="tpm-title">已关闭的 tab · 点击重新打开</div>
        {closedKeys.length === 0 ? (
          <div className="tpm-empty">暂无已关闭的 tab</div>
        ) : (
          closedKeys.map((key) => {
            const item = byKey(key)
            return (
              <button
                key={key}
                type="button"
                className="tpm-item"
                onClick={() => {
                  onReopen(key)
                  menuRef.current?.classList.remove('show')
                }}
              >
                {item.icon(13)}
                <span>{item.label}</span>
                <span className="tpm-hint">已关闭</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
