import { useEffect } from 'react'
import './CreateJobSuccessModal.css'

interface CreateJobSuccessModalProps {
  /** 刚创建成功的任务名 */
  jobName: string
  onClose: () => void
}

/** 任务创建成功弹窗：页面正中，双按钮（去 ADE Teams 编辑 / 关闭），常驻直到手动关闭 */
export default function CreateJobSuccessModal({ jobName, onClose }: CreateJobSuccessModalProps) {
  // Escape 关闭（macOS 标准）；遮罩点击不关闭——成功提示需明确按钮操作，避免误触丢失入口
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay job-success-overlay">
      <div className="modal-box job-success-box" role="dialog" aria-modal="true" aria-label="创建成功">
        <div className="modal-head">
          <span className="modal-title">创建成功</span>
          <button type="button" className="modal-close" aria-label="关闭" onClick={onClose}>×</button>
        </div>

        <div className="job-success-body">
          <span className="job-success-icon">✓</span>
          <p className="job-success-title">任务「{jobName}」创建成功</p>
          <p className="job-success-desc">可在 ADE Teams 中编辑该任务的工作流</p>
        </div>

        <div className="job-success-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>关 闭</button>
          <button
            type="button"
            className="btn-primary"
            title="即将上线"
            onClick={() => { /* 本期占位：ADE Teams 编辑页暂未实现 */ onClose() }}
          >
            去 ADE Teams 编辑 ↗
          </button>
        </div>
      </div>
    </div>
  )
}
