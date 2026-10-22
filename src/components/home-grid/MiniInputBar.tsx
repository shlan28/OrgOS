/** 多视窗窗格底部简化输入条：[＋] [单行输入] [发送]；功能收进 ＋ 菜单 */

import { useEffect, useRef, useState } from 'react'
import RecordingWidget, { fmtRecordingSec, type RecordingFile } from '../RecordingWidget'
import {
  ArrowUpIcon, AtIcon, BoltIcon, BranchIcon, CodeIcon, FolderIcon,
  MicIcon, PlusIcon, RobotIcon,
} from '../icons'
import './HomeGrid.css'

const EDIT_MODES = ['自动接受编辑', '手动确认编辑']
const RUN_MODES = ['默认模式', '规划模式', '智能体模式']
const MODELS = ['qwen3.8-max', 'qwen3-coder', 'claude-sonnet-4', 'gpt-5']
const CONTEXT_PROJECTS = ['loomweb', 'loom-server', 'docs-site']
const CONTEXT_BRANCHES = ['dev', 'main', 'feature/chat-ui']

/** ＋ 菜单设置项的二级选择展开目标 */
type SubMenuKey = 'editMode' | 'runMode' | 'model' | 'context' | null

interface MiniInputBarProps {
  /** 输入框占位文案（新对话 =「消息…」；历史会话插话 =「插话…」） */
  placeholder: string
}

