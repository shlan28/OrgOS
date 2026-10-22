import { useEffect, useRef, useState } from 'react'
import type {
  CodeReviewData, ChecklistItem, ReviewMr, ReviewComment,
  ItemCategory, CommentLevel,
} from '../../data/codereview'
import {
  CHECK_CATEGORIES, COMMENT_LEVELS, ITEM_SCOPES,
  agreementStats, resolutionProgress, missList, weakItems, nowStamp, mergePendingHuman,
} from '../../data/codereview'
import { Section, Row } from '../SettingsRow'
import SegmentedControl from '../SegmentedControl'
import StatusBadge, { type BadgeTone } from '../StatusBadge'
import Toggle from '../Toggle'
import FormModal, { ModalField } from '../FormModal'
import { ChevronDownIcon, ChecklistIcon, RobotIcon, ArrowLeftIcon } from '../icons'
import './CodeReviewPanel.css'

/** 比对状态 → 徽标色 */
const matchTone: Record<ReviewComment['match'], BadgeTone> = {
  双方一致: 'success',
  仅ADE: 'warning',
  仅人工: 'danger',
}

/** 意见级别 → 徽标色 */
const levelTone: Record<CommentLevel, BadgeTone> = {
  必须修改: 'danger',
  建议修改: 'neutral',
}

/** MR 状态 → 徽标色 */
const mrStatusTone: Record<ReviewMr['status'], BadgeTone> = {
  初审中: 'info',
  待复审: 'warning',
  待裁决: 'warning',
  已完成: 'neutral',
}

/** MR 结论 → 徽标色 */
const verdictTone: Record<NonNullable<ReviewMr['verdict']>, BadgeTone> = {
  通过: 'success',
  打回: 'danger',
}

/** 分类 → 展示色（检查项引用 / 分类徽标用） */
const categoryColor: Record<ItemCategory, string> = {
  正确性: 'var(--status-info)',
  可维护性: 'var(--status-success)',
  性能: 'var(--status-warning)',
  测试: '#7c5cbf',
  规范: 'var(--status-neutral)',
}

/** 分段说明文案 */
const SEG_HINT: Record<string, string> = {
  queue: '每个 MR 由 ADE 初审 + 人工复审双线独立审查，交叉比对后由人工裁决',
  checklist: '检查项是两条审查线的共同依据，每条意见必须挂载检查项',
  report: '从已完成审查的裁决结果中聚合一致率、误报与漏检',
}

/** 新建/编辑检查项表单 */
interface ItemForm {
  title: string
  category: ItemCategory
  defaultLevel: CommentLevel
  description: string
  badExample: string
  goodExample: string
  scope: string
}

const emptyItemForm = (): ItemForm => ({
  title: '', category: '正确性', defaultLevel: '建议修改',
  description: '', badExample: '', goodExample: '', scope: ITEM_SCOPES[0],
})

interface CodeReviewPanelProps {
  data: CodeReviewData
  onUpdateData: (d: CodeReviewData) => void
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
 * 代码审查面板（双审交叉验证）：
 * 审查队列（MR 列表 → 二级双栏对比 + 裁决 + 结论）
 * 审查标准（五分类检查项 CRUD + 启停）
 * 一致性报告（KPI + 漏检清单反哺 + 薄弱检查项）
 */
export default function CodeReviewPanel({ data, onUpdateData }: CodeReviewPanelProps) {
  const [segment, setSegment] = useState<'queue' | 'checklist' | 'report'>('queue')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollToTop(rootRef.current)
  }, [segment])

  const enabledCount = data.checklist.filter((i) => i.enabled).length

  return (
    <div className="cr-panel" ref={rootRef}>
      <SegmentedControl
        value={segment}
        onChange={(key) => setSegment(key as 'queue' | 'checklist' | 'report')}
        items={[
          { key: 'queue', label: `审查队列 (${data.mrs.length})`, icon: null },
          { key: 'checklist', label: `审查标准 (${enabledCount})`, icon: null },
          { key: 'report', label: '一致性报告', icon: null },
        ]}
      />
      <p className="cr-seg-hint">{SEG_HINT[segment]}</p>

      {segment === 'queue' && <QueueSegment data={data} onUpdateData={onUpdateData} />}
      {segment === 'checklist' && <ChecklistSegment data={data} onUpdateData={onUpdateData} />}
      {segment === 'report' && <ReportSegment data={data} onUpdateData={onUpdateData} />}
    </div>
  )
}

