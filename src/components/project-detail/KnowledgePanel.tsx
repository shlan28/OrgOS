import { useEffect, useRef, useState } from 'react'
import type { Knowledge, DocLibrary } from '../../data/projects'
import type { FeishuSettings } from '../../data/settings'
import SegmentedControl from '../SegmentedControl'
import DocLibraryView from './DocLibraryView'
import KbIndexPanel from './KbIndexPanel'
import './KnowledgePanel.css'

interface KnowledgePanelProps {
  /** 文档库（「文档」子 tab 数据源 = project.documents） */
  documents: DocLibrary
  onUpdateDocuments: (documents: DocLibrary) => void
  /** 知识数据（「项目知识库」子 tab 取 folders/docs；记忆已拆至独立「记忆」tab） */
  knowledge: Knowledge
  onUpdateKnowledge: (k: Knowledge) => void
  /** 飞书个人授权设置（「文档」子 tab OAuth 导入用） */
  feishu: FeishuSettings
  onUpdateFeishu: (updater: (f: FeishuSettings) => FeishuSettings) => void
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
 * - 文档：DocLibraryView（多层级目录树 + 只读文档列表 + ⇗ 跳飞书 + OAuth 导入）
 * - 项目知识库：KbIndexPanel（收录清单 + 索引状态 + 检索测试）
 * 记忆已拆出为独立顶级 tab「记忆」（MemoryPanel）。
 */
export default function KnowledgePanel({
  documents, onUpdateDocuments, knowledge, onUpdateKnowledge,
  feishu, onUpdateFeishu,
}: KnowledgePanelProps) {
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
        ? (
          <DocLibraryView
            library={documents}
            onUpdateLibrary={onUpdateDocuments}
            feishu={feishu}
            onUpdateFeishu={onUpdateFeishu}
          />
        )
        : <KbIndexPanel knowledge={knowledge} onUpdateKnowledge={onUpdateKnowledge} />}
    </div>
  )
}
