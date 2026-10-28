import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  docSyncApi,
  type BrowseItem,
  type DocSource,
  type DocSourceKind,
  type DocSyncAuth,
  type SyncDoc,
  type SyncRun,
} from '../../lib/docSyncApi'
import { DocIcon, ChevronRightIcon, FolderIcon, ExternalIcon, DownloadIcon, PlusIcon } from '../icons'
import './KbIndexPanel.css'
import './DocLibraryView.css'

interface DocLibraryViewProps {
  projectId: string
}

const TYPE_LABEL: Record<string, string> = {
  docx: '文档',
  doc: '文档',
  sheet: '表格',
  bitable: '多维表格',
  file: '文件',
  mindnote: '思维导图',
  slides: '幻灯片',
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

const fmtTime = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 知识库收录状态徽标 */
function kbBadgeOf(doc: SyncDoc): { cls: string; label: string } | null {
  if (doc.syncStatus === 'failed') return { cls: 'failed', label: '同步失败' }
  if (doc.kbState === 'fetching') return { cls: 'pending', label: '拉取中' }
  if (doc.kbState === 'failed') return { cls: 'failed', label: '拉取失败' }
  if (doc.kbState === 'indexed') return doc.stale ? { cls: 'stale', label: '待更新' } : { cls: 'indexed', label: '已索引' }
  if (doc.kbState === 'ready') return doc.stale ? { cls: 'stale', label: '待更新' } : { cls: 'pending', label: '待索引' }
  return null
}

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/**
 * 「文档」子 tab：真实飞书目录 + 文档清单。
 * 同步只拉清单（元数据），正文在「项目知识库」收录时才拉取。
 */
export default function DocLibraryView({ projectId }: DocLibraryViewProps) {
  const [sources, setSources] = useState<DocSource[]>([])
  const [docs, setDocs] = useState<SyncDoc[]>([])
  const [activeSource, setActiveSource] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [runId, setRunId] = useState('')
  const [run, setRun] = useState<SyncRun | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [menuDoc, setMenuDoc] = useState('')
  const [busyDoc, setBusyDoc] = useState('')

  /* ---------- 数据加载 ---------- */

  const refresh = useCallback(async () => {
    try {
      const [sourceRes, docRes] = await Promise.all([
        docSyncApi.sources(projectId),
        docSyncApi.docs(projectId, { sourceId: activeSource || undefined }),
      ])
      setSources(sourceRes.sources)
      setDocs(docRes.docs)
      setError('')
      if (sourceRes.runningRunId) {
        setRunId(sourceRes.runningRunId)
        setSyncing(true)
      }
    } catch (err) {
      setError(errText(err))
    }
  }, [projectId, activeSource])

  useEffect(() => {
    setLoading(true)
    void refresh().finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    setSelectedPath('')
    setMenuDoc('')
  }, [activeSource])

  /** 同步进度轮询 */
  useEffect(() => {
    if (!syncing || !runId) return
    let timer = 0
    let stopped = false

    const tick = async () => {
      try {
        const res = await docSyncApi.getRun(projectId, runId)
        if (stopped) return
        setRun(res.run)
        if (res.run.status === 'running') {
          timer = window.setTimeout(tick, 1000)
          return
        }
        setSyncing(false)
        setRunId('')
        await refresh()
        setToast(
          res.run.status === 'failed'
            ? `同步失败 · ${res.run.failed} 处：${(res.run.error || '未知错误').slice(0, 70)}${(res.run.error || '').length > 70 ? '…' : ''}`
            : `同步完成 · 新增 ${res.run.added} / 更新 ${res.run.updated} / 移除 ${res.run.removed}${res.run.failed ? ` / 失败 ${res.run.failed}` : ''}`,
        )
      } catch (err) {
        if (stopped) return
        setSyncing(false)
        setRunId('')
        setError(errText(err))
      }
    }

    void tick()
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [syncing, runId, projectId, refresh])

  /** 收正文中的文档轮询 */
  useEffect(() => {
    if (!docs.some((d) => d.kbState === 'fetching')) return
    const timer = window.setInterval(() => { void refresh() }, 2000)
    return () => window.clearInterval(timer)
  }, [docs, refresh])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  /* ---------- 操作 ---------- */

  const handleSync = async () => {
    if (syncing) return
    try {
      const res = await docSyncApi.startSync(projectId, activeSource || undefined)
      setRunId(res.runId)
      setRun(null)
      setSyncing(true)
    } catch (err) {
      setError(errText(err))
    }
  }

  const handleKbToggle = async (doc: SyncDoc) => {
    setBusyDoc(doc.id)
    setMenuDoc('')
    try {
      if (doc.kbState === 'off') await docSyncApi.addToKb(projectId, doc.id)
      else await docSyncApi.removeFromKb(projectId, doc.id)
      await refresh()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusyDoc('')
    }
  }

  const handleRemoveSource = async (source: DocSource) => {
    const ok = window.confirm(`移除同步源「${source.name}」？该源下已同步的文档与正文快照会一并删除。`)
    if (!ok) return
    try {
      await docSyncApi.removeSource(projectId, source.id)
      if (activeSource === source.id) setActiveSource('')
      await refresh()
    } catch (err) {
      setError(errText(err))
    }
  }

  /* ---------- 目录树派生 ---------- */

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

  const visibleDocs = docsIn(selectedPath)
  const currentSource = sources.find((s) => s.id === activeSource) || null
  const listLabel = selectedPath || (currentSource ? currentSource.name : '全部文档')

  const renderFolder = (path: string, depth: number) => {
    const children = childrenOf(path)
    const isCollapsed = collapsed.includes(path)
    return (
      <div key={path}>
        <button
          type="button"
          className={`kbi-tree-item${selectedPath === path ? ' active' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setSelectedPath(path)}
        >
          {children.length > 0 ? (
            <span
              className={`fs-tree-caret${isCollapsed ? '' : ' open'}`}
              title={isCollapsed ? '展开' : '折叠'}
              onClick={(e) => {
                e.stopPropagation()
                setCollapsed(isCollapsed
                  ? collapsed.filter((p) => p !== path)
                  : [...collapsed, path])
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

  /* ---------- 渲染 ---------- */

  return (
    <div className="doclib-panel">
      {/* 工具栏：源切换 + 同步 + 源管理 */}
      <div className="doclib-toolbar">
        <select
          className="doclib-select"
          value={activeSource}
          onChange={(e) => setActiveSource(e.target.value)}
          title="切换同步源"
        >
          <option value="">全部同步源</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.kind === 'wiki_space' ? '知识库 · ' : '文件夹 · '}{s.name}
            </option>
          ))}
        </select>

        <span className="doclib-run">
          {syncing
            ? `同步中…${run ? ` 已扫描 ${run.total} 篇` : ''}`
            : currentSource?.lastSyncedAt
              ? `上次同步 ${fmtTime(currentSource.lastSyncedAt)}`
              : ''}
        </span>

        <span className="doclib-tools-acts">
          <button type="button" className="fs-import-btn" disabled={syncing || sources.length === 0} onClick={handleSync}>
            <DownloadIcon size={13} />
            {syncing ? '同步中…' : '立即同步'}
          </button>
          <button type="button" className="fs-import-btn" onClick={() => setAddOpen(true)}>
            <PlusIcon size={13} />
            添加同步源
          </button>
        </span>
      </div>

      {error && <div className="doclib-error">{error}</div>}

      {loading ? (
        <div className="kbi-empty">正在加载飞书文档…</div>
      ) : sources.length === 0 ? (
        <div className="doclib-empty-state">
          <FolderIcon size={26} />
          <p>还没有飞书同步源</p>
          <span>添加一个云空间文件夹或知识库空间，就能把飞书文档同步到这里。</span>
          <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>添加同步源</button>
        </div>
      ) : (
        <div className="doclib-two-col">
          <div className="kbi-tree">
            <div className="kbi-tree-title">目录</div>
            <button
              type="button"
              className={`kbi-tree-item${selectedPath === '' ? ' active' : ''}`}
              onClick={() => setSelectedPath('')}
            >
              <DocIcon size={14} />
              <span className="kbi-tree-name">全部文档</span>
              <span className="kbi-tree-count"><b>{docs.length}</b></span>
            </button>
            {childrenOf('').map((path) => renderFolder(path, 0))}
          </div>

          <div className="kbi-list">
            <div className="kbi-list-tools">
              <span className="doclib-list-label">{listLabel}（{visibleDocs.length} 篇）</span>
            </div>
            <div className="kbi-list-body">
              {visibleDocs.length === 0 && (
                <div className="kbi-empty">{syncing ? '同步中，稍候刷新…' : '该目录下暂无文档，点击「立即同步」拉取'}</div>
              )}
              {visibleDocs.map((doc) => {
                const badge = kbBadgeOf(doc)
                return (
                  <div key={doc.id} className="kbi-row">
                    <DocIcon size={16} className="kbi-row-icon" />
                    <span className="kbi-row-main">
                      <span className="kbi-row-title">
                        <span className="kbi-row-name">{doc.title}</span>
                        {badge && <span className={`kbi-badge ${badge.cls}`}>{badge.label}</span>}
                      </span>
                      <span className="kbi-row-sub">
                        {TYPE_LABEL[doc.externalType] || doc.externalType}
                        {doc.parentPath ? ` · ${doc.parentPath}` : ''}
                        {` · 更新于 ${fmtTime(doc.modifiedAt)}`}
                        {doc.kbState === 'failed' && doc.kbError ? ` · ${doc.kbError}` : ''}
                      </span>
                    </span>
                    <div className="doclib-row-acts">
                      <button
                        type="button"
                        className="doclib-dots"
                        title="更多"
                        disabled={busyDoc === doc.id}
                        onClick={() => setMenuDoc(menuDoc === doc.id ? '' : doc.id)}
                      >
                        ⋯
                      </button>
                      {menuDoc === doc.id && (
                        <>
                          <div className="doclib-menu-mask" onClick={() => setMenuDoc('')} />
                          <div className="doclib-row-menu">
                            {doc.kbState === 'off' ? (
                              <button type="button" onClick={() => void handleKbToggle(doc)}>＋ 加入知识库</button>
                            ) : (
                              <>
                                {doc.stale && <button type="button" onClick={() => void handleKbToggle(doc)}>↻ 重新拉取正文</button>}
                                <button type="button" onClick={() => void handleKbToggle(doc)}>✕ 移出知识库</button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                      <button
                        type="button"
                        className="doc-jump-btn"
                        title="在飞书中打开"
                        onClick={() => {
                          const url = doc.url || `https://feishu.cn/wiki/${doc.externalToken}`
                          window.open(url, '_blank', 'noopener')
                        }}
                      >
                        <ExternalIcon size={15} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {toast && <div className="doclib-toast">{toast}</div>}

      {addOpen && (
        <AddSourceModal
          projectId={projectId}
          sources={sources}
          onRemove={handleRemoveSource}
          onClose={() => setAddOpen(false)}
          onAdded={async (added) => {
            setAddOpen(false)
            await refresh()
            if (added[0]) setActiveSource(added[0].id)
            try {
              const res = await docSyncApi.startSync(projectId)
              setRunId(res.runId)
              setRun(null)
              setSyncing(true)
            } catch (err) {
              setError(errText(err))
            }
          }}
        />
      )}
    </div>
  )
}

/* ================= 添加同步源弹窗（目录 / 空间 / 单篇文档，可多选） ================= */

interface AddSourceModalProps {
  projectId: string
  sources: DocSource[]
  onRemove: (source: DocSource) => void | Promise<void>
  onClose: () => void
  onAdded: (sources: DocSource[]) => void | Promise<void>
}

interface Picked {
  key: string
  kind: DocSourceKind
  token: string
  name: string
  url?: string
  docType?: string
}

function AddSourceModal({ projectId, sources, onRemove, onClose, onAdded }: AddSourceModalProps) {
  const [kind, setKind] = useState<DocSourceKind>('folder')
  const [path, setPath] = useState<{ token: string; name: string }[]>([])
  const [items, setItems] = useState<BrowseItem[]>([])
  const [currentToken, setCurrentToken] = useState('')
  const [auth, setAuth] = useState<DocSyncAuth>('tenant')
  const [selected, setSelected] = useState<Picked[]>([])
  const [browsing, setBrowsing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (nextKind: DocSourceKind, nextPath: { token: string; name: string }[]) => {
    setBrowsing(true)
    setError('')
    try {
      const wikiSpace = nextKind === 'wiki_space' ? (nextPath[0]?.token || '') : ''
      const parent = nextKind === 'wiki_space'
        ? (nextPath.length > 1 ? nextPath[nextPath.length - 1].token : '')
        : (nextPath.length > 0 ? nextPath[nextPath.length - 1].token : '')
      const res = await docSyncApi.browse(projectId, { kind: nextKind === 'doc' ? 'folder' : nextKind, token: wikiSpace, parent, auth })
      setItems(res.items)
      setCurrentToken(res.token)
      setAuth(res.auth)
    } catch (err) {
      setItems([])
      setError(errText(err))
    } finally {
      setBrowsing(false)
    }
  }, [projectId, auth])

  useEffect(() => { void load(kind, path) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const switchKind = (next: 'folder' | 'wiki_space') => {
    if (next === kind) return
    setKind(next)
    setPath([])
    setItems([])
    setCurrentToken('')
    void load(next, [])
  }

  const enter = (item: BrowseItem) => {
    if (!item.hasChildren) return
    const token = kind === 'wiki_space' ? (item.nodeToken || item.token) : item.token
    const next = [...path, { token, name: item.name }]
    setPath(next)
    void load(kind, next)
  }

  const goRoot = () => {
    setPath([])
    void load(kind, [])
  }

  /** 列表项 → 待添加的源 */
  const toPick = (item: BrowseItem): Picked => {
    if (item.type === 'space') {
      return { key: `wiki_space:${item.token}`, kind: 'wiki_space', token: item.token, name: item.name }
    }
    if (kind === 'folder' && item.type === 'folder') {
      return { key: `folder:${item.token}`, kind: 'folder', token: item.token, name: item.name }
    }
    return {
      key: `doc:${item.token}`,
      kind: 'doc',
      token: item.token,
      name: item.name,
      url: item.url,
      docType: item.objType || 'docx',
    }
  }

  /** 当前所在目录本身也可以作为一个源（整棵子树） */
  const currentPick: Picked | null = kind === 'folder' && currentToken
    ? {
      key: `folder:${currentToken}`,
      kind: 'folder',
      token: currentToken,
      name: path.length > 0 ? path[path.length - 1].name : '云空间根目录',
    }
    : null

  const isOn = (key: string) => selected.some((p) => p.key === key)
  const toggle = (pick: Picked) => setSelected((prev) => (
    prev.some((p) => p.key === pick.key) ? prev.filter((p) => p.key !== pick.key) : [...prev, pick]
  ))

  /** 已在同步源里的项：列表中直接显示为勾选，点击即移除 */
  const sourceByKey = new Map(sources.map((s) => [`${s.kind}:${s.token}`, s]))
  const existingOf = (pick: Picked) => sourceByKey.get(pick.key)
  const currentExisting = currentPick ? existingOf(currentPick) : undefined

  const handleAdd = async () => {
    if (selected.length === 0 || adding) return
    setAdding(true)
    setError('')
    try {
      const res = await docSyncApi.addSources(projectId, selected.map((p) => ({
        kind: p.kind,
        token: p.token,
        name: p.name,
        url: p.url,
        auth,
        docType: p.docType,
      })))
      if (res.failed.length > 0) {
        setError(res.failed.map((f) => `${f.name || '未命名'}：${f.error}`).join('；'))
        if (res.sources.length === 0) return
      }
      await onAdded(res.sources)
    } catch (err) {
      setError(errText(err))
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box fs-import-modal" role="dialog" aria-modal="true" aria-label="添加飞书同步源">
        <div className="modal-head">
          <span className="modal-title">添加飞书同步源</span>
          <button type="button" className="modal-close" aria-label="关闭" onClick={onClose}>×</button>
        </div>

        <div className="fs-kind-tabs">
          <button type="button" className={kind === 'folder' ? 'active' : ''} onClick={() => switchKind('folder')}>
            云空间
          </button>
          <button type="button" className={kind === 'wiki_space' ? 'active' : ''} onClick={() => switchKind('wiki_space')}>
            知识库空间
          </button>
        </div>

        <div className="fs-breadcrumb">
          <button type="button" onClick={goRoot}>根目录</button>
          {path.map((seg, index) => (
            <span key={`${seg.token}-${index}`}>
              <span className="fs-crumb-sep">/</span>
              <span className="fs-crumb-cur">{seg.name}</span>
            </span>
          ))}
          <span className="fs-auth-chip">{auth === 'user' ? '个人身份' : '应用身份'}</span>
        </div>

        <div className="fs-select-hint">
          勾选目录 = 同步整棵子树；勾选文档 = 只同步这一篇。已添加的项显示为勾选，点一下可移除。
        </div>

        <div className="fs-tree-wrap" style={{ maxHeight: 300 }}>
          <div className="fs-tree">
            {currentPick && (
              <div className={`fs-tree-item${currentExisting || isOn(currentPick.key) ? ' sel' : ''}`}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={Boolean(currentExisting || isOn(currentPick.key))}
                  className={`fs-check${currentExisting || isOn(currentPick.key) ? ' on' : ''}${currentExisting ? ' locked' : ''}`}
                  title={currentExisting ? '已在同步源中，点击移除' : '勾选当前目录（含全部子目录）'}
                  onClick={() => {
                    if (currentExisting) void onRemove(currentExisting)
                    else toggle(currentPick)
                  }}
                >
                  {currentExisting || isOn(currentPick.key) ? '✓' : ''}
                </button>
                <span className="fs-current-label">
                  <FolderIcon size={14} />
                  <span className="fs-tree-name">当前目录：{currentPick.name}</span>
                  {currentExisting && <span className="fs-tree-count">已添加</span>}
                </span>
              </div>
            )}

            {browsing && <div className="kbi-empty">正在读取飞书目录…</div>}
            {!browsing && items.length === 0 && <div className="kbi-empty">这里没有可用的目录</div>}

            {!browsing && items.map((item) => {
              const pick = toPick(item)
              const existing = existingOf(pick)
              const on = Boolean(existing) || isOn(pick.key)
              return (
                <div key={`${item.token}-${item.name}`} className={`fs-tree-item${on ? ' sel' : ''}`}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={`fs-check${on ? ' on' : ''}${existing ? ' locked' : ''}`}
                    title={existing
                      ? '已在同步源中，点击移除'
                      : pick.kind === 'doc' ? '勾选只同步这一篇' : '勾选同步整棵子树'}
                    onClick={() => {
                      if (existing) void onRemove(existing)
                      else toggle(pick)
                    }}
                  >
                    {on ? '✓' : ''}
                  </button>
                  <button
                    type="button"
                    className="fs-tree-label"
                    disabled={!item.hasChildren}
                    onClick={() => enter(item)}
                  >
                    {item.hasChildren
                      ? <span className="fs-tree-caret open"><ChevronRightIcon size={11} /></span>
                      : <span className="fs-tree-caret-sp" />}
                    {item.type === 'doc'
                      ? <span className="fs-tree-doc"><DocIcon size={13} /></span>
                      : <span className="fs-tree-dir"><FolderIcon size={14} /></span>}
                    <span className="fs-tree-name">{item.name}</span>
                    {existing && <span className="fs-tree-count">已添加</span>}
                    {item.hasChildren && <span className="fs-tree-count">下钻</span>}
                    {item.type === 'doc' && <span className="fs-tree-count">{TYPE_LABEL[item.objType || ''] || item.objType}</span>}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="fs-pick">
          {selected.length > 0
            ? <>已选 {selected.length} 项：{selected.map((p) => p.name).join('、')}</>
            : <span className="fs-pick-hint">还没有勾选任何目录或文档</span>}
        </div>

        {error && <div className="doclib-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="text-btn" onClick={onClose}>取消</button>
          <button
            type="button"
            className="btn-primary"
            disabled={selected.length === 0 || adding}
            onClick={() => void handleAdd()}
          >
            {adding ? '添加中…' : `添加所选（${selected.length} 项）`}
          </button>
        </div>
      </div>
    </div>
  )
}
