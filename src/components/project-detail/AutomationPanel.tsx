import { useEffect, useRef, useState } from 'react'
import type { AutoJob, JobRun, ScheduleRule } from '../../data/projects'
import { WORKFLOW_TEMPLATES, WEEKDAY_NAMES, scheduleTextOf } from '../../data/projects'
import { Section, Row } from '../SettingsRow'
import FormModal, { ModalField } from '../FormModal'
import SegmentedControl from '../SegmentedControl'
import StatusBadge, { type BadgeTone } from '../StatusBadge'
import CreateJobSuccessModal from './CreateJobSuccessModal'
import Toggle from '../Toggle'
import GateCard from './GateCard'
import RunModal from './RunModal'
import { isActiveRun } from '../../hooks/useAutomationEngine'
import './AutomationPanel.css'

const runTone: Record<JobRun['status'], BadgeTone> = {
  排队中: 'neutral',
  运行中: 'info',
  等待确认: 'warning',
  等待输入: 'warning',
  已暂停: 'warning',
  成功: 'success',
  失败: 'danger',
  已取消: 'neutral',
  已拒绝: 'neutral',
}

/** 任务行右侧展示的运行状态（无当前运行时取最近一次历史） */
const displayRun = (job: AutoJob): JobRun | undefined => job.currentRun ?? job.history[0]

/** 待人工处理的任务数（初始 tab 选择用） */
const pendingCountOf = (jobs: AutoJob[]): number =>
  jobs.filter((j) => j.currentRun?.status === '等待确认' || j.currentRun?.status === '等待输入').length

/** 新建表单：任务名 + 工作流模板 + 触发方式（定时规则） */
interface CreateForm {
  name: string
  workflowId: string
  triggerType: '定时' | '手动'
  schedule: ScheduleRule
}

/** 新建表单默认值 */
const emptyCreateForm = (): CreateForm => ({
  name: '',
  workflowId: '',
  triggerType: '手动',
  schedule: { freq: '每天', time: '08:00' },
})

/** 时/分/星期/日期下拉选项 */
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTE_OPTIONS = ['00', '15', '30', '45']
const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7]
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1)

interface AutomationPanelProps {
  jobs: AutoJob[]
  /** 通知跳转定位：打开该任务的运行弹窗 */
  focusJobId?: string | null
  onClearFocus?: () => void
  /** 写操作（新建/编辑/删除/启停） */
  onUpdateJobs: (jobs: AutoJob[]) => void
  /** 运行引擎动作 */
  onApprove: (jobId: string) => void
  onReject: (jobId: string) => void
  onSubmit: (jobId: string, values: Record<string, string>) => void
  onCancelRun: (jobId: string) => void
  onTrigger: (jobId: string) => void
  onSendMessage: (jobId: string, text: string) => void
}

