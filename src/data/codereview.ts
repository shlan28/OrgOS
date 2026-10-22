/** 代码审查域：类型 + 预置检查项库 + 聚合函数（双审交叉验证，纯前端 Mock） */

/* —— 类型定义 —— */

/** 检查项分类 */
export type ItemCategory = '正确性' | '可维护性' | '性能' | '测试' | '规范'

/** 意见级别 */
export type CommentLevel = '必须修改' | '建议修改'

/** 审查检查项（预设 + 自定义统一形态） */
export interface ChecklistItem {
  id: string
  title: string
  category: ItemCategory
  /** 判定标准说明 */
  description: string
  /** 坏例代码片段（mono 展示） */
  badExample: string
  /** 好例代码片段 */
  goodExample: string
  scope: string
  /** 新建意见时的默认级别倾向 */
  defaultLevel: CommentLevel
  enabled: boolean
  /** 预置 = true：不可删除/不可改内容，仅可启停 */
  builtin: boolean
}

/** 审查意见（ADE / 人工两条线的统一形态） */
export interface ReviewComment {
  id: string
  /** 提出方：ADE 初审 / 人工复审 */
  by: 'ADE' | '人工'
  /** by=人工 时的复审人名 */
  reviewer?: string
  /** 挂载的检查项 id（意见必须挂检查项） */
  itemId: string
  level: CommentLevel
  file: string
  line: number
  snippet: string
  problem: string
  suggestion: string
  /** 交叉比对状态（Mock 预置：相同 file+line+itemId = 双方一致） */
  match: '双方一致' | '仅ADE' | '仅人工'
  /** 仅ADE 意见的人工裁决（null = 未裁决） */
  resolution?: '有效' | '误报' | null
  resolvedAt?: string
}

/** 合并请求（审查队列主线） */
export interface ReviewMr {
  id: string
  title: string
  /** MR 作者（项目成员名） */
  author: string
  /** 源分支 → 目标分支 */
  sourceBranch: string
  targetBranch: string
  additions: number
  deletions: number
  files: number
  /** 'MM-DD HH:mm' */
  createdAt: string
  /** ADE 初审完成时间 */
  adeReviewedAt: string
  /** 本次审查依据的启用检查项数（历史快照，不随启停回改） */
  itemsApplied: number
  /** GitLab MR 地址（「人工复审 ↗」跳转目标） */
  mrUrl: string
  /**
   * 阶段状态机：初审中 → 待人工复审 → 待裁决 → 已完成。
   * ADE 意见只在 Loom 展示、不下发 GitLab；人工在 GitLab 评论，webhook 准实时同步。
   */
  status: '初审中' | '待复审' | '待裁决' | '已完成'
  /** 人工复审意见同步时间（= 待复审 → 待裁决 流转时刻，webhook 到达） */
  humanSyncedAt?: string
  /**
   * 待同步人工意见集（仅 待复审 态）：复审人在 GitLab 提交的评论，Mock 预置于此；
   * 点击「人工复审 ↗」2s 后并入 comments 并清空（模拟 webhook 到达）。
   * 真实系统无此字段——意见由 note webhook 直接写入 comments。
   */
  pendingHumanComments?: ReviewComment[]
  /** 结论（status=已完成 时有效） */
  verdict?: '通过' | '打回'
  concludedAt?: string
  comments: ReviewComment[]
}

/** 代码审查域数据（挂 Project.codereview） */
export interface CodeReviewData {
  checklist: ChecklistItem[]
  mrs: ReviewMr[]
}

/* —— 常量 —— */

/** 检查项分类可选项 */
export const CHECK_CATEGORIES: ItemCategory[] = ['正确性', '可维护性', '性能', '测试', '规范']

/** 意见级别可选项 */
export const COMMENT_LEVELS: CommentLevel[] = ['必须修改', '建议修改']

/** 适用范围下拉选项 */
export const ITEM_SCOPES = ['全部文件', '前端 *.ts,*.tsx', '后端 *.java,*.py', '配置 *.yaml,*.json']

/* —— 预置检查项库（10 条，五分类各 2 条，默认全启用） —— */

