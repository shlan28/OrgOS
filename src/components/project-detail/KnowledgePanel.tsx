import { useEffect, useRef, useState } from 'react'
import type { Knowledge, DocLibrary } from '../../data/projects'
import SegmentedControl from '../SegmentedControl'
import DocLibraryView from './DocLibraryView'
import './KnowledgePanel.css'

interface KnowledgePanelProps {
  /** 文档库（「文档」子 tab 数据源 = project.documents） */
  documents: DocLibrary
  onUpdateDocuments: (documents: DocLibrary) => void
  /** 知识数据（「项目知识库」子 tab 取 folders/docs；记忆已拆至独立「记忆」tab） */
  knowledge: Knowledge
  onUpdateKnowledge: (k: Knowledge) => void
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
 * 记忆已拆出为独立顶级 tab「记忆」（MemoryPanel）。
 */
export default function KnowledgePanel({
  documents, onUpdateDocuments, knowledge, onUpdateKnowledge,
}: KnowledgePanelProps) {
  const [segment, setSegment] = useState('docs')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollToTop(rootRef.current)
  }, [segment])

  const kbLibrary: DocLibrary = { folders: knowledge.folders, docs: knowledge.docs }
  const updateKbLibrary = (lib: DocLibrary) => onUpdateKnowledge({ ...knowledge, ...lib })

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
        ? <DocLibraryView library={documents} onUpdateLibrary={onUpdateDocuments} />
        : <DocLibraryView library={kbLibrary} onUpdateLibrary={updateKbLibrary} />}
    </div>
  )
}
