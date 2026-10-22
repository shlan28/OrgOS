import { useEffect, useRef } from 'react'
import type { AutoJob, JobRun } from '../../data/projects'
import { CURRENT_USER } from '../../data/projects'
import StatusBadge from '../StatusBadge'
import './GateCard.css'

interface GateCardProps {
  job: AutoJob
  run: JobRun
  /** 通知跳转定位：滚动到可视区并闪烁高亮 */
  highlight?: boolean
  onApprove: (jobId: string) => void
  onReject: (jobId: string) => void
  /** 输入型：打开任务运行弹窗（表单在弹窗内） */
  onOpenModal: (jobId: string) => void
}

/** 待人工处理卡片：确认型保留快捷按钮；输入型「去填写」打开弹窗；卡片标记需要谁处理 */
export default function GateCard({ job, run, highlight, onApprove, onReject, onOpenModal }: GateCardProps) {
  const gate = run.gate
  const cardRef = useRef<HTMLDivElement>(null)

  // 高亮定位：滚动到可视区（闪烁动画由 CSS 类驱动）
  useEffect(() => {
    if (!highlight) return
    cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlight])

  if (!gate) return null

  const approver = gate.approver
  const verb = gate.type === '确认' ? '确认' : '填写'
  const approverLabel = approver
    ? (approver.name === CURRENT_USER.name ? `需要你${verb}` : `需要 ${approver.name} ${verb}`)
    : ''

  return (
    <div
      ref={cardRef}
      className={`gate-card gate-${gate.type === '确认' ? 'confirm' : 'input'}${highlight ? ' highlight' : ''}`}
    >
      <div className="gate-head">
        <span className="gate-job">
          {job.name} · 运行 #{run.id}
        </span>
        <StatusBadge tone="warning">{run.status}</StatusBadge>
      </div>

      <p className="gate-title">{gate.title}</p>
      <p className="gate-desc">{gate.description}</p>

      {approver && (
        <div className="gate-approver">
          <span
            className="gate-approver-avatar"
            style={{ background: approver.color ?? '#5b7ba6' }}
            title={approver.name}
          >
            {approver.initial}
          </span>
          <span className="gate-approver-text">{approverLabel}</span>
        </div>
      )}

      <div className="gate-foot">
        <span className="gate-meta">
          运行至步骤 {Math.min(run.currentStep + 1, run.steps.length)}/{run.steps.length}
          {run.waitingSince ? ` · 已等待 ${run.waitingSince}` : ''}
        </span>
        <span className="gate-actions">
          <button type="button" className="text-btn gate-detail-btn" onClick={() => onOpenModal(job.id)}>查看详情</button>
          {gate.type === '确认' ? (
            <>
              <button type="button" className="text-btn" onClick={() => onReject(job.id)}>拒绝</button>
              <button type="button" className="btn-primary" onClick={() => onApprove(job.id)}>批准</button>
            </>
          ) : (
            <button type="button" className="btn-primary" onClick={() => onOpenModal(job.id)}>去填写 →</button>
          )}
        </span>
      </div>
    </div>
  )
}
