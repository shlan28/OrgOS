import React, { useEffect } from 'react'
import './FormModal.css'

interface FormModalProps {
  /** 弹窗标题（如「新建文档」「导入文档」） */
  title: string
  /** 表单字段（竖向排列的输入框/下拉） */
  children: React.ReactNode
  confirmText: string
  confirmDisabled?: boolean
  onConfirm: () => void
  onClose: () => void
  /** 宽版弹窗（内容多时用，如编辑项目含成员/ADE 区块） */
  wide?: boolean
  /** 危险操作（删除等）：确认按钮用红色 */
  confirmDanger?: boolean
}

/** 通用弹窗表单：新增类操作统一使用（遮罩 + 居中弹窗 + 标题栏 + 字段 + 取消/确认） */
export default function FormModal({ title, children, confirmText, confirmDisabled, onConfirm, onClose, wide, confirmDanger }: FormModalProps) {
  /** Escape 关闭（macOS 标准交互） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        // 点击遮罩关闭（仅当点击目标是遮罩本身）
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`modal-box${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button type="button" className="modal-close" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <div className="modal-fields">{children}</div>
        <div className="modal-actions">
          <button type="button" className="text-btn" onClick={onClose}>取消</button>
          <button
            type="button"
            className={`btn-primary${confirmDanger ? ' danger' : ''}`}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 弹窗字段容器：12px 灰色标签 + 控件 */
export function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="modal-field">
      <div className="modal-field-label">{label}</div>
      {children}
    </div>
  )
}
