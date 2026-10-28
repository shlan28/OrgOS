import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { sandboxApi, type SandboxStatus } from '../../lib/sandboxApi'
import './PtyTerminalPanel.css'

interface PtyTerminalPanelProps {
  projectId: string
}

type WsState = 'idle' | 'connecting' | 'open' | 'closed'

const STATUS_TEXT: Record<string, string> = {
  disabled: '非研发项目没有终端',
  docker_unavailable: 'Docker 未运行',
  stopped: '沙箱未启动',
  starting: '正在准备沙箱…',
  error: '沙箱启动失败',
}

/** 格 4「终端」：连接项目沙箱容器内的 bash */
export default function PtyTerminalPanel({ projectId }: PtyTerminalPanelProps) {
  const [status, setStatus] = useState<SandboxStatus | null>(null)
  const [error, setError] = useState('')
  const [wsState, setWsState] = useState<WsState>('idle')
  const [retryKey, setRetryKey] = useState(0)

  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const startRequested = useRef(false)

  /* —— 状态轮询：停止态自动拉起一次，其余状态交给用户重试 —— */
  useEffect(() => {
    startRequested.current = false
  }, [projectId, retryKey])

  useEffect(() => {
    let alive = true
    let timer = 0

    const tick = async () => {
      try {
        let next = await sandboxApi.status(projectId)
        if (!alive) return
        setStatus(next)
        setError('')

        if (next.enabled && next.status === 'stopped' && !startRequested.current) {
          startRequested.current = true
          next = await sandboxApi.start(projectId)
          if (!alive) return
          setStatus(next)
        }

        if (['running', 'disabled', 'error', 'docker_unavailable'].includes(next.status)) return
        timer = window.setTimeout(tick, 1500)
      } catch (err) {
        if (!alive) return
        setError(err instanceof Error ? err.message : '获取沙箱状态失败')
        timer = window.setTimeout(tick, 3000)
      }
    }

    void tick()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [projectId, retryKey])

  /* —— xterm 实例（只在 running 时存在） —— */
  useEffect(() => {
    if (status?.status !== 'running' || !hostRef.current || termRef.current) return
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "'SF Mono', Menlo, Monaco, 'Noto Sans Mono CJK SC', monospace",
      theme: {
        background: '#111418',
        foreground: '#d7dae0',
        cursor: '#7cc4ff',
        selectionBackground: '#2b3a4a',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    term.onData((data) => {
      const ws = wsRef.current
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    const onResize = () => {
      if (!fitRef.current) return
      fitRef.current.fit()
      const ws = wsRef.current
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }
    window.addEventListener('resize', onResize)
    const observer = new ResizeObserver(onResize)
    observer.observe(hostRef.current)

    return () => {
      window.removeEventListener('resize', onResize)
      observer.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [status?.status, projectId])

  /* —— WebSocket 连接 —— */
  useEffect(() => {
    if (status?.status !== 'running') return
    const term = termRef.current
    if (!term) return

    let cancelled = false
    setWsState('connecting')
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${window.location.host}/api/projects/${encodeURIComponent(projectId)}/sandbox/terminal?cols=${term.cols}&rows=${term.rows}`
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      if (cancelled) return
      setWsState('open')
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let msg: { type?: string; phase?: string; message?: string; code?: number }
        try { msg = JSON.parse(ev.data) } catch { return }
        if (msg.type === 'status' && msg.phase === 'error') {
          setError(msg.message || '终端启动失败')
        }
        if (msg.type === 'exit') {
          setWsState('closed')
        }
        return
      }
      if (ev.data instanceof ArrayBuffer) term.write(new Uint8Array(ev.data))
    }

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null
      if (cancelled) return
      setWsState('closed')
      // 容器可能已空闲停止：重新查询状态并按需拉起
      setRetryKey((k) => k + 1)
    }

    return () => {
      cancelled = true
      ws.onclose = null
      ws.close()
      if (wsRef.current === ws) wsRef.current = null
    }
  }, [projectId, status?.status, retryKey])

  const retry = useCallback(async () => {
    setError('')
    setWsState('connecting')
    try {
      const next = await sandboxApi.start(projectId)
      setStatus(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动沙箱失败')
    }
    setRetryKey((k) => k + 1)
  }, [projectId])

  const running = status?.status === 'running'
  const overlayVisible = !running || wsState === 'closed' || wsState === 'connecting'
  const state = status?.status || 'starting'
  const title = STATUS_TEXT[state] || '正在准备沙箱…'
  const detail = error || status?.message
    || (state === 'docker_unavailable'
      ? '请先启动 Docker Desktop，然后点击重试'
      : state === 'disabled'
        ? ''
        : '首次启动需要准备容器，可能需要几十秒')

  return (
    <div className="pty-panel">
      <div className="pty-term" ref={hostRef} />
      {overlayVisible && (
        <div className="pty-overlay">
          <div className="pty-card">
            {running ? (
              <>
                <div className="pty-title">终端连接已断开</div>
                <p className="pty-desc">沙箱可能已空闲停止，重新连接会自动拉起。</p>
                <button type="button" className="pty-btn primary" onClick={() => setRetryKey((k) => k + 1)}>
                  重新连接
                </button>
              </>
            ) : (
              <>
                <div className="pty-title">{title}</div>
                {detail && <p className="pty-desc">{detail}</p>}
                {state === 'starting' && <div className="pty-spinner" />}
                {status?.enabled && state !== 'disabled' && (
                  <button type="button" className="pty-btn primary" onClick={() => void retry()}>
                    重试
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