/* ================= 段一：审查队列 ================= */

function QueueSegment({ data, onUpdateData }: CodeReviewPanelProps) {
  const [openMrId, setOpenMrId] = useState<string | null>(null)
  /** 本次会话内刚完成 webhook 模拟同步的 MR id（驱动流转提示条） */
  const [syncedMrId, setSyncedMrId] = useState<string | null>(null)
  const openMr = data.mrs.find((m) => m.id === openMrId) ?? null

  if (openMr) {
    return (
      <MrDetail
        data={data}
        mr={openMr}
        justSynced={syncedMrId === openMr.id}
        onBack={() => setOpenMrId(null)}
        onUpdateData={onUpdateData}
        onHumanSynced={() => setSyncedMrId(openMr.id)}
      />
    )
  }

  // 排序：待复审 → 待裁决 → 已完成（同组内时间倒序）
  const statusRank: Record<ReviewMr['status'], number> = { 待复审: 0, 待裁决: 1, 初审中: 2, 已完成: 3 }
  const sorted = [...data.mrs].sort((a, b) =>
    statusRank[a.status] - statusRank[b.status] || b.createdAt.localeCompare(a.createdAt),
  )

  return (
    <Section label={`合并请求 (${data.mrs.length})`}>
      {sorted.length === 0 ? (
        <div className="cr-empty-state">
          <div className="cr-empty-icon"><ChecklistIcon size={40} /></div>
          <div className="cr-empty-title">暂无审查请求</div>
          <div className="cr-empty-desc">MR 提交后将自动进入审查队列</div>
        </div>
      ) : sorted.map((mr) => (
        <Row key={mr.id} onClick={() => setOpenMrId(mr.id)}>
          <div className="cr-mr-row">
            <div className="cr-mr-main">
              <span className="cr-mr-title">{mr.title}</span>
              <span className="cr-mr-author">{mr.author}</span>
            </div>
            <div className="cr-mr-sub">
              {mr.sourceBranch} → {mr.targetBranch}
              <span className="cr-mr-diff"> · <span className="cr-add">+{mr.additions}</span> <span className="cr-del">−{mr.deletions}</span></span>
              {' '}· {mr.files} 个文件 · {mr.createdAt}
            </div>
            <div className="cr-mr-right">
              <StatusBadge tone={mrStatusTone[mr.status]}>{mr.status}</StatusBadge>
              {mr.status === '已完成' && mr.verdict && (
                <StatusBadge tone={verdictTone[mr.verdict]}>{mr.verdict}</StatusBadge>
              )}
              <span className="cr-chevron"><ChevronDownIcon size={14} /></span>
            </div>
          </div>
        </Row>
      ))}
    </Section>
  )
}

/* —— MR 审查详情（二级视图：双栏对比 + 裁决 + 结论） —— */

