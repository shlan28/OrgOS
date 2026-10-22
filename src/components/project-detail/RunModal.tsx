import { useEffect, useRef, useState } from 'react'
import type { AutoJob, JobRun } from '../../data/projects'
import { CURRENT_USER } from '../../data/projects'
import StatusBadge, { type BadgeTone } from '../StatusBadge'
import { isActiveRun } from '../../hooks/useAutomationEngine'
import ChatMessage from './ChatMessage'
import './RunModal.css'

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

interface RunModalProps {
  job: AutoJob
  onClose: () => void
  /** 引擎动作 */
  onApprove: (jobId: string) => void
  onReject: (jobId: string) => void
  onSubmit: (jobId: string, values: Record<string, string>) => void
  onCancelRun: (jobId: string) => void
  onTrigger: (jobId: string) => void
  onSendMessage: (jobId: string, text: string) => void
}

/** 任务运行弹窗：运行控制台（消息流 + 输入框）；任务编辑由 ADE Teams 编辑页承接 */
export default function RunModal({
  job, onClose, onApprove, onReject, onSubmit, onCancelRun, onTrigger, onSendMessage,
}: RunModalProps) {
  const [draft, setDraft] = useState('')

  const streamRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)

  const run = job.currentRun ?? job.history[0]
  const active = isActiveRun(job.currentRun)

  // 消息流自动滚动（仅当已处于底部时跟随）
  useEffect(() => {
    const el = streamRef.current
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight
  }, [run?.messages.length])

  const handleStreamScroll = () => {
    const el = streamRef.current
    if (!el) return
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const handleSend = () => {
    if (!draft.trim() || !active) return
    onSendMessage(job.id, draft.trim())
    setDraft('')
    stickBottom.current = true
  }

  return (
    <div
      className="run-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="run-modal" role="dialog" aria-modal="true" aria-label={`${job.name} 运行`}>
        {/* 头部 */}
        <div className="run-modal-head">
          <div className="run-modal-title-row">
            <span className="run-modal-name">{job.name}</span>
            {run && (
              <span className={`run-modal-badge${job.currentRun?.status === '运行中' ? ' running' : ''}`}>
                <StatusBadge tone={runTone[run.status]}>{run.status}</StatusBadge>
                {job.currentRun && job.currentRun.status === '运行中' && (
                  <span className="run-modal-progress">
                    {Math.min(job.currentRun.currentStep + 1, job.currentRun.steps.length)}/{job.currentRun.steps.length}
                  </span>
                )}
              </span>
            )}
            <span className="run-modal-head-actions">
              {active && (
                <button type="button" className="text-btn danger" onClick={() => onCancelRun(job.id)}>取消运行</button>
              )}
              {!active && !job.currentRun && (
                <button type="button" className="text-btn" onClick={() => onTrigger(job.id)}>运行</button>
              )}
              <button
                type="button"
                className="text-btn run-modal-teams-edit"
                title="即将上线"
                onClick={() => { /* 本期占位：ADE Teams 编辑页暂未实现 */ }}
              >
                ↗ 去 ADE Teams 编辑
              </button>
              <button type="button" className="run-modal-close" aria-label="关闭" onClick={onClose}>×</button>
            </span>
          </div>
          <p className="run-modal-sub">
            {job.triggerType} · {job.triggerParam}
            {run ? ` · 运行 #${run.id} · ${run.finishedAt ? `结束于 ${run.finishedAt}` : `开始于 ${run.startedAt}`}` : ' · 尚未运行'}
          </p>
          {/* 细步骤进度条 */}
          {run && (
            <div className="run-modal-steps">
              {run.steps.map((s, i) => (
                <span key={s.id} className={`run-step-seg status-${s.status}${i === run.currentStep && run.steps[i].status === '运行中' ? ' current' : ''}`}>
                  <span className="run-step-seg-bar" />
                  <span className="run-step-seg-name">{s.name}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 消息流（ChatMessage 共享渲染） */}
        <div className="run-modal-stream" ref={streamRef} onScroll={handleStreamScroll}>
          {run ? (
            run.messages.map((m, i) => (
              <ChatMessage
                key={m.id}
                message={m}
                prevMessage={run.messages[i - 1]}
                job={job}
                waiting={job.currentRun?.status === '等待确认' || job.currentRun?.status === '等待输入'}
                onApprove={onApprove}
                onReject={onReject}
                onSubmit={onSubmit}
              />
            ))
          ) : (
            <div className="run-modal-empty">尚未运行过，点击右上角「运行」手动触发一次</div>
          )}
        </div>

        {/* 输入框（仅活动运行）：左侧当前用户头像，明确"我以什么身份在说话" */}
        {active && (
          <div className="run-modal-input">
            <span
              className="run-msg-avatar"
              style={{ background: CURRENT_USER.color ?? '#5b7ba6' }}
              title={`以 ${CURRENT_USER.name} 身份发送`}
            >
              {CURRENT_USER.initial}
            </span>
            <input
              className="field-input"
              value={draft}
              placeholder="给运行中的任务发消息…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSend()
              }}
            />
            <button type="button" className="btn-primary" disabled={!draft.trim()} onClick={handleSend}>发送</button>
          </div>
        )}
      </div>
    </div>
  )
}
