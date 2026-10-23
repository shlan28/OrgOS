import { useEffect, useMemo, useRef, useState } from 'react'
import type { Knowledge, KbDoc, KbIndexState } from '../../data/projects'
import { DocIcon, SearchIcon, FolderIcon } from '../icons'
import './KbIndexPanel.css'

interface KbIndexPanelProps {
  knowledge: Knowledge
  onUpdateKnowledge: (k: Knowledge) => void
}

/** 未分组伪目录 id（无 folderId 文档聚合节点） */
const UNGROUPED = '__ungrouped__'
/** 全部文档伪目录 id */
const ALL = '__all__'

type FilterKey = 'all' | 'included' | 'excluded' | 'attention'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'included', label: '已收录' },
  { key: 'excluded', label: '未收录' },
  { key: 'attention', label: '需处理' },
]

const stateOf = (doc: KbDoc): KbIndexState => doc.indexState ?? 'off'
const isIndexable = (s: KbIndexState) => s !== 'off'

/** 状态徽标文案与配色 */
const STATE_META: Record<KbIndexState, { label: string; cls: string }> = {
  indexed: { label: '已索引', cls: 'indexed' },
  indexing: { label: '索引中', cls: 'indexing' },
  pending: { label: '排队中', cls: 'pending' },
  failed: { label: '失败', cls: 'failed' },
  stale: { label: '已过期', cls: 'stale' },
  off: { label: '未收录', cls: 'off' },
}

