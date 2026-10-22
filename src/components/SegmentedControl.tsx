import React from 'react'
import './SegmentedControl.css'

export interface SegmentItem {
  key: string
  label: string
  icon: React.ReactNode
}

interface Props {
  items: SegmentItem[]
  value: string
  onChange: (key: string) => void
}

/** 分段控件（Home / Code） */
export default function SegmentedControl({ items, value, onChange }: Props) {
  return (
    <div className="segmented" role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={value === item.key}
          className={`segment ${value === item.key ? 'active' : ''}`}
          onClick={() => onChange(item.key)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}
