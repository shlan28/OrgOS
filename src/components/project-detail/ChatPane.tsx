import { useEffect, useMemo, useRef, useState } from 'react'
import type { AutoJob, Project, ProjectSession, RunMessage } from '../../data/projects'
import { CURRENT_USER, ADE_SENDER, getPeriodState } from '../../data/projects'
import { UsersIcon } from '../icons'
import { isActiveRun } from '../../hooks/useAutomationEngine'
import type { AutomationEngine } from '../../hooks/useAutomationEngine'
import ChatMessage from './ChatMessage'
import MembersDrawer from './MembersDrawer'
import MentionInput, { mentionOptionsOf, type MentionInputHandle } from './MentionInput'
import './ChatPane.css'

/** 手动会话插话的 ADE 假回应延迟（毫秒） */
const MANUAL_REPLY_DELAY = 1500

const nowTime = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const msgId = () => `m${Date.now()}${Math.floor(Math.random() * 1000)}`

interface ChatPaneProps {
  project: Project
  /** 当前会话（activeSessionId 状态在 ProjectDetail，格 1/2/3 共享） */
  activeSession: ProjectSession | null
  /** 当前会话关联的任务（auto 会话，消息实时取 run） */
  job: AutoJob | null
  /** 更新项目数据（手动会话消息/日志 append / 会话改名 / 成员写操作） */
  onUpdateProject: (projectId: string, updater: (p: Project) => Project) => void
  /** 自动化运行引擎（auto 会话消息联动 / Gate 动作 / 插话） */
  engine: AutomationEngine
}

/**
 * 格 2：会话详情。单行头部（会话名可点击改名 + 自动化 tag + 成员 icon）
 * + 消息流（auto 实时联动引擎）+ 插话输入框 + 会话成员只读抽屉。
 */