/** 自动化任务面板：横向分段切换（待人工处理 / 任务），点击任务行打开运行弹窗 */
export default function AutomationPanel({
  jobs,
  focusJobId,
  onClearFocus,
  onUpdateJobs,
  onApprove,
  onReject,
  onSubmit,
  onCancelRun,
  onTrigger,
  onSendMessage,
}: AutomationPanelProps) {
  const [creating, setCreating] = useState(false)
  const [modalJobId, setModalJobId] = useState<string | null>(null)
  const [segment, setSegment] = useState<'pending' | 'jobs'>(pendingCountOf(jobs) > 0 ? 'pending' : 'jobs')
  /** 通知跳转定位：高亮目标待处理卡片（短暂闪烁后自动清除） */
  const [highlightJobId, setHighlightJobId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateForm>(emptyCreateForm())
  /** 创建成功弹窗（常驻，点按钮关闭；值为刚创建的任务名） */
  const [successJobName, setSuccessJobName] = useState<string | null>(null)

  const pendingJobs = jobs.filter((j) => j.currentRun?.status === '等待确认' || j.currentRun?.status === '等待输入')
  const pendingCount = pendingJobs.length

  const resetForm = () => setForm(emptyCreateForm())

  // 通知跳转定位：切到「待人工处理」tab 并高亮目标卡片（不自动打开运行弹窗）
  // 注：onClearFocus 为内联函数（引用每次渲染都变），用 ref 承接，避免 effect 反复触发清掉高亮定时器
  const clearFocusRef = useRef(onClearFocus)
  clearFocusRef.current = onClearFocus
  useEffect(() => {
    if (!focusJobId) return
    setSegment('pending')
    setHighlightJobId(focusJobId)
    clearFocusRef.current?.()
    const t = setTimeout(() => setHighlightJobId(null), 2600)
    return () => clearTimeout(t)
  }, [focusJobId])

  const toggleJob = (id: string, next: boolean) => {
    onUpdateJobs(jobs.map((j) => (j.id === id ? { ...j, enabled: next } : j)))
  }

  const handleCreate = () => {
    if (!form.name.trim() || !form.workflowId) return
    const scheduled = form.triggerType === '定时'
    const job: AutoJob = {
      id: `j${Date.now()}`,
      name: form.name.trim(),
      workflowId: form.workflowId,
      triggerType: form.triggerType,
      triggerParam: scheduled ? scheduleTextOf(form.schedule) : '手动触发',
      schedule: scheduled ? form.schedule : undefined,
      enabled: true,
      needApproval: false,
      history: [],
    }
    onUpdateJobs([...jobs, job])
    setCreating(false)
    resetForm()
    // 创建成功：弹出正式成功弹窗（常驻，点按钮关闭）
    setSuccessJobName(job.name)
  }

  const modalJob = jobs.find((j) => j.id === modalJobId) ?? null

  return (
    <div className="automation-panel">
      <SegmentedControl
        value={segment}
        onChange={(key) => setSegment(key as 'pending' | 'jobs')}
        items={[
          { key: 'pending', label: `待人工处理${pendingCount > 0 ? `（${pendingCount}）` : ''}`, icon: null },
          { key: 'jobs', label: `任务（${jobs.length}）`, icon: null },
        ]}
      />

      {segment === 'pending' && (
        <div className="automation-segment-body">
          {pendingCount === 0 ? (
            <div className="automation-empty">暂无待人工处理的事项</div>
          ) : (
            <Section label={`待人工处理（${pendingCount}）`}>
              {pendingJobs.map((job) => (
                job.currentRun && (
                  <GateCard
                    key={job.id}
                    job={job}
                    run={job.currentRun}
                    highlight={highlightJobId === job.id}
                    onApprove={onApprove}
                    onReject={onReject}
                    onOpenModal={setModalJobId}
                  />
                )
              ))}
            </Section>
          )}
        </div>
      )}

      {segment === 'jobs' && (
        <div className="automation-segment-body">
          <Section
            label={`任务（${jobs.length} 个）`}
            action={<button type="button" className="text-btn" onClick={() => { setCreating(true); resetForm() }}>+ 新建</button>}
          >
            {jobs.length === 0 && <div className="automation-empty">暂无自动化任务</div>}
            {jobs.map((job) => {
              const run = displayRun(job)
              const active = isActiveRun(job.currentRun)
              const current = job.currentRun
              // 副标题第 2 行：执行情况（仅活动运行显示；已结束/未运行不显示，徽标已足够）
              const runLine = current
                ? current.status === '运行中'
                  ? `执行中：${current.steps[current.currentStep]?.name ?? '—'}`
                  : `等待人工处理${current.waitingSince ? ` · 已等待 ${current.waitingSince}` : ''}`
                : null
              return (
                <Row
                  key={job.id}
                  className={job.enabled ? '' : 'automation-row-off'}
                  onClick={() => setModalJobId(job.id)}
                >
                  <span className="settings-row-main">
                    <span className="settings-row-text">
                      <span className="settings-row-title">{job.name}</span>
                      <span className="settings-row-sub">{job.triggerType} · {job.triggerParam}</span>
                      {runLine && (
                        <span className={`settings-row-sub automation-run-line${current?.status === '运行中' ? ' running' : ' waiting'}`}>
                          {runLine}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="settings-row-right">
                    {run && (
                      <span className={`automation-run-badge${current?.status === '运行中' ? ' running' : ''}`}>
                        <StatusBadge tone={runTone[run.status]}>{run.status}</StatusBadge>
                        {current && current.status === '运行中' && (
                          <span className="automation-step-progress">
                            {Math.min(current.currentStep + 1, current.steps.length)}/{current.steps.length}
                          </span>
                        )}
                        {!current && run.finishedAt && (
                          <span className="automation-step-progress finished">{run.finishedAt}</span>
                        )}
                      </span>
                    )}
                    {!active && (
                      <button
                        type="button"
                        className="text-btn automation-run-btn"
                        title="手动运行一次"
                        onClick={(e) => { e.stopPropagation(); onTrigger(job.id) }}
                      >
                        运行
                      </button>
                    )}
                    <span onClick={(e) => e.stopPropagation()}>
                      <Toggle
                        checked={job.enabled}
                        disabled={active}
                        title={active ? '运行中的任务不可停用' : job.enabled ? '点击停用' : '点击启用'}
                        onChange={(next) => toggleJob(job.id, next)}
                      />
                    </span>
                  </span>
                </Row>
              )
            })}
          </Section>
        </div>
      )}

      {/* 任务运行弹窗 */}
      {modalJob && (
        <RunModal
          job={modalJob}
          onClose={() => setModalJobId(null)}
          onApprove={onApprove}
          onReject={onReject}
          onSubmit={onSubmit}
          onCancelRun={onCancelRun}
          onTrigger={onTrigger}
          onSendMessage={onSendMessage}
        />
      )}

      {/* 新建任务弹窗：任务名 + 工作流模板 + 触发方式（定时规则） */}
      {creating && (
        <FormModal
          title="新建任务"
          confirmText="创建"
          confirmDisabled={!form.name.trim() || !form.workflowId}
          onConfirm={handleCreate}
          onClose={() => { setCreating(false); resetForm() }}
        >
          <ModalField label="任务名">
            <input className="field-input" value={form.name} placeholder="如 每日构建" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </ModalField>
          <ModalField label="工作流模板">
            <select
              className="field-select"
              value={form.workflowId}
              onChange={(e) => setForm({ ...form, workflowId: e.target.value })}
            >
              <option value="" disabled>选择工作流模板</option>
              {WORKFLOW_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </ModalField>
          <ModalField label="触发方式">
            <div className="automation-trigger-group" role="radiogroup" aria-label="触发方式">
              <label className={`automation-trigger-option${form.triggerType === '定时' ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="trigger-type"
                  checked={form.triggerType === '定时'}
                  onChange={() => setForm({ ...form, triggerType: '定时' })}
                />
                定时
              </label>
              <label className={`automation-trigger-option${form.triggerType === '手动' ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="trigger-type"
                  checked={form.triggerType === '手动'}
                  onChange={() => setForm({ ...form, triggerType: '手动' })}
                />
                手动
              </label>
            </div>
          </ModalField>

          {/* 定时规则：仅触发方式 = 定时时显示 */}
          {form.triggerType === '定时' && (
            <div className="automation-schedule-box">
              <div className="automation-schedule-row">
                <span className="automation-schedule-label">频率</span>
                <select
                  className="field-select"
                  value={form.schedule.freq}
                  onChange={(e) => setForm({
                    ...form,
                    schedule: {
                      ...form.schedule,
                      freq: e.target.value as ScheduleRule['freq'],
                      weekday: e.target.value === '每周' ? (form.schedule.weekday ?? 1) : undefined,
                      day: e.target.value === '每月' ? (form.schedule.day ?? 1) : undefined,
                    },
                  })}
                >
                  <option value="每天">每天</option>
                  <option value="每周">每周</option>
                  <option value="每月">每月</option>
                </select>
              </div>

              {form.schedule.freq === '每周' && (
                <div className="automation-schedule-row">
                  <span className="automation-schedule-label">星期</span>
                  <select
                    className="field-select"
                    value={form.schedule.weekday ?? 1}
                    onChange={(e) => setForm({ ...form, schedule: { ...form.schedule, weekday: Number(e.target.value) } })}
                  >
                    {WEEKDAY_OPTIONS.map((d) => <option key={d} value={d}>{WEEKDAY_NAMES[d]}</option>)}
                  </select>
                </div>
              )}

              {form.schedule.freq === '每月' && (
                <div className="automation-schedule-row">
                  <span className="automation-schedule-label">日期</span>
                  <select
                    className="field-select"
                    value={form.schedule.day ?? 1}
                    onChange={(e) => setForm({ ...form, schedule: { ...form.schedule, day: Number(e.target.value) } })}
                  >
                    {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d} 日</option>)}
                  </select>
                </div>
              )}

              <div className="automation-schedule-row">
                <span className="automation-schedule-label">时间</span>
                <span className="automation-schedule-time">
                  <select
                    className="field-select"
                    value={form.schedule.time.slice(0, 2)}
                    onChange={(e) => setForm({ ...form, schedule: { ...form.schedule, time: `${e.target.value}:${form.schedule.time.slice(3)}` } })}
                  >
                    {HOUR_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <span className="automation-schedule-colon">:</span>
                  <select
                    className="field-select"
                    value={form.schedule.time.slice(3)}
                    onChange={(e) => setForm({ ...form, schedule: { ...form.schedule, time: `${form.schedule.time.slice(0, 2)}:${e.target.value}` } })}
                  >
                    {MINUTE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </span>
              </div>

              <p className="automation-schedule-preview">{scheduleTextOf(form.schedule)} 自动执行</p>
            </div>
          )}
        </FormModal>
      )}

      {/* 创建成功弹窗：页面正中，双按钮（去 ADE Teams 编辑 / 关闭），常驻直到手动关闭 */}
      {successJobName && (
        <CreateJobSuccessModal
          jobName={successJobName}
          onClose={() => setSuccessJobName(null)}
        />
      )}
    </div>
  )
}
