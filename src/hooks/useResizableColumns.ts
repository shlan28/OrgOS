import { useCallback, useEffect, useRef, useState } from 'react'

/** 列定义：默认宽 + 最小宽 */
export interface ResizableColumnSpec {
  defaultWidth: number
  minWidth: number
}

export interface ResizableColumns {
  /** 当前各列宽度（列数 = specs 长度；null = 未拖过 → 调用方按默认渲染） */
  widths: number[] | null
  /** 拖拽某条拖拽条（index = 左侧列下标）：挂在 resizer 的 onMouseDown */
  startResize: (index: number, e: React.MouseEvent) => void
  /** 双击拖拽条重置（null = 回默认比例） */
  reset: () => void
}

/**
 * 四格布局列宽拖拽（详情页专用，但保持通用）：
 * - 只管理「定宽列」（前 N 列，渲染时 style.width 生效）；
 * - 最后一列由调用方用 flex:1 吸收剩余宽度；
 * - minmax 钳制：左列不小于 min，也不超过「容器 − 其余列 min」的隐式上限；
 * - window 级 mousemove/mouseup 保证拖出元素仍生效，结束后清理。
 */
export function useResizableColumns(specs: ResizableColumnSpec[]): ResizableColumns {
  const [widths, setWidths] = useState<number[] | null>(null)

  /** 拖拽会话数据（事件闭包捕获用 ref，避免重渲染中断） */
  const drag = useRef<{ index: number; startX: number; startWidth: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const startResize = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault()
    drag.current = { index, startX: e.clientX, startWidth: 0 }
    setDragging(true)
  }, [])

  // 拖动中：window mousemove 计算 delta → 更新左列宽
  useEffect(() => {
    if (!dragging) return

    const onMove = (ev: MouseEvent) => {
      const d = drag.current
      if (!d) return
      const delta = ev.clientX - d.startX

      setWidths((prev) => {
        // 基准列宽：未拖过 = 默认宽
        const base = prev ?? specs.map((s) => s.defaultWidth)
        if (d.startWidth === 0) {
          // 首次 move 记录起始宽（mousedown 时 DOM 宽读取时机不稳，这里延迟取值）
          d.startWidth = base[d.index]
        }
        const min = specs[d.index].minWidth
        const next = Math.max(min, d.startWidth + delta)
        const out = base.slice()
        out[d.index] = next
        return out
      })
    }

    const onUp = () => {
      drag.current = null
      setDragging(false)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, specs])

  const reset = useCallback(() => setWidths(null), [])

  return { widths, startResize, reset }
}
