import { useState } from 'react'
import type { AutoJob, RunMessage } from '../../data/projects'
import { CURRENT_USER, ADE_SENDER } from '../../data/projects'
import './ChatMessage.css'

interface ChatMessageProps {
  message: RunMessage
  /** 上一条消息（连续同一说话人时名字只显示首条） */
  prevMessage?: RunMessage
  /** 关联任务（Gate 表单/按钮动作需要）；手动会话传 null → 不渲染按钮/表单 */
  job: AutoJob | null
  /** 当前会话是否处于等待处理（控制 Gate actions / 表单可用） */
  waiting: boolean
  onApprove?: (jobId: string) => void
  onReject?: (jobId: string) => void
  onSubmit?: (jobId: string, values: Record<string, string>) => void
}

/**
 * 单条会话消息渲染（RunModal 与详情页会话区共享）：
 * - 系统 = 居中灰小字；ADE = 左头像灰气泡；人 = 右绿气泡（多人各自底色）；
 * - 消息文本中 @提及 高亮显示（@ + 连续非空白词）；
 * - Gate 问题消息（等待时）带内联按钮 / 迷你表单；
 * - 步骤完成消息带阶段性结果块（产物文件 + 跳转会话）。
 */

/** 文本按 @提及 分段渲染（@名字 = 蓝色高亮） */
const renderText = (text: string) => {
  const parts = text.split(/(@[^\s@，。；、！？]+)/g)
  if (parts.length === 1) return text
  return parts.map((p, i) =>
    p.startsWith('@') && p.length > 1
      ? <span key={i} className="msg-mention">{p}</span>
      : p,
  )
}

export default function ChatMessage({
  message, prevMessage, job, waiting, onApprove, onReject, onSubmit,
}: ChatMessageProps) {
  const [values, setValues] = useState<Record<string, string>>({})

  if (message.role === '系统') {
    return <div className="run-msg system">{message.text}</div>
  }

  // 说话人：sender 优先，缺省按 role 兜底（人 = 当前用户，ADE = 默认执行方）
  const sender = message.sender ?? (message.role === '人' ? CURRENT_USER : ADE_SENDER)
  // 连续同一说话人只在首条显示名字（系统消息天然打断连续性）
  const sameSpeaker = prevMessage?.role === message.role && prevMessage?.sender?.name === message.sender?.name
  const showName = !sameSpeaker

  if (message.role === '人') {
    return (
      <div className="run-msg-row mine">
        {showName && <span className="run-msg-name mine">{sender.name}</span>}
        <div className="run-msg-content mine">
          <div className="run-msg-bubble mine">{renderText(message.text)}</div>
          <span
            className="run-msg-avatar"
            style={{ background: sender.color ?? '#5b7ba6' }}
            title={sender.name}
          >
            {sender.initial}
          </span>
        </div>
      </div>
    )
  }

  // ADE 消息（可能带内联问题 / 阶段性结果）
  const hasActions = !!message.actions && waiting
  const hasForm = !!message.form && waiting
  const hasResult = !!message.result

  return (
    <div className="run-msg-row">
      {showName && <span className="run-msg-name">{sender.name}</span>}
      <div className="run-msg-content">
        <span
          className="run-msg-avatar"
          style={{ background: sender.color ?? '#7c66d8' }}
          title={sender.name}
        >
          {sender.initial}
        </span>
        <div className={`run-msg-bubble ade${hasActions || hasForm ? ' gate' : ''}`}>
          {hasActions || hasForm ? <div className="run-msg-gate-title">⚠ {job?.currentRun?.gate?.title ?? '需要你的输入'}</div> : null}
          <div className="run-msg-text">{renderText(message.text)}</div>

          {/* 阶段性结果块：摘要 + 产物文件（带下划线可跳转）+ 跳转会话 */}
          {hasResult && (
            <div className="run-msg-result">
              <div className="run-msg-result-title">阶段结果</div>
              <div className="run-msg-result-summary">{message.result!.summary}</div>
              {message.result!.files.length > 0 && (
                <div className="run-msg-result-files">
                  {message.result!.files.map((f) => (
                    <a
                      key={f.url}
                      className="run-msg-result-file"
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      title={f.url}
                    >
                      <span className="run-msg-result-file-icon">📄</span>
                      {f.name}
                    </a>
                  ))}
                </div>
              )}
              <div className="run-msg-result-foot">
                <button
                  type="button"
                  className="text-btn run-msg-result-session"
                  title={message.result!.sessionUrl}
                  onClick={() => window.open(message.result!.sessionUrl, '_blank', 'noreferrer')}
                >
                  跳转到会话 ↗
                </button>
              </div>
            </div>
          )}

          {hasActions && job && (
            <div className="run-msg-actions">
              {message.actions!.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={a.kind === 'primary' ? 'btn-primary' : 'text-btn'}
                  onClick={() => (a.label === '批准' ? onApprove?.(job.id) : onReject?.(job.id))}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}

          {hasForm && job && (
            <div className="run-msg-form">
              {message.form!.map((f) => (
                <label key={f.key} className="run-msg-field">
                  <span className="run-msg-field-label">
                    {f.label}
                    {f.required && <span className="run-msg-field-required">*</span>}
                  </span>
                  <input
                    className="field-input"
                    value={values[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                </label>
              ))}
              <div className="run-msg-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={message.form!.some((f) => f.required && !values[f.key]?.trim())}
                  onClick={() => onSubmit?.(job.id, values)}
                >
                  提交并继续
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
