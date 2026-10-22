/** 自动化统计 Mock 数据与聚合函数（独立于 AutoJob，纯静态确定性生成） */

/* —— 类型定义 —— */

/** 日序列（固定 30 天，面板按时间范围截取） */
export interface DailyStat {
  /** 'MM-DD' */
  date: string
  /** 执行次数 */
  runs: number
  /** 成功次数 */
  success: number
  /** 当日平均耗时（分钟） */
  avgMinutes: number
}

/** 任务级统计（30 天口径） */
export interface JobStat {
  jobId: string
  name: string
  triggerType: '定时' | '事件' | '手动'
  enabled: boolean
  /** 区间内执行次数 */
  runs: number
  /** 成功率 % */
  successRate: number
  /** 平均耗时（分钟） */
  avgMinutes: number
  /** P90 耗时（分钟） */
  p90Minutes: number
  /** 人工预估单次耗时（分钟） */
  manualMinutes: number
  lastStatus: '成功' | '失败' | '运行中' | '等待确认' | '等待输入' | '已取消' | '未运行'
  lastRunAt: string
}

export interface EfficiencyData {
  /** 近 30 天日序列（旧 → 新） */
  daily: DailyStat[]
  /** 任务级统计 */
  jobs: JobStat[]
  /** 同期人工操作次数（替代率分母的一部分） */
  manualOps: number
}

/* —— 日序列生成（确定性，无随机数） —— */

/** 以 2026-08-28 为"今天"，往前推 30 天 */
const TODAY = new Date(2026, 7, 28)

function formatMD(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 生成 30 天日序列：
 * - 工作日基线高（26–34 次），周末衰减（8–14 次）
 * - 固定相位波动 (i * 7) % 5，保证确定性
 * - 失败率 3–5%，个别日尖刺（i % 11 === 3 时失败 +6）
 */
function buildDaily(): DailyStat[] {
  const out: DailyStat[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - i)
    const dow = d.getDay()
    const weekend = dow === 0 || dow === 6
    const wave = (i * 7) % 5
    const runs = weekend ? 8 + wave : 26 + wave
    let fails = Math.max(0, Math.round(runs * (0.03 + (i % 3) * 0.007)))
    if (i % 11 === 3) fails += 6
    const success = Math.max(0, runs - fails)
    const avgMinutes = 3.6 + ((i * 3) % 7) * 0.18
    out.push({ date: formatMD(d), runs, success, avgMinutes: Math.round(avgMinutes * 10) / 10 })
  }
  return out
}

/* —— 任务级 Mock 数据 —— */

const loomwebJobs: JobStat[] = [
  {
    jobId: 'j1', name: '每日构建', triggerType: '定时', enabled: true,
    runs: 30, successRate: 96.7, avgMinutes: 3.1, p90Minutes: 5.2, manualMinutes: 25,
    lastStatus: '运行中', lastRunAt: '08-28 08:00',
  },
  {
    jobId: 'j2', name: 'MR 静态检查', triggerType: '事件', enabled: true,
    runs: 118, successRate: 98.3, avgMinutes: 2.2, p90Minutes: 3.8, manualMinutes: 15,
    lastStatus: '成功', lastRunAt: '08-27 16:42',
  },
  {
    jobId: 'j3', name: '周报生成', triggerType: '定时', enabled: true,
    runs: 4, successRate: 75, avgMinutes: 2.6, p90Minutes: 3.1, manualMinutes: 90,
    lastStatus: '等待确认', lastRunAt: '08-28 14:55',
  },
  {
    jobId: 'j4', name: '发布准备', triggerType: '手动', enabled: true,
    runs: 6, successRate: 83.3, avgMinutes: 6.8, p90Minutes: 9.4, manualMinutes: 60,
    lastStatus: '等待输入', lastRunAt: '08-28 14:48',
  },
  {
    jobId: 'j5', name: '依赖漏洞扫描', triggerType: '定时', enabled: true,
    runs: 30, successRate: 93.3, avgMinutes: 4.5, p90Minutes: 7.6, manualMinutes: 35,
    lastStatus: '成功', lastRunAt: '08-28 06:30',
  },
  {
    jobId: 'j6', name: '接口回归', triggerType: '事件', enabled: true,
    runs: 86, successRate: 95.3, avgMinutes: 8.4, p90Minutes: 12.7, manualMinutes: 120,
    lastStatus: '成功', lastRunAt: '08-27 19:20',
  },
  {
    jobId: 'j7', name: '环境巡检', triggerType: '定时', enabled: true,
    runs: 60, successRate: 91.7, avgMinutes: 1.8, p90Minutes: 2.9, manualMinutes: 20,
    lastStatus: '成功', lastRunAt: '08-28 07:00',
  },
  {
    jobId: 'j8', name: '文档同步', triggerType: '事件', enabled: false,
    runs: 22, successRate: 86.4, avgMinutes: 3.3, p90Minutes: 5.5, manualMinutes: 30,
    lastStatus: '未运行', lastRunAt: '08-19 11:05',
  },
]

const yigouJobs: JobStat[] = [
  {
    jobId: 'j1', name: '夜间打包', triggerType: '定时', enabled: true,
    runs: 30, successRate: 100, avgMinutes: 5.2, p90Minutes: 6.8, manualMinutes: 45,
    lastStatus: '成功', lastRunAt: '08-28 02:00',
  },
  {
    jobId: 'j2', name: '崩溃日志聚合', triggerType: '定时', enabled: false,
    runs: 14, successRate: 92.9, avgMinutes: 0.7, p90Minutes: 1.2, manualMinutes: 25,
    lastStatus: '未运行', lastRunAt: '08-24 10:00',
  },
]

