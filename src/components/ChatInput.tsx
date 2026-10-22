import { useEffect, useRef, useState } from 'react'
import Dropdown from './Dropdown'
import RecordingWidget, { fmtRecordingSec, type RecordingFile } from './RecordingWidget'
import {
  ArrowUpIcon,
  AtIcon,
  BoltIcon,
  CodeIcon,
  MicIcon,
  PlusIcon,
  SlashIcon,
} from './icons'
import './ChatInput.css'

const EDIT_MODES = ['自动接受编辑', '手动确认编辑']
const RUN_MODES = ['默认模式', '规划模式', '智能体模式']
const MODELS = ['qwen3.8-max', 'qwen3-coder', 'claude-sonnet-4', 'gpt-5']

/** 主内容区输入卡片：占位输入框 + 底部工具栏 + 发送按钮 + @ 长录音入口 */
export default function ChatInput() {
  const [text, setText] = useState('')
  const [editMode, setEditMode] = useState(EDIT_MODES[0])
  const [runMode, setRunMode] = useState(RUN_MODES[0])
  const [model, setModel] = useState(MODELS[0])
  /** @ 引用菜单展开态 */
  const [atMenuOpen, setAtMenuOpen] = useState(false)
  /** 录音会话：null = 未在录/已关闭；值 = 会话 id（点「长录音」开启新一轮） */
  const [recordingId, setRecordingId] = useState<string | null>(null)
  /** 已加入输入卡片的录音文件（附件条）：null = 无；同 id 去重、新录音替换 */
  const [recordingFile, setRecordingFile] = useState<RecordingFile | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const atMenuRef = useRef<HTMLDivElement>(null)

  const canSend = text.trim().length > 0

  // @ 菜单：点击外部自动关闭
  useEffect(() => {
    if (!atMenuOpen) return
    const onClick = (e: MouseEvent) => {
      if (atMenuRef.current && !atMenuRef.current.contains(e.target as Node)) setAtMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [atMenuOpen])

  /** @ 菜单「长录音」：开启录音（录音中再点无效，防重复） */
  const startRecording = () => {
    setAtMenuOpen(false)
    if (recordingId !== null) return
    setRecordingId(`rec-${Date.now()}`)
  }

  /** 小窗「加入输入框」：把录音.mp3 附件条放进输入卡片（同 id 去重） */
  const handleAddToInput = (file: RecordingFile) => {
    setRecordingFile((prev) => (prev?.id === file.id ? prev : file))
  }

  return (
    <div className="chat-input-card">
      {/* 录音文件附件条（textarea 上方；同 id 去重，新录音替换） */}
      {recordingFile && (
        <div className="rec-chip">
          <span className="rec-chip-icon">
            <MicIcon size={15} />
          </span>
          <div className="rec-chip-info">
            <span className="rec-chip-name">{recordingFile.name}</span>
            <span className="rec-chip-meta">
              {fmtRecordingSec(recordingFile.seconds)} · {recordingFile.size}
            </span>
          </div>
          <button
            type="button"
            className="rec-chip-remove"
            onClick={() => setRecordingFile(null)}
            title="移除录音文件"
          >
            ×
          </button>
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="chat-textarea"
        placeholder="可向 Loom 询问任何事"
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && canSend) {
            e.preventDefault()
            setText('')
          }
        }}
      />

      <div className="chat-toolbar">
        <div className="toolbar-left">
          <button type="button" className="icon-btn" title="添加附件">
            <PlusIcon size={15} />
          </button>
          <button type="button" className="icon-btn" title="命令">
            <SlashIcon size={15} />
          </button>
          {/* 引用：@ 弹出菜单（含「长录音」入口） */}
          <div className="at-menu" ref={atMenuRef}>
            <button
              type="button"
              className={`icon-btn${recordingId !== null ? ' recording' : ''}`}
              title="引用（@ 长录音）"
              onClick={() => setAtMenuOpen((v) => !v)}
            >
              <AtIcon size={15} />
            </button>
            {atMenuOpen && (
              <div className="at-menu-panel">
                <button type="button" className="at-menu-item" onClick={startRecording}>
                  <MicIcon size={14} />
                  <span>长录音</span>
                </button>
              </div>
            )}
          </div>

          <Dropdown
            className="edit-mode-dropdown"
            options={EDIT_MODES}
            value={editMode}
            onChange={setEditMode}
          >
            <CodeIcon size={13} className="green-icon" />
            <span className="green-text">{editMode}</span>
          </Dropdown>

          <Dropdown options={RUN_MODES} value={runMode} onChange={setRunMode}>
            <BoltIcon size={13} />
            <span>{runMode}</span>
          </Dropdown>
        </div>

        <div className="toolbar-right">
          <Dropdown align="right" options={MODELS} value={model} onChange={setModel}>
            <span>翼构 · 研发工程师 · {model}</span>
          </Dropdown>

          <button
            type="button"
            className={`send-btn ${canSend ? 'enabled' : ''}`}
            disabled={!canSend}
            title="发送"
            onClick={() => canSend && setText('')}
          >
            <ArrowUpIcon size={15} color="#fff" />
          </button>
        </div>
      </div>

      {/* 录音小窗（fixed 浮窗：主区右上角，可拖动；关闭后卸载） */}
      {recordingId !== null && (
        <RecordingWidget
          sessionId={recordingId}
          onAddToInput={handleAddToInput}
          onClose={() => setRecordingId(null)}
        />
      )}
    </div>
  )
}
