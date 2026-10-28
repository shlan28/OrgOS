import { useEffect, useMemo, useRef, useState } from 'react'
import type { AdeAgent, Project, RunMessage } from '../../data/projects'
import { getPeriodState } from '../../data/projects'
import type { RuntimeSession } from '../../lib/runtimeApi'
import { UsersIcon, TerminalIcon, PlusIcon } from '../icons'
import ChatMessage from './ChatMessage'
import MembersDrawer from './MembersDrawer'
import MentionInput, { mentionOptionsOf, type MentionInputHandle } from './MentionInput'
import './ChatPane.css'

interface ChatPaneProps {
  project: Project
  /** 当前会话（后端持久化；成员/agent 均来自项目真实数据） */
  session: RuntimeSession | null
  /** 会话所属 agent（真实项目 agent） */
  agent: AdeAgent | null
  /** 真实消息（用户 / agent） */
  messages: RunMessage[]
  /** 发送中（阻止重复发送） */
  busy: boolean
  /** 本条消息是否还在排队 */
  queued: boolean
  /** 队列位置（1 = 正在执行或下一条） */
  queuePosition: number
  /** 最近一次错误 */
  error: string
  /** 当前登录用户名（发送身份 / 成员「我」标识） */
  currentUserName: string
  /** 是否还有更早消息 */
  hasMore: boolean
  /** 正在加载更早消息 */
  loadingOlder: boolean
  /** 加载更早消息 */
  onLoadOlder: () => void
  onSend: (text: string, useKnowledge: boolean, useMemory: boolean) => Promise<void> | void
  /** 项目是否开启记忆注入（关闭时本轮开关置灰） */
  memoryInjectEnabled: boolean
  /** 右侧 Agent CLI 格子是否展开 */
  cliOpen: boolean
  /** 展开/收起 Agent CLI */
  onToggleCli: () => void
  /** 会话改名（写回后端） */
  onRename: (sessionId: string, title: string) => void
}

/**
 * 格 2：会话详情。单行头部（会话名可点击改名 + 成员 icon）
 * + 真实消息流 + 输入框 + 会话成员只读抽屉。
 */
