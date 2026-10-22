import React from 'react'

interface SectionProps {
  label: string
  /** 分组标题右侧操作区（如 + 新建 / + 导入 按钮） */
  action?: React.ReactNode
  children: React.ReactNode
}

/** Settings 式分组：灰色小标题 + 白色圆角卡片 */
export function Section({ label, action, children }: SectionProps) {
  return (
    <div>
      <div className="section-label-row">
        <div className="section-label">{label}</div>
        {action && <div className="section-action">{action}</div>}
      </div>
      <div className="section-card">{children}</div>
    </div>
  )
}

interface RowProps {
  children: React.ReactNode
  onClick?: () => void
  className?: string
  /** 悬停提示（如禁用原因） */
  title?: string
}

/** Settings 式行（样式见 App.css .settings-row） */
export function Row({ children, onClick, className, title }: RowProps) {
  return (
    <div
      className={`settings-row${onClick ? ' clickable' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      title={title}
    >
      {children}
    </div>
  )
}
