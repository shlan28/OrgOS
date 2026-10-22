import { useState } from 'react'
import type { DailyStat } from '../../data/efficiency'
import './TrendChart.css'

interface TrendChartProps {
  /** 日序列（旧 → 新，已按时间范围截取） */
  data: DailyStat[]
}

const W = 680
const H = 220
const PAD = { top: 14, right: 40, bottom: 24, left: 34 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

/** 成功率折线纵轴范围（%） */
const RATE_MIN = 80
const RATE_MAX = 100

/** 执行次数柱状图（左轴）+ 成功率折线（右轴），hover 竖参考线 + 浮层 */
export default function TrendChart({ data }: TrendChartProps) {
  const [hover, setHover] = useState<number | null>(null)

  const maxRuns = Math.max(10, ...data.map((d) => d.runs))
  const runsStep = Math.ceil(maxRuns / 4 / 5) * 5 || 5
  const runsTop = runsStep * 4

  const bandW = PLOT_W / data.length
  const barW = Math.min(18, bandW * 0.55)

  const x = (i: number) => PAD.left + bandW * i + bandW / 2
  const yRuns = (v: number) => PAD.top + PLOT_H * (1 - v / runsTop)
  const yRate = (v: number) => PAD.top + PLOT_H * (1 - (v - RATE_MIN) / (RATE_MAX - RATE_MIN))

  const ratePoints = data.map((d, i) => {
    const rate = d.runs > 0 ? (d.success / d.runs) * 100 : 100
    return { x: x(i), y: yRate(Math.min(RATE_MAX, Math.max(RATE_MIN, rate))) }
  })
  const ratePath = ratePoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  const hoverItem = hover !== null ? data[hover] : null
  const hoverRate = hoverItem && hoverItem.runs > 0 ? Math.round((hoverItem.success / hoverItem.runs) * 1000) / 10 : 100

  return (
    <div className="trend-chart">
      <div className="trend-legend">
        <span className="trend-legend-item"><i className="dot dot-runs" />执行次数</span>
        <span className="trend-legend-item"><i className="dot dot-rate" />成功率</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="trend-svg"
        role="img"
        aria-label="执行次数与成功率趋势"
        onMouseLeave={() => setHover(null)}
      >
        {/* 横向网格线 + 左右轴刻度 */}
        {[0, 1, 2, 3, 4].map((k) => {
          const gy = PAD.top + (PLOT_H / 4) * k
          return (
            <g key={k}>
              <line x1={PAD.left} y1={gy} x2={W - PAD.right} y2={gy} className="grid-line" />
              <text x={PAD.left - 6} y={gy + 3.5} textAnchor="end" className="axis-text">{runsTop - runsStep * k}</text>
              <text x={W - PAD.right + 6} y={gy + 3.5} className="axis-text">{RATE_MAX - ((RATE_MAX - RATE_MIN) / 4) * k}%</text>
            </g>
          )
        })}

        {/* 执行次数柱 */}
        {data.map((d, i) => {
          const h = PLOT_H * (d.runs / runsTop)
          return (
            <rect
              key={`bar-${d.date}`}
              x={x(i) - barW / 2}
              y={yRuns(d.runs)}
              width={barW}
              height={Math.max(0, h)}
              rx={2}
              className="trend-bar"
            />
          )
        })}

        {/* 成功率折线 */}
        <path d={ratePath} className="rate-line" />
        {ratePoints.map((p, i) => (
          <circle key={`pt-${data[i].date}`} cx={p.x} cy={p.y} r={2.4} className="rate-dot" />
        ))}

        {/* X 轴日期（首/中/尾 + 每 5 天） */}
        {data.map((d, i) => {
          const show = i === 0 || i === data.length - 1 || (i + 1) % 5 === 0
          if (!show) return null
          return (
            <text key={`x-${d.date}`} x={x(i)} y={H - 8} textAnchor="middle" className="axis-text">{d.date}</text>
          )
        })}

        {/* hover 竖参考线 */}
        {hover !== null && (
          <line x1={x(hover)} y1={PAD.top} x2={x(hover)} y2={PAD.top + PLOT_H} className="hover-line" />
        )}

        {/* hover 捕获区（每根柱一个透明矩形） */}
        {data.map((d, i) => (
          <rect
            key={`hit-${d.date}`}
            x={PAD.left + bandW * i}
            y={PAD.top}
            width={bandW}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {/* hover 浮层 */}
      {hoverItem && (
        <div
          className="trend-tooltip"
          style={{ left: `${((x(hover!) / W) * 100).toFixed(2)}%` }}
        >
          <div className="trend-tooltip-date">{hoverItem.date}</div>
          <div className="trend-tooltip-row"><span>执行</span><b>{hoverItem.runs} 次</b></div>
          <div className="trend-tooltip-row"><span>成功</span><b>{hoverItem.success} 次</b></div>
          <div className="trend-tooltip-row"><span>失败</span><b>{hoverItem.runs - hoverItem.success} 次</b></div>
          <div className="trend-tooltip-row"><span>成功率</span><b>{hoverRate}%</b></div>
        </div>
      )}
    </div>
  )
}
