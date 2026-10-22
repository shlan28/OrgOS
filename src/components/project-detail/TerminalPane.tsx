import { useEffect, useMemo, useRef } from 'react'
import type { Project, ProjectSession, TerminalLog } from '../../data/projects'
import { logAgentIdOf, runLogsOf } from '../../data/projects'
import { isActiveRun } from '../../hooks/useAutomationEngine'
import './TerminalPane.css'

interface TerminalPaneProps {
  project: Project
  /** 当前会话（格 1/2/3 共享，状态在 ProjectDetail） */
  activeSession: ProjectSession | null
  /** 当前选中 ADE（多 agent tab 状态在 ProjectDetail，与格 2 插话共享） */
  activeAgentId: string | null
  /** 切换 ADE tab */
  onSelectAgent: (agentId: string) => void
}

/** auto 会话当前运行（无 = 历史） */
const activeRunOf = (project: Project, session: ProjectSession | null) => {
  if (!session || session.source !== 'auto' || !session.jobId) return undefined
  const job = project.autoJobs.find((j) => j.id === session.jobId)
  return job?.currentRun ?? job?.history[0]
}

/** kind → 行前缀（cmd/prompt 用 ❯ 提示符，其余用语义前缀） */
const KIND_PREFIX: Partial<Record<TerminalLog['kind'], string>> = {
  think: '◦',
  file: '▸',
  tool: '⚡',
  ok: '✓',
  err: '✗',
  info: '▸',
}

/**
 * 格 3：Agent CLI 模式——还原 agent loop 的完整操作轨迹。
 * auto 会话从 run.messages 派生（思考/工具调用/命令/原始输出/文件读写）；
 * manual 会话读 session.logs（插话联动 append prompt/think 行）。
 * 多 ADE 项目头部下有 agent tab 层：每个 agent 一个独立 CLI 轨迹桶。
 */
export default function TerminalPane({
  project, activeSession, activeAgentId, onSelectAgent,
}: TerminalPaneProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)

  const run = activeRunOf(project, activeSession)
  const isAuto = activeSession?.source === 'auto'
  const agents = project.agents
  /** auto 会话轨迹实时派生（按 agent 打标）；manual 读 session.logs */
  const logs: TerminalLog[] = useMemo(
    () => (isAuto ? runLogsOf(run, agents) : activeSession?.logs ?? []),
    [isAuto, run, agents, activeSession],
  )
  /** 当前 agent 的轨迹桶（log.agentId 缺省归主 agent） */
  const activeLogs = useMemo(
    () => logs.filter((l) => logAgentIdOf(l, agents) === activeAgentId),
    [logs, agents, activeAgentId],
  )

  // 吸底跟随（仅当已处于底部时）
  useEffect(() => {
    const el = bodyRef.current
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight
  }, [activeLogs.length, activeSession?.id])

  const handleScroll = () => {
    const el = bodyRef.current
    if (!el) return
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const running = isAuto && isActiveRun(run)

  /** 单条轨迹 → 行内容（多行 text 逐行渲染；前缀/提示符按 kind） */
  const renderLog = (l: TerminalLog) => {
    const lines = l.text.split('\n')
    const prefix = KIND_PREFIX[l.kind]
    const showPrompt = l.kind === 'cmd' || l.kind === 'prompt'
    return (
      <div key={l.id} className={`term-line ${l.kind}`}>
        {lines.map((line, i) => (
          <div key={i} className="term-row">
            {i === 0 && <span className="ts">{l.time}</span>}
            {i > 0 && <span className="ts" />}
            {i === 0 && showPrompt && <span className="sym">❯</span>}
            {i > 0 && showPrompt && <span className="sym" />}
            {i === 0 && prefix && !showPrompt && <span className="sym">{prefix}</span>}
            {i > 0 && prefix && !showPrompt && <span className="sym" />}
            <span className={`body${i > 0 ? ' cont' : ''}`}>{line}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="terminal-pane">
      <div className="term-head">
        <span className="term-title">Agent CLI</span>
        {activeSession && <span className="term-sess" title={activeSession.name}>{activeSession.name}</span>}
        {running && <span className="term-running-dot" title="agent loop 运行中，轨迹实时增长" />}
      </div>
      {/* agent tab 层：多 ADE 项目显示（每个 agent 一个 CLI 实例） */}
      {agents.length > 1 && (
        <div className="term-agent-tabs" role="tablist" aria-label="ADE 轨迹切换">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={a.id === activeAgentId}
              className={`term-agent-tab${a.id === activeAgentId ? ' active' : ''}`}
              title={`${a.name} · ${a.role} · ${a.model}${a.status === '工作中' ? ` · 工作中：${a.currentTask}` : ''}`}
              onClick={() => onSelectAgent(a.id)}
            >
              <span
                className={`term-agent-dot${a.status === '工作中' ? ' busy' : ''}`}
                title={a.status === '工作中' ? '工作中' : '空闲'}
              />
              <span className="term-agent-name">{a.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="term-body" ref={bodyRef} onScroll={handleScroll}>
        {activeLogs.length > 0 ? (
          activeLogs.map(renderLog)
        ) : (
          <div className="term-line term-empty">
            <div className="term-row">
              <span className="ts" />
              <span className="sym">❯</span>
              <span className="body">
                等待 agent 启动…
                <span className="term-cursor" />
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
