import React from 'react'
import './PlaceholderPanel.css'

interface PlaceholderPanelProps {
  icon: React.ReactNode
  name: string
}

/** 占位面板：代码/安全审查/测试 共用 */
export default function PlaceholderPanel({ icon, name }: PlaceholderPanelProps) {
  return (
    <div className="placeholder-panel">
      <div className="placeholder-icon">{icon}</div>
      <div className="placeholder-title">{name} 功能建设中</div>
      <div className="placeholder-desc">该模块将在后续版本提供，敬请期待</div>
    </div>
  )
}
