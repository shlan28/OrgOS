import { useState } from 'react'
import type { DocLibrary, KbFolder, KbDoc } from '../../data/projects'
import type { FeishuSettings } from '../../data/settings'
import { DocIcon, ChevronRightIcon, FolderIcon, ExternalIcon, DownloadIcon } from '../icons'
import './KbIndexPanel.css'
import './DocLibraryView.css'

interface DocLibraryViewProps {
  /** 库数据（「文档」子 tab = project.documents） */
  library: DocLibrary
  onUpdateLibrary: (lib: DocLibrary) => void
  /** 飞书个人授权设置（OAuth 导入流程用；与凭证无关） */
  feishu: FeishuSettings
  /** 授权状态写回（授权 / 取消授权，Mock 全局共享） */
  onUpdateFeishu: (updater: (f: FeishuSettings) => FeishuSettings) => void
}

/** 「全部文档」伪目录 id */
const ALL = '__all__'

const nowStamp = () => {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ================= 飞书 Mock 目录树（多层级） ================= */

/** 飞书目录树节点（导入弹窗用） */
interface FsNode {
  /** 目录或文档名 */
  name: string
  /** 目录：子节点；文档：无 children */
  children?: FsNode[]
  /** 文档数（目录行右侧） */
  count?: number
}

/** 飞书云文档 Mock 目录（多层级，与原型图一致） */
const FEISHU_TREE: FsNode[] = [
  {
    name: '产品研发', count: 26,
    children: [
      {
        name: '移动端', count: 11,
        children: [
          { name: '支付链路时序图说明' },
          { name: '首页多视窗交互规格' },
          { name: '结算页灰度方案' },
        ],
      },
      {
        name: 'Web 端', count: 9,
        children: [
          { name: 'PRD v3' },
          { name: '架构设计说明' },
        ],
      },
      {
        name: '设计', count: 6,
        children: [
          { name: '设计规范 tokens' },
        ],
      },
    ],
  },
  {
    name: '运营', count: 12,
    children: [
      { name: '活动复盘 0918' },
      { name: '增长实验记录' },
    ],
  },
  {
    name: '知识库', count: 48,
    children: [
      { name: '新成员环境搭建指南' },
      { name: 'API Mock 数据规范' },
    ],
  },
  {
    name: '研发规范', count: 9,
    children: [
      { name: '编码规范' },
      { name: 'Git 提交规范' },
    ],
  },
  {
    name: '会议纪要', count: 31,
    children: [
      { name: '需求评审 0901' },
      { name: '周会 0925' },
    ],
  },
]

/** 选中目标：路径数组（如 ['产品研发', '移动端']） */
type FsPath = string[]

/**
 * 「文档」子 tab 视图（飞书化）：
 * 左栏多层级目录树 + 右栏文档列表（只读，行尾 ⇗ 跳飞书）+ OAuth 导入弹窗（个人授权 → 选飞书目录；
 * 个人授权与凭证解耦，弹窗无凭证警示条）。
 */
export default function DocLibraryView({
  library, onUpdateLibrary, feishu, onUpdateFeishu,
}: DocLibraryViewProps) {
  const { docs, folders } = library
  // 目录树状态（多层级）
  const [selectedFolder, setSelectedFolder] = useState<string>(ALL)
  const [collapsedIds, setCollapsedIds] = useState<string[]>([])
  // 导入弹窗
  const [importing, setImporting] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)
  /** 多选：勾选的节点路径集合（目录或文档，勾目录 = 导入该目录全部子文档） */
  const [fsChecked, setFsChecked] = useState<string[]>([])
  const [fsCollapsed, setFsCollapsed] = useState<string[]>([
    '产品研发/移动端', '产品研发/Web 端', '产品研发/设计',
    '运营', '知识库', '研发规范', '会议纪要',
  ])
  const [importBusy, setImportBusy] = useState(false)

  /* ---------- 目录树派生逻辑（多层级） ---------- */
  /** 目录的子孙 id 集合（含自身） */
  const subtreeIds = (folderId: string): Set<string> => {
    const ids = new Set<string>([folderId])
    let grew = true
    while (grew) {
      grew = false
      for (const f of folders) {
        if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
          ids.add(f.id)
          grew = true
        }
      }
    }
    return ids
  }

  /** 目录路径文案：产品研发 / 移动端 */
  const folderPathLabel = (folderId: string): string => {
    const parts: string[] = []
    let cur = folders.find((f) => f.id === folderId)
    while (cur) {
      parts.unshift(cur.name)
      cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined
    }
    return parts.join(' / ')
  }

  /** 目录下的文档数（含子孙目录） */
  const countIn = (folderId: string) => {
    const ids = subtreeIds(folderId)
    return docs.filter((d) => ids.has(d.folderId)).length
  }

  const visibleDocs = selectedFolder === ALL
    ? docs
    : docs.filter((d) => subtreeIds(selectedFolder).has(d.folderId))
  const folderName = selectedFolder === ALL
    ? '全部文档'
    : folderPathLabel(selectedFolder)

  /* ---------- 飞书跳转 ---------- */
  const openInFeishu = (doc: KbDoc) => {
    const url = `https://feishu.cn/wiki/${doc.sourceRef || doc.id}`
    window.open(url, '_blank', 'noopener')
  }

  /* ---------- 导入（飞书层级 → 本地目录层级） ---------- */

  /** 查飞书树中路径下的直接子文档名列表（路径为目录时含直接子文档；无子文档 = 叶子文档路径） */
  const fsDocsAt = (path: FsPath): string[] => {
    let nodes: FsNode[] = FEISHU_TREE
    for (const seg of path) {
      const hit = nodes.find((n) => n.name === seg)
      if (!hit || !hit.children) return []
      nodes = hit.children
    }
    // 该路径是目录：收集其全部子孙文档；是文档：空
    const out: string[] = []
    const walk = (list: FsNode[]) => {
      for (const n of list) {
        if (n.children) walk(n.children)
        else out.push(n.name)
      }
    }
    walk(nodes)
    return out
  }

  /** 授权（弹窗内，OAuth Mock 800ms） */
  const handleAuthorize = () => {
    setAuthorizing(true)
    window.setTimeout(() => {
      onUpdateFeishu((f) => ({
        ...f,
        authorized: true,
        authorizedAt: new Date().toLocaleString('zh-CN', {
          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        }).replace(/\//g, '-'),
      }))
      setAuthorizing(false)
    }, 800)
  }

  /** 导入所选（多选）：每个勾选节点解析为「目录 = 全部子文档」或「单文档」，1s 模拟解析后批量写入 */
  const handleImport = () => {
    if (fsChecked.length === 0 || importBusy) return
    setImportBusy(true)
    window.setTimeout(() => {
      /** 展开勾选路径下的所有文档（路径, 文档名）对 */
      const targets: { path: FsPath; name: string }[] = []
      for (const key of fsChecked) {
        const path = key.split('/')
        // 勾选的是文档（叶）：直接一条；勾选的是目录：取其下全部子文档
        const docsInPath = fsDocsAt(path)
        if (docsInPath.length > 0) {
          // 该路径下有直接子文档 → 目录（含全部子孙文档）或本身就是文档
          targets.push(...docsInPath.map((name) => ({ path, name })))
        } else {
          // 叶子文档节点
          const name = path[path.length - 1]
          targets.push({ path: path.slice(0, -1), name })
        }
      }
      // 按路径逐级建目录 + 生成文档
      const newFolders: KbFolder[] = []
      const newDocs: KbDoc[] = []
      const folderIdByPath = new Map<string, string>()
      const localFolders = [...folders]
      const ensurePath = (path: FsPath): string => {
        const pathKey = path.join('/')
        if (folderIdByPath.has(pathKey)) return folderIdByPath.get(pathKey)!
        let parentId: string | undefined
        let lastId = ''
        for (const seg of path) {
          const segKey = parentId ? `${parentId}/${seg}` : seg
          let fid = folderIdByPath.get(segKey)
          if (!fid) {
            const exist = localFolders.find((f) => f.name === seg && (f.parentId ?? '') === (parentId ?? ''))
            if (exist) {
              fid = exist.id
            } else {
              const folder: KbFolder = { id: `f${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: seg }
              if (parentId) folder.parentId = parentId
              localFolders.push(folder)
              newFolders.push(folder)
              fid = folder.id
            }
            folderIdByPath.set(segKey, fid)
          }
          lastId = fid
          parentId = fid
        }
        return lastId
      }
      targets.forEach(({ path, name }, i) => {
        const folderId = path.length > 0 ? ensurePath(path) : ''
        newDocs.push({
          id: `d${Date.now()}_${i}`,
          title: name,
          source: '团队 wiki',
          sourceRef: `wiki/${[...path, name].join('/')}`,
          folderId,
          importedAt: nowStamp(),
          updatedAt: nowStamp(),
          markdown: '',
          content: [],
          summary: `（从飞书 ${path.join('/') || '根目录'} 导入，解析后可查看摘要。）`,
        })
      })
      onUpdateLibrary({
        ...library,
        folders: localFolders,
        docs: [...newDocs, ...docs],
      })
      setImportBusy(false)
      setImporting(false)
      setFsChecked([])
    }, 1000)
  }

  /* ---------- 左栏目录树（多层级递归渲染，对齐 kbi-tree 样式） ---------- */
  const renderFolderNode = (folder: KbFolder, depth: number) => {
    const children = folders.filter((f) => f.parentId === folder.id)
    const collapsed = collapsedIds.includes(folder.id)
    return (
      <div key={folder.id}>
        <button
          type="button"
          className={`kbi-tree-item${selectedFolder === folder.id ? ' active' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setSelectedFolder(folder.id)}
        >
          {children.length > 0 ? (
            <span
              className={`fs-tree-caret${collapsed ? '' : ' open'}`}
              title={collapsed ? '展开' : '折叠'}
              onClick={(e) => {
                e.stopPropagation()
                setCollapsedIds(collapsed
                  ? collapsedIds.filter((id) => id !== folder.id)
                  : [...collapsedIds, folder.id])
              }}
            >
              <ChevronRightIcon size={11} />
            </span>
          ) : (
            <span className="fs-tree-caret-sp" />
          )}
          <FolderIcon size={14} />
          <span className="kbi-tree-name">{folder.name}</span>
          <span className="kbi-tree-count">{countIn(folder.id)}</span>
        </button>
        {!collapsed && children.map((c) => renderFolderNode(c, depth + 1))}
      </div>
    )
  }

  /* ---------- 导入弹窗：飞书目录树递归渲染（多选） ---------- */

  /** 某路径下全部子文档的完整路径集合（勾选目录时全量计算勾选态） */
  const subtreeDocKeys = (path: FsPath): string[] => {
    const docs = fsDocsAt(path)
    return docs.map((name) => [...path, name].join('/'))
  }

  const toggleCheck = (key: string) => {
    setFsChecked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  /** 勾选态：自身勾选；目录 = 三态（全选 ✓ / 部分 — / 空） */
  const checkStateOf = (key: string, hasChildren: boolean): 'on' | 'part' | 'off' => {
    if (fsChecked.includes(key)) return 'on'
    if (!hasChildren) return 'off'
    // 目录：子孙文档有勾选但自身未勾 → 半选
    const docs = subtreeDocKeys(key.split('/'))
    const hitCount = docs.filter((k) => fsChecked.some((c) => k === c || k.startsWith(`${c}/`) || c.startsWith(`${k}/`))).length
    if (hitCount > 0 && hitCount < docs.length) return 'part'
    if (hitCount === docs.length && docs.length > 0) return 'on'
    return 'off'
  }

  const renderFsNode = (node: FsNode, path: FsPath, depth: number) => {
    const nodePath = [...path, node.name]
    const key = nodePath.join('/')
    const hasChildren = !!node.children && node.children.length > 0
    const collapsed = fsCollapsed.includes(key)
    const checkState = checkStateOf(key, hasChildren)
    return (
      <div key={key}>
        <div
          className={`fs-tree-item${checkState === 'on' ? ' sel' : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          {/* 多选 checkbox：目录三态 / 文档两态 */}
          <button
            type="button"
            role="checkbox"
            aria-checked={checkState === 'on'}
            className={`fs-check${checkState === 'on' ? ' on' : ''}${checkState === 'part' ? ' part' : ''}`}
            title={hasChildren ? '勾选导入该目录全部文档' : '勾选导入该文档'}
            onClick={() => toggleCheck(key)}
          >
            {checkState === 'on' ? '✓' : checkState === 'part' ? '—' : ''}
          </button>
          {/* 名称行：目录点击 = 展开折叠 */}
          <button
            type="button"
            className="fs-tree-label"
            onClick={() => {
              if (hasChildren) {
                setFsCollapsed(collapsed
                  ? fsCollapsed.filter((k) => k !== key)
                  : [...fsCollapsed, key])
              }
            }}
          >
            {hasChildren ? (
              <span className={`fs-tree-caret${collapsed ? '' : ' open'}`}><ChevronRightIcon size={11} /></span>
            ) : (
              <span className="fs-tree-caret-sp" />
            )}
            {hasChildren
              ? <span className="fs-tree-dir"><FolderIcon size={14} /></span>
              : <span className="fs-tree-doc"><DocIcon size={13} /></span>}
            <span className="fs-tree-name">{node.name}</span>
            {hasChildren && node.count !== undefined && (
              <span className="fs-tree-count">{node.count} 篇</span>
            )}
          </button>
        </div>
        {!collapsed && hasChildren && node.children!.map((c) => renderFsNode(c, nodePath, depth + 1))}
      </div>
    )
  }

  /* ---------- 列表视图（对齐项目知识库 kbi 样式体系：左目录树 + 右列表） ---------- */
  return (
    <div className="doclib-panel">
      <div className="doclib-two-col">
        {/* 左：目录树（多层级，对齐 kbi-tree） */}
        <div className="kbi-tree">
          <div className="kbi-tree-title">目录</div>
          <button
            type="button"
            className={`kbi-tree-item${selectedFolder === ALL ? ' active' : ''}`}
            onClick={() => setSelectedFolder(ALL)}
          >
            <DocIcon size={14} />
            <span className="kbi-tree-name">全部文档</span>
            <span className="kbi-tree-count"><b>{docs.length}</b>/{docs.length}</span>
          </button>
          {folders.filter((f) => !f.parentId).map((f) => renderFolderNode(f, 0))}
        </div>

        {/* 右：列表（对齐 kbi-list：工具行 + 行列表） */}
        <div className="kbi-list">
          <div className="kbi-list-tools">
            <span className="doclib-list-label">{folderName}（{visibleDocs.length} 篇）</span>
            <span className="doclib-tools-acts">
              <button type="button" className="fs-import-btn" onClick={() => setImporting(true)}>
                <DownloadIcon size={13} />
                从飞书导入
              </button>
            </span>
          </div>
          <div className="kbi-list-body">
            {visibleDocs.length === 0 && <div className="kbi-empty">该目录下暂无文档</div>}
            {visibleDocs.map((doc) => (
              <div key={doc.id} className="kbi-row">
                <DocIcon size={16} className="kbi-row-icon" />
                <span className="kbi-row-main">
                  <span className="kbi-row-title">
                    <span className="kbi-row-name">{doc.title}</span>
                    <span className="kbi-badge off">{doc.source}</span>
                  </span>
                  <span className="kbi-row-sub">
                    {doc.sourceRef || doc.source} · 更新于 {doc.updatedAt}
                  </span>
                </span>
                <button
                  type="button"
                  className="doc-jump-btn"
                  title="在飞书中打开"
                  onClick={() => openInFeishu(doc)}
                >
                  <ExternalIcon size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 飞书 OAuth 导入弹窗 */}
      {importing && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setImporting(false) }}
        >
          <div className="modal-box fs-import-modal" role="dialog" aria-modal="true" aria-label="从飞书导入文档">
            <div className="modal-head">
              <span className="modal-title">从飞书导入文档</span>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setImporting(false)}>×</button>
            </div>

            {/* 步骤条 */}
            <div className="fs-steps">
              <span className={`fs-step${feishu.authorized ? ' done' : ' active'}`}>
                <span className="fs-step-num">{feishu.authorized ? '✓' : '1'}</span>个人授权
              </span>
              <span className="fs-step-arrow">→</span>
              <span className={`fs-step${feishu.authorized ? ' active' : ''}`}>
                <span className="fs-step-num">2</span>选择目录
              </span>
            </div>

            {/* 步骤 1：个人授权卡（与凭证无关，未授权直接授权） */}
            <div className="fs-auth-card">
              <div className="fs-auth-title">飞书个人授权</div>
              <div className="fs-auth-sub">权限：读取云文档目录 · OAuth 登录授权，无需配置应用凭证</div>
              {feishu.authorized ? (
                <div className="fs-auth-done">
                  <span className="fs-ok-badge">已授权</span>
                  {feishu.authorizedAccount} · {feishu.authorizedAt}
                </div>
              ) : (
                <button
                  type="button"
                  className="fs-auth-btn"
                  disabled={authorizing}
                  title="发起飞书个人授权"
                  onClick={handleAuthorize}
                >
                  {authorizing ? '授权中…' : '授权'}
                </button>
              )}
            </div>

            {/* 步骤 2：飞书目录树（多层级） */}
            <div className="fs-tree-wrap">
              <div className="fs-tree">
                {FEISHU_TREE.map((n) => renderFsNode(n, [], 0))}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="text-btn" onClick={() => setImporting(false)}>取消</button>
              <button
                type="button"
                className="btn-primary"
                disabled={!feishu.authorized || fsChecked.length === 0 || importBusy}
                onClick={handleImport}
              >
                {importBusy
                  ? '导入中…'
                  : fsChecked.length > 0
                    ? `导入所选（${fsChecked.length} 项）`
                    : '请勾选要导入的目录或文档'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