export default function MiniInputBar({ placeholder }: MiniInputBarProps) {
  const [text, setText] = useState('')
  const [editMode, setEditMode] = useState(EDIT_MODES[0])
  const [runMode, setRunMode] = useState(RUN_MODES[0])
  const [model, setModel] = useState(MODELS[0])
  const [ctxProject, setCtxProject] = useState(CONTEXT_PROJECTS[0])
  const [ctxBranch, setCtxBranch] = useState(CONTEXT_BRANCHES[0])
  /** ＋ 菜单展开态 */
  const [menuOpen, setMenuOpen] = useState(false)
  /** 菜单内二级选择展开目标（null = 一级列表） */
  const [subMenu, setSubMenu] = useState<SubMenuKey>(null)
  /** 录音会话 id（null = 未在录/已关闭；复用 ChatInput 同款语义） */
  const [recordingId, setRecordingId] = useState<string | null>(null)
  /** 附件行（录音.mp3） */
  const [attachment, setAttachment] = useState<RecordingFile | null>(null)

  const menuRef = useRef<HTMLDivElement>(null)

  const canSend = text.trim().length > 0

  // ＋ 菜单：点击外部自动关闭（同 ChatInput 的 atMenu 模式）
  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setSubMenu(null)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  /** 菜单项点击公共处理：收起菜单 */
  const closeMenu = () => {
    setMenuOpen(false)
    setSubMenu(null)
  }

  /** 「添加附件」：Mock 附件条（静态演示） */
  const addMockAttachment = () => {
    setAttachment({
      id: `file-${Date.now()}`,
      name: '设计稿.png',
      seconds: 0,
      size: '312KB',
    })
    closeMenu()
  }

  /** 「引用 · @ 长录音」：开启录音小窗（fixed 复用） */
  const startRecording = () => {
    closeMenu()
    if (recordingId !== null) return
    setRecordingId(`rec-${Date.now()}`)
  }

  /** 二级选择项通用渲染（label + 当前值高亮） */
  const subItem = (label: string, active: boolean, onClick: () => void) => (
    <button
      type="button"
      key={label}
      className={`pi-sub-item${active ? ' active' : ''}`}
      onClick={() => { onClick(); setSubMenu(null) }}
    >
      {active && <span className="pi-sub-check">✓</span>}
      <span className="pi-sub-label">{label}</span>
    </button>
  )

  return (
    <div className="pane-input">
      {/* 附件行（输入条上方；录音「加入输入框」或 Mock 附件触发） */}
      {attachment && (
        <div className="pi-attachment">
          <span className="pi-att-icon"><MicIcon size={13} /></span>
          <span className="pi-att-name">{attachment.name}</span>
          <span className="pi-att-meta">
            {attachment.seconds > 0 ? `${fmtRecordingSec(attachment.seconds)} · ` : ''}{attachment.size}
          </span>
          <button
            type="button"
            className="pi-att-remove"
            title="移除附件"
            onClick={() => setAttachment(null)}
          >
            ×
          </button>
        </div>
      )}

      <div className="pi-bar" ref={menuRef}>
        {/* ＋ 功能入口 */}
        <button
          type="button"
          className={`pi-plus${menuOpen ? ' open' : ''}`}
          title="功能菜单"
          onClick={() => {
            setMenuOpen((v) => !v)
            setSubMenu(null)
          }}
        >
          <PlusIcon size={13} />
        </button>

        <textarea
          className="pi-textarea"
          placeholder={placeholder}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (canSend) setText('')
            }
          }}
        />

        <button
          type="button"
          className={`pi-send${canSend ? ' ok' : ''}`}
          disabled={!canSend}
          title="发送"
          onClick={() => canSend && setText('')}
        >
          <ArrowUpIcon size={11} />
        </button>

        {/* ＋ 功能菜单（向上弹出；二级选择内联展开） */}
        {menuOpen && (
          <div className="pi-menu">
            {subMenu === null && (
              <>
                <div className="pm-group">插入</div>
                <button type="button" className="pm-item" onClick={addMockAttachment}>
                  <FolderIcon size={13} />
                  <span>添加附件</span>
                </button>
                <button type="button" className="pm-item" onClick={startRecording}>
                  <AtIcon size={13} />
                  <span>引用 · @ 长录音</span>
                </button>
                <div className="pm-sep" />
                <div className="pm-group">设置</div>
                <button type="button" className="pm-item" onClick={() => setSubMenu('editMode')}>
                  <CodeIcon size={13} />
                  <span>编辑模式</span>
                  <span className="pm-val green">{editMode}</span>
                </button>
                <button type="button" className="pm-item" onClick={() => setSubMenu('runMode')}>
                  <BoltIcon size={13} />
                  <span>运行模式</span>
                  <span className="pm-val">{runMode}</span>
                </button>
                <button type="button" className="pm-item" onClick={() => setSubMenu('model')}>
                  <RobotIcon size={13} />
                  <span>模型</span>
                  <span className="pm-val">翼构 · {model}</span>
                </button>
                <button type="button" className="pm-item" onClick={() => setSubMenu('context')}>
                  <BranchIcon size={13} />
                  <span>上下文</span>
                  <span className="pm-val">{ctxProject} · {ctxBranch}</span>
                </button>
              </>
            )}

            {subMenu === 'editMode' && (
              <div className="pi-sub">
                <button type="button" className="pi-sub-back" onClick={() => setSubMenu(null)}>
                  ‹ 编辑模式
                </button>
                {EDIT_MODES.map((m) => subItem(m, m === editMode, () => setEditMode(m)))}
              </div>
            )}
            {subMenu === 'runMode' && (
              <div className="pi-sub">
                <button type="button" className="pi-sub-back" onClick={() => setSubMenu(null)}>
                  ‹ 运行模式
                </button>
                {RUN_MODES.map((m) => subItem(m, m === runMode, () => setRunMode(m)))}
              </div>
            )}
            {subMenu === 'model' && (
              <div className="pi-sub">
                <button type="button" className="pi-sub-back" onClick={() => setSubMenu(null)}>
                  ‹ 模型
                </button>
                {MODELS.map((m) => subItem(m, m === model, () => setModel(m)))}
              </div>
            )}
            {subMenu === 'context' && (
              <div className="pi-sub">
                <button type="button" className="pi-sub-back" onClick={() => setSubMenu(null)}>
                  ‹ 上下文 · 项目 / 分支
                </button>
                {CONTEXT_PROJECTS.map((p) => subItem(p, p === ctxProject, () => setCtxProject(p)))}
                <div className="pm-sep" />
                {CONTEXT_BRANCHES.map((b) => subItem(b, b === ctxBranch, () => setCtxBranch(b)))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 录音小窗（fixed 浮窗，跨窗格复用） */}
      {recordingId !== null && (
        <RecordingWidget
          sessionId={recordingId}
          onAddToInput={(file) => setAttachment((prev) => (prev?.id === file.id ? prev : file))}
          onClose={() => setRecordingId(null)}
        />
      )}
    </div>
  )
}