/** 各项目能效数据（data-pipeline 无任务，不注册 → 空状态） */
const EFFICIENCY: Record<string, EfficiencyData> = {
  loomweb: { daily: buildDaily(), jobs: loomwebJobs, manualOps: 116 },
  'yigou-app': { daily: buildDaily().map((d) => ({ ...d, runs: Math.round(d.runs * 0.18), success: Math.round(d.success * 0.18), avgMinutes: Math.round((d.avgMinutes + 1.4) * 10) / 10 })), jobs: yigouJobs, manualOps: 38 },
}

/** 按项目取能效数据（无数据返回 null → 空状态） */
export function getEfficiency(projectId: string): EfficiencyData | null {
  return EFFICIENCY[projectId] ?? null
}

/* —— 聚合函数（面板按 range 现算，保证联动一致） —— */

/** KPI 汇总 */
export interface Kpis {
  /** 任务总数 */
  jobCount: number
  enabledCount: number
  disabledCount: number
  /** 区间内执行次数 */
  runs: number
  /** 日均执行次数 */
  runsPerDay: number
  /** 成功率 % */
  successRate: number
  /** 失败次数 */
  failCount: number
  /** 平均耗时（分钟） */
  avgMinutes: number
  /** P90 耗时（分钟，按任务 P90 加权近似） */
  p90Minutes: number
  /** 节省工时（小时） */
  savedHours: number
  /** 折算人天（8h/人天） */
  savedDays: number
  /** 自动化替代率 % */
  replaceRate: number
  /** 人工操作次数（同期） */
  manualOps: number
}

/** 按时间范围截取日序列（旧 → 新） */
export function sliceDaily(data: EfficiencyData, rangeDays: number): DailyStat[] {
  return data.daily.slice(-rangeDays)
}

/** 汇总 KPI（rangeDays = 7 / 14 / 30） */
export function summarize(data: EfficiencyData, rangeDays: number): Kpis {
  const daily = sliceDaily(data, rangeDays)
  const runs = daily.reduce((s, d) => s + d.runs, 0)
  const success = daily.reduce((s, d) => s + d.success, 0)
  const failCount = runs - success
  const avgMinutes = runs > 0 ? daily.reduce((s, d) => s + d.avgMinutes * d.runs, 0) / runs : 0

  // 任务级：runs 为 30 天口径，按 rangeDays 等比折算
  const scale = rangeDays / 30
  const jobRuns = data.jobs.reduce((s, j) => s + j.runs * scale, 0)
  const p90Minutes = jobRuns > 0
    ? data.jobs.reduce((s, j) => s + j.p90Minutes * j.runs * scale, 0) / jobRuns
    : 0
  const savedHours = data.jobs.reduce((s, j) => s + (j.manualMinutes - j.avgMinutes) * j.runs * scale, 0) / 60

  // 替代率：自动执行 / (自动执行 + 人工操作)，人工操作同比例折算
  const manualOps = Math.round(data.manualOps * scale)
  const replaceRate = runs + manualOps > 0 ? (runs / (runs + manualOps)) * 100 : 0

  return {
    jobCount: data.jobs.length,
    enabledCount: data.jobs.filter((j) => j.enabled).length,
    disabledCount: data.jobs.filter((j) => !j.enabled).length,
    runs,
    runsPerDay: Math.round((runs / rangeDays) * 10) / 10,
    successRate: runs > 0 ? Math.round((success / runs) * 1000) / 10 : 0,
    failCount,
    avgMinutes: Math.round(avgMinutes * 10) / 10,
    p90Minutes: Math.round(p90Minutes * 10) / 10,
    savedHours: Math.round(savedHours * 10) / 10,
    savedDays: Math.round((savedHours / 8) * 10) / 10,
    replaceRate: Math.round(replaceRate),
    manualOps,
  }
}

/** 触发类型分布行 */
export interface TriggerRow {
  type: '定时' | '事件' | '手动'
  /** 该类型任务数 */
  jobs: number
  /** 该类型执行次数（30 天口径） */
  runs: number
  /** 执行次数占比 % */
  share: number
}

/** 触发类型分布（按执行次数占比） */
export function triggerBreakdown(data: EfficiencyData): TriggerRow[] {
  const types: TriggerRow['type'][] = ['定时', '事件', '手动']
  const total = data.jobs.reduce((s, j) => s + j.runs, 0)
  return types.map((type) => {
    const jobs = data.jobs.filter((j) => j.triggerType === type)
    const runs = jobs.reduce((s, j) => s + j.runs, 0)
    return { type, jobs: jobs.length, runs, share: total > 0 ? Math.round((runs / total) * 100) : 0 }
  })
}

/** 明细行（JobStat + 区间折算字段，按节省工时降序） */
export interface JobRow extends JobStat {
  /** 区间内执行次数（折算） */
  scaledRuns: number
  /** 区间内节省工时（小时） */
  savedHours: number
}

/** 任务明细行（按节省工时降序） */
export function jobRows(data: EfficiencyData, rangeDays: number): JobRow[] {
  const scale = rangeDays / 30
  return data.jobs
    .map((j) => ({
      ...j,
      scaledRuns: Math.round(j.runs * scale),
      savedHours: Math.round(((j.manualMinutes - j.avgMinutes) * j.runs * scale / 60) * 10) / 10,
    }))
    .sort((a, b) => b.savedHours - a.savedHours)
}
