import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { MicIcon, StopIcon } from './icons'
import './RecordingWidget.css'

/** 转写 Mock 文案：随录音时长逐句「识别」出来，小窗只展示最近一句 */
const TRANSCRIPT_LINES = [
  '帮我在这期版本里，',
  '把项目中心的首页会话框，',
  '加上录音转写的交互：',
  '录音小窗固定在右上角，',
  '显示正在录音的进度，',
  '停止后生成一个录音文件。',
]

/** 录音文件名（加入输入框的附件条展示） */
export const RECORDING_FILE_NAME = '录音.mp3'

/** 秒数 → mm:ss */
export const fmtRecordingSec = (sec: number) =>
  `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`

/** 录音文件 Mock 大小（KB） */
export const mockRecordingSize = (sec: number) => `${(12 + sec * 8).toFixed(0)}KB`

/** 加入输入框的录音文件（附件条数据） */
export interface RecordingFile {
  /** 录音会话 id（去重用） */
  id: string
  /** 文件名 */
  name: string
  /** 时长（秒） */
  seconds: number
  /** Mock 大小 */
  size: string
}

/** 小窗默认锚点：主区右上角（fixed，预览/面板工具 icon 下方同列） */
const DEFAULT_POS = { top: 60, right: 24 }

interface RecordingWidgetProps {
  /** 录音会话 id（变更 = 新一轮录音，计时归零） */
  sessionId: string
  /** 把录音文件加入输入框（附件条；由 ChatInput 去重/替换） */
  onAddToInput: (file: RecordingFile) => void
  /** 关闭小窗（丢弃本轮录音） */
  onClose: () => void
}

/**
 * 录音小窗（fixed 浮窗，默认主区右上角，头部可拖动）：
 * - 录音中：红色呼吸圆点 + mm:ss 计时 + 音柱动效 + 最近一句转写（替换更新）；
 * - 「停止」→ 已停止态（小窗不关闭）：文件行 录音.mp3 · mm:ss + 定格转写
 *   + 「加入输入框」（把 录音.mp3 附件条放进输入卡片）+「详情」占位 +「×」关闭；
 * - 「详情」为占位禁用（独立录音详情页后续接入）。
 */
export default function RecordingWidget({ sessionId, onAddToInput, onClose }: RecordingWidgetProps) {
  const [seconds, setSeconds] = useState(0)
  const [stopped, setStopped] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number | null; right: number | null }>({
    top: DEFAULT_POS.top,
    left: null,
    right: DEFAULT_POS.right,
  })
  const widgetRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startX: number; startY: number; baseTop: number; baseLeft: number } | null>(null)

  // 秒表：1s 间隔累计（停止后拦住不累计；sessionId 变更 = 新录音，重置归位）
  useEffect(() => {
    setSeconds(0)
    setStopped(false)
    setPos({ top: DEFAULT_POS.top, left: null, right: DEFAULT_POS.right })
    const timer = window.setInterval(
      () => setSeconds((s) => (stoppedRef.current ? s : s + 1)),
      1000,
    )
    return () => window.clearInterval(timer)
  }, [sessionId])

  // 停止标志（interval 闭包读最新值）
  const stoppedRef = useRef(false)
  useEffect(() => {
    stoppedRef.current = stopped
  }, [stopped])

  const lineCount = Math.min(TRANSCRIPT_LINES.length, Math.floor(seconds / 3) + 1)
  const lastLine = seconds >= 3 ? TRANSCRIPT_LINES[lineCount - 1] : '正在聆听…'

  /* —— 拖动：按住头部移动（松手保留位置；不越出视口） —— */
  const onDragStart = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return // 头部按钮（×）不触发拖动
    const rect = widgetRef.current?.getBoundingClientRect()
    if (!rect) return
    drag.current = { startX: e.clientX, startY: e.clientY, baseTop: rect.top, baseLeft: rect.left }
    document.body.classList.add('rec-dragging')
  }

  useEffect(() => {
    const onMove = (e: globalThis.MouseEvent) => {
      if (!drag.current || !widgetRef.current) return
      const dx = e.clientX - drag.current.startX
      const dy = e.clientY - drag.current.startY
      const w = widgetRef.current.offsetWidth
      const h = widgetRef.current.offsetHeight
      const nextLeft = Math.min(Math.max(8, drag.current.baseLeft + dx), window.innerWidth - w - 8)
      const nextTop = Math.min(Math.max(8, drag.current.baseTop + dy), window.innerHeight - h - 8)
      setPos({ top: nextTop, left: nextLeft, right: null })
    }
    const onUp = () => {
      drag.current = null
      document.body.classList.remove('rec-dragging')
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  const style: CSSProperties = {
    top: pos.top,
    left: pos.left ?? undefined,
    right: pos.right ?? undefined,
  }

  /** 已停止态：加入输入框（附件条数据由父组件接管去重） */
  const handleAddToInput = () => {
    onAddToInput({
      id: sessionId,
      name: RECORDING_FILE_NAME,
      seconds,
      size: mockRecordingSize(seconds),
    })
  }

  return (
    <div
      className={`rec-widget${stopped ? ' stopped' : ''}`}
      style={style}
      ref={widgetRef}
      role="dialog"
      aria-label="录音小窗"
    >
      <div className="rec-head" onMouseDown={onDragStart} title="按住拖动小窗">
        {stopped ? (
          <>
            <span className="rec-file-icon">
              <MicIcon size={13} />
            </span>
            <span className="rec-file-name">{RECORDING_FILE_NAME}</span>
            <span className="rec-timer stopped-time">{fmtRecordingSec(seconds)}</span>
          </>
        ) : (
          <>
            <span className="rec-dot" />
            <span className="rec-label">正在录音</span>
            <span className="rec-timer">{fmtRecordingSec(seconds)}</span>
          </>
        )}
        <button type="button" className="rec-close" title="关闭（丢弃本轮录音）" onClick={onClose}>
          ×
        </button>
      </div>

      {/* 录音中：音柱动效 + 最近一句转写 + 停止/详情 */}
      {!stopped && (
        <>
          <div className="rec-wave" aria-hidden="true">
            {Array.from({ length: 28 }, (_, i) => (
              <span
                key={i}
                className="rec-bar"
                style={{ animationDelay: `${(i % 7) * 0.12}s` }}
              />
            ))}
          </div>

          <div className="rec-transcript" key={lineCount} title="转写预览（最近一句）">
            {lastLine}
          </div>

          <div className="rec-actions">
            <button type="button" className="rec-stop-btn" onClick={() => setStopped(true)}>
              <StopIcon size={12} />
              <span>停止</span>
            </button>
            <button
              type="button"
              className="rec-detail-btn"
              disabled
              title="录音详情开发中，敬请期待"
            >
              <span>详情</span>
            </button>
          </div>
        </>
      )}

      {/* 已停止：定格转写 + 继续录音/加入输入框/详情 */}
      {stopped && (
        <>
          <div className="rec-transcript" title="转写（最近一句，已定格）">
            {lastLine}
          </div>
          <div className="rec-actions">
            <button type="button" className="rec-resume-btn" onClick={() => setStopped(false)} title="继续本次录音">
              <MicIcon size={12} />
              <span>继续</span>
            </button>
            <button type="button" className="rec-add-btn" onClick={handleAddToInput}>
              加入输入框
            </button>
            <button
              type="button"
              className="rec-detail-btn"
              disabled
              title="录音详情开发中，敬请期待"
            >
              <span>详情</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
