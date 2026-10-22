import { useState } from 'react'
import {
  getEfficiency, summarize, sliceDaily, triggerBreakdown, jobRows,
} from '../../data/efficiency'
import { Section } from '../SettingsRow'
import SegmentedControl from '../SegmentedControl'
import StatusBadge, { type BadgeTone } from '../StatusBadge'
import { ChartIcon } from '../icons'
import TrendChart from './TrendChart'
import HBar from './HBarChart'
import './EfficiencyPanel.css'

const RANGES = [
  { key: '7', label: '近 7 天' },
  { key: '14', label: '近 14 天' },
  { key: '30', label: '近 30 天' },
]

const lastTone: Record<string, BadgeTone> = {
  成功: 'success',
  失败: 'danger',
  运行中: 'info',
  等待确认: 'warning',
  等待输入: 'warning',
  已取消: 'neutral',
  未运行: 'neutral',
}

/** 成功率数值语义色 */
function rateTone(rate: number): string {
  if (rate >= 95) return 'var(--status-success)'
  if (rate >= 90) return 'var(--status-warning)'
  return 'var(--status-danger)'
}

interface EfficiencyPanelProps {
  projectId: string
}

/** 自动化统计面板：KPI / 执行趋势 / 任务规模 / 效率收益 / 任务明细 */
export default function EfficiencyPanel({ projectId }: EfficiencyPanelProps) {
  const [range, setRange] = useState('14')
  const data = getEfficiency(projectId)

  // 空状态：项目无自动化任务数据
  if (!data) {
    return (
      <div className="efficiency-empty">
        <div className="efficiency-empty-icon"><ChartIcon size={40} /></div>
        <div className="efficiency-empty-title">暂无自动化任务数据</div>
        <div className="efficiency-empty-desc">创建自动化任务后，这里将展示能效统计</div>
      </div>
    )
  }

  const rangeDays = Number(range)
  const kpi = summarize(data, rangeDays)
  const daily = sliceDaily(data, rangeDays)
  const triggers = triggerBreakdown(data)
  const rows = jobRows(data, rangeDays)
  const maxTriggerRuns = Math.max(...triggers.map((t) => t.runs), 1)
  // 人工预估单次耗时（按任务加权平均）
  const manualMinutes = data.jobs.reduce((s, j) => s + j.manualMinutes * j.runs, 0)
    / Math.max(1, data.jobs.reduce((s, j) => s + j.runs, 0))
  const speedup = kpi.avgMinutes > 0 ? Math.round((manualMinutes / kpi.avgMinutes) * 10) / 10 : 0

  return (
    <div className="efficiency-panel">
      {/* 顶部：说明 + 时间范围切换 */}
      <div className="efficiency-toolbar">
        <span className="efficiency-hint">自动化任务运行数据统计</span>
        <SegmentedControl
          items={RANGES.map((r) => ({ key: r.key, label: r.label, icon: null }))}
          value={range}
          onChange={setRange}
        />
      </div>

      {/* ① 核心指标 */}
      <div className="efficiency-kpis">
        <div className="kpi-card">
          <div className="kpi-label">自动化任务</div>
          <div className="kpi-value">{kpi.jobCount}</div>
          <div className="kpi-sub">启用 {kpi.enabledCount} · 停用 {kpi.disabledCount}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">执行次数</div>
          <div className="kpi-value">{kpi.runs}</div>
          <div className="kpi-sub">日均 {kpi.runsPerDay} 次</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">成功率</div>
          <div className="kpi-value" style={{ color: rateTone(kpi.successRate) }}>{kpi.successRate}%</div>
          <div className="kpi-sub">失败 {kpi.failCount} 次</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">平均耗时</div>
          <div className="kpi-value">{kpi.avgMinutes} 分钟</div>
          <div className="kpi-sub">P90 {kpi.p90Minutes} 分钟</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">节省工时</div>
          <div className="kpi-value">{kpi.savedHours} 小时</div>
          <div className="kpi-sub">≈ {kpi.savedDays} 人天</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">自动化替代率</div>
          <div className="kpi-value">{kpi.replaceRate}%</div>
          <div className="kpi-sub">自动 {kpi.runs} / 人工 {kpi.manualOps} 次</div>
        </div>
      </div>

      {/* ② 执行趋势 */}
      <Section label="执行趋势">
        <div className="efficiency-card-body">
          <TrendChart data={daily} />
        </div>
      </Section>

      {/* ③ 任务规模：触发类型分布 */}
      <Section label="任务规模 · 触发类型分布">
        <div className="efficiency-card-body">
          {triggers.map((t) => (
            <div className="trigger-row" key={t.type}>
              <div className="trigger-name">
                {t.type}
                <span className="trigger-jobs">{t.jobs} 个任务</span>
              </div>
              <HBar value={(t.runs / maxTriggerRuns) * 100} tone="success" height={8} />
              <div className="trigger-value">
                {t.runs} 次 · {t.share}%
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ④ 效率收益 */}
      <Section label="效率收益">
        <div className="efficiency-card-body">
          <div className="gain-block">
            <div className="gain-title">单次耗时对比（同类工作）</div>
            <div className="compare-row">
              <span className="compare-label">人工预估</span>
              <HBar value={100} tone="neutral" height={10} />
              <span className="compare-value">{Math.round(manualMinutes)} 分钟</span>
            </div>
            <div className="compare-row">
              <span className="compare-label">自动化实际</span>
              <HBar value={(kpi.avgMinutes / manualMinutes) * 100} tone="success" height={10} />
              <span className="compare-value">{kpi.avgMinutes} 分钟</span>
            </div>
            <div className="gain-note">效率提升约 {speedup} 倍</div>
          </div>
          <div className="gain-divider" />
          <div className="gain-block">
            <div className="gain-title">自动化替代率</div>
            <div className="replace-row">
              <HBar value={kpi.replaceRate} tone="success" height={10} />
              <span className="replace-value">{kpi.replaceRate}%</span>
            </div>
            <div className="gain-note">自动执行 {kpi.runs} 次 / 人工操作 {kpi.manualOps} 次</div>
          </div>
          <div className="gain-divider" />
          <div className="gain-block">
            <div className="gain-title">节省工时</div>
            <div className="gain-note">
              本期累计节省 <b>{kpi.savedHours} 小时</b> ≈ <b>{kpi.savedDays} 人天</b>
            </div>
          </div>
        </div>
      </Section>

      {/* ⑤ 任务明细 */}
      <Section label={`任务明细（${rows.length}）`}>
        <div className="efficiency-table-wrap">
          <table className="efficiency-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>执行次数</th>
                <th>成功率</th>
                <th>平均耗时</th>
                <th className="col-p90">P90</th>
                <th>节省工时</th>
                <th>最近运行</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.jobId}>
                  <td>
                    <div className="job-cell">
                      <span className={`job-name${r.enabled ? '' : ' off'}`}>{r.name}</span>
                      <span className="job-trigger">{r.triggerType}</span>
                    </div>
                  </td>
                  <td className="num">{r.scaledRuns}</td>
                  <td>
                    <div className="rate-cell">
                      <span className="rate-num" style={{ color: rateTone(r.successRate) }}>{r.successRate}%</span>
                      <HBar value={r.successRate} tone={r.successRate >= 95 ? 'success' : r.successRate >= 90 ? 'warning' : 'danger'} height={4} className="rate-mini" />
                    </div>
                  </td>
                  <td className="num">{r.avgMinutes} 分钟</td>
                  <td className="num col-p90">{r.p90Minutes} 分钟</td>
                  <td className="num strong">{r.savedHours} 小时</td>
                  <td>
                    <div className="last-cell">
                      <StatusBadge tone={lastTone[r.lastStatus] ?? 'neutral'}>{r.lastStatus}</StatusBadge>
                      <span className="last-time">{r.lastRunAt}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