function MrDetail({ data, mr, onBack, onUpdateData, justSynced, onHumanSynced }: {
  data: CodeReviewData
  mr: ReviewMr
  onBack: () => void
  onUpdateData: (d: CodeReviewData) => void
  /** 刚完成 webhook 模拟同步（待复审 → 待裁决），显示 3s 过渡提示条 */
  justSynced?: boolean
  /** 同步流转完成回调（QueueSegment 记录，驱动再次进入时的提示条） */
  onHumanSynced?: () => void
}) {
  const items = data.checklist
  const itemOf = (id: string) => items.find((i) => i.id === id)
  const adeComments = mr.comments.filter((c) => c.by === 'ADE')
  const humanComments = mr.comments.filter((c) => c.by === '人工')
  const progress = resolutionProgress(mr)
  const pending = mr.status === '待裁决' && progress.resolved < progress.total
  const done = mr.status === '已完成'
  const [syncTip, setSyncTip] = useState(false)

  // 刚同步流转时显示过渡提示条，3s 自动消失
  useEffect(() => {
    if (!justSynced) return
    setSyncTip(true)
    const t = window.setTimeout(() => setSyncTip(false), 3000)
    return () => window.clearTimeout(t)
  }, [justSynced])

  /** 更新当前 MR（局部 patch 后整体写回，与其他面板一致） */
  const patchMr = (patch: Partial<ReviewMr>, commentPatch?: { id: string; changes: Partial<ReviewComment> }) => {
    onUpdateData({
      ...data,
      mrs: data.mrs.map((m) => {
        if (m.id !== mr.id) return m
        const merged: ReviewMr = { ...m, ...patch }
        return {
          ...merged,
          // 先取 merged.comments（patch.comments 优先，如 webhook 合并意见），再做意见级 patch
          comments: commentPatch
            ? merged.comments.map((c) => (c.id === commentPatch.id ? { ...c, ...commentPatch.changes } : c))
            : merged.comments,
        }
      }),
    })
  }

  /* —— ① ADE 初审中：占位视图 —— */
  if (mr.status === '初审中') {
    return (
      <div className="cr-mr-detail">
        <button type="button" className="cr-back" onClick={onBack}>
          <ArrowLeftIcon size={13} />
          返回审查队列
        </button>
        <div className="cr-stage-card">
          <div className="cr-stage-icon"><RobotIcon size={26} /></div>
          <div className="cr-stage-title">ADE 初审进行中</div>
          <div className="cr-stage-desc">预计 1 分钟内完成，完成后自动流转至人工复审</div>
        </div>
      </div>
    )
  }

  /* —— ② 待人工复审：复审工作台（ADE 意见计数可见、内容不出示） —— */
  if (mr.status === '待复审') {
    return (
      <HumanReviewStage
        mr={mr}
        onBack={onBack}
        onSynced={() => {
          patchMr(mergePendingHuman(mr))
          onHumanSynced?.()
        }}
      />
    )
  }

  /* —— ③ 待裁决 / ④ 已完成：双栏对比视图 —— */
  return (
    <div className="cr-mr-detail">
      <button type="button" className="cr-back" onClick={onBack}>
        <ArrowLeftIcon size={13} />
        返回审查队列
      </button>

      <div className="cr-mr-head">
        <div className="cr-mr-head-top">
          <span className="cr-mr-head-title">{mr.title}</span>
          <StatusBadge tone={mrStatusTone[mr.status]}>{mr.status}</StatusBadge>
          {done && mr.verdict && <StatusBadge tone={verdictTone[mr.verdict]}>{mr.verdict}</StatusBadge>}
        </div>
        <div className="cr-mr-head-sub">
          {mr.author} · {mr.sourceBranch} → {mr.targetBranch}
          <span className="cr-mr-diff"> · <span className="cr-add">+{mr.additions}</span> <span className="cr-del">−{mr.deletions}</span></span>
          {' '}· {mr.files} 个文件 · {mr.createdAt}
        </div>
        <div className="cr-mr-head-sub">
          ADE 初审于 {mr.adeReviewedAt}
          {mr.humanSyncedAt && <> · 人工复审同步于 {mr.humanSyncedAt}</>}
          {' '}· 依据启用中的 {mr.itemsApplied} 条检查项
        </div>
      </div>

      {syncTip && (
        <div className="cr-sync-tip">评论已同步 · 已自动比对双方意见</div>
      )}

      <div className="cr-columns">
        <CommentColumn
          title="ADE 初审"
          icon={<RobotIcon size={13} />}
          comments={adeComments}
          itemOf={itemOf}
          showResolve={!done}
          onResolve={(id, resolution) => patchMr({}, { id, changes: { resolution, resolvedAt: resolution ? nowStamp() : undefined } })}
        />
        <CommentColumn
          title="人工复审"
          icon={<span className="cr-col-user">shilu</span>}
          comments={humanComments}
          itemOf={itemOf}
          showResolve={false}
          onResolve={() => {}}
        />
      </div>

      {mr.status === '待裁决' ? (
        <div className="cr-mr-footer">
          <div className="cr-progress">
            裁决进度 {progress.resolved}/{progress.total}
            {pending && <span className="cr-progress-hint"> · 全部裁决后可出结论</span>}
          </div>
          <div className="cr-mr-actions">
            <button
              type="button"
              className="cr-btn-outline"
              title="在 GitLab MR 页补充评论（Mock 仅跳转）"
              onClick={() => window.open(mr.mrUrl, '_blank', 'noreferrer')}
            >
              人工复审 ↗
            </button>
            <button
              type="button"
              className="cr-btn-outline"
              disabled={pending}
              title={pending ? `请先完成 ${progress.total - progress.resolved} 条意见的裁决` : undefined}
              onClick={() => patchMr({ status: '已完成', verdict: '打回', concludedAt: nowStamp() })}
            >
              打回 MR
            </button>
            <button
              type="button"
              className="btn-primary cr-btn-conclude"
              disabled={pending}
              title={pending ? `请先完成 ${progress.total - progress.resolved} 条意见的裁决` : undefined}
              onClick={() => patchMr({ status: '已完成', verdict: '通过', concludedAt: nowStamp() })}
            >
              确认通过
            </button>
          </div>
        </div>
      ) : (
        <div className="cr-mr-verdict">
          <span className="cr-verdict-label">结论：</span>
          <span className={mr.verdict === '通过' ? 'cr-verdict-pass' : 'cr-verdict-reject'}>{mr.verdict}</span>
          {mr.concludedAt && <span className="cr-verdict-time"> · {mr.concludedAt}</span>}
          <button
            type="button"
            className="cr-btn-outline cr-verdict-jump"
            title="在 GitLab MR 页查看评论（Mock 仅跳转）"
            onClick={() => window.open(mr.mrUrl, '_blank', 'noreferrer')}
          >
            人工复审 ↗
          </button>
        </div>
      )}
    </div>
  )
}

