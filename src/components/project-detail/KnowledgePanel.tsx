import { useEffect, useRef, useState } from 'react'
import SegmentedControl from '../SegmentedControl'
import DocLibraryView from './DocLibraryView'
import KbIndexPanel from './KbIndexPanel'
import './KnowledgePanel.css'

interface KnowledgePanelProps {
  /** 项目 id（两个子 tab 都直接读项目下的飞书文档接口） */
  projectId: string
}

/** 滚动到最近的可滚动祖先顶部 */
function scrollToTop(el: HTMLElement | null) {
  let node = el?.parentElement ?? null
  while (node) {
    if (node.scrollHeight > node.clientHeight) {
      node.scrollTop = 0
      return
    }
    node = node.parentElement
  }
}

/**
 * 「文档和知识库」面板：顶部分段切换（文档 / 项目知识库）。
 * - 文档：DocLibraryView（飞书同步源 + 真实目录树 + 文档清单 + 立即同步）
 * - 项目知识库：KbIndexPanel（收录清单 + 正文拉取状态；切分检索待 P3）
 * 记忆已拆出为独立顶级 tab「记忆」（MemoryPanel）。
 */
export default function KnowledgePanel({ projectId }: KnowledgePanelProps) {
  const [segment, setSegment] = useState('docs')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollToTop(rootRef.current)
  }, [segment])

  return (
    <div className="knowledge-panel" ref={rootRef}>
      <SegmentedControl
        value={segment}
        onChange={setSegment}
        items={[
          { key: 'docs', label: '文档', icon: null },
          { key: 'kb', label: '项目知识库', icon: null },
        ]}
      />
      {segment === 'docs'
        ? <DocLibraryView projectId={projectId} />
        : <KbIndexPanel projectId={projectId} />}
    </div>
  )
}
