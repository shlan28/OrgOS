import { useEffect, useMemo, useRef, useState } from 'react'
import type { Project, ProjectSession, TerminalLog } from '../../data/projects'
import { runLogsOf } from '../../data/projects'
import { isActiveRun } from '../../hooks/useAutomationEngine'
import './TerminalPane.css'

interface TerminalPaneProps {
  project: Project
  /** 当前会话（格 1/2/3 共享，状态在 ProjectDetail） */
  activeSession: ProjectSession | null
  /** 更新项目数据（manual 会话插话日志 append） */
  onUpdateProject: (projectId: string, updater: (p: Project) => Project) => void
}

/** auto 会话当前运行（无 = 历史） */
const activeRunOf = (project: Project, session: ProjectSession | null) => {
  if (!session || session.source !== 'auto' || !session.jobId) return undefined
  const job = project.autoJobs.find((j) => j.id === session.jobId)
  return job?.currentRun ?? job?.history[0]
}

/**
 * 格 3：ADE 工具调用日志（浅底 mono 日志风）。
 * auto 会话从 run.messages 实时派生（引擎推进自动增长）；
 * manual 会话读 session.logs（插话联动 append）。
 */
export default function TerminalPane({ project, activeSession, onUpdateProject }: TerminalPaneProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)
  /** 清空确认态（manual 会话专用；auto 日志跟随运行不可截断） */
  const [confirmingClear, setConfirmingClear] = useState(false)

  const run = activeRunOf(project, activeSession)
  const isAuto = activeSession?.source === 'auto'
  /** auto 会话日志实时派生；manual 读 session.logs */
  const logs: TerminalLog[] = useMemo(
    () => (isAuto ? runLogsOf(run) : activeSession?.logs ?? []),
    [isAuto, run, activeSession],
  )

  // 吸底跟随（仅当已处于底部时）
  useEffect(() => {
    const el = bodyRef.current
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight
  }, [logs.length, activeSession?.id])

  const handleScroll = () => {
    const el = bodyRef.current
    if (!el) return
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  /** 清空 manual 会话日志 */
  const handleClear = () => {
    if (!activeSession || isAuto) return
    if (!confirmingClear) {
      setConfirmingClear(true)
      return
    }
    onUpdateProject(project.id, (p) => ({
      ...p,
      sessions: p.sessions.map((s) => (s.id === activeSession.id ? { ...s, logs: [] } : s)),
    }))
    setConfirmingClear(false)
    stickBottom.current = true
  }

  const running = isAuto && isActiveRun(run)

  return (
    <div className="terminal-pane">
      <div className="term-head">
        <span className="term-title">ADE 工具日志</span>
        {activeSession && <span className="term-sess" title={activeSession.name}>{activeSession.name}</span>}
        {activeSession && !isAuto && (
          <button
            type="button"
            className={`term-clear-btn${confirmingClear ? ' confirm' : ''}`}
            onClick={handleClear}
            title="清空本会话日志"
          >
            {confirmingClear ? '确认清空' : '清空'}
          </button>
        )}
        {running && <span className="term-running-dot" title="日志实时跟随运行" />}
      </div>
      <div className="term-body" ref={bodyRef} onScroll={handleScroll}>
        {logs.length > 0 ? (
          logs.map((l) => (
            <div key={l.id} className={`tl ${l.kind}`}>
              <span className="ts">{l.time}</span>
              {l.kind === 'cmd' && <span className="sym">❯</span>}
              <span className="body">{l.text}</span>
            </div>
          ))
        ) : (
          <div className="tl term-empty">
            <span className="ts" />
            <span className="sym">❯</span>
            <span className="body">
              等待 agent 调用工具…
              <span className="term-cursor" />
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