/* —— ② 待人工复审：复审工作台（跳转 GitLab + 模拟 webhook 同步流转） —— */

function HumanReviewStage({ mr, onBack, onSynced }: {
  mr: ReviewMr
  onBack: () => void
  /** 模拟 webhook 到达后的流转回调（待同步意见并入 + 状态 → 待裁决） */
  onSynced: () => void
}) {
  const [syncing, setSyncing] = useState(false)
  const adeCount = mr.comments.filter((c) => c.by === 'ADE').length

  /** 点击「人工复审 ↗」：新窗口跳 GitLab，Mock 中同时触发 2s 模拟同步 */
  const handleJump = () => {
    window.open(mr.mrUrl, '_blank', 'noreferrer')
    setSyncing(true)
    window.setTimeout(onSynced, 2000)
  }

  return (
    <div className="cr-mr-detail">
      <button type="button" className="cr-back" onClick={onBack}>
        <ArrowLeftIcon size={13} />
        返回审查队列
      </button>

      <div className="cr-mr-head">
        <div className="cr-mr-head-top">
          <span className="cr-mr-head-title">{mr.title}</span>
          <StatusBadge tone={mrStatusTone[mr.status]}>{mr.status}</StatusBadge>
        </div>
        <div className="cr-mr-head-sub">
          {mr.author} · {mr.sourceBranch} → {mr.targetBranch}
          <span className="cr-mr-diff"> · <span className="cr-add">+{mr.additions}</span> <span className="cr-del">−{mr.deletions}</span></span>
          {' '}· {mr.files} 个文件 · {mr.createdAt}
        </div>
        <div className="cr-mr-head-sub">
          ADE 初审于 {mr.adeReviewedAt} · 依据启用中的 {mr.itemsApplied} 条检查项
        </div>
      </div>

      <div className="cr-stage-card">
        <div className="cr-stage-head">
          <span className="cr-stage-icon"><RobotIcon size={22} /></span>
          <span className="cr-stage-title">
            ADE 初审已完成（{adeCount} 条意见）· 等待人工复审
          </span>
        </div>
        <p className="cr-stage-note">ADE 意见在比对前不对复审人展示，以保证双审交叉验证的独立性</p>
        <ol className="cr-stage-steps">
          <li>点击下方按钮，在 GitLab MR 页查看完整 diff</li>
          <li>在 diff 上以行级评论提出复审意见</li>
          <li>评论将通过 webhook 准实时同步回来，自动比对双方意见</li>
        </ol>
        <button
          type="button"
          className="btn-primary cr-stage-btn"
          disabled={syncing}
          onClick={handleJump}
        >
          {syncing ? '同步评论中…' : '人工复审 ↗'}
        </button>
        <div className="cr-stage-sync">
          {syncing ? '正在同步 GitLab 评论…' : 'webhook 正常 · 评论同步延迟约 1~3 秒'}
        </div>
      </div>
    </div>
  )
}

