import { useEffect, useRef } from 'react'
import type { AdeAgent, TerminalLog } from '../../data/projects'
import type { RuntimeSession } from '../../lib/runtimeApi'
import './TerminalPane.css'

interface TerminalPaneProps {
  /** 当前会话（后端持久化） */
  session: RuntimeSession | null
  /** 会话所属 agent（真实项目 agent） */
  agent: AdeAgent | null
  /** 真实 dsh 事件行 */
  logs: TerminalLog[]
  /** 运行中（驱动头部呼吸点） */
  busy: boolean
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
 * 格 3：Agent CLI 模式——还原 agent loop 的真实操作轨迹。
 * 数据来自后端持久化事件（useRealSession → lines），一个会话对应一个 agent；不再有 mock 轨迹。
 */
export default function TerminalPane({
  session, agent, logs, busy,
}: TerminalPaneProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)

  // 吸底跟随（仅当已处于底部时）
  useEffect(() => {
    const el = bodyRef.current
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight
  }, [logs.length, session?.id])

  const handleScroll = () => {
    const el = bodyRef.current
    if (!el) return
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

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
        {session && <span className="term-sess" title={session.title}>{session.title}</span>}
        {agent && <span className="term-agent" title={`${agent.name} · ${agent.role} · ${agent.model}`}>{agent.name}</span>}
        {busy && <span className="term-running-dot" title="agent loop 运行中，轨迹实时增长" />}
      </div>
      <div className="term-body" ref={bodyRef} onScroll={handleScroll}>
        {logs.length > 0 ? (
          logs.map(renderLog)
        ) : (
          <div className="term-line term-empty">
            <div className="term-row">
              <span className="ts" />
              <span className="sym">❯</span>
              <span className="body">
                {session ? '等待 agent 启动…' : '暂无会话'}
                <span className="term-cursor" />
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
