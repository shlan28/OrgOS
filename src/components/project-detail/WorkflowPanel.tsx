import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AutoJob, JobRun, RunStep } from '../../data/projects'
import { isActiveRun } from '../../hooks/useAutomationEngine'
import {
  ClockIcon, ZapIcon, DownloadIcon, BoxIcon, BlocksIcon, ExternalIcon,
  DocIcon, SearchIcon, GearIcon, ChevronRightIcon, PlusIcon,
} from '../icons'
import './WorkflowPanel.css'

/* ===== 布局常量（节点尺寸与节奏） ===== */
const NODE_W = 132
const NODE_GAP = 60 // 期望间距
const NODE_GAP_NARROW = 20 // 最小间距
const NODE_H_EST = 62 // 节点估算高度（两行内容）

/** 节点视觉状态（由 step.status + 运行整体状态推导） */
type NodeState = 'success' | 'running' | 'waiting' | 'pending'

const NODE_STATE_TEXT: Record<NodeState, string> = {
  success: '成功',
  running: '运行中',
  waiting: '等待确认',
  pending: '等待',
}

/** 按步骤名挑图标（Mock 关键词匹配，无匹配时齿轮兜底） */
const iconOfStep = (name: string, size: number): ReactNode => {
  if (name.includes('拉取')) return <DownloadIcon size={size} />
  if (name.includes('依赖') || name.includes('打包') || name.includes('产物')) return <BoxIcon size={size} />
  if (name.includes('测试')) return <BlocksIcon size={size} />
  if (name.includes('构建') || name.includes('编译') || name.includes('打包')) return <BoxIcon size={size} />
  if (name.includes('发布') || name.includes('外发')) return <ExternalIcon size={size} />
  if (name.includes('报告') || name.includes('周报') || name.includes('文档')) return <DocIcon size={size} />
  if (name.includes('检查') || name.includes('静态')) return <SearchIcon size={size} />
  if (name.includes('汇总') || name.includes('数据')) return <ChartLike />
  return <GearIcon size={size} />
}

/** 汇总数据等「图表类」步骤的小图标（柱状） */
const ChartLike = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="4" y1="20" x2="20" y2="20" />
    <line x1="7" y1="20" x2="7" y2="12" />
    <line x1="12" y1="20" x2="12" y2="7" />
    <line x1="17" y1="20" x2="17" y2="14.5" />
  </svg>
)

/** 触发器图标：定时 = 时钟 / 事件 = 闪电 / 手动 = 齿轮 */
const triggerIcon = (job: AutoJob, size: number): ReactNode => {
  if (job.triggerType === '定时') return <ClockIcon size={size} />
  if (job.triggerType === '事件') return <ZapIcon size={size} />
  return <GearIcon size={size} />
}

/** 步骤节点 meta 文案：等待前 = 耗时；运行中 = 进度语义；未执行 = 空 */
const metaOfStep = (step: RunStep, idx: number, run: JobRun): string => {
  if (step.status === '等待') {
    // Gate 步骤给出等待对象
    if (run.gate && idx === run.currentStep) {
      return `${run.gate.approver?.name ?? '人工'} 确认 · 已等待 ${run.waitingSince ?? '—'}`
    }
    return ''
  }
  if (step.status === '运行中') {
    const total = run.steps.length
    return `步骤 ${idx + 1}/${total}`
  }
  return `耗时 ${step.time ?? '—'}`
}

/** 步骤节点状态推导 */
const stateOfStep = (step: RunStep, run: JobRun): NodeState => {
  if (step.status === '成功' || step.status === '跳过') return 'success'
  if (step.status === '运行中') {
    // 整体已暂停：当前步骤显示等待语义（挂起），运行态只在整体运行中时出现
    return run.status === '已暂停' ? 'waiting' : 'running'
  }
  if (step.status === '等待') {
    // Gate 所在步骤 = 等待确认；其余等待 = 未执行
    if (run.gate && run.steps[run.currentStep]?.id === step.id) return 'waiting'
    return 'pending'
  }
  return 'pending' // 失败/已取消按 pending 视觉（Mock）
}

