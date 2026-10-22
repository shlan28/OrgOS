import './HBarChart.css'

interface HBarProps {
  /** 条形长度占比（0–100） */
  value: number
  /** 语义色（success / info / neutral / warning / danger，对应 --status-* 变量） */
  tone?: 'success' | 'info' | 'neutral' | 'warning' | 'danger'
  /** 条形高度（px，默认 8） */
  height?: number
  /** 轨道背景（默认浅灰） */
  track?: boolean
  className?: string
}

/** 横向条形（div + 百分比宽度，触发分布 / 耗时对比 / 迷你成功率条复用） */
export default function HBar({ value, tone = 'success', height = 8, track = true, className }: HBarProps) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div
      className={`hbar${track ? ' with-track' : ''}${className ? ` ${className}` : ''}`}
      style={{ height }}
      role="img"
      aria-label={`${pct}%`}
    >
      <div className={`hbar-fill tone-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  )
}
