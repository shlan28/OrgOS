import React, { useEffect, useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon } from './icons'
import './Dropdown.css'

export interface DropdownProps {
  /** 触发器内容（图标 + 文字等） */
  children: React.ReactNode
  /** 下拉选项 */
  options: string[]
  value: string
  onChange: (v: string) => void
  className?: string
  /** 菜单对齐方向 */
  align?: 'left' | 'right'
}

/** 通用下拉菜单：点击触发器弹出选项列表，点击外部自动关闭 */
export default function Dropdown({
  children,
  options,
  value,
  onChange,
  className,
  align = 'left',
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className={`dropdown ${className ?? ''}`} ref={ref}>
      <button
        type="button"
        className="dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        {children}
        <ChevronDownIcon size={10} className="dropdown-chevron" />
      </button>
      {open && (
        <div className={`dropdown-menu ${align === 'right' ? 'align-right' : ''}`}>
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`dropdown-item ${opt === value ? 'active' : ''}`}
              onClick={() => {
                onChange(opt)
                setOpen(false)
              }}
            >
              <span>{opt}</span>
              {opt === value && <CheckIcon size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