/** 双栏之一：意见卡片列 */
function CommentColumn({ title, icon, comments, itemOf, showResolve, onResolve }: {
  title: string
  icon: React.ReactNode
  comments: ReviewComment[]
  itemOf: (id: string) => ChecklistItem | undefined
  /** 是否展示裁决按钮（仅待复审 MR 的左栏） */
  showResolve: boolean
  onResolve: (commentId: string, resolution: '有效' | '误报' | null) => void
}) {
  return (
    <div className="cr-col">
      <div className="cr-col-head">
        <span className="cr-col-title">{icon}{title}（{comments.length} 条）</span>
      </div>
      {comments.length === 0 ? (
        <div className="cr-col-empty">本次未提出意见</div>
      ) : comments.map((c) => {
        const item = itemOf(c.itemId)
        return (
          <div key={c.id} className={`cr-comment cr-comment-${c.match}`}>
            <div className="cr-comment-head">
              <StatusBadge tone={matchTone[c.match]}>{c.match}</StatusBadge>
              {item && (
                <button
                  type="button"
                  className="cr-item-ref"
                  title={`检查项 · ${item.title}（${item.category}）`}
                >
                  #{item.id.replace('ck-', '')} {item.title}
                </button>
              )}
              <StatusBadge tone={levelTone[c.level]}>{c.level}</StatusBadge>
            </div>
            <div className="cr-comment-loc">{c.file}:{c.line}</div>
            <div className="cr-comment-problem">{c.problem}</div>
            <div className="cr-comment-sug"><span className="cr-sug-label">建议：</span>{c.suggestion}</div>
            <div className="cr-comment-snippet mono-block" title={c.snippet}>{c.snippet}</div>

            {/* 裁决区：仅 ADE 提出 + 待复审 MR */}
            {c.match === '仅ADE' && showResolve && (
              c.resolution ? (
                <div className="cr-resolve-done">
                  <button
                    type="button"
                    className="cr-resolve-reset"
                    title="点击撤销裁决"
                    onClick={() => onResolve(c.id, null)}
                  >
                    <StatusBadge tone={c.resolution === '有效' ? 'success' : 'danger'}>{c.resolution}</StatusBadge>
                    {c.resolvedAt && <span className="cr-resolve-time">{c.resolvedAt}</span>}
                  </button>
                </div>
              ) : (
                <div className="cr-resolve-actions">
                  <button type="button" className="btn-mini" onClick={() => onResolve(c.id, '有效')}>有效</button>
                  <button type="button" className="text-btn danger" onClick={() => onResolve(c.id, '误报')}>误报</button>
                </div>
              )
            )}
            {c.match === '仅ADE' && !showResolve && c.resolution && (
              <div className="cr-resolve-readonly">
                <StatusBadge tone={c.resolution === '有效' ? 'success' : 'danger'}>{c.resolution}</StatusBadge>
                {c.resolvedAt && <span className="cr-resolve-time">{c.resolvedAt}</span>}
              </div>
            )}
            {c.match === '仅人工' && (
              <div className="cr-missed-tag">
                <StatusBadge tone="danger">ADE 漏检</StatusBadge>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ================= 段二：审查标准 ================= */

function ChecklistSegment({ data, onUpdateData }: CodeReviewPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<ChecklistItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<ItemForm>(emptyItemForm())

  const openCreate = (prefill?: Partial<ItemForm>) => {
    setForm({ ...emptyItemForm(), ...prefill })
    setCreating(true)
  }

  const openEdit = (item: ChecklistItem) => {
    setForm({
      title: item.title,
      category: item.category,
      defaultLevel: item.defaultLevel,
      description: item.description,
      badExample: item.badExample,
      goodExample: item.goodExample,
      scope: item.scope,
    })
    setEditing(item)
  }

  const sameCategoryTitleTaken = data.checklist.some(
    (i) => i.id !== editing?.id && i.category === form.category && i.title === form.title.trim(),
  )
  const formDisabled = !form.title.trim() || sameCategoryTitleTaken

  const handleSave = () => {
    if (formDisabled) return
    if (editing) {
      onUpdateData({
        ...data,
        checklist: data.checklist.map((i) => (i.id === editing.id ? {
          ...i,
          title: form.title.trim(),
          category: form.category,
          defaultLevel: form.defaultLevel,
          description: form.description.trim(),
          badExample: form.badExample.trim(),
          goodExample: form.goodExample.trim(),
          scope: form.scope,
        } : i)),
      })
      setEditing(null)
    } else {
      onUpdateData({
        ...data,
        checklist: [...data.checklist, {
          id: `ck-${Date.now()}`,
          title: form.title.trim(),
          category: form.category,
          defaultLevel: form.defaultLevel,
          description: form.description.trim(),
          badExample: form.badExample.trim(),
          goodExample: form.goodExample.trim(),
          scope: form.scope,
          enabled: true,
          builtin: false,
        }],
      })
      setCreating(false)
    }
  }

  const toggleItem = (id: string, next: boolean) => {
    onUpdateData({
      ...data,
      checklist: data.checklist.map((i) => (i.id === id ? { ...i, enabled: next } : i)),
    })
  }

  const removeItem = (id: string) => {
    onUpdateData({
      ...data,
      checklist: data.checklist.filter((i) => i.id !== id),
    })
  }

  return (
    <div>
      {CHECK_CATEGORIES.map((cat) => {
        const catItems = data.checklist.filter((i) => i.category === cat)
        const enabled = catItems.filter((i) => i.enabled).length
        return (
          <Section
            key={cat}
            label={`${cat}（${catItems.length}${enabled < catItems.length ? ` · 启用 ${enabled}` : ''}）`}
            action={cat === CHECK_CATEGORIES[0] ? (
              <button type="button" className="text-btn" onClick={() => openCreate()}>+ 新建检查项</button>
            ) : undefined}
          >
            {catItems.length === 0 ? (
              <div className="cr-empty-inline">暂无该分类检查项</div>
            ) : catItems.map((item) => (
              <Row key={item.id} onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                <div className="cr-item-row">
                  <div className="cr-item-main">
                    <span className="cr-item-title">{item.title}</span>
                    <span className="cr-item-cat" style={{ color: categoryColor[item.category] }}>
                      {item.category}
                    </span>
                  </div>
                  <div className="cr-item-sub">
                    {item.description} · {item.scope}
                  </div>
                  <div className="cr-item-right">
                    <span
                      onClick={(e) => e.stopPropagation()}
                      title="点击行展开详情"
                    >
                      <Toggle checked={item.enabled} onChange={(v) => toggleItem(item.id, v)} />
                    </span>
                    {!item.builtin && (
                      <span className="cr-item-ops" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="text-btn" onClick={() => openEdit(item)}>编辑</button>
                        <button type="button" className="text-btn danger" onClick={() => removeItem(item.id)}>移除</button>
                      </span>
                    )}
                    <span className={`cr-chevron${expandedId === item.id ? ' open' : ''}`}>
                      <ChevronDownIcon size={14} />
                    </span>
                  </div>

                  {expandedId === item.id && (
                    <div className="cr-item-expand">
                      <div className="cr-expand-kv">
                        <span className="cr-expand-k">说明</span>
                        <span className="cr-expand-v">{item.description}</span>
                      </div>
                      <div className="cr-expand-examples">
                        <div className="cr-example cr-example-bad">
                          <span className="cr-example-label">坏例</span>
                          <div className="mono-block" title={item.badExample}>{item.badExample || '—'}</div>
                        </div>
                        <div className="cr-example cr-example-good">
                          <span className="cr-example-label">好例</span>
                          <div className="mono-block" title={item.goodExample}>{item.goodExample || '—'}</div>
                        </div>
                      </div>
                      <div className="cr-expand-kv">
                        <span className="cr-expand-k">级别倾向</span>
                        <span className="cr-expand-v">{item.defaultLevel}</span>
                      </div>
                      <div className="cr-expand-kv">
                        <span className="cr-expand-k">适用范围</span>
                        <span className="cr-expand-v">{item.scope}</span>
                      </div>
                      {item.builtin && <div className="cr-expand-note">预置检查项不可修改，仅可启停</div>}
                    </div>
                  )}
                </div>
              </Row>
            ))}
          </Section>
        )
      })}

      <p className="cr-bottom-hint">停用的检查项不作为审查依据 · 每条审查意见必须挂载检查项</p>

      {(creating || editing) && (
        <FormModal
          title={editing ? '编辑检查项' : '新建检查项'}
          confirmText={editing ? '保存' : '创建'}
          confirmDisabled={formDisabled}
          onConfirm={handleSave}
          onClose={() => { setCreating(false); setEditing(null) }}
        >
          <ModalField label="标题">
            <input
              className="field-input"
              value={form.title}
              placeholder="如 循环内禁止发起请求"
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </ModalField>
          <ModalField label="分类">
            <select className="field-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ItemCategory })}>
              {CHECK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </ModalField>
          <ModalField label="级别倾向">
            <select className="field-select" value={form.defaultLevel} onChange={(e) => setForm({ ...form, defaultLevel: e.target.value as CommentLevel })}>
              {COMMENT_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </ModalField>
          <ModalField label="说明">
            <textarea
              className="field-textarea"
              rows={3}
              placeholder="说明该检查项的判定标准"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </ModalField>
          <ModalField label="坏例（反例代码片段）">
            <input
              className="field-input cr-mono-input"
              value={form.badExample}
              placeholder="如 for (const id of ids) { await api.get(id) }"
              onChange={(e) => setForm({ ...form, badExample: e.target.value })}
            />
          </ModalField>
          <ModalField label="好例（正例代码片段）">
            <input
              className="field-input cr-mono-input"
              value={form.goodExample}
              placeholder="如 const list = await api.batchGet(ids)"
              onChange={(e) => setForm({ ...form, goodExample: e.target.value })}
            />
          </ModalField>
          <ModalField label="适用范围">
            <select className="field-select" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
              {ITEM_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </ModalField>
        </FormModal>
      )}
    </div>
  )
}

/* ================= 段三：一致性报告 ================= */

function ReportSegment({ data, onUpdateData }: CodeReviewPanelProps) {
  const [strengthen, setStrengthen] = useState<ChecklistItem | null>(null)
  const stats = agreementStats(data.mrs)
  const misses = missList(data.mrs)
  const weak = weakItems(data.mrs, data.checklist)

  const rateColor = (v: number, good: number, mid: number, higherBetter: boolean) => {
    if (higherBetter) return v >= good ? 'var(--status-success)' : v >= mid ? 'var(--status-warning)' : 'var(--status-danger)'
    return v <= good ? 'var(--status-success)' : v <= mid ? 'var(--status-warning)' : 'var(--status-danger)'
  }

  const openStrengthen = (item: ChecklistItem) => {
    // 切到标准段的新建弹窗：直接在本段弹出（预填分类与说明）
    setStrengthen(item)
  }

  const itemOf = (id: string) => data.checklist.find((i) => i.id === id)

  if (stats.doneMrs === 0) {
    return (
      <div className="cr-empty-state">
        <div className="cr-empty-icon"><ChecklistIcon size={40} /></div>
        <div className="cr-empty-title">暂无一致性数据</div>
        <div className="cr-empty-desc">完成一次双线审查后，这里将展示一致率分析</div>
      </div>
    )
  }

  return (
    <div>
      {/* KPI 卡片 */}
      <div className="cr-kpis">
        <div className="cr-kpi">
          <div className="cr-kpi-label">整体一致率</div>
          <div className="cr-kpi-value" style={{ color: rateColor(stats.agreementRate, 70, 50, true) }}>
            {stats.agreementRate}%
          </div>
          <div className="cr-kpi-sub">双方一致 {stats.agreed} / 比对单元 {stats.totalPairs}</div>
        </div>
        <div className="cr-kpi">
          <div className="cr-kpi-label">ADE 误报率</div>
          <div className="cr-kpi-value" style={{ color: rateColor(stats.falsePositiveRate, 10, 30, false) }}>
            {stats.falsePositiveRate}%
          </div>
          <div className="cr-kpi-sub">误报 {stats.falsePositive} / 已裁决仅ADE {stats.validAde + stats.falsePositive}</div>
        </div>
        <div className="cr-kpi">
          <div className="cr-kpi-label">ADE 漏检</div>
          <div className="cr-kpi-value" style={{ color: stats.humanOnly > 0 ? 'var(--status-danger)' : 'var(--status-success)' }}>
            {stats.humanOnly}
          </div>
          <div className="cr-kpi-sub">人工提出而 ADE 未发现</div>
        </div>
        <div className="cr-kpi">
          <div className="cr-kpi-label">已完成审查</div>
          <div className="cr-kpi-value">{stats.doneMrs}</div>
          <div className="cr-kpi-sub">待复审 {stats.pendingMrs}</div>
        </div>
      </div>

      {/* 漏检清单 */}
      <Section label={`漏检清单 (${misses.length})`}>
        {misses.length === 0 ? (
          <div className="cr-empty-inline">暂无漏检记录</div>
        ) : misses.map(({ mr, comment }) => {
          const item = itemOf(comment.itemId)
          return (
            <Row key={`${mr.id}-${comment.id}`}>
              <div className="cr-miss-row">
                <div className="cr-miss-main">
                  <span className="cr-miss-title">{comment.problem}</span>
                  {item && (
                    <button
                      type="button"
                      className="cr-item-ref"
                      title={`检查项 · ${item.title}（${item.category}）`}
                    >
                      #{item.id.replace('ck-', '')} {item.title}
                    </button>
                  )}
                </div>
                <div className="cr-miss-sub">
                  MR {mr.title} · {comment.file}:{comment.line}
                </div>
                <div className="cr-miss-right">
                  {item && (
                    <button type="button" className="cr-strengthen-btn" onClick={() => openStrengthen(item)}>
                      强化该检查项
                    </button>
                  )}
                </div>
              </div>
            </Row>
          )
        })}
      </Section>

      {/* 薄弱检查项 */}
      <Section label={`薄弱检查项 (${weak.length})`}>
        {weak.length === 0 ? (
          <div className="cr-empty-inline">暂无统计数据</div>
        ) : weak.map(({ item, agreed, missed, falsePositive }) => (
          <Row key={item.id}>
            <div className="cr-weak-row">
              <div className="cr-weak-main">
                <span className="cr-weak-title">{item.title}</span>
                <span className="cr-item-cat" style={{ color: categoryColor[item.category] }}>{item.category}</span>
              </div>
              <div className="cr-weak-sub">
                一致 {agreed} · <span className={missed > 0 ? 'cr-weak-miss' : ''}>漏检 {missed}</span> · 误报 {falsePositive}
              </div>
              <div className="cr-weak-right">
                {missed >= 2 ? (
                  <StatusBadge tone="danger">重点强化</StatusBadge>
                ) : missed === 1 ? (
                  <StatusBadge tone="warning">需关注</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">健康</StatusBadge>
                )}
              </div>
            </div>
          </Row>
        ))}
      </Section>

      {/* 强化该检查项弹窗（预填新建） */}
      {strengthen && (
        <StrengthenModal
          source={strengthen}
          onClose={() => setStrengthen(null)}
          onConfirm={(title, description, level) => {
            onUpdateData({
              ...data,
              checklist: [...data.checklist, {
                id: `ck-${Date.now()}`,
                title,
                category: strengthen.category,
                defaultLevel: level,
                description,
                badExample: '',
                goodExample: '',
                scope: strengthen.scope,
                enabled: true,
                builtin: false,
              }],
            })
            setStrengthen(null)
          }}
        />
      )}
    </div>
  )
}

/** 「强化该检查项」弹窗：预填分类与说明，标题默认「强化：原检查项名」 */
function StrengthenModal({ source, onClose, onConfirm }: {
  source: ChecklistItem
  onClose: () => void
  onConfirm: (title: string, description: string, level: CommentLevel) => void
}) {
  const [title, setTitle] = useState(`强化：${source.title}`)
  const [description, setDescription] = useState(
    `基于漏检反哺：原检查项「${source.title}」存在漏检，需强化判定标准。${source.description}`,
  )
  const [level, setLevel] = useState<CommentLevel>('必须修改')
  const disabled = !title.trim()

  return (
    <FormModal
      title="强化该检查项"
      confirmText="创建"
      confirmDisabled={disabled}
      onConfirm={() => onConfirm(title.trim(), description.trim(), level)}
      onClose={onClose}
    >
      <ModalField label={`分类（继承原检查项：${source.category}）`}>
        <span className="cr-strengthen-cat" style={{ color: categoryColor[source.category] }}>{source.category}</span>
      </ModalField>
      <ModalField label="标题">
        <input className="field-input" value={title} placeholder="如 强化：循环内禁止发起请求" onChange={(e) => setTitle(e.target.value)} />
      </ModalField>
      <ModalField label="级别倾向">
        <select className="field-select" value={level} onChange={(e) => setLevel(e.target.value as CommentLevel)}>
          {COMMENT_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </ModalField>
      <ModalField label="说明">
        <textarea className="field-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </ModalField>
    </FormModal>
  )
}