export default function ChatPane({
  project, session, agent, messages, busy, queued, queuePosition, error,
  currentUserName, hasMore, loadingOlder, onLoadOlder, onSend, onRename,
  cliOpen, onToggleCli, memoryInjectEnabled,
}: ChatPaneProps) {
  /** 成员抽屉开关 */
  const [membersOpen, setMembersOpen] = useState(false)
  /** 本轮是否先检索项目知识库 */
  const [useKnowledge, setUseKnowledge] = useState(false)
  /** 本轮是否注入项目记忆（默认跟随项目开关，会话内保持） */
  const [useMemory, setUseMemory] = useState(memoryInjectEnabled)

  useEffect(() => {
    setUseMemory(memoryInjectEnabled)
  }, [memoryInjectEnabled])
  /** 输入框左侧「＋」菜单 */
  const [toolsOpen, setToolsOpen] = useState(false)
  const toolsRef = useRef<HTMLDivElement>(null)
  /** 会话名编辑态：input 值 */
  const [nameDraft, setNameDraft] = useState<string | null>(null)

  /** 提及输入框句柄（清空/聚焦）；候选 = 项目真实成员 + 项目真实 agent */
  const mentionRef = useRef<MentionInputHandle>(null)
  const mentionOptions = useMemo(
    () => mentionOptionsOf(project.members, project.agents),
    [project.members, project.agents],
  )

  const streamRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)
  /** 加载更早消息前的高度（用于保持滚动位置） */
  const prependHeight = useRef<number | null>(null)

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
  }, [session?.id])

  /** 保存会话名（空值 / 未变化则不改） */
  const commitRename = () => {
    const next = nameDraft?.trim()
    if (session && next && next !== session.title) onRename(session.id, next)
    setNameDraft(null)
  }

  useEffect(() => {
    if (!toolsOpen) return
    const close = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolsOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [toolsOpen])

  // 消息流自动滚动（仅当已处于底部时跟随）
  useEffect(() => {
    const el = streamRef.current
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight
  }, [messages.length, session?.id])

  const handleStreamScroll = () => {
    const el = streamRef.current
    if (!el) return
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (el.scrollTop < 40 && hasMore && !loadingOlder) {
      prependHeight.current = el.scrollHeight
      onLoadOlder()
    }
  }

  // 顶部加载更早消息后保持视口位置
  useEffect(() => {
    const el = streamRef.current
    if (!el || prependHeight.current == null) return
    el.scrollTop = el.scrollHeight - prependHeight.current
    prependHeight.current = null
  }, [messages.length])

  /** 发送：直达后端会话（busy / 无会话时不可发送） */
  const handleSend = (text: string) => {
    if (!text.trim() || !session || busy) return
    stickBottom.current = true
    void onSend(text, useKnowledge, useMemory)
  }

  const disabled = !session || busy

  return (
    <div className="chat-pane">
      {/* 单行头部 = 当前会话行：会话名（点击改名）+ 成员 icon */}
      <div className="chat-session-bar" title={headTooltip}>
        <div className="chat-session-title">
          {nameDraft === null ? (
            <button
              type="button"
              className="s-name s-name-btn"
              title={session ? '点击修改会话名' : undefined}
              disabled={!session}
              onClick={() => session && setNameDraft(session.title)}
            >
              {session?.title ?? '暂无会话'}
            </button>
          ) : (
            <input
              className="s-name-input"
              value={nameDraft}
              autoFocus
              spellCheck={false}
              maxLength={60}
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
          className={`icon-toggle${cliOpen ? ' active' : ''}`}
          title={cliOpen ? '收起 Agent CLI' : '展开 Agent CLI'}
          onClick={onToggleCli}
        >
          <TerminalIcon size={15} />
        </button>
        <button
          type="button"
          className={`icon-toggle${membersOpen ? ' active' : ''}`}
          title="项目成员与 agent"
          onClick={() => setMembersOpen((v) => !v)}
        >
          <UsersIcon size={15} />
        </button>
      </div>

      {/* 会话元信息：创建者 / 项目成员数 / 当前执行 agent */}
      {session && (
        <div className="chat-session-meta">
          <span>{session.createdBy || '未知'} 创建</span>
          <span>·</span>
          <span>{project.members.length} 位项目成员</span>
          <span>·</span>
          <span>执行 {agent?.name ?? '—'}</span>
        </div>
      )}

      {/* 消息流（ChatMessage 共享渲染） */}
      <div className="chat-stream" ref={streamRef} onScroll={handleStreamScroll}>
        {loadingOlder && <div className="chat-load-older">加载更早消息…</div>}
        {messages.length > 0 ? (
          messages.map((m, i) => (
            <ChatMessage
              key={m.id}
              message={m}
              prevMessage={messages[i - 1]}
              job={null}
              waiting={false}
            />
          ))
        ) : (
          <div className="chat-stream-empty">
            {session ? '会话已就绪，发送第一条消息开始' : '暂无会话，点击左上角「＋」新建'}
          </div>
        )}
      </div>

      {/* 队列提示：多人同时发送时按顺序执行 */}
      {queued && (
        <p className="chat-queue-hint">
          已排队，等待执行{queuePosition > 1 ? `（前方 ${queuePosition - 1} 条）` : ''}
        </p>
      )}

      {/* 插话输入框：@ 提及项目成员 / agent */}
      <div className="chat-input">
        <div className="chat-tools" ref={toolsRef}>
          <button
            type="button"
            className={`chat-kb-toggle${(useKnowledge || (memoryInjectEnabled && useMemory)) ? ' on' : ''}${toolsOpen ? ' open' : ''}`}
            disabled={disabled}
            aria-label="更多选项"
            aria-haspopup="menu"
            aria-expanded={toolsOpen}
            title="更多选项"
            onClick={() => setToolsOpen((v) => !v)}
          >
            <PlusIcon size={14} />
          </button>
          {toolsOpen && (
            <div className="chat-tools-menu" role="menu">
              <button
                type="button"
                className="chat-tools-row"
                role="menuitemcheckbox"
                aria-checked={useMemory}
                disabled={!memoryInjectEnabled}
                onClick={() => setUseMemory((v) => !v)}
              >
                <span>记忆</span>
                <span className={`chat-switch${useMemory && memoryInjectEnabled ? ' on' : ''}`} aria-hidden="true" />
              </button>
              <p className="chat-tools-hint">
                {memoryInjectEnabled ? '默认开启；关闭后本轮不使用项目记忆' : '项目已关闭记忆注入'}
              </p>
              <button
                type="button"
                className="chat-tools-row"
                role="menuitemcheckbox"
                aria-checked={useKnowledge}
                onClick={() => setUseKnowledge((v) => !v)}
              >
                <span>知识库</span>
                <span className={`chat-switch${useKnowledge ? ' on' : ''}`} aria-hidden="true" />
              </button>
              <p className="chat-tools-hint">开启后本轮先检索项目知识库再回答</p>
            </div>
          )}
        </div>
        <MentionInput
          ref={mentionRef}
          options={mentionOptions}
          placeholder={disabled
            ? (busy ? 'agent 正在回复…' : '先新建一个会话')
            : `发送消息，@ 可提及成员或 ${agent?.name ?? 'agent'}…`}
          disabled={disabled}
          onSend={(text) => handleSend(text)}
        />
        <button
          type="button"
          className="chat-send-btn"
          disabled={disabled}
          onClick={() => mentionRef.current?.submit()}
          aria-label="发送"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
      {error && <p className="chat-error">{error}</p>}

      {/* 会话成员抽屉（只读覆盖式，格内显示；添加/编辑在编辑项目弹窗） */}
      {membersOpen && (
        <MembersDrawer
          project={project}
          currentUserName={currentUserName}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </div>
  )
}
