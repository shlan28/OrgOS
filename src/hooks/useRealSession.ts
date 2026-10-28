import { useCallback, useEffect, useRef, useState } from 'react'
import { runtimeApi, type ChatMessage, type HarnessEvent } from '../lib/runtimeApi'
import { clock, clockOf, toLine, type Line } from '../lib/harnessLines'

const PAGE_SIZE = 50

/** 按 id 合并消息并保持时间顺序（重复 id 以新数据为准） */
const mergeMessages = (base: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] => {
  const map = new Map(base.map((m) => [m.id, m]))
  for (const m of incoming) map.set(m.id, m)
  return [...map.values()].sort((a, b) => {
    const ta = Date.parse(a.at) || 0
    const tb = Date.parse(b.at) || 0
    return ta - tb
  })
}

/**
 * 一个真实会话的运行状态：消息（分页）、事件行、运行中标志、发送 / 停止。
 * 控制台与项目详情共用，保证两处行为一致。
 */
export function useRealSession(
  sessionId: string | null,
  onTurnEnd?: () => void,
  currentUserName = '',
) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [queued, setQueued] = useState(false)
  const [queuePosition, setQueuePosition] = useState(0)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const esRef = useRef<EventSource | null>(null)
  const turnRef = useRef<string | null>(null)

  /** 拉最新一页消息（保留已加载的更早消息） */
  const reload = useCallback(async () => {
    if (!sessionId) return
    try {
      const page = await runtimeApi.messages(sessionId, { limit: PAGE_SIZE })
      setMessages((prev) => mergeMessages(prev, page.messages))
      setHasMore(page.hasMore)
      setNextBefore(page.nextBefore)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载消息失败')
    }
  }, [sessionId])

  useEffect(() => {
    esRef.current?.close()
    esRef.current = null
    turnRef.current = null
    setBusy(false)
    setQueued(false)
    setQueuePosition(0)
    setLines([])
    setError('')
    setHasMore(false)
    setNextBefore(null)
    if (!sessionId) { setMessages([]); return }
    let alive = true
    runtimeApi.messages(sessionId, { limit: PAGE_SIZE })
      .then((page) => {
        if (!alive) return
        setMessages(page.messages)
        setHasMore(page.hasMore)
        setNextBefore(page.nextBefore)
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : '加载消息失败'))
    // 历史事件 → CLI 轨迹（默认最近 50 轮）
    runtimeApi.sessionEvents(sessionId)
      .then(({ events }) => {
        if (!alive) return
        const history = events
          .map((e) => {
            const line = toLine(e.payload, clockOf(e.at))
            return line ? { ...line, key: `h:${e.turnId}:${e.seq}` } : null
          })
          .filter((l): l is Line => Boolean(l))
        setLines(history)
      })
      .catch(() => { /* CLI 历史不可用时只显示新事件 */ })
    return () => { alive = false }
  }, [sessionId])

  useEffect(() => () => { esRef.current?.close() }, [])

  /** 向上加载更早的消息 */
  const loadOlder = useCallback(async () => {
    if (!sessionId || !hasMore || nextBefore == null || loadingOlder) return
    setLoadingOlder(true)
    try {
      const page = await runtimeApi.messages(sessionId, { before: nextBefore, limit: PAGE_SIZE })
      setMessages((prev) => mergeMessages(page.messages, prev))
      setHasMore(page.hasMore)
      setNextBefore(page.nextBefore)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载历史消息失败')
    } finally {
      setLoadingOlder(false)
    }
  }, [sessionId, hasMore, nextBefore, loadingOlder])

  const send = useCallback(async (content: string, useKnowledge = false, useMemory = true) => {
    const text = content.trim()
    if (!text || !sessionId) return
    setError('')

    let turnId = ''
    try {
      const { turn, queuePosition: position } = await runtimeApi.createTurn(sessionId, text, useKnowledge, useMemory)
      turnId = turn.id
      turnRef.current = turnId
      setQueuePosition(position ?? 1)
      setQueued(turn.status === 'queued')
      setMessages((list) => mergeMessages(list, [{
        id: `u:${turnId}`,
        role: 'user',
        content: text,
        at: new Date().toISOString(),
        userName: currentUserName,
      }]))
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败')
      return
    }

    setBusy(true)
    const es = new EventSource(runtimeApi.streamUrl(turnId))
    esRef.current = es

    es.onmessage = (ev) => {
      let event: HarnessEvent
      try { event = JSON.parse(ev.data) } catch { return }
      setQueued(false)
      const line = toLine(event, clock())
      if (line) setLines((list) => [...list, line])
      if (event.type === 'final' && event.text.trim()) {
        setMessages((list) => mergeMessages(list, [{
          id: `a:${turnId}`,
          role: 'assistant',
          content: event.text,
          at: new Date().toISOString(),
          turnId,
        }]))
      }
    }

    const finish = () => {
      es.close()
      if (esRef.current === es) esRef.current = null
      turnRef.current = null
      setBusy(false)
      setQueued(false)
      void reload()
      onTurnEnd?.()
    }

    es.addEventListener('end', finish)
    es.onerror = finish
  }, [sessionId, onTurnEnd, currentUserName, reload])

  const stop = useCallback(async () => {
    if (turnRef.current) await runtimeApi.cancelTurn(turnRef.current).catch(() => {})
    turnRef.current = null
    esRef.current?.close()
    esRef.current = null
    setBusy(false)
  }, [])

  return {
    messages, lines, busy, queued, queuePosition, error,
    hasMore, loadingOlder, loadOlder, reload, send, stop,
  }
}
