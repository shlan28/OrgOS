import { useCallback, useEffect, useMemo, useState } from 'react'
import { docSyncApi, type SyncDoc } from '../../lib/docSyncApi'
import { kbApi, type KbChunk, type KbConfig, type KbSearchResult, type KbStatus } from '../../lib/kbApi'
import { DocIcon, SearchIcon, FolderIcon, ChevronRightIcon, ExternalIcon } from '../icons'
import './KbIndexPanel.css'

interface KbIndexPanelProps {
  projectId: string
}

const ALL = '__all__'
const UNGROUPED = '__ungrouped__'
const CHUNK_PAGE = 20

const TYPE_LABEL: Record<string, string> = {
  docx: '文档',
  doc: '文档',
  sheet: '表格',
  bitable: '多维表格',
  file: '文件',
  mindnote: '思维导图',
  slides: '幻灯片',
}

type KbViewState = 'indexed' | 'stale' | 'ready' | 'fetching' | 'failed' | 'off'

const STATE_META: Record<KbViewState, { label: string; cls: string }> = {
  indexed: { label: '已索引', cls: 'indexed' },
  stale: { label: '待更新', cls: 'stale' },
  ready: { label: '待索引', cls: 'pending' },
  fetching: { label: '拉取中', cls: 'pending' },
  failed: { label: '失败', cls: 'failed' },
  off: { label: '未收录', cls: 'off' },
}

const stateOf = (doc: SyncDoc): KbViewState => {
  if (doc.kbState === 'off') return 'off'
  if (doc.kbState === 'indexed') return doc.stale ? 'stale' : 'indexed'
  if (doc.kbState === 'ready') return 'ready'
  if (doc.kbState === 'fetching') return 'fetching'
  return 'failed'
}

const ROUTE_LABEL: Record<string, string> = { bm25: '关键词', like: '短词', vector: '语义' }

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const fmtTime = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

type FilterKey = 'all' | 'included' | 'excluded' | 'attention'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'included', label: '已收录' },
  { key: 'excluded', label: '未收录' },
  { key: 'attention', label: '需处理' },
]

/**
 * 「项目知识库」子 tab：收录清单 + 索引状态 + 检索测试。
 * 检索链路：FTS5 trigram（中文 ≥3 字）+ 短词 LIKE 兜底 + 可选向量，RRF 融合。
 */