interface WorkflowPanelProps {
  jobs: AutoJob[]
  /** 运行（未运行态主按钮） */
  onRun: (jobId: string) => void
  /** 暂停运行 */
  onPause: (jobId: string) => void
  /** 停止运行（回到未运行态） */
  onStop: (jobId: string) => void
  /** 从暂停处继续 */
  onResume: (jobId: string) => void
  /** 从头重新运行 */
  onRestart: (jobId: string) => void
  /** Gate 处理 */
  onApprove: (jobId: string) => void
  onReject: (jobId: string) => void
  /** 打开该任务的运行详情弹窗（复用 RunModal） */
  onOpenRunModal: (jobId: string) => void
  /** 新建工作流（跳转/回调，占位） */
  onCreateWorkflow?: () => void
}

/** 运行状态 → 状态点色调 */
const runToneOf = (status: string | undefined): 'run' | 'wait' | 'idle' => {
  if (!status) return 'idle'
  if (status === '运行中' || status === '排队中') return 'run'
  if (status === '等待确认' || status === '等待输入' || status === '已暂停') return 'wait'
  return 'idle'
}

/**
 * 工作流面板（React Flow 风格节点画布 · 简洁版）：
 * - 工具条：任务下拉（含「新建工作流」）+ 触发方式 + 编辑链接 + 运行控制三态按钮组；
 * - 画布：触发器节点 + 步骤节点（白卡纯描边、状态=小圆点+文字），连线统一灰、仅当前执行边蓝色流动；
 * - 右侧属性面板：选中节点信息（Gate 步骤带批准/拒绝）；
 * - 底部状态条：状态 + 进度 + 步骤。
 */