export default function ChatPane({
  project, activeSession, job, onUpdateProject, engine,
}: ChatPaneProps) {
  /** 成员抽屉开关 */
  const [membersOpen, setMembersOpen] = useState(false)
  /** 会话名编辑态：input 值 */
  const [nameDraft, setNameDraft] = useState<string | null>(null)

  /** 提及输入框句柄（清空/聚焦）；候选 = 项目成员 + 项目 ADE */
  const mentionRef = useRef<MentionInputHandle>(null)
  const mentionOptions = useMemo(
    () => mentionOptionsOf(project.members, project.agents),
    [project.members, project.agents],
  )

  const streamRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)
  /** 手动会话假回应定时器（卸载清理） */
  const replyTimer = useRef<number | null>(null)

  const run = job ? job.currentRun ?? job.history[0] : undefined
  const active = isActiveRun(job?.currentRun)
  const waiting = job?.currentRun?.status === '等待确认' || job?.currentRun?.status === '等待输入'
  const messages: RunMessage[] = job
    ? run?.messages ?? []
    : activeSession?.messages ?? []

  /** 头部 tooltip：项目名/状态/周期（格内不平铺，悬停可见） */
  const headTooltip = useMemo(() => {
    const state = getPeriodState(project)
    const hint = state.kind === 'expiring' || state.kind === 'running' || state.kind === 'overdue'
      ? `（${state.kind === 'overdue' ? '已逾期' : '剩'} ${state.days} 天）`
      : ''
    return `${project.name} · ${project.status} · ${project.description} · 周期 ${project.startDate} ~ ${project.endDate}${hint}`
  }, [project])

  // 切换会话时退出改名态
  useEffect(() => {
    setNameDraft(null)
  }, [activeSession?.id])

  /** 保存会话名（空值回退原名） */
  const commitRename = () => {
    const next = nameDraft?.trim()
    if (activeSession && next && next !== activeSession.name) {
      onUpdateProject(project.id, (p) => ({
        ...p,
        sessions: p.sessions.map((s) => (s.id === activeSession.id ? { ...s, name: next } : s)),
      }))
    }
    setNameDraft(null)
  }

  // 消息流自动滚动（仅当已处于底部时跟随）
  useEffect(() => {
    const el = streamRef.current
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight
  }, [messages.length, activeSession?.id])

  useEffect(() => () => {
    if (replyTimer.current) window.clearTimeout(replyTimer.current)
  }, [])

  const handleStreamScroll = () => {
    const el = streamRef.current
    if (!el) return
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  /** 插话发送：auto 活动运行走引擎；手动会话本地 append（消息 + 工具日志）+ ADE 假回应 */
  const handleSend = (text: string) => {
    if (!text || !activeSession) return
    stickBottom.current = true

    if (job) {
      if (!active) return
      engine.sendMessage(project.id, job.id, text)
      return
    }

    const time = nowTime()
    // 手动会话：append 人消息 + agent CLI 轨迹行（同一次更新事务）
    const humanMsg: RunMessage = {
      id: msgId(), role: '人', text, time,
      sender: { name: CURRENT_USER.name, initial: CURRENT_USER.initial, color: CURRENT_USER.color },
    }
    onUpdateProject(project.id, (p) => ({
      ...p,
      sessions: p.sessions.map((s) => (s.id === activeSession.id ? {
        ...s,
        messages: [...s.messages, humanMsg],
        logs: [...(s.logs ?? []), { id: msgId(), time, kind: 'prompt' as const, text }],
      } : s)),
    }))

    replyTimer.current = window.setTimeout(() => {
      const replyTime = nowTime()
      const adeMsg: RunMessage = {
        id: msgId(), role: 'ADE',
        text: '收到。当前为空闲会话，已将你的消息作为新任务指令排队执行。',
        time: replyTime,
        sender: { name: ADE_SENDER.name, initial: ADE_SENDER.initial, color: ADE_SENDER.color },
      }
      onUpdateProject(project.id, (p) => ({
        ...p,
        sessions: p.sessions.map((s) => (s.id === activeSession.id ? {
          ...s,
          messages: [...s.messages, adeMsg],
          logs: [...(s.logs ?? []), { id: msgId(), time: replyTime, kind: 'think' as const, text: '空闲会话指令已入队，等待调度执行' }],
        } : s)),
      }))
    }, MANUAL_REPLY_DELAY)
  }

  return (
    <div className="chat-pane">
      {/* 单行头部 = 当前会话行：会话名（点击改名）+ 自动化 tag + 成员 icon */}
      <div className="chat-session-bar" title={headTooltip}>
        <div className="chat-session-title">
          {nameDraft === null ? (
            <button
              type="button"
              className="s-name s-name-btn"
              title={activeSession ? '点击修改会话名' : undefined}
              disabled={!activeSession}
              onClick={() => activeSession && setNameDraft(activeSession.name)}
            >
              {activeSession?.name ?? '暂无会话'}
              {activeSession?.source === 'auto' && <span className="s-tag">自动化</span>}
            </button>
          ) : (
            <input
              className="s-name-input"
              value={nameDraft}
              autoFocus
              spellCheck={false}
              maxLength={40}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setNameDraft(null)
              }}
            />
          )}
        </div>
        <button
          type="button"
          className={`icon-toggle${membersOpen ? ' active' : ''}`}
          title="会话成员"
          onClick={() => setMembersOpen((v) => !v)}
        >
          <UsersIcon size={15} />
        </button>
      </div>

      {/* 消息流（ChatMessage 共享渲染） */}
      <div className="chat-stream" ref={streamRef} onScroll={handleStreamScroll}>
        {messages.length > 0 ? (
          messages.map((m, i) => (
            <ChatMessage
              key={m.id}
              message={m}
              prevMessage={messages[i - 1]}
              job={job}
              waiting={waiting}
              onApprove={(jobId) => engine.approve(project.id, jobId)}
              onReject={(jobId) => engine.reject(project.id, jobId)}
              onSubmit={(jobId, values) => engine.submit(project.id, jobId, values)}
            />
          ))
        ) : (
          <div className="chat-stream-empty">
            {activeSession ? '会话已就绪，发送第一条消息开始' : '暂无会话，点击左上角「＋」新建'}
          </div>
        )}
      </div>

      {/* 插话输入框：@ 提及项目成员/ADE；auto 活动运行 / 手动会话可用 */}
      <div className="chat-input">
        <span
          className="run-msg-avatar"
          style={{ background: CURRENT_USER.color ?? '#5b7ba6' }}
          title={`以 ${CURRENT_USER.name} 身份发送`}
        >
          {CURRENT_USER.initial}
        </span>
        <MentionInput
          ref={mentionRef}
          options={mentionOptions}
          placeholder={job ? (active ? '给运行中的任务发消息…' : '任务空闲，输入将转为新任务指令…') : '发送消息，@ 可提及成员或 ADE…'}
          disabled={!!job && !active}
          onSend={(text) => handleSend(text)}
        />
        <button
          type="button"
          className="chat-send-btn"
          disabled={!!job && !active}
          onClick={() => mentionRef.current?.submit()}
          aria-label="发送"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      {/* 会话成员抽屉（只读覆盖式，格内显示；添加/编辑在编辑项目弹窗） */}
      {membersOpen && (
        <MembersDrawer
          project={project}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </div>
  )
}
