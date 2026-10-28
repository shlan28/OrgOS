import type { HarnessEvent } from './runtimeApi'

export type LineKind = 'sys' | 'prompt' | 'think' | 'cmd' | 'out' | 'file' | 'tool' | 'ok' | 'err' | 'info'

export interface Line {
  key: string
  kind: LineKind
  sym: string
  text: string
  at: string
}

export const clock = () =>
  new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

/** ISO 时间 → HH:mm:ss（历史事件回放用） */
export const clockOf = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return clock()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const prettyInput = (input: unknown) => {
  try {
    const text = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
    return text.length > 1200 ? `${text.slice(0, 1200)}…` : text
  } catch {
    return String(input)
  }
}

const truncate = (text: string, max = 4000) => (text.length > max ? `${text.slice(0, max)}\n…` : text)

/** dsh NDJSON 事件 → 与详情页 Agent CLI 一致的终端行 */
export function toLine(event: HarnessEvent, at: string): Line | null {
  const base = { key: `${at}-${Math.random().toString(36).slice(2, 8)}`, at }
  switch (event.type) {
    case 'session':
      return { ...base, kind: 'sys', sym: '', text: `dsh session ${event.sessionId}\ncwd ${event.cwd}` }
    case 'status':
      if (event.phase === 'turn_start') return { ...base, kind: 'prompt', sym: '❯', text: `turn ${event.turn ?? ''}` }
      if (event.phase === 'step_start') return { ...base, kind: 'think', sym: '◦', text: `step ${event.step ?? ''} 开始` }
      if (event.phase === 'step_end') {
        const usage = event.usage
        const tokens = usage?.totalTokens ? ` · tokens ${usage.totalTokens}` : ''
        return { ...base, kind: 'info', sym: '▸', text: `step ${event.step ?? ''} 结束${tokens}` }
      }
      if (event.phase === 'turn_end') {
        if (event.reason?.kind === 'error') {
          return { ...base, kind: 'err', sym: '✗', text: event.reason.error?.message || 'turn 失败' }
        }
        return { ...base, kind: 'ok', sym: '✓', text: `turn ${event.turn ?? ''} 完成` }
      }
      return null
    case 'thinking':
      return { ...base, kind: 'think', sym: '◦', text: event.text }
    case 'text':
      return { ...base, kind: 'out', sym: '', text: event.text }
    case 'tool_call':
      return { ...base, kind: 'tool', sym: '⚡', text: `${event.tool}\n${prettyInput(event.input)}` }
    case 'tool_result':
      return {
        ...base,
        kind: event.status === 'error' ? 'err' : 'out',
        sym: event.status === 'error' ? '✗' : '▸',
        text: truncate(event.result),
      }
    case 'final':
      return event.text.trim() ? { ...base, kind: 'ok', sym: '✓', text: event.text } : null
    case 'error':
      return { ...base, kind: 'err', sym: '✗', text: event.message }
    case 'kb_search': {
      if (event.chunks.length === 0) {
        return { ...base, kind: 'info', sym: '⌕', text: `知识库检索：无命中${event.lowConfidence ? '（低置信）' : ''}` }
      }
      const list = event.chunks
        .map((c, i) => `${i + 1}. 《${c.title}》${c.sectionPath ? ` › ${c.sectionPath}` : ''}`)
        .join('\n')
      return { ...base, kind: 'info', sym: '⌕', text: `知识库检索：命中 ${event.chunks.length} 条\n${list}` }
    }
    case 'memory_recall': {
      if (!event.memories || event.memories.length === 0) return null
      const list = event.memories
        .map((memory, i) => `${i + 1}. ${memory.content.slice(0, 60)}`)
        .join('\n')
      return { ...base, kind: 'info', sym: '⌕', text: `记忆注入：使用 ${event.count} 条\n${list}` }
    }
    default:
      return null
  }
}