export default function KbIndexPanel({ projectId }: KbIndexPanelProps) {
  const [docs, setDocs] = useState<SyncDoc[]>([])
  const [status, setStatus] = useState<KbStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [keyword, setKeyword] = useState('')
  const [selectedFolder, setSelectedFolder] = useState<string>(ALL)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [busyDoc, setBusyDoc] = useState('')
  /** 批量收录进行中（后端逐篇拉正文+建索引，靠轮询收敛） */
  const [collecting, setCollecting] = useState(false)

  // 详情：片段
  const [detailId, setDetailId] = useState<string | null>(null)
  const [chunks, setChunks] = useState<KbChunk[]>([])
  const [chunkPage, setChunkPage] = useState(0)
  const [chunkLoading, setChunkLoading] = useState(false)

  // 检索测试
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<KbSearchResult | null>(null)
  const [rerankOn, setRerankOn] = useState(false)

  // 索引设置
  const [configOpen, setConfigOpen] = useState(false)
  const [configForm, setConfigForm] = useState<KbConfig & { apiKey: string }>({
    baseUrl: '', model: '', dim: 0, glossary: '', visionModel: '', rerankModel: '', hasKey: false, apiKey: '',
  })
  const [savingConfig, setSavingConfig] = useState(false)
  /** 重建索引确认弹窗 */
  const [rebuildConfirm, setRebuildConfirm] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [docRes, statusRes] = await Promise.all([
        docSyncApi.docs(projectId),
        kbApi.status(projectId),
      ])
      setDocs(docRes.docs)
      setStatus(statusRes)
      setError('')
    } catch (err) {
      setError(errText(err))
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    void refresh().finally(() => setLoading(false))
  }, [refresh])

  /** 索引/拉取/批量收录中时轮询 */
  useEffect(() => {
    const busy = collecting || (status?.indexing || 0) > 0 || docs.some((d) => d.kbState === 'fetching')
    if (!busy) return
    const timer = window.setInterval(() => { void refresh() }, 3000)
    return () => window.clearInterval(timer)
  }, [status, docs, refresh, collecting])

  /** 批量收录结束（没有剩余未收录、也没有在处理中的文档） */
  useEffect(() => {
    if (!collecting || !status) return
    const { off, fetching, ready, indexed } = status.counts
    if (off === 0 && fetching === 0 && ready === 0 && (status.indexing || 0) === 0 && indexed > 0) {
      setCollecting(false)
    }
  }, [collecting, status])

  /** 兜底：10 分钟后停止轮询，避免个别失败文档导致一直转 */
  useEffect(() => {
    if (!collecting) return
    const timer = window.setTimeout(() => setCollecting(false), 10 * 60 * 1000)
    return () => window.clearTimeout(timer)
  }, [collecting])

  /* ---------- 统计 ---------- */
  const stats = useMemo(() => {
    const counts = status?.counts
    if (counts) return counts
    const ready = docs.filter((d) => stateOf(d) === 'ready').length
    const indexed = docs.filter((d) => stateOf(d) === 'indexed').length
    const stale = docs.filter((d) => stateOf(d) === 'stale').length
    const fetching = docs.filter((d) => stateOf(d) === 'fetching').length
    const failed = docs.filter((d) => stateOf(d) === 'failed').length
    const off = docs.filter((d) => stateOf(d) === 'off').length
    return { included: docs.length - off, indexed, ready, stale, fetching, failed, off }
  }, [status, docs])

  /* ---------- 目录树 ---------- */
  const folderPaths = useMemo(() => {
    const set = new Set<string>()
    for (const doc of docs) {
      if (!doc.parentPath) continue
      const parts = doc.parentPath.split('/')
      for (let i = 1; i <= parts.length; i += 1) set.add(parts.slice(0, i).join('/'))
    }
    return [...set]
  }, [docs])

  const childrenOf = (path: string) => folderPaths.filter((p) => parentOf(p) === path)
  const docsIn = (path: string) => docs.filter((d) => (
    path === '' ? true : d.parentPath === path || d.parentPath.startsWith(`${path}/`)
  ))

  const visibleDocs = useMemo(() => {
    let list = selectedFolder === ALL
      ? docs
      : selectedFolder === UNGROUPED
        ? docs.filter((d) => !d.parentPath)
        : docsIn(selectedFolder)

    if (filter === 'included') list = list.filter((d) => stateOf(d) !== 'off')
    if (filter === 'excluded') list = list.filter((d) => stateOf(d) === 'off')
    if (filter === 'attention') list = list.filter((d) => ['failed', 'stale', 'ready', 'fetching'].includes(stateOf(d)))

    const kw = keyword.trim().toLowerCase()
    if (kw) list = list.filter((d) => d.title.toLowerCase().includes(kw) || d.parentPath.toLowerCase().includes(kw))
    return list
  }, [docs, selectedFolder, filter, keyword, folderPaths]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 操作 ---------- */

  const rebuildAll = async () => {
    try {
      await kbApi.index(projectId)
      await refresh()
    } catch (err) {
      setError(errText(err))
    }
  }

  /** 把已同步但还没收录的文档批量拉正文 + 建索引 */
  const collectAll = async () => {
    try {
      const res = await kbApi.collect(projectId)
      if (res.queued > 0) {
        setCollecting(true)
        await refresh()
      }
    } catch (err) {
      setError(errText(err))
    }
  }

  const rebuildDoc = async (doc: SyncDoc) => {
    setBusyDoc(doc.id)
    try {
      await kbApi.index(projectId, doc.id)
      await refresh()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusyDoc('')
    }
  }

  const refetchDoc = async (doc: SyncDoc) => {
    setBusyDoc(doc.id)
    try {
      await docSyncApi.addToKb(projectId, doc.id)
      await refresh()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusyDoc('')
    }
  }

  /** 收录开关：未收录 → 拉正文并建索引；已收录 → 移出 */
  const toggleDoc = async (doc: SyncDoc) => {
    if (stateOf(doc) === 'off') await refetchDoc(doc)
    else await removeDoc(doc)
  }

  const removeDoc = async (doc: SyncDoc) => {
    setBusyDoc(doc.id)
    try {
      await docSyncApi.removeFromKb(projectId, doc.id)
      setDetailId(null)
      await refresh()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusyDoc('')
    }
  }

  const runSearch = async () => {
    if (!query.trim() || searching) return
    setSearching(true)
    setResult(null)
    try {
      setResult(await kbApi.search(projectId, query.trim(), 8, rerankOn))
    } catch (err) {
      setError(errText(err))
    } finally {
      setSearching(false)
    }
  }

  const openConfig = () => {
    const cfg = status?.config
    setConfigForm({
      baseUrl: cfg?.baseUrl || '',
      model: cfg?.model || '',
      dim: cfg?.dim || 0,
      glossary: cfg?.glossary || '',
      visionModel: cfg?.visionModel || '',
      rerankModel: cfg?.rerankModel || '',
      hasKey: Boolean(cfg?.hasKey),
      apiKey: '',
    })
    setConfigOpen(true)
  }

  const saveConfig = async () => {
    setSavingConfig(true)
    try {
      await kbApi.saveConfig(projectId, {
        baseUrl: configForm.baseUrl,
        model: configForm.model,
        dim: Number(configForm.dim) || 0,
        glossary: configForm.glossary,
        visionModel: configForm.visionModel,
        rerankModel: configForm.rerankModel,
        ...(configForm.apiKey ? { apiKey: configForm.apiKey } : {}),
      })
      setConfigOpen(false)
      await refresh()
    } catch (err) {
      setError(errText(err))
    } finally {
      setSavingConfig(false)
    }
  }

  /** 打开详情时加载片段 */
  useEffect(() => {
    if (!detailId) { setChunks([]); return }
    let cancelled = false
    setChunkLoading(true)
    kbApi.chunks(projectId, detailId, CHUNK_PAGE, chunkPage * CHUNK_PAGE)
      .then((res) => { if (!cancelled) setChunks(res.chunks) })
      .catch((err) => { if (!cancelled) { setChunks([]); setError(errText(err)) } })
      .finally(() => { if (!cancelled) setChunkLoading(false) })
    return () => { cancelled = true }
  }, [detailId, chunkPage, projectId])

  const detailDoc = docs.find((d) => d.id === detailId) || null

  const renderFolder = (path: string, depth: number) => {
    const children = childrenOf(path)
    const isCollapsed = collapsed.includes(path)
    return (
      <div key={path}>
        <button
          type="button"
          className={`kbi-tree-item${selectedFolder === path ? ' active' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setSelectedFolder(path)}
        >
          {children.length > 0 ? (
            <span
              className={`fs-tree-caret${isCollapsed ? '' : ' open'}`}
              title={isCollapsed ? '展开' : '折叠'}
              onClick={(e) => {
                e.stopPropagation()
                setCollapsed(isCollapsed ? collapsed.filter((p) => p !== path) : [...collapsed, path])
              }}
            >
              <ChevronRightIcon size={11} />
            </span>
          ) : <span className="fs-tree-caret-sp" />}
          <FolderIcon size={14} />
          <span className="kbi-tree-name">{path.split('/').pop()}</span>
          <span className="kbi-tree-count">{docsIn(path).length}</span>
        </button>
        {!isCollapsed && children.map((child) => renderFolder(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="kbindex-panel">
      <div className="kbindex-stats">
        <span className="kbi-chip plain">收录 <b>{stats.included}</b></span>
        <span className="kbi-chip ok"><span className="kbi-dot" />已索引 <b>{stats.indexed}</b></span>
        {stats.off > 0 && <span className="kbi-chip plain">未收录 <b>{stats.off}</b></span>}
        {stats.ready > 0 && <span className="kbi-chip run"><span className="kbi-dot" />待索引 <b>{stats.ready}</b></span>}
        {stats.fetching > 0 && <span className="kbi-chip run"><span className="kbi-dot" />拉取中 <b>{stats.fetching}</b></span>}
        {stats.stale > 0 && <span className="kbi-chip plain">待更新 <b>{stats.stale}</b></span>}
        {stats.failed > 0 && <span className="kbi-chip err"><span className="kbi-dot" />失败 <b>{stats.failed}</b></span>}
        <span className="kbi-chip plain">片段 <b>{status?.chunks.chunks ?? 0}</b></span>
        {status?.config.model && (
          <span className="kbi-chip plain">向量 <b>{status.chunks.embeddedCurrent}</b></span>
        )}
        {(status?.chunks.embeddingStale ?? 0) > 0 && (
          <span className="kbi-chip err">待重嵌 <b>{status?.chunks.embeddingStale}</b></span>
        )}
        <span className="kbi-chip plain">覆盖 <b>{Math.round((status?.coverage ?? 0) * 100)}%</b></span>
        <span className="kbindex-stats-acts">
          {stats.off > 0 && (
            <button type="button" className="kbi-act primary" onClick={() => void collectAll()}>
              收录全部（{stats.off}）
            </button>
          )}
          <button type="button" className="kbi-act primary" onClick={() => { setSearchOpen(true); setResult(null) }}>
            检索测试
          </button>
          <button type="button" className="kbi-act" onClick={() => setRebuildConfirm(true)}>重建索引</button>
          <button type="button" className="kbi-act" onClick={openConfig}>索引设置</button>
        </span>
      </div>

      {error && <div className="doclib-error">{error}</div>}

      <div className="kbindex-two-col">
        <div className="kbi-tree">
          <div className="kbi-tree-title">目录</div>
          <button
            type="button"
            className={`kbi-tree-item${selectedFolder === ALL ? ' active' : ''}`}
            onClick={() => setSelectedFolder(ALL)}
          >
            <DocIcon size={14} />
            <span className="kbi-tree-name">全部文档</span>
            <span className="kbi-tree-count">{docs.length}</span>
          </button>
          {childrenOf('').map((path) => renderFolder(path, 0))}
          {docs.some((d) => !d.parentPath) && (
            <button
              type="button"
              className={`kbi-tree-item${selectedFolder === UNGROUPED ? ' active' : ''}`}
              onClick={() => setSelectedFolder(UNGROUPED)}
            >
              <FolderIcon size={14} />
              <span className="kbi-tree-name">未分组</span>
              <span className="kbi-tree-count">{docs.filter((d) => !d.parentPath).length}</span>
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
                  {f.label}
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
            {loading && <div className="kbi-empty">正在加载…</div>}
            {!loading && docs.length === 0 && (
              <div className="kbi-empty">还没有同步到文档。先去「文档」子 tab 添加同步源并同步。</div>
            )}
            {!loading && docs.length > 0 && visibleDocs.length === 0 && <div className="kbi-empty">没有匹配的文档</div>}
            {visibleDocs.map((doc) => {
              const state = stateOf(doc)
              const meta = STATE_META[state]
              return (
                <div key={doc.id} className="kbi-row" onClick={() => { setDetailId(doc.id); setChunkPage(0) }}>
                  <DocIcon size={16} className="kbi-row-icon" />
                  <span className="kbi-row-main">
                    <span className="kbi-row-title">
                      <span className="kbi-row-name">{doc.title}</span>
                      <span className={`kbi-badge ${meta.cls}`}>{meta.label}</span>
                    </span>
                    <span className="kbi-row-sub">
                      {TYPE_LABEL[doc.externalType] || doc.externalType}
                      {doc.parentPath ? ` · ${doc.parentPath}` : ''}
                      {doc.kbState === 'indexed' && doc.kbFetchedAt ? ` · 索引于 ${fmtTime(doc.kbFetchedAt)}` : ''}
                      {(state === 'failed' || state === 'stale') && doc.kbError ? ` · ${doc.kbError}` : ''}
                    </span>
                  </span>
                  <span
                    className={`kbi-toggle${state === 'off' ? ' off' : ''}`}
                    role="switch"
                    aria-checked={state !== 'off'}
                    aria-label={`${state === 'off' ? '收录' : '移出知识库'} ${doc.title}`}
                    title={state === 'off' ? '点击收录：拉取正文并建立索引' : '点击移出知识库（删除正文与索引）'}
                    onClick={(e) => { e.stopPropagation(); void toggleDoc(doc) }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 详情：元信息 + 片段 */}
      {detailDoc && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetailId(null) }}>
          <div className="modal-box kbi-detail-modal" role="dialog" aria-modal="true" aria-label="文档索引详情">
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
                类型：{TYPE_LABEL[detailDoc.externalType] || detailDoc.externalType} · 路径：{detailDoc.parentPath || '根目录'}<br />
                飞书修改：{fmtTime(detailDoc.modifiedAt)}
                {detailDoc.kbFetchedAt && <> · 正文拉取：{fmtTime(detailDoc.kbFetchedAt)}</>}
              </div>
              {(stateOf(detailDoc) === 'failed' || stateOf(detailDoc) === 'stale') && detailDoc.kbError && (
                <p className={`kbi-detail-error${stateOf(detailDoc) === 'stale' ? ' stale' : ''}`}>{detailDoc.kbError}</p>
              )}
              <div className="kbi-detail-acts">
                {stateOf(detailDoc) === 'off' ? (
                  <button type="button" className="kbi-act primary" disabled={busyDoc === detailDoc.id} onClick={() => void refetchDoc(detailDoc)}>
                    ＋ 收录并建索引
                  </button>
                ) : (
                  <>
                    <button type="button" className="kbi-act primary" disabled={busyDoc === detailDoc.id} onClick={() => void rebuildDoc(detailDoc)}>
                      ↻ 重建索引
                    </button>
                    <button type="button" className="kbi-act" disabled={busyDoc === detailDoc.id} onClick={() => void refetchDoc(detailDoc)}>
                      ⤓ 重新拉取正文
                    </button>
                  </>
                )}
                <button type="button" className="kbi-act" onClick={() => {
                  const url = detailDoc.url || `https://feishu.cn/wiki/${detailDoc.externalToken}`
                  window.open(url, '_blank', 'noopener')
                }}>⇱ 在飞书中打开</button>
                {stateOf(detailDoc) !== 'off' && (
                  <button type="button" className="kbi-act" disabled={busyDoc === detailDoc.id} onClick={() => void removeDoc(detailDoc)}>
                    ✕ 移出知识库
                  </button>
                )}
              </div>

              <div className="kbi-chunk-title">
                片段{chunkLoading ? '（加载中…）' : `（第 ${chunkPage + 1} 页）`}
              </div>
              {!chunkLoading && chunks.length === 0 && (
                <p className="kbi-detail-empty">
                  {stateOf(detailDoc) === 'off' ? '未收录，点上方「收录并建索引」。' : '还没有片段。点「重建索引」生成。'}
                </p>
              )}
              {chunks.map((chunk) => (
                <div key={chunk.id} className="kbi-chunk-card">
                  <div className="kbi-chunk-head">
                    <span className="mono">#{String(chunk.ordinal + 1).padStart(3, '0')}</span>
                    <span>·</span>
                    <span>{chunk.sectionPath || '无标题'}</span>
                    <span className="kbi-chunk-meta">{chunk.charCount} 字{chunk.hasEmbedding ? ' · 已向量化' : ''}</span>
                  </div>
                  <pre className="kbi-chunk-body">{chunk.content}</pre>
                </div>
              ))}
            </div>
            <div className="kbi-detail-foot">
              <span className="kbi-chunk-pager-info">每页 {CHUNK_PAGE} 个片段</span>
              <span className="kbi-chunk-pager-btns">
                <button type="button" className="kbi-act" disabled={chunkPage === 0} onClick={() => setChunkPage((p) => p - 1)}>‹ 上一页</button>
                <button type="button" className="kbi-act" disabled={chunks.length < CHUNK_PAGE} onClick={() => setChunkPage((p) => p + 1)}>下一页 ›</button>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 检索测试 */}
      {searchOpen && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setSearchOpen(false) }}>
          <div className="modal-box kbi-ret-modal" role="dialog" aria-modal="true" aria-label="检索测试">
            <div className="modal-head">
              <span className="modal-title">检索测试</span>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setSearchOpen(false)}>×</button>
            </div>
            <div className="kbi-ret-query">
              <input
                value={query}
                placeholder="输入问题或关键词，例如：灰度发布怎么做"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
              />
              {status?.config.rerankModel && (
                <button
                  type="button"
                  className={`kbi-act${rerankOn ? ' primary' : ''}`}
                  title="LLM 重排：更慢但首屏更准"
                  onClick={() => setRerankOn((v) => !v)}
                >
                  重排
                </button>
              )}
              <button type="button" className="kbi-act primary" disabled={searching || !query.trim()} onClick={() => void runSearch()}>
                {searching ? '检索中…' : '检索'}
              </button>
            </div>
            <div className="kbi-ret-body">
              <p className="kbi-ret-hint">
                {status?.config.model
                  ? `关键词 + 语义混合 · 模型 ${status.config.model}`
                  : '仅关键词检索（未配置嵌入模型）'}
              </p>

              {result && (
                <>
                  <p className="kbi-ret-hint">
                    命中 {result.chunks.length} 条 · 关键词 {result.routes.bm25} / 短词 {result.routes.like} / 语义 {result.routes.vector}{result.reranked ? ' · 已重排' : ''}
                  </p>
                  {result.lowConfidence && (
                    <div className="kbi-ret-low">未找到足够依据，结果可能不相关。</div>
                  )}
                  {result.chunks.map((hit) => (
                    <div key={hit.id} className="kbi-ret-item">
                      <div className="kbi-ret-head">
                        <span className="kbi-ret-doc">{hit.doc.title}</span>
                        {hit.sectionPath && <span className="kbi-ret-path">{hit.sectionPath}</span>}
                        {hit.routes.map((r) => (
                          <span key={r} className="kbi-badge off">{ROUTE_LABEL[r] || r}</span>
                        ))}
                        <span className="kbi-ret-score mono">{hit.score.toFixed(3)}</span>
                        <button
                          type="button"
                          className="kbi-ret-open"
                          title="在飞书中打开"
                          onClick={() => window.open(hit.doc.url || `https://feishu.cn/wiki/${hit.docId}`, '_blank', 'noopener')}
                        >
                          <ExternalIcon size={12} />
                        </button>
                      </div>
                      <pre className="kbi-ret-text">{hit.content}</pre>
                    </div>
                  ))}
                </>
              )}
              {!searching && !result && <div className="kbi-ret-status">输入问题后回车，查看命中片段与来源。</div>}
            </div>
          </div>
        </div>
      )}

      {/* 重建索引确认：提示影响范围与费用 */}
      {rebuildConfirm && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setRebuildConfirm(false) }}>
          <div className="modal-box kbi-confirm-modal" role="dialog" aria-modal="true" aria-label="确认重建索引">
            <div className="modal-head">
              <span className="modal-title">重建索引</span>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setRebuildConfirm(false)}>×</button>
            </div>
            <div className="kbi-confirm-body">
              <p>
                将重新切分并刷新本项目 <b>{stats.included}</b> 篇已收录文档的索引（当前 <b>{status?.chunks.chunks ?? 0}</b> 个片段，嵌入模型 {status?.config.model ? <b>{status.config.model}</b> : '未配置'}）。
              </p>
              <ul>
                <li>内容没有变化的片段会按哈希复用，<b>不会重复向量化</b>，通常不产生额外费用。</li>
                <li>若刚切换过嵌入模型，或文档正文有更新，对应片段会重新调用嵌入接口，<b>按片段数计费</b>。</li>
                {(status?.chunks.embeddingStale ?? 0) > 0 && (
                  <li>当前有 <b>{status?.chunks.embeddingStale}</b> 个片段属于旧模型，重建时会重新向量化。</li>
                )}
                <li>重建期间检索仍可用；单个文档处理过程中会短暂显示「待索引」。</li>
              </ul>
              <p className="kbi-confirm-hint">参考耗时：537 个片段全量重建约 12 秒（已配置嵌入模型）；未配置模型时只重切分，通常 1–2 秒。</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="text-btn" onClick={() => setRebuildConfirm(false)}>取消</button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => { setRebuildConfirm(false); void rebuildAll() }}
              >
                继续重建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 索引设置 */}
      {configOpen && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfigOpen(false) }}>
          <div className="modal-box kbi-config-modal" role="dialog" aria-modal="true" aria-label="索引设置">
            <div className="modal-head">
              <span className="modal-title">索引设置</span>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setConfigOpen(false)}>×</button>
            </div>
            <div className="kbi-config-body">
              <label className="kbi-config-row">
                <span>嵌入接口</span>
                <input value={configForm.baseUrl} placeholder="https://api.siliconflow.cn/v1（留空 = 仅关键词）" onChange={(e) => setConfigForm((f) => ({ ...f, baseUrl: e.target.value }))} />
              </label>
              <label className="kbi-config-row">
                <span>模型</span>
                <input value={configForm.model} placeholder="BAAI/bge-m3" onChange={(e) => setConfigForm((f) => ({ ...f, model: e.target.value }))} />
              </label>
              <label className="kbi-config-row">
                <span>维度</span>
                <input type="number" value={configForm.dim || ''} placeholder="1024" onChange={(e) => setConfigForm((f) => ({ ...f, dim: Number(e.target.value) || 0 }))} />
              </label>
              <label className="kbi-config-row">
                <span>图片转写</span>
                <input value={configForm.visionModel} placeholder="Qwen/Qwen3-VL-8B-Instruct（留空 = 图片不收录）" onChange={(e) => setConfigForm((f) => ({ ...f, visionModel: e.target.value }))} />
              </label>
              <label className="kbi-config-row">
                <span>重排模型</span>
                <input value={configForm.rerankModel} placeholder="Qwen/Qwen2.5-7B-Instruct（留空 = 不重排）" onChange={(e) => setConfigForm((f) => ({ ...f, rerankModel: e.target.value }))} />
              </label>
              <label className="kbi-config-row">
                <span>API Key</span>
                <input type="password" value={configForm.apiKey} placeholder={configForm.hasKey ? '已配置，留空不修改' : '未配置'} onChange={(e) => setConfigForm((f) => ({ ...f, apiKey: e.target.value }))} />
              </label>
              <label className="kbi-config-row kbi-config-col">
                <span>术语表</span>
                <textarea
                  value={configForm.glossary}
                  placeholder={'每行一条，查询时自动扩展：\nADE=Agent 开发环境'}
                  onChange={(e) => setConfigForm((f) => ({ ...f, glossary: e.target.value }))}
                />
              </label>
              <p className="kbi-config-hint">
                留空嵌入接口则只跑关键词检索（FTS5），配置后重建索引才会写入向量。图片与文档内嵌图片需要「图片转写」视觉模型，未配置时图片收录会失败。
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="text-btn" onClick={() => setConfigOpen(false)}>取消</button>
              <button type="button" className="btn-primary" disabled={savingConfig} onClick={() => void saveConfig()}>
                {savingConfig ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
