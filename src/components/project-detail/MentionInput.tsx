import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { AdeAgent, Member } from '../../data/projects'
import './MentionInput.css'

/** 提及候选（项目成员 / 项目 ADE） */
export interface MentionOption {
  /** 插入的显示名（如 wang / 研发工程师ADE） */
  name: string
  /** 头像字 */
  initial: string
  /** 头像色 */
  color: string
  /** 副标题（职位/角色） */
  sub: string
  /** 分组 */
  group: '成员' | 'ADE'
  online?: boolean
}

/** 由项目数据组装候选 */
export const mentionOptionsOf = (members: Member[], agents: AdeAgent[]): MentionOption[] => [
  ...members.map((m) => ({
    name: m.name,
    initial: m.initial,
    color: '#5b7ba6',
    sub: m.role,
    group: '成员' as const,
    online: m.online,
  })),
  ...agents.map((a) => ({
    name: a.name,
    initial: a.name.replace(/^./, (c) => c),
    color: '#7c66d8',
    sub: `${a.role} · ${a.model}`,
    group: 'ADE' as const,
  })),
]

export interface MentionInputHandle {
  /** 清空输入 */
  clear: () => void
  /** 聚焦 */
  focus: () => void
  /** 提交（有内容时发送并清空） */
  submit: () => void
}

interface MentionInputProps {
  placeholder: string
  disabled?: boolean
  /** 候选（项目成员 + 项目 ADE） */
  options: MentionOption[]
  /** 发送时输出纯文本（提及以 @名字 呈现） */
  onSend: (text: string) => void
}

const mentionChipHtml = (o: MentionOption) =>
  `<span class="mention-chip" data-mention="${o.name}" contenteditable="false">@${o.name}</span>`

/**
 * 提及输入框：contentEditable 富输入。
 * - 输入 @ 触发浮层（候选 = 项目成员 + 项目 ADE），↑↓ 选中、Enter/点击插入高亮 chip；
 * - Backspace 整体删除 chip；发送时导出纯文本（chip → @名字）。
 */
