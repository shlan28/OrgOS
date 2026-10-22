import './StatusBadge.css'

export type BadgeTone = 'success' | 'info' | 'danger' | 'warning' | 'neutral'

interface StatusBadgeProps {
  tone: BadgeTone
  children: string
}

/** 通用状态徽标：浅色底 + 深色文字 */
export default function StatusBadge({ tone, children }: StatusBadgeProps) {
  return <span className={`status-badge tone-${tone}`}>{children}</span>
}
