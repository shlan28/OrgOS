import { useCallback, useEffect, useRef, useState } from 'react'

/** 列定义：默认比例（flex-grow 权重）+ 最小宽 */
export interface ResizableColumnSpec {
  ratio: number
  minWidth: number
}

export interface ResizableColumns {
  /** 各列宽度覆盖值（null = 该列走默认比例；拖拽后为固定 px） */
  widths: (number | null)[]
  /** 某列的内联样式（flex 比例/定宽 + minWidth） */
  cellStyle: (index: number) => { flex: string; minWidth: number }
  /** 拖拽某条拖拽条（index = 左侧列下标）：挂在 resizer 的 onMouseDown */
  startResize: (index: number, e: React.MouseEvent) => void
  /** 双击拖拽条重置（全 null = 回默认比例） */
  reset: () => void
}

/**
 * 详情页四格列宽（比例分配 + 拖拽微调）：
 * - 默认态：各列 `flex: <ratio> 1 0px`，按比例分「扣除 padding 与拖拽条后的剩余空间」，
 *   窗口缩放自动保持比例、不会溢出（百分比 width 会因不含拖拽条而溢出）；
 * - 拖拽后：被拖列固定为 `flex: 0 0 <px>px`，其余列仍按比例重新分配剩余空间；
 * - 起始宽读真实 DOM 宽（非 spec 数值——比例态下两者无对应关系，用 spec 会跳变）；
 * - max 钳制：不把其余列挤到各自 minWidth 以下（否则溢出容器）；
 * - window 级 mousemove/mouseup 保证拖出元素仍生效，结束后清理。
 */
export function useResizableColumns(specs: ResizableColumnSpec[]): ResizableColumns {
  /** null = 未拖过该列（走默认比例） */
  const [widths, setWidths] = useState<(number | null)[]>(() => specs.map(() => null))

  /** 拖拽会话数据（事件闭包捕获用 ref，避免重渲染中断） */
  const drag = useRef<{ index: number; startX: number; startWidth: number; max: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const startResize = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault()
    const resizer = e.currentTarget as HTMLElement
    // 左邻格 = 被拖拽的列；其真实渲染宽作为拖拽起点
    const leftCell = resizer.previousElementSibling as HTMLElement | null
    const grid = resizer.parentElement

    // max = 容器内容宽 − 拖拽条总宽 − 其余列 minWidth 之和
    let max = Number.POSITIVE_INFINITY
    if (grid) {
      const cs = getComputedStyle(grid)
      const contentW = grid.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')
      const gapW = Array.from(grid.querySelectorAll('.cell-resizer'))
        .reduce((sum, el) => sum + el.getBoundingClientRect().width, 0)
      const othersMin = specs.reduce((sum, sp, i) => (i === index ? sum : sum + sp.minWidth), 0)
      max = Math.max(specs[index].minWidth, contentW - gapW - othersMin)
    }

    drag.current = {
      index,
      startX: e.clientX,
      startWidth: leftCell?.getBoundingClientRect().width ?? specs[index].minWidth,
      max,
    }
    setDragging(true)
  }, [specs])

  // 拖动中：window mousemove 计算 delta → 更新该列定宽
  useEffect(() => {
    if (!dragging) return

    const onMove = (ev: MouseEvent) => {
      const d = drag.current
      if (!d) return
      const min = specs[d.index].minWidth
      const next = Math.min(d.max, Math.max(min, d.startWidth + (ev.clientX - d.startX)))
      setWidths((prev) => {
        const out = prev.slice()
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

  const reset = useCallback(() => setWidths(specs.map(() => null)), [specs])

  const cellStyle = useCallback(
    (index: number) => {
      const w = widths[index]
      return {
        flex: w == null ? `${specs[index].ratio} 1 0px` : `0 0 ${w}px`,
        minWidth: specs[index].minWidth,
      }
    },
    [widths, specs],
  )

  return { widths, cellStyle, startResize, reset }
}