export default function WorkflowPanel({
  jobs, onRun, onPause, onStop, onResume, onRestart, onApprove, onReject, onOpenRunModal, onCreateWorkflow,
}: WorkflowPanelProps) {
  const [jobId, setJobId] = useState(jobs[0]?.id ?? '')
  const [selectedStep, setSelectedStep] = useState(0) // 选中节点下标（0 = 触发器）
  /** 画布缩放（0.4 ~ 1.8，滚轮/按钮）与平移（拖拽空白处） */
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  /** 属性面板收起态 */
  const [inspectorOpen, setInspectorOpen] = useState(true)
  /** 任务下拉打开态（点击开/关，非 hover） */
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // 点击下拉外部时关闭
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const job = jobs.find((j) => j.id === jobId) ?? jobs[0]
  const run: JobRun | undefined = job?.currentRun ?? job?.history[0]
  const active = isActiveRun(job?.currentRun)
  /** 工具条按钮组依据的运行状态（有 currentRun 用 currentRun，无则未运行） */
  const runStatus = job?.currentRun?.status
  /** 步骤 = 当前/最近一次运行的步骤（无任何运行时画布只画触发器） */
  const steps = run?.steps ?? []

  /** 画布尺寸（量取实际容器，链按可用宽居中） */
  const canvasRef = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(760)
  const [canvasH, setCanvasH] = useState(560)

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setCanvasW(e.contentRect.width)
        setCanvasH(e.contentRect.height)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** 任务切换时重置选中与视图 */
  useEffect(() => {
    setSelectedStep(0)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [jobId])

  /* —— 画布拖拽平移 —— */
  const panning = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null)
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    panning.current = { sx: e.clientX, sy: e.clientY, bx: pan.x, by: pan.y }
  }
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const p = panning.current
      if (!p) return
      setPan({ x: p.bx + (e.clientX - p.sx), y: p.by + (e.clientY - p.sy) })
    }
    const up = () => { panning.current = null }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  /* —— 缩放（按钮 ±15%；以画布中心为锚；滚轮 0.05 步进） —— */
  const ZOOM_MIN = 0.4
  const ZOOM_MAX = 1.8
  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))
  const zoomBy = (delta: number) => {
    setZoom((z) => clampZoom(z + delta))
    // 缩放时平移按比例收拢，保持画布中心不漂移
    setPan((p) => ({ x: p.x * (1 + delta / Math.max(zoom, 0.01)), y: p.y * (1 + delta / Math.max(zoom, 0.01)) }))
  }
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return // 仅 ctrl/cmd+滚轮缩放（普通滚轮留给页面滚动习惯）
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.05 : -0.05
    setZoom((z) => clampZoom(z + delta))
  }
  /** 适配视图：重置缩放平移（节点链自动居中布局） */
  const fitView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  /** 节点布局（链水平居中、间距随可用宽自适应，不越界） */
  const nodeCount = job ? 1 + steps.length : 0
  const layout = useMemo(() => {
    // 期望总宽 = 期望节奏（60 间距），最小 20；超出可用宽时收窄间距
    const pad = 24 // 链两侧留白
    const avail = Math.max(canvasW - pad * 2, 200)
    const want = nodeCount > 4 ? NODE_GAP_NARROW : NODE_GAP
    const totalWant = nodeCount * NODE_W + (nodeCount - 1) * want
    const gap = totalWant <= avail
      ? want
      : Math.max(NODE_GAP_NARROW, (avail - nodeCount * NODE_W) / Math.max(nodeCount - 1, 1))
    const total = nodeCount * NODE_W + (nodeCount - 1) * gap
    const startX = (canvasW - total) / 2
    const chainY = (canvasH - NODE_H_EST) / 2
    return { startX, chainY, gap }
  }, [nodeCount, canvasW, canvasH])

  const { startX, chainY, gap } = layout

  /** 节点 x 坐标序列 */
  const xs = useMemo(() => {
    if (!job) return [] as number[]
    return Array.from({ length: nodeCount }, (_, i) => startX + i * (NODE_W + gap))
  }, [job, nodeCount, startX, gap])

  /** 连线：前节点右缘 → 后节点左缘，y = 节点纵向中心；当前执行边蓝色流动 */
  const edges = useMemo(() => {
    if (!job || !run || xs.length < 2) return [] as { d: string; flow: boolean }[]
    const y = chainY + NODE_H_EST / 2
    const list: { d: string; flow: boolean }[] = []
    for (let i = 0; i < xs.length - 1; i++) {
      const x1 = xs[i] + NODE_W
      const x2 = xs[i + 1]
      const c1 = x1 + (x2 - x1) * 0.4
      const c2 = x2 - (x2 - x1) * 0.4
      // 流动边 = 「进入当前执行/等待步骤」的那条（i+1 节点 = trigger? currentStep: currentStep+1）
      const targetStepIdx = i // i=0 → trigger→st1；i=1 → st1→st2
      const currentEdgeIdx = active ? run.currentStep : -1
      const flow = targetStepIdx === currentEdgeIdx
      list.push({ d: `M ${x1} ${y} C ${c1} ${y}, ${c2} ${y}, ${x2} ${y}`, flow })
    }
    return list
  }, [job, run, xs, chainY, active])

  /** 运行整体状态（底部状态条 + 工具条状态点） */
  const runStateText = run
    ? (job?.currentRun ? run.status : '空闲')
    : '无运行'
  const stateTone = runToneOf(job?.currentRun?.status)

  /** 步骤完成数 / 总数（进度条） */
  const doneSteps = run ? run.steps.filter((s) => s.status === '成功' || s.status === '跳过').length : 0
  const totalSteps = steps.length
  const progress = run && totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0

  if (!job) {
    return (
      <div className="wf-empty">
        <p>暂无自动化任务</p>
        <p className="sub">在「自动化任务」tab 新建任务后，可在此查看工作流编排</p>
      </div>
    )
  }

  /** 选中节点信息（0 = 触发器） */
  const selIsTrigger = selectedStep === 0
  const selStep: RunStep | undefined = selIsTrigger ? undefined : steps[selectedStep - 1]
  const selState: NodeState | null = selStep && run ? stateOfStep(selStep, run) : null
  const selIsGate = !!run?.gate && selStep?.id === steps[run.currentStep]?.id

  return (
    <div className="wf-panel">
      {/* 工具条：任务下拉 + 触发方式 + 编辑链接 + 运行控制（未运行/运行中/已暂停 三态按钮组） */}
      <div className="wf-toolbar">
        <div
          className={`wf-job-select${menuOpen ? ' open' : ''}`}
          ref={menuRef}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className={`wf-state-dot ${stateTone}`} />
          <span className="name">{job.name}</span>
          <span className="caret">▾</span>
          <div className="wf-job-menu">
            {jobs.map((j) => {
              const tone = runToneOf(j.currentRun?.status)
              return (
                <button
                  key={j.id}
                  type="button"
                  className={`wf-job-menu-item${j.id === job.id ? ' current' : ''}`}
                  onClick={() => { setJobId(j.id); setSelectedStep(0); setMenuOpen(false) }}
                >
                  <span className={`wf-state-dot ${tone}`} />
                  <span className="n">{j.name}</span>
                  {j.id === job.id && <ChevronRightIcon size={12} />}
                </button>
              )
            })}
            <div className="wf-job-menu-divider" />
            <button
              type="button"
              className="wf-job-menu-create"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onCreateWorkflow?.() }}
            >
              <PlusIcon size={12} />
              <span className="n">新建工作流</span>
            </button>
          </div>
        </div>
        <span className="wf-trigger">
          {job.triggerType} · {job.triggerParam}
        </span>
        <span className="spacer" />
        <button type="button" className="wf-link-btn">去 ADE Teams 编辑</button>
        {/* 运行控制三态 */}
        {runStatus === '运行中' || runStatus === '排队中' ? (
          <>
            <button type="button" className="wf-outline-btn" onClick={() => onPause(job.id)}>暂停</button>
            <button type="button" className="wf-outline-btn danger" onClick={() => onStop(job.id)}>停止</button>
          </>
        ) : runStatus === '已暂停' ? (
          <>
            <button type="button" className="wf-primary-btn" onClick={() => onResume(job.id)}>继续运行</button>
            <button type="button" className="wf-outline-btn" onClick={() => onRestart(job.id)}>重头运行</button>
          </>
        ) : runStatus === '等待确认' || runStatus === '等待输入' ? (
          <button type="button" className="wf-outline-btn" onClick={() => onOpenRunModal(job.id)}>查看任务</button>
        ) : (
          <button type="button" className="wf-primary-btn" onClick={() => onRun(job.id)}>运行</button>
        )}
      </div>

      {/* 画布 + 属性面板 */}
      <div className={`wf-body${inspectorOpen ? ' insp-open' : ' insp-collapsed'}`}>
        <div
          className={`wf-canvas${panning.current ? ' panning' : ''}`}
          ref={canvasRef}
          onMouseDown={onCanvasMouseDown}
          onWheel={onWheel}
        >
          {/* 缩放平移层：内部内容整体 transform */}
          <div className="wf-transform" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
            {/* 连线层 */}
            <svg className="wf-edges" width={canvasW} height={canvasH}>
              {edges.map((e, i) => (
                <path key={i} className={e.flow ? 'edge flow' : 'edge'} d={e.d} />
              ))}
            </svg>

            {/* 触发器节点 */}
            <div
              className={`wf-node${selectedStep === 0 ? ' selected' : ''}`}
              style={{ left: xs[0], top: chainY }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setSelectedStep(0)}
            >
              <div className="wf-node-row1">
                {triggerIcon(job, 15)}
                <span className="t">{job.triggerType}触发</span>
              </div>
              <div className="wf-node-row2">
                <span className="m">{job.triggerParam}</span>
              </div>
            </div>

            {/* 步骤节点 */}
            {steps.map((step, idx) => {
              const st = run ? stateOfStep(step, run) : 'pending' as NodeState
              const gate = !!run?.gate && step.id === run.steps[run.currentStep]?.id
              return (
                <div
                  key={step.id}
                  className={`wf-node${selectedStep === idx + 1 ? ' selected' : ''}${st === 'pending' ? ' dimmed' : ''}`}
                  style={{ left: xs[idx + 1], top: chainY }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setSelectedStep(idx + 1)}
                >
                  <div className="wf-node-row1">
                    {iconOfStep(step.name, 15)}
                    <span className="t">{step.name}</span>
                  </div>
                  <div className="wf-node-row2">
                    <span className="m">{run ? metaOfStep(step, idx, run) : ''}</span>
                    {(st !== 'pending' || gate) && (
                      <span className={`wf-node-state ${st}`}>
                        <span className="d" />
                        {gate
                          ? '等待确认'
                          : st === 'waiting' && run?.status === '已暂停' && step.status === '运行中'
                            ? '已暂停'
                            : NODE_STATE_TEXT[st]}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 缩放控件（＋/－/适配） */}
          <div className="wf-zoom">
            <button type="button" aria-label="缩小" title="缩小" onClick={() => zoomBy(-0.15)}>－</button>
            <button type="button" aria-label="放大" title="放大" onClick={() => zoomBy(0.15)}>＋</button>
            <button type="button" aria-label="适配" title="适配画布" onClick={fitView}>⤢</button>
            <span className="pct">{Math.round(zoom * 100)}%</span>
          </div>
        </div>

        {/* 抽屉收/展把手：骑在画布与抽屉分界线上，纵向居中 */}
        <button
          type="button"
          className="wf-insp-toggle"
          title={inspectorOpen ? '收起面板' : '展开面板'}
          aria-label={inspectorOpen ? '收起面板' : '展开面板'}
          onClick={() => setInspectorOpen((v) => !v)}
        >
          {inspectorOpen ? '›' : '‹'}
        </button>

        {/* 右侧属性面板（可收起：收起后画布占满） */}
        <div className={`wf-inspector${inspectorOpen ? '' : ' collapsed'}`}>
          <div className="wf-insp-content">
              <div className="wf-insp-head">
                <div className="t">{selIsTrigger ? `${job.triggerType}触发` : selStep?.name}</div>
                <div className="s">
                  {selIsTrigger
                    ? `${job.workflowId.toUpperCase()} · ${steps.length} 个步骤`
                    : `步骤 ${selectedStep} / ${Math.max(steps.length, 1)}`}
                </div>
              </div>

              {selIsTrigger ? (
                <div className="wf-insp-sec">
                  <div className="h">触发方式</div>
                  <div className="wf-kv"><span className="k">类型</span><span className="v">{job.triggerType}</span></div>
                  <div className="wf-kv"><span className="k">规则</span><span className="v">{job.triggerParam}</span></div>
                  <div className="wf-kv"><span className="k">需人工确认</span><span className="v">{job.needApproval ? '是' : '否'}</span></div>
                  {runStatus ? (
                    <p className="wf-insp-note">任务{runStatus === '已暂停' ? '已暂停' : '运行中'}，控制请用工具条按钮</p>
                  ) : (
                    <button type="button" className="wf-insp-btn" onClick={() => onRun(job.id)}>
                      立即运行一次
                    </button>
                  )}
                </div>
              ) : selStep && (
                <>
                  <div className="wf-insp-sec">
                    <div className="h">节点信息</div>
                    <div className="wf-kv"><span className="k">运行</span><span className="v mono">{run ? `#${run.id}` : '—'}</span></div>
                    <div className="wf-kv"><span className="k">{active ? '进度' : '耗时'}</span><span className="v">{selStep.status === '等待' ? '—' : selStep.time ?? '—'}</span></div>
                    <div className="wf-kv">
                      <span className="k">状态</span>
                      <span className={`v st-${selState ?? 'pending'}`}>{selState ? NODE_STATE_TEXT[selState] : '等待'}</span>
                    </div>
                    {!active && run && (
                      <div className="wf-kv"><span className="k">最近运行</span><span className="v">{run.finishedAt ? `${run.startedAt} ~ ${run.finishedAt}` : run.startedAt}</span></div>
                    )}
                  </div>

                  {/* Gate 操作：与消息流/待处理卡片同源 */}
                  {selIsGate && run?.gate && (
                    <div className="wf-insp-sec">
                      <div className="h">{run.gate.title}</div>
                      <p className="wf-gate-desc">
                        {run.gate.type === '输入' ? (run.gate.description || '发布前请补充以下信息：') : run.gate.description}
                      </p>
                      <div className="wf-gate-acts">
                        <button type="button" className="no" onClick={() => onReject(job.id)}>拒绝</button>
                        <button type="button" className="yes" onClick={() => onApprove(job.id)}>批准</button>
                      </div>
                      {run.gate.type === '输入' && (
                        <p className="wf-gate-hint">表单填写请在「自动化任务」面板或运行详情中完成</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
        </div>
      </div>

      {/* 底部状态条 */}
      <div className="wf-runbar">
        <span className="state">
          <span className={`d tone-${stateTone}`} />
          {runStateText}
        </span>
        <span className="progress"><i style={{ width: `${progress}%`, background: stateTone === 'wait' ? 'var(--status-warning)' : stateTone === 'run' ? 'var(--status-info)' : 'var(--status-neutral)' }} /></span>
        <span className="info">
          {run
            ? (active
              ? `步骤 ${Math.min(run.currentStep + 1, totalSteps)}/${totalSteps} · ${run.steps[Math.min(run.currentStep, totalSteps - 1)]?.name ?? ''}`
              : `最近运行 #${run.id} · ${run.status}`)
            : '尚未运行过'}
        </span>
      </div>
    </div>
  )
}