export const PRESET_ITEMS: ChecklistItem[] = [
  {
    id: 'ck-boundary', title: '边界条件处理', category: '正确性', defaultLevel: '必须修改',
    description: '入参为空、越界、极端值时行为需明确，禁止不判断直接取用。',
    badExample: 'const first = items[0].id',
    goodExample: 'const first = items[0]?.id ?? DEFAULT_ID',
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'ck-error', title: '错误处理完备', category: '正确性', defaultLevel: '必须修改',
    description: '外部调用（网络 / 存储）失败需有捕获、提示与降级路径，不允许静默失败。',
    badExample: 'localStorage.setItem(key, value)  // 可能抛 QuotaExceeded',
    goodExample: 'try { localStorage.setItem(key, value) } catch (e) { report(e) }',
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'ck-single', title: '函数职责单一', category: '可维护性', defaultLevel: '建议修改',
    description: '超长函数与深层嵌套需拆分，一个函数只做一件事（建议 ≤ 80 行、嵌套 ≤ 3 层）。',
    badExample: 'function submit() { /* 校验+请求+埋点+跳转 120 行 */ }',
    goodExample: 'function submit() { validate(); request(); track(); navigate() }',
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'ck-naming', title: '命名达意', category: '可维护性', defaultLevel: '建议修改',
    description: '变量 / 函数名需表意，禁止无意义缩写与序号后缀。',
    badExample: 'const d = diff[0]; function handle2() {}',
    goodExample: 'const firstDiff = diff[0]; function retrySubmit() {}',
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'ck-loop-io', title: '循环内 IO', category: '性能', defaultLevel: '必须修改',
    description: '循环内禁止逐个发起请求 / 查询，需合并为批量接口或一次查询。',
    badExample: 'for (const id of ids) { await api.get(id) }',
    goodExample: 'const list = await api.batchGet(ids)',
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'ck-list-key', title: '大列表渲染', category: '性能', defaultLevel: '建议修改',
    description: '列表 key 需稳定唯一（禁止 index），超长列表需虚拟化渲染。',
    badExample: '<Item key={index} data={row} />',
    goodExample: '<Item key={row.id} data={row} />',
    scope: '前端 *.ts,*.tsx', enabled: true, builtin: true,
  },
  {
    id: 'ck-test-cover', title: '新逻辑有测试', category: '测试', defaultLevel: '建议修改',
    description: '新增的分支逻辑（含边界）需附对应单元测试，覆盖主路径与异常路径。',
    badExample: 'export function calcDiscount() { /* 无测试 */ }',
    goodExample: 'calcDiscount.test.ts · 3 组边界用例',
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'ck-regression', title: '修复附回归用例', category: '测试', defaultLevel: '建议修改',
    description: 'bugfix 需附可复现的回归用例，防止缺陷重复打开。',
    badExample: 'fix: 修复金额为负的崩溃（无用例）',
    goodExample: 'fix: 修复金额为负的崩溃（附 order-negative.spec）',
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'ck-module', title: '模块边界', category: '规范', defaultLevel: '建议修改',
    description: '遵循项目目录分层，禁止工具层写业务逻辑、组件层直连底层 API。',
    badExample: '// src/utils/date.ts\nimport { payGateway } from "@/api/pay"',
    goodExample: '// src/utils/date.ts（纯函数，无业务依赖）',
    scope: '全部文件', enabled: true, builtin: true,
  },
  {
    id: 'ck-comment-why', title: '注释解释 why', category: '规范', defaultLevel: '建议修改',
    description: '注释说明动机与约束，不复述代码字面行为。',
    badExample: 'i++  // i 加一',
    goodExample: '// 兜底旧数据：2026-03 前的订单无 channel 字段',
    scope: '全部文件', enabled: true, builtin: true,
  },
]

/* —— 工厂 —— */

/** 新项目默认代码审查数据：预置检查项全启用 + 空 MR */
export function createDefaultCodeReview(): CodeReviewData {
  return {
    checklist: PRESET_ITEMS.map((i) => ({ ...i })),
    mrs: [],
  }
}

/* —— 工具函数 —— */

/** 当前时刻 'MM-DD HH:mm' */
export function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 一致性统计（口径见技术方案 5.4） */
export interface AgreementStats {
  /** 双方一致对数 */
  agreed: number
  /** 仅 ADE 条数 */
  adeOnly: number
  /** 仅人工（漏检）条数 */
  humanOnly: number
  /** 比对单元总数 = agreed + adeOnly + humanOnly */
  totalPairs: number
  /** 已裁决有效（仅ADE → 有效） */
  validAde: number
  /** 已裁决误报（仅ADE → 误报） */
  falsePositive: number
  /** 待裁决（仅ADE 未裁决） */
  pendingAde: number
  /** ADE 意见总数 = agreed + adeOnly */
  adeTotal: number
  /** 一致率 % = agreed / totalPairs */
  agreementRate: number
  /** 误报率 % = falsePositive / 已裁决仅ADE（未裁决不计） */
  falsePositiveRate: number
  doneMrs: number
  pendingMrs: number
}

