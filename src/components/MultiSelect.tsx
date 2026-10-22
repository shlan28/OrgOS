import { useEffect, useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon } from './icons'
import './MultiSelect.css'

interface MultiSelectProps {
  /** 可选项 */
  options: string[]
  /** 已选项 */
  value: string[]
  onChange: (next: string[]) => void
  /** 未选择时的占位文字 */
  placeholder?: string
}

/** 通用多选下拉：触发器显示已选标签（名称 ✕），菜单点击切换选中（不关闭） */
export default function MultiSelect({ options, value, onChange, placeholder = '请选择' }: MultiSelectProps) {
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

  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt])
  }

  return (
    <div className={`multi-select${open ? ' open' : ''}`} ref={ref}>
      <button
        type="button"
        className="multi-select-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        {value.length === 0
          ? <span className="multi-select-placeholder">{placeholder}</span>
          : (
            <span className="multi-select-tags">
              {value.map((v) => (
                <span key={v} className="multi-select-tag">
                  {v}
                  <span
                    role="button"
                    aria-label={`移除 ${v}`}
                    className="multi-select-tag-x"
                    onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== v)) }}
                  >
                    ×
                  </span>
                </span>
              ))}
            </span>
          )}
        <ChevronDownIcon size={10} className="multi-select-chevron" />
      </button>
      {open && (
        <div className="multi-select-menu">
          {options.map((opt) => {
            const selected = value.includes(opt)
            return (
              <button
                key={opt}
                type="button"
                className={`multi-select-item${selected ? ' active' : ''}`}
                onClick={() => toggle(opt)}
              >
                <span>{opt}</span>
                {selected && <CheckIcon size={13} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