const nowStamp = () => {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

/** 片段分页大小 */
const CHUNK_PAGE_SIZE = 10

/** 分页页码序列（当前页居中窗口 + 首 1 + 尾页，最多 7 个数字位；用 0 表示省略号占位） */
function pageNumbers(page: number, pageCount: number): number[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const set = new Set<number>([1, pageCount, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((n) => set.add(n))
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((n) => set.add(n))
  const nums = [...set].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b)
  const out: number[] = []
  let prev = 0
  for (const n of nums) {
    if (n - prev > 1) out.push(0) // 省略号占位
    out.push(n)
    prev = n
  }
  return out
}

/**
 * 派生 Mock 片段列表（数量 = chunks）：
 * 以文档 content 小节为种子循环生成，带段内序号避免重样（演示用）。
 */
function chunkListOf(doc: KbDoc): { heading: string; body: string }[] {
  const total = doc.chunks ?? 0
  if (total <= 0 || doc.content.length === 0) return []
  const out: { heading: string; body: string }[] = []
  for (let i = 0; i < total; i++) {
    const seed = doc.content[i % doc.content.length]
    const round = Math.floor(i / doc.content.length)
    out.push(
      round === 0
        ? { heading: seed.heading, body: seed.body }
        : { heading: `${seed.heading}（续 ${round}）`, body: `${seed.body}（本节内容较长，切分为第 ${i + 1} 个片段，前文接 chunk #${String(i).padStart(3, '0')}。）` },
    )
  }
  return out
}

/**
 * 「项目知识库」子 tab：收录清单 + 索引状态 + 检索测试。
 * 状态机（Mock 定时推进）：off → pending → 600ms → indexing → 1200ms → indexed；
 * failed/stale/indexed → 重建/重试 → indexing → indexed；indexed → 文档更新 → stale；关 → off（清零）。
 */
export default function KbIndexPanel({ knowledge, onUpdateKnowledge }: KbIndexPanelProps) {
  const { docs, folders } = knowledge
  /** 最新 docs 的 ref（setTimeout 回调里读最新状态，避免闭包旧值卡状态机） */
  const docsRef = useRef(docs)
  docsRef.current = docs
  // 目录树选中（只读：全部 / 各目录 / 未分组）
  const [selectedFolder, setSelectedFolder] = useState<string>(ALL)
  // 过滤分段 + 搜索
  const [filter, setFilter] = useState<FilterKey>('all')
  const [keyword, setKeyword] = useState('')
  // 弹层：索引详情 / 检索测试 / 批量菜单
  const [detailId, setDetailId] = useState<string | null>(null)
  /** 索引详情片段分页页码（1 起） */
  const [chunkPage, setChunkPage] = useState(1)
  const [retrievalOpen, setRetrievalOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const batchRef = useRef<HTMLDivElement>(null)
  // 检索测试状态
  const [query, setQuery] = useState('多视窗 窗格')
  const [searching, setSearching] = useState(false)
  const [searchDone, setSearchDone] = useState(false)

  /* ---------- 统计（实时聚合） ---------- */
  const stats = useMemo(() => {
    const included = docs.filter((d) => isIndexable(stateOf(d)))
    const indexed = docs.filter((d) => ['indexed', 'stale'].includes(stateOf(d)))
    const indexing = docs.filter((d) => stateOf(d) === 'indexing')
    const pending = docs.filter((d) => stateOf(d) === 'pending')
    const failed = docs.filter((d) => stateOf(d) === 'failed')
    const attention = failed.length + docs.filter((d) => stateOf(d) === 'stale').length + pending.length
    const chunks = indexed.reduce((sum, d) => sum + (d.chunks ?? 0), 0)
    return { total: docs.length, included: included.length, indexed: indexed.length, indexing: indexing.length + pending.length, failed: failed.length, chunks, attention }
  }, [docs])

  /* ---------- 目录树（只读，含未分组聚合） ---------- */
  const rootFolders = folders.filter((f) => !f.parentId)
  /** 目录内文档（仅看 folderId 精确匹配；树为两层平铺不递归） */
  const docsInFolder = (folderId: string) => folderId === UNGROUPED
    ? docs.filter((d) => !d.folderId)
    : docs.filter((d) => d.folderId === folderId)
  /** 目录节点显示 收录数/总数 */
  const folderCount = (folderId: string) => {
    const list = docsInFolder(folderId)
    return `${list.filter((d) => isIndexable(stateOf(d))).length}/${list.length}`
  }

  /* ---------- 列表过滤 ---------- */
  const visibleDocs = useMemo(() => {
    let list = docs
    if (selectedFolder === ALL) {
      // 全部
    } else {
      list = docsInFolder(selectedFolder)
    }
    if (filter === 'included') list = list.filter((d) => isIndexable(stateOf(d)))
    if (filter === 'excluded') list = list.filter((d) => !isIndexable(stateOf(d)))
    if (filter === 'attention') list = list.filter((d) => ['failed', 'stale', 'pending'].includes(stateOf(d)))
    const kw = keyword.trim().toLowerCase()
    if (kw) list = list.filter((d) => d.title.toLowerCase().includes(kw) || d.sourceRef.toLowerCase().includes(kw))
    return list
  }, [docs, selectedFolder, filter, keyword]) // eslint-disable-line react-hooks/exhaustive-deps

  const attentionCount = stats.attention

  /* ---------- 状态机写回 ---------- */
  /**
   * 写回单文档 patch。读最新 docs 用 docsRef（定时器闭包里的 knowledge 是旧值，直接读会卡状态机）；
   * 父级 onUpdateKnowledge 为对象式更新（ProjectDetail → onUpdateProject 函数式 setProjects，状态总是最新）。
   */
  const patchDoc = (id: string, patch: Partial<KbDoc>) => {
    const latest = docsRef.current
    onUpdateKnowledge({
      ...knowledge,
      docs: latest.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })
  }

  /** 读最新文档 */
  const readDoc = (id: string): KbDoc | null => docsRef.current.find((d) => d.id === id) ?? null

  /** 步进一个文档的状态机（setTimeout 链；演示用，写回父级 state） */
  const advance = (id: string) => {
    const doc = readDoc(id)
    if (!doc) return
    const s = stateOf(doc)
    if (s === 'off') {
      patchDoc(id, { indexState: 'pending', chunks: 0, indexedAt: undefined, errorText: undefined })
      window.setTimeout(() => {
        const cur = readDoc(id)
        if (cur && stateOf(cur) === 'pending') {
          patchDoc(id, { indexState: 'indexing' })
          window.setTimeout(() => {
            const c2 = readDoc(id)
            if (c2 && stateOf(c2) === 'indexing') {
              patchDoc(id, { indexState: 'indexed', chunks: 40 + Math.floor(Math.random() * 21), indexedAt: nowStamp() })
            }
          }, 1200)
        }
      }, 600)
    } else {
      // 重建 / 重试：failed / stale / indexed / indexing → indexing → indexed（演示一律成功）
      patchDoc(id, { indexState: 'indexing', errorText: undefined })
      window.setTimeout(() => {
        const cur = readDoc(id)
        if (cur && stateOf(cur) === 'indexing') {
          patchDoc(id, { indexState: 'indexed', chunks: 40 + Math.floor(Math.random() * 21), indexedAt: nowStamp() })
        }
      }, 1200)
    }
  }

  /** 收录开关 */
  const handleToggle = (doc: KbDoc) => {
    const s = stateOf(doc)
    if (s === 'off') {
      advance(doc.id)
    } else {
      patchDoc(doc.id, { indexState: 'off', chunks: 0, indexedAt: undefined, errorText: undefined })
    }
  }

  /** 重建/重试（详情弹窗） */
  const handleRebuild = (doc: KbDoc) => {
    advance(doc.id)
  }

  /** 模拟文档更新（详情弹窗，演示状态机 indexed → stale） */
  const handleSimulateUpdate = (doc: KbDoc) => {
    patchDoc(doc.id, {
      indexState: 'stale',
      updatedAt: nowStamp().slice(0, 5),
      errorText: '文档已更新，索引过期，需重建',
    })
  }

  /** 在飞书中打开（Mock 外链） */
  const openInFeishu = (doc: KbDoc) => {
    const url = doc.sourceRef.startsWith('http') ? doc.sourceRef : `https://feishu.cn/wiki/${doc.sourceRef || doc.id}`
    window.open(url, '_blank', 'noopener')
  }

  /* ---------- 批量操作 ---------- */
  const batchCollectAll = () => {
    docs.filter((d) => stateOf(d) === 'off').forEach((d) => advance(d.id))
    setBatchOpen(false)
  }
  const batchRebuildAll = () => {
    docs.filter((d) => ['indexed', 'stale', 'failed'].includes(stateOf(d))).forEach((d) => advance(d.id))
    setBatchOpen(false)
  }
  const batchOffAll = () => {
    onUpdateKnowledge({
      ...knowledge,
      docs: docs.map((d) => isIndexable(stateOf(d))
        ? { ...d, indexState: 'off' as const, chunks: 0, indexedAt: undefined, errorText: undefined }
        : d),
    })
    setBatchOpen(false)
  }

  // 批量菜单外部点击关闭
  useEffect(() => {
    if (!batchOpen) return
    const close = (e: MouseEvent) => {
      if (batchRef.current && !batchRef.current.contains(e.target as Node)) setBatchOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [batchOpen])

  /* ---------- 检索测试（Mock：关键词包含匹配已索引文档） ---------- */
  const indexedDocs = docs.filter((d) => ['indexed', 'stale'].includes(stateOf(d)))

  const searchResults = useMemo(() => {
    if (!searchDone) return null
    const terms = query.trim().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return []
    const hits: { doc: KbDoc; body: string; score: number }[] = []
    for (const doc of indexedDocs) {
      const sections = [
        ...doc.content.map((c) => `${c.heading}：${c.body}`),
        doc.summary,
      ]
      for (const body of sections) {
        const hitTerms = terms.filter((t) => body.toLowerCase().includes(t.toLowerCase()))
        if (hitTerms.length > 0) {
          hits.push({ doc, body, score: 0.6 + 0.12 * hitTerms.length })
        }
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, 8)
  }, [searchDone, query, indexedDocs]) // eslint-disable-line react-hooks/exhaustive-deps

  const runSearch = () => {
    setSearching(true)
    setSearchDone(false)
    window.setTimeout(() => {
      setSearching(false)
      setSearchDone(true)
    }, 800)
  }

  const detailDoc = docs.find((d) => d.id === detailId) ?? null

  /* ---------- 渲染 ---------- */
  return (
    <div className="kbindex-panel">
      {/* ① 统计条：chips + 检索测试 + 批量 */}
      <div className="kbindex-stats">
        <span className="kbi-chip plain">收录 <b>{stats.included}/{stats.total}</b></span>
        <span className="kbi-chip ok"><span className="kbi-dot" />已索引 <b>{stats.indexed}</b></span>
        {stats.indexing > 0 && (
          <span className="kbi-chip run"><span className="kbi-dot" />索引中 <b>{stats.indexing}</b></span>
        )}
        {stats.failed > 0 && (
          <span className="kbi-chip err"><span className="kbi-dot" />失败 <b>{stats.failed}</b></span>
        )}
        <span className="kbi-chip plain">片段 <b>{stats.chunks}</b></span>
        <span className="kbindex-stats-acts">
          <button type="button" className="kbi-act primary" onClick={() => { setRetrievalOpen(true); setSearchDone(false) }}>
            检索测试
          </button>
          <div className="kbi-batch-wrap" ref={batchRef}>
            <button type="button" className="kbi-act" onClick={() => setBatchOpen((v) => !v)}>⋯ 批量</button>
            {batchOpen && (
              <div className="kbi-batch-menu">
                <button type="button" onClick={batchCollectAll}>＋ 收录全部未收录</button>
                <button type="button" onClick={batchRebuildAll}>↻ 重建全部索引</button>
                <button type="button" className="danger" onClick={batchOffAll}>✕ 取消全部收录</button>
              </div>
            )}
          </div>
        </span>
      </div>

      {/* ② 双栏：左目录树（只读） + 右清单 */}
      <div className="kbindex-two-col">
        <div className="kbi-tree">
          <div className="kbi-tree-title">目录（只读）</div>
          <button
            type="button"
            className={`kbi-tree-item${selectedFolder === ALL ? ' active' : ''}`}
            onClick={() => setSelectedFolder(ALL)}
          >
            <DocIcon size={14} />
            <span className="kbi-tree-name">全部文档</span>
            <span className="kbi-tree-count"><b>{stats.included}</b>/{stats.total}</span>
          </button>
          {rootFolders.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`kbi-tree-item${selectedFolder === f.id ? ' active' : ''}`}
              onClick={() => setSelectedFolder(f.id)}
            >
              <FolderIcon size={14} />
              <span className="kbi-tree-name">{f.name}</span>
              <span className="kbi-tree-count">{folderCount(f.id)}</span>
            </button>
          ))}
          {docs.some((d) => !d.folderId) && (
            <button
              type="button"
              className={`kbi-tree-item${selectedFolder === UNGROUPED ? ' active' : ''}`}
              onClick={() => setSelectedFolder(UNGROUPED)}
            >
              <FolderIcon size={14} />
              <span className="kbi-tree-name">未分组</span>
              <span className="kbi-tree-count">{folderCount(UNGROUPED)}</span>
            </button>
          )}
        </div>

        <div className="kbi-list">
          <div className="kbi-list-tools">
            <div className="kbi-filters">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={filter === f.key ? 'active' : ''}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}{f.key === 'attention' && attentionCount > 0 ? ` ${attentionCount}` : ''}
                </button>
              ))}
            </div>
            <div className="kbi-search">
              <SearchIcon size={13} />
              <input
                value={keyword}
                placeholder="搜索文档名 / 路径"
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
          </div>
          <div className="kbi-list-body">
            {visibleDocs.length === 0 && <div className="kbi-empty">没有匹配的文档</div>}
            {visibleDocs.map((doc) => {
              const s = stateOf(doc)
              const meta = STATE_META[s]
              return (
                <div key={doc.id} className="kbi-row" onClick={() => { setDetailId(doc.id); setChunkPage(1) }}>
                  <DocIcon size={16} className="kbi-row-icon" />
                  <span className="kbi-row-main">
                    <span className="kbi-row-title">
                      <span className="kbi-row-name">{doc.title}</span>
                      <span className={`kbi-badge ${meta.cls}`}>{meta.label}</span>
                    </span>
                    <span className="kbi-row-sub">
                      {doc.sourceRef || doc.source}
                      {s === 'indexed' || s === 'stale' ? ` · 片段 ${doc.chunks ?? 0}` : ''}
                      {doc.indexedAt && s === 'indexed' ? ` · ${doc.indexedAt}` : ''}
                      {s === 'stale' ? ' · 索引已过期' : ''}
                      {s === 'failed' && doc.errorText ? ` · ${doc.errorText.split('：')[0]}` : ''}
                    </span>
                  </span>
                  <span
                    className={`kbi-toggle${isIndexable(s) ? '' : ' off'}`}
                    role="switch"
                    aria-checked={isIndexable(s)}
                    aria-label={`收录 ${doc.title}`}
                    title={isIndexable(s) ? '点击取消收录（清零片段）' : '点击收录并建立索引'}
                    onClick={(e) => { e.stopPropagation(); handleToggle(doc) }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ③ 索引详情弹窗 */}
      {detailDoc && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setDetailId(null) }}
        >
          <div className="modal-box kbi-detail-modal" role="dialog" aria-modal="true" aria-label="索引详情">
            <div className="modal-head">
              <span className="modal-title">索引详情</span>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setDetailId(null)}>×</button>
            </div>
            <div className="kbi-detail-body">
              <div className="kbi-detail-head">
                <span className="kbi-detail-title">{detailDoc.title}</span>
                <span className={`kbi-badge ${STATE_META[stateOf(detailDoc)].cls}`}>
                  {STATE_META[stateOf(detailDoc)].label}
                </span>
              </div>
              <div className="kbi-detail-meta">
                路径：{detailDoc.sourceRef || detailDoc.source}（{detailDoc.source}）<br />
                片段：{detailDoc.chunks ?? 0} · 更新于 {detailDoc.updatedAt}
                {detailDoc.indexedAt && <> · 最近索引 {detailDoc.indexedAt}</>}
              </div>
              {stateOf(detailDoc) === 'failed' && detailDoc.errorText && (
                <p className="kbi-detail-error">失败原因：{detailDoc.errorText}</p>
              )}
              {stateOf(detailDoc) === 'stale' && (
                <p className="kbi-detail-error stale">{detailDoc.errorText || '文档已更新，索引过期，需重建'}</p>
              )}
              <div className="kbi-detail-acts">
                {stateOf(detailDoc) === 'failed' ? (
                  <button type="button" className="kbi-act primary" onClick={() => handleRebuild(detailDoc)}>↻ 重试索引</button>
                ) : (
                  <button
                    type="button"
                    className="kbi-act primary"
                    disabled={stateOf(detailDoc) === 'indexing' || stateOf(detailDoc) === 'pending'}
                    onClick={() => handleRebuild(detailDoc)}
                  >
                    ↻ 重建索引
                  </button>
                )}
                <button type="button" className="kbi-act" onClick={() => openInFeishu(detailDoc)}>⇱ 在飞书中打开</button>
                {stateOf(detailDoc) === 'indexed' && (
                  <button type="button" className="kbi-act" onClick={() => handleSimulateUpdate(detailDoc)}>
                    ✎ 模拟文档更新
                  </button>
                )}
              </div>
              <div className="kbi-chunk-title">
                片段预览（共 {detailDoc.chunks ?? 0} 条）
              </div>
              {stateOf(detailDoc) === 'off' && (
                <p className="kbi-detail-empty">该文档尚未收录，打开右侧收录开关后自动建立索引。</p>
              )}
              {(stateOf(detailDoc) === 'indexing' || stateOf(detailDoc) === 'pending') && (
                <p className="kbi-detail-empty">正在建立索引，完成后可预览片段……</p>
              )}
              {stateOf(detailDoc) === 'failed' && (
                <p className="kbi-detail-empty">索引失败，重试成功后可预览片段。</p>
              )}
              {['indexed', 'stale'].includes(stateOf(detailDoc)) && (() => {
                const chunks = chunkListOf(detailDoc)
                const pageCount = Math.max(1, Math.ceil(chunks.length / CHUNK_PAGE_SIZE))
                const page = Math.min(chunkPage, pageCount)
                const start = (page - 1) * CHUNK_PAGE_SIZE
                return chunks.slice(start, start + CHUNK_PAGE_SIZE).map((sec, i) => (
                  <div key={start + i} className="kbi-chunk-card">
                    <div className="kbi-chunk-head">
                      <span className="mono">chunk #{String(start + i + 1).padStart(3, '0')}</span>
                      <span>·</span>
                      <span>{sec.heading}</span>
                    </div>
                    <p className="kbi-chunk-body">{sec.body}</p>
                  </div>
                ))
              })()}
            </div>
            {/* 分页条：固定弹窗底部 footer（滚动区外，翻页永远可见） */}
            {['indexed', 'stale'].includes(stateOf(detailDoc)) && (() => {
              const chunks = chunkListOf(detailDoc)
              const pageCount = Math.max(1, Math.ceil(chunks.length / CHUNK_PAGE_SIZE))
              const page = Math.min(chunkPage, pageCount)
              return (
                <div className="kbi-detail-foot">
                  <span className="kbi-chunk-pager-info">
                    共 {chunks.length} 条 · 第 {page} / {pageCount} 页 · 每页 {CHUNK_PAGE_SIZE} 条
                  </span>
                  <span className="kbi-chunk-pager-btns">
                    <button
                      type="button"
                      className="kbi-act"
                      disabled={page <= 1}
                      onClick={() => setChunkPage(page - 1)}
                    >
                      ‹ 上一页
                    </button>
                    {pageNumbers(page, pageCount).map((p, idx) => (
                      p === 0 ? (
                        <span key={`gap-${idx}`} className="kbi-chunk-gap">…</span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          className={`kbi-act num${p === page ? ' primary' : ''}`}
                          onClick={() => setChunkPage(p)}
                        >
                          {p}
                        </button>
                      )
                    ))}
                    <button
                      type="button"
                      className="kbi-act"
                      disabled={page >= pageCount}
                      onClick={() => setChunkPage(page + 1)}
                    >
                      下一页 ›
                    </button>
                  </span>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ④ 检索测试弹窗 */}
      {retrievalOpen && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setRetrievalOpen(false) }}
        >
          <div className="modal-box kbi-ret-modal" role="dialog" aria-modal="true" aria-label="检索测试">
            <div className="modal-head">
              <span className="modal-title">检索测试</span>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setRetrievalOpen(false)}>×</button>
            </div>
            <div className="kbi-ret-query">
              <input
                value={query}
                placeholder="输入查询词，测试已索引片段的召回效果"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
              />
              <button type="button" className="kbi-act primary" disabled={searching || !query.trim()} onClick={runSearch}>
                {searching ? '检索中…' : '测试'}
              </button>
            </div>
            <p className="kbi-ret-hint">
              在 {stats.indexed} 篇已索引文档 · {stats.chunks} 个片段中检索（Mock 相似度）
            </p>
            {searching && <div className="kbi-ret-status">检索中……</div>}
            {searchDone && searchResults && searchResults.length === 0 && (
              <div className="kbi-ret-status">无命中片段，换个查询词试试</div>
            )}
            {searchDone && searchResults && searchResults.map((hit, i) => (
              <div key={i} className="kbi-ret-item">
                <div className="kbi-ret-head">
                  <span className="kbi-ret-doc">{hit.doc.title}</span>
                  <span className={`kbi-badge ${STATE_META[stateOf(hit.doc)].cls}`}>
                    {STATE_META[stateOf(hit.doc)].label}
                  </span>
                  <span className="kbi-ret-score mono">{hit.score.toFixed(2)}</span>
                </div>
                <p className="kbi-ret-text">{hit.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