const MentionInput = forwardRef<MentionInputHandle, MentionInputProps>(
  ({ placeholder, disabled, options, onSend }, ref) => {
    const boxRef = useRef<HTMLDivElement>(null)
    /** 浮层高亮下标 */
    const [hi, setHi] = useState(0)
    const [candidates, setCandidates] = useState<MentionOption[]>([])

    useImperativeHandle(ref, () => ({
      clear: () => { if (boxRef.current) boxRef.current.innerHTML = '' },
      focus: () => boxRef.current?.focus(),
      submit: () => send(),
    }))

    /** 纯文本导出：chip → @名字 */
    const plainText = () => {
      const el = boxRef.current
      if (!el) return ''
      const clone = el.cloneNode(true) as HTMLElement
      clone.querySelectorAll('.mention-chip').forEach((c) => {
        const name = c.getAttribute('data-mention') ?? c.textContent?.slice(1) ?? ''
        c.replaceWith(document.createTextNode(`@${name}`))
      })
      return clone.textContent ?? ''
    }

    const send = () => {
      const text = plainText().trim()
      if (!text) return
      onSend(text)
      if (boxRef.current) boxRef.current.innerHTML = ''
      closeMenu()
    }

    const closeMenu = () => {
      setHi(0)
      setCandidates([])
    }

    /** 从光标处取 @ 触发词（null = 无激活提及） */
    const detectQuery = (): { start: number; word: string } | null => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return null
      const range = sel.getRangeAt(0).cloneRange()
      if (!boxRef.current?.contains(range.startContainer)) return null
      // 只在纯文本节点里检测
      if (range.startContainer.nodeType !== Node.TEXT_NODE) return null
      const text = range.startContainer.textContent ?? ''
      const caret = range.startOffset
      // 光标前找最近的 @（且 @ 前是空白或开头）
      const before = text.slice(0, caret)
      const at = before.lastIndexOf('@')
      if (at < 0) return null
      const word = before.slice(at + 1)
      // 过滤词不含空白（含空白 = 提及已结束）
      if (/\s/.test(word)) return null
      return { start: at, word }
    }

    /** 输入事件：检测 @ 提及态 + 实时过滤 */
    const onInput = () => {
      const det = detectQuery()
      if (det && det.word.length <= 12) {
        const q = det.word.toLowerCase()
        const list = options.filter((o) => o.name.toLowerCase().includes(q) || o.sub.toLowerCase().includes(q))
        setCandidates(list)
        setHi(0)
      } else {
        closeMenu()
      }
    }

    /** 选中某候选：替换 @触发词 为 chip + 尾随空格（实时重算光标，避免 state 滞后） */
    const pick = (o: MentionOption) => {
      const det = detectQuery()
      if (!det) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const node = sel.getRangeAt(0).startContainer
      if (node.nodeType !== Node.TEXT_NODE) return
      const caret = sel.getRangeAt(0).startOffset
      // 删除 @+过滤词
      const range = document.createRange()
      range.setStart(node, det.start)
      range.setEnd(node, caret)
      range.deleteContents()
      // chip + 尾随空格（真实 text node，插入后用于定位光标）
      const holder = document.createElement('span')
      holder.innerHTML = mentionChipHtml(o)
      const frag = document.createDocumentFragment()
      frag.appendChild(holder.firstElementChild!)
      const tail = document.createTextNode('\u00A0')
      frag.appendChild(tail)
      range.insertNode(frag)
      // 光标落在尾随空格之后（insertNode 后 frag 失去父子引用，须用实际节点 tail 定位）
      const newRange = document.createRange()
      newRange.setStart(tail, 1)
      newRange.collapse(true)
      sel.removeAllRanges()
      sel.addRange(newRange)
      closeMenu()
      boxRef.current?.focus()
    }

    /** 键盘：浮层开着时 ↑↓/Enter/Tab/Esc；Backspace 整体删 chip；Enter 发送 */
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (candidates.length > 0) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % candidates.length); return }
        if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + candidates.length) % candidates.length); return }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          pick(candidates[hi])
          return
        }
        if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return }
      }
      // Backspace：光标紧贴 chip 之后（空 text node 或 box 末尾）→ 一次整体删除 chip
      if (e.key === 'Backspace') {
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
          const node = sel.getRangeAt(0).startContainer
          const offset = sel.getRangeAt(0).startOffset
          /** 光标前一兄弟是否 chip */
          const chipBefore = (n: Node, off: number): { chip: HTMLElement; tail: Text | null } | null => {
            let prev: ChildNode | null = null
            let tail: Text | null = null
            if (n.nodeType === Node.TEXT_NODE) {
              const t = n as Text
              // 光标在 text 开头（NBSP 已被吃掉/空节点）→ 前一兄弟
              if (off === 0) prev = t.previousSibling
              // 光标在仅含 NBSP 的 text 内部（chip 尾随空格）→ 整删 chip+NBSP
              else if (t.length === 1 && t.data === '\u00A0' && off === 1) {
                prev = t.previousSibling
                tail = t
              }
            } else if (n instanceof HTMLElement) {
              if (off === 0) prev = n.previousSibling
              else if (off === n.childNodes.length) prev = n.lastChild
            }
            return prev instanceof HTMLElement && prev.classList.contains('mention-chip')
              ? { chip: prev, tail }
              : null
          }
          const hit = chipBefore(node, offset)
          if (hit) {
            e.preventDefault()
            hit.chip.remove()
            hit.tail?.remove()
            return
          }
        }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        send()
      }
    }

    /** 渲染分组候选 */
    const grouped = useMemo(() => {
      const members = candidates.filter((c) => c.group === '成员')
      const ades = candidates.filter((c) => c.group === 'ADE')
      return [
        ...(members.length ? [{ key: '成员', items: members }] : []),
        ...(ades.length ? [{ key: 'ADE', items: ades }] : []),
      ]
    }, [candidates])

    return (
      <div className="mention-wrap">
        <div
          ref={boxRef}
          className="mention-box"
          contentEditable={!disabled}
          data-placeholder={placeholder}
          suppressContentEditableWarning
          onInput={onInput}
          onKeyDown={onKeyDown}
          onBlur={() => { setTimeout(closeMenu, 120) }}
          role="textbox"
          aria-multiline="false"
          aria-label={placeholder}
        />
        {candidates.length > 0 && (
          <div className="mention-menu">
            {grouped.map((g) => (
              <div key={g.key} className="mention-group">
                <div className="mention-group-h">{g.key === '成员' ? '项目成员' : '项目 ADE'}</div>
                {g.items.map((o) => {
                  const idx = candidates.indexOf(o)
                  return (
                    <button
                      key={`${o.group}-${o.name}`}
                      type="button"
                      className={`mention-item${idx === hi ? ' hi' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); pick(o) }}
                      onMouseEnter={() => setHi(idx)}
                    >
                      <span className="avatar" style={{ background: o.color }}>{o.initial}</span>
                      <span className="name">{o.name}</span>
                      <span className="sub">{o.sub}</span>
                      {o.group === '成员' && (
                        <span className={`dot ${o.online ? 'on' : ''}`} title={o.online ? '在线' : '离线'} />
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
            {candidates.length === 0 && <div className="mention-empty">无匹配</div>}
          </div>
        )}
      </div>
    )
  },
)

MentionInput.displayName = 'MentionInput'
export default MentionInput