/** 从全部 MR 聚合一致性统计（已完成 MR 口径，含裁决进度用待裁决数） */
export function agreementStats(mrs: ReviewMr[]): AgreementStats {
  const done = mrs.filter((m) => m.status === '已完成')
  let agreed = 0
  let adeOnly = 0
  let humanOnly = 0
  let validAde = 0
  let falsePositive = 0
  let pendingAde = 0

  for (const mr of done) {
    for (const c of mr.comments) {
      if (c.match === '双方一致') agreed++
      else if (c.match === '仅ADE') {
        adeOnly++
        if (c.resolution === '有效') validAde++
        else if (c.resolution === '误报') falsePositive++
        else pendingAde++
      } else humanOnly++
    }
  }
  // 已完成 MR 理论上不存在待裁决，但口径上保留防御：仅统计已完成
  const totalPairs = agreed + adeOnly + humanOnly
  const resolvedAde = validAde + falsePositive
  return {
    agreed, adeOnly, humanOnly, totalPairs,
    validAde, falsePositive, pendingAde,
    adeTotal: agreed + adeOnly,
    agreementRate: totalPairs > 0 ? Math.round((agreed / totalPairs) * 100) : 0,
    falsePositiveRate: resolvedAde > 0 ? Math.round((falsePositive / resolvedAde) * 100) : 0,
    doneMrs: done.length,
    pendingMrs: mrs.length - done.length,
  }
}

/** 单个 MR 的裁决进度（仅ADE 意见：已裁决 / 总数） */
export function resolutionProgress(mr: ReviewMr): { resolved: number; total: number } {
  const adeOnly = mr.comments.filter((c) => c.match === '仅ADE')
  return {
    total: adeOnly.length,
    resolved: adeOnly.filter((c) => c.resolution === '有效' || c.resolution === '误报').length,
  }
}

/**
 * 合并待同步意见并流转状态（模拟 note webhook 到达）：
 * comments = [...comments, ...pendingHumanComments] → status 待裁决 + humanSyncedAt = now。
 */
export function mergePendingHuman(mr: ReviewMr): ReviewMr {
  const pending = mr.pendingHumanComments ?? []
  return {
    ...mr,
    comments: [...mr.comments, ...pending],
    pendingHumanComments: [],
    status: '待裁决',
    humanSyncedAt: nowStamp(),
  }
}

/** 漏检清单：已完成 MR 中 match=仅人工 的意见（MR 创建时间倒序） */
export function missList(mrs: ReviewMr[]): Array<{ mr: ReviewMr; comment: ReviewComment }> {
  const out: Array<{ mr: ReviewMr; comment: ReviewComment }> = []
  for (const mr of mrs) {
    if (mr.status !== '已完成') continue
    for (const c of mr.comments) {
      if (c.match === '仅人工') out.push({ mr, comment: c })
    }
  }
  return out.sort((a, b) => b.mr.createdAt.localeCompare(a.mr.createdAt))
}

/** 薄弱检查项统计行 */
export interface WeakItemRow {
  item: ChecklistItem
  agreed: number
  missed: number
  falsePositive: number
}

/** 薄弱检查项：已完成 MR 意见按 itemId 归因（漏检降序 → 误报降序 → 一致降序） */
export function weakItems(mrs: ReviewMr[], items: ChecklistItem[]): WeakItemRow[] {
  const map = new Map<string, WeakItemRow>()
  for (const item of items) {
    map.set(item.id, { item, agreed: 0, missed: 0, falsePositive: 0 })
  }
  for (const mr of mrs) {
    if (mr.status !== '已完成') continue
    for (const c of mr.comments) {
      const row = map.get(c.itemId)
      if (!row) continue
      if (c.match === '双方一致') row.agreed++
      else if (c.match === '仅人工') row.missed++
      else if (c.match === '仅ADE' && c.resolution === '误报') row.falsePositive++
    }
  }
  return Array.from(map.values())
    .filter((r) => r.agreed + r.missed + r.falsePositive > 0)
    .sort((a, b) => b.missed - a.missed || b.falsePositive - a.falsePositive || b.agreed - a.agreed)
}
