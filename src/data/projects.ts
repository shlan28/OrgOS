/** 项目中心 Mock 数据与类型定义 */

import {
  createDefaultSecurity, findingStatsText,
  type SecurityData, type SecurityRule, type ReviewRecord, type RuleFinding,
} from './security'
import { createDefaultCodeReview, type CodeReviewData } from './codereview'

export type { SecurityData, SecurityRule, ReviewRecord, RuleFinding }
export { findingStatsText }
export type { CodeReviewData }

export interface Member {
  id: string
  name: string
  initial: string
  /** 职位：前端/后端/测试/产品… */
  role: string
  /** 权限：项目负责人/管理员，可空 */
  permission?: string
  online: boolean
  lastActive: string
}

export interface AdeAgent {
  id: string
  name: string
  role: string
  /** 大模型底座 */
  model: string
  status: '工作中' | '空闲'
  /** 工作中显示任务名，空闲为空 */
  currentTask: string
  /** 关联项目（'不关联项目' 或项目名） */
  linkedProject: string
  /** 多模态模型 */
  multimodalModel: string
  /** 协作模型（空 = 未选择） */
  collabModel: string
  /** 个人知识库（多选） */
  knowledgeBases: string[]
  /** MCP 服务（多选） */
  mcpServices: string[]
  /** ADE.md 个性化内容（Markdown） */
  adeMd: string
  /** 工具开关（key 见 ADE_TOOLS） */
  tools: Record<string, boolean>
  /** 运行时：第四个模型槽 */
  model4?: string
  /** 运行时：模型服务（DeepSeek Harness provider） */
  provider?: string
  /** 运行时：权限档 */
  permission?: 'readonly' | 'workspace-write' | 'full'
  /** 运行时：工作目录（空 = 服务端默认） */
  workdir?: string
  /** 所属后端项目 id（空 = 未归属项目） */
  projectId?: string | null
  /** 所属运行时 id（空 = 未绑定） */
  runtimeId?: string | null
  /** 该 agent 名下的会话数（删除前提示用） */
  sessionCount?: number
}

/** 运行时（DeepSeek Harness）可选模型 */
export const ADE_RUNTIME_MODELS = ['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash']

/** 模型下拉：真实运行时模型在前，Mock 底座在后（保持既有数据可用） */
export const ADE_MODEL_OPTIONS = [...ADE_RUNTIME_MODELS, 'GLM-glm-5.3', 'qwen3.8-max', 'qwen3-max']

/** 运行时模型服务 */
export const ADE_PROVIDERS = ['deepseek-official', 'openai-compatible']

/** 运行时权限档 */
export const ADE_PERMISSIONS: { key: 'readonly' | 'workspace-write' | 'full'; label: string; hint: string }[] = [
  { key: 'readonly', label: '只读', hint: '沙箱只读，写入工具会被拒绝' },
  { key: 'workspace-write', label: '工作区可写', hint: '允许在工作目录内读写（推荐）' },
  { key: 'full', label: '完全访问', hint: '关闭沙箱，谨慎使用' },
]

/* —— ADE 设置：工具目录与选项常量 —— */

/** ADE 可开关的工具（内置工具 + IM 渠道） */
export interface AdeTool {
  id: string
  name: string
  group: 'builtin' | 'im'
  /** 徽标底色 */
  color: string
  /** 徽标字符 */
  badge: string
  /** IM 渠道凭证状态（false = 尚未配置） */
  credentialReady?: boolean
}

export const ADE_TOOLS: AdeTool[] = [
  { id: 'gitlab', name: 'GitLab', group: 'builtin', color: '#fc6d26', badge: 'G' },
  { id: 'jenkins', name: 'Jenkins', group: 'builtin', color: '#d24939', badge: 'J' },
  { id: 'zentao', name: '禅道', group: 'builtin', color: '#0fb8b0', badge: '禅' },
  { id: 'jira', name: 'Jira', group: 'builtin', color: '#2684ff', badge: 'J' },
  { id: 'confluence', name: 'Confluence', group: 'builtin', color: '#1d63d6', badge: 'C' },
  { id: 'feishu', name: '飞书', group: 'im', color: '#3370ff', badge: '飞', credentialReady: false },
  { id: 'wecom', name: '企业微信', group: 'im', color: '#0082ff', badge: '企', credentialReady: false },
]

export const ADE_LLM_BASES = ['GLM-glm-5.3', 'qwen3.8-max', 'qwen3-max']
export const ADE_MULTIMODAL_MODELS = ['kimi/kimi-k3', 'qwen3-vl-plus', 'GLM-glm-5.3v']
export const ADE_COLLAB_MODELS = ['qwen3-max', 'GLM-glm-5.3', 'kimi/kimi-k3']
export const ADE_KNOWLEDGE_BASES = ['研发规范库', '产品需求库', '运维手册']
export const ADE_MCP_SERVICES = ['代码仓库 MCP', '浏览器 MCP', '数据库 MCP']
export const ADE_LINKED_PROJECTS = ['不关联项目', 'loomweb', '翼构移动应用']

/** ADE.md 编辑器占位模板（与真实产品一致） */
export const ADE_MD_PLACEHOLDER = `## 你是谁
写清楚这个 Agent 的身份、角色或人设。

例如：
你是一个温柔但直接的学习伙伴，擅长帮我拆解复杂问题。

## 你能做什么
写清楚这个 Agent 主要帮用户完成什么事。

例如：
- 帮我整理想法
- 陪我练习表达
- 提醒我重要事项
- 在我犹豫时给出建议

## 你应该怎么说话
写清楚语气、风格和表达方式。

例如：
- 说话简洁
- 不要太官方`

/** 新建 ADE 的默认配置（申请专属ADE / 兜底值共用） */
export function createDefaultAdeConfig() {
  return {
    linkedProject: ADE_LINKED_PROJECTS[0],
    multimodalModel: ADE_MULTIMODAL_MODELS[0],
    collabModel: '',
    knowledgeBases: [] as string[],
    mcpServices: [] as string[],
    adeMd: '',
    tools: Object.fromEntries(ADE_TOOLS.map((t) => [t.id, false])) as Record<string, boolean>,
  }
}

/* —— 自动化任务（运行 Run + 步骤 Step + 人工介入点 Gate） —— */

/** 运行步骤状态 */
export type StepStatus = '等待' | '运行中' | '成功' | '失败' | '跳过'

export interface RunStep {
  id: string
  name: string
  status: StepStatus
  /** 完成时刻（如 08:00:41） */
  time?: string
}

/** 人工介入点：运行到某步时暂停等人 */
export interface HumanGate {
  type: '确认' | '输入'
  title: string
  description: string
  /** 需要处理的人（确认型 = 确认人；输入型 = 填写人）；缺省 = 不指定 */
  approver?: MessageSender
  /** 输入型：表单字段定义 */
  fields?: { key: string; label: string; placeholder?: string; required?: boolean }[]
}

export type RunStatus =
  | '排队中' | '运行中' | '等待确认' | '等待输入' | '已暂停'
  | '成功' | '失败' | '已取消' | '已拒绝'

/** 消息发送者（区分说话人：项目成员 / ADE） */
export interface MessageSender {
  /** 显示名 */
  name: string
  /** 头像字符 */
  initial: string
  /** 头像底色（缺省用默认灰蓝） */
  color?: string
}

/** 当前登录用户（Mock：与侧边栏底部一致） */
export const CURRENT_USER: MessageSender = { name: 'shilu', initial: 'S', color: '#5b7ba6' }

/** 任务执行方 ADE 的默认身份 */
export const ADE_SENDER: MessageSender = { name: '研发工程师ADE', initial: 'A', color: '#7c66d8' }

/** 阶段性结果中的产物文件（带下划线可跳转 URL 展示） */
export interface ResultFile {
  /** 展示名（如 dist/index.html） */
  name: string
  /** 跳转地址（Mock：点击新开标签页） */
  url: string
}

/** 步骤阶段性结果（步骤完成时由 ADE 返回，渲染为结果块） */
export interface StepResult {
  /** 结果摘要（如「单元测试全部通过（58/58），覆盖率 87.4%」） */
  summary: string
  /** 产物文件（带下划线可跳转 URL） */
  files: ResultFile[]
  /** 该阶段对应的 ADE 会话地址（「跳转到会话」按钮用） */
  sessionUrl: string
}

/** 运行消息（对话式运行控制台） */
export interface RunMessage {
  id: string
  /** 系统 = 运行开始/结束等事件；ADE = 任务执行方；人 = 用户插话 */
  role: '系统' | 'ADE' | '人'
  text: string
  time: string
  /** 说话人（人 = 发消息的成员；ADE = 执行方）；缺省时渲染按 role 兜底 */
  sender?: MessageSender
  /** 确认型问题消息附带的内联按钮 */
  actions?: { label: string; kind: 'primary' | 'default' }[]
  /** 输入型问题消息附带的迷你表单 */
  form?: { key: string; label: string; placeholder?: string; required?: boolean }[]
  /** 阶段性结果（步骤完成消息附带；渲染为结果块） */
  result?: StepResult
}

/** 任务的一次运行实例 */
export interface JobRun {
  id: string
  jobId: string
  status: RunStatus
  startedAt: string
  finishedAt?: string
  steps: RunStep[]
  /** 当前执行到的步骤下标 */
  currentStep: number
  /** 等待中的人工介入点（非等待状态为空） */
  gate?: HumanGate
  /** 已等待时长文案（等待状态显示用） */
  waitingSince?: string
  /** 对话式消息流 */
  messages: RunMessage[]
}

export interface AutoJob {
  id: string
  name: string
  /** 绑定的工作流模板 id（新建时必选，见 WORKFLOW_TEMPLATES） */
  workflowId: string
  triggerType: '定时' | '事件' | '手动'
  triggerParam: string
  /** 定时规则（triggerType = '定时' 时存在，新建弹窗结构化配置） */
  schedule?: ScheduleRule
  enabled: boolean
  /** 运行中需要人工确认（新建任务可勾选） */
  needApproval: boolean
  /** 当前运行（无则空闲） */
  currentRun?: JobRun
  /** 历史运行（Mock 保留最近 3 条） */
  history: JobRun[]
}

/* —— 定时规则（新建任务 · 触发方式 = 定时） —— */

/** 定时规则：频率 + 对应时间/星期/日期 */
export interface ScheduleRule {
  /** 频率 */
  freq: '每天' | '每周' | '每月'
  /** 时间 HH:mm（三档频率通用） */
  time: string
  /** 每周：星期几（1-7，1 = 周一） */
  weekday?: number
  /** 每月：几号（1-31） */
  day?: number
}

/** 星期展示名（下标 1-7 对应周一~周日） */
export const WEEKDAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

/** 定时规则 → 展示文案（任务行副标题 / RunModal 头部用） */
export function scheduleTextOf(rule: ScheduleRule): string {
  switch (rule.freq) {
    case '每天': return `每天 ${rule.time}`
    case '每周': return `每周${WEEKDAY_NAMES[rule.weekday ?? 1]} ${rule.time}`
    case '每月': return `每月 ${rule.day ?? 1} 日 ${rule.time}`
  }
}

/** 工作流模板（ADE Teams 产出的流程定义，Mock） */
export interface WorkflowTemplate {
  id: string
  name: string
  /** 模板简介（步骤链路描述） */
  description: string
}

/** Mock 工作流模板列表（模拟 ADE Teams 已发布的工作流） */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  { id: 'wf1', name: '每日构建与测试', description: '拉取代码 → 安装依赖 → 单元测试 → 构建产物' },
  { id: 'wf2', name: 'MR 静态检查', description: '拉取代码 → 静态检查 → 输出报告' },
  { id: 'wf3', name: '周报生成', description: '汇总数据 → 起草周报 → 等待确认 → 发布' },
  { id: 'wf4', name: '发布准备', description: '版本信息填写 → 预检 → 发布' },
]

/** 按 id 取工作流模板名（找不到返回占位文案） */
export const workflowNameOf = (id: string): string =>
  WORKFLOW_TEMPLATES.find((t) => t.id === id)?.name ?? '未绑定模板'

/* —— 阶段性结果 Mock 工具（消息流结果块数据源） —— */

/** Mock 会话地址：每个阶段（run + 步骤序号）各自对应一个会话 */
export const sessionUrlOf = (runId: string, stepIdx: number): string =>
  `https://loom.aicoda.tech/session/${runId}-st${stepIdx}`

/** Mock 产物文件地址 */
const artifactUrl = (path: string): string =>
  `https://gitlab.aicoda.tech/fe/loomweb/-/artifacts/${path}`

/** 按步骤名生成阶段性结果（关键词匹配，未命中给通用模板） */
export function stepResultOf(stepName: string, runId: string, stepIdx: number): StepResult {
  const sessionUrl = sessionUrlOf(runId, stepIdx)
  if (stepName.includes('拉取')) {
    return {
      summary: '已同步 origin/dev 最新提交，工作区就绪。',
      files: [
        { name: 'logs/fetch.log', url: artifactUrl('logs/fetch.log') },
        { name: 'CHANGES.diff', url: artifactUrl('CHANGES.diff') },
      ],
      sessionUrl,
    }
  }
  if (stepName.includes('安装') || stepName.includes('依赖')) {
    return {
      summary: '依赖安装完成，共 312 个包，无安全漏洞。',
      files: [{ name: 'logs/install.log', url: artifactUrl('logs/install.log') }],
      sessionUrl,
    }
  }
  if (stepName.includes('测试')) {
    return {
      summary: '单元测试全部通过（58/58），覆盖率 87.4%。',
      files: [
        { name: 'test-report.html', url: artifactUrl('test-report.html') },
        { name: 'coverage/lcov.info', url: artifactUrl('coverage/lcov.info') },
      ],
      sessionUrl,
    }
  }
  if (stepName.includes('构建') || stepName.includes('打包')) {
    return {
      summary: '构建产物完成，输出 dist/ 共 42 个文件，体积 1.8 MB。',
      files: [
        { name: 'dist/index.html', url: artifactUrl('dist/index.html') },
        { name: 'dist/assets/app.js', url: artifactUrl('dist/assets/app.js') },
        { name: 'dist/assets/app.css', url: artifactUrl('dist/assets/app.css') },
      ],
      sessionUrl,
    }
  }
  if (stepName.includes('检查') || stepName.includes('静态')) {
    return {
      summary: '静态检查完成，0 error / 3 warning。',
      files: [{ name: 'lint-report.html', url: artifactUrl('lint-report.html') }],
      sessionUrl,
    }
  }
  if (stepName.includes('汇总') || stepName.includes('聚合')) {
    return {
      summary: '数据汇总完成：MR 12 个，Issue 8 个，提交 47 次。',
      files: [{ name: 'data/summary.json', url: artifactUrl('data/summary.json') }],
      sessionUrl,
    }
  }
  if (stepName.includes('周报') || stepName.includes('生成')) {
    return {
      summary: '周报草稿生成完成，共 6 个章节。',
      files: [{ name: 'weekly-report-0828.md', url: artifactUrl('weekly-report-0828.md') }],
      sessionUrl,
    }
  }
  if (stepName.includes('归档') || stepName.includes('发布')) {
    return {
      summary: '产物已归档至发布目录，校验和一致。',
      files: [{ name: 'release/manifest.json', url: artifactUrl('release/manifest.json') }],
      sessionUrl,
    }
  }
  // 通用模板
  return {
    summary: `${stepName}完成。`,
    files: [{ name: `logs/${stepName}.log`, url: artifactUrl(`logs/${stepName}.log`) }],
    sessionUrl,
  }
}

/** 应用内通知（由人工介入点触发） */
export interface Notification {
  id: string
  type: '等待确认' | '等待输入'
  jobId: string
  runId: string
  projectId: string
  title: string
  description: string
  /** 相对时间文案 */
  time: string
  /** 需要处理的人（由 Gate 触发时带上，列表展示用） */
  approver?: MessageSender
}

export interface SpecDoc {
  id: string
  name: string
  note: string
  updatedAt: string
  /** 编辑区源文本 */
  markdown: string
  /** 预览渲染数据 */
  content: { heading: string; body: string }[]
  /** 是否加入项目提示词：开启后该规范内容注入本项目的 ADE 系统提示词 */
  inPrompt: boolean
}

/* —— 代码仓库（代码 tab） —— */

/** 代码仓库：editable = 可编辑仓库；readonly = 只读仓库（仅给 Agent 提供上下文） */
export interface CodeRepo {
  id: string
  /** 仓库名（如 loomweb） */
  name: string
  /** 仓库类型：gitlab / svn */
  type: 'gitlab' | 'svn'
  /** 默认分支 */
  branch: string
  mode: 'editable' | 'readonly'
  /** 一句话说明（可编辑 = 用途；只读 = 给 Agent 提供什么上下文） */
  note: string
  /** 最近同步时间（Mock 文案） */
  syncedAt: string
}

/** 可选仓库目录（添加弹窗下拉用，Mock：模拟从代码平台拉取的仓库列表） */
export const CODE_REPO_CATALOG: { type: 'gitlab' | 'svn'; name: string; branches: string[] }[] = [
  { type: 'gitlab', name: 'loomweb', branches: ['dev', 'main', 'feature/login'] },
  { type: 'gitlab', name: 'loomweb-docs', branches: ['main'] },
  { type: 'gitlab', name: 'loom-ui', branches: ['main', 'v2.3.1', 'v2.2.0'] },
  { type: 'gitlab', name: 'yigou-app', branches: ['main', 'release/2.4'] },
  { type: 'svn', name: 'platform-sdk', branches: ['trunk', 'branches/2.4'] },
  { type: 'svn', name: 'pay-gateway', branches: ['trunk', 'release/2.4'] },
]

/* —— 知识记忆 —— */

/** 项目知识库文档（可从外部导入，带索引状态） */
/** 知识库目录（用户创建管理，支持多层级） */
export interface KbFolder {
  id: string
  name: string
  /** 父目录 id，空 = 根目录 */
  parentId?: string
}

/** 知识库文档索引状态机（项目知识库收录清单用） */
export type KbIndexState = 'off' | 'pending' | 'indexing' | 'indexed' | 'failed' | 'stale'

/** 项目知识库文档（统一形态：收录清单 + 索引状态） */
export interface KbDoc {
  id: string
  title: string
  /** 所属目录 id（目录树过滤用） */
  folderId: string
  source: '团队 wiki' | 'GitLab 文档' | '本地文件' | '手动'
  sourceRef: string
  importedAt: string
  updatedAt: string
  /** 完整文档内容（编辑区源文本） */
  markdown: string
  /** 预览渲染数据 */
  content: { heading: string; body: string }[]
  /** 摘要（列表行次级文案展示用） */
  summary: string
  /** 索引状态（项目知识库收录状态机；「文档」子 tab 的 documents 不带该字段 = 视作 off） */
  indexState?: KbIndexState
  /** 已索引片段数（off 清零；统计条「片段」= 全库求和） */
  chunks?: number
  /** 最近一次索引完成时间（indexing 结束刷新） */
  indexedAt?: string
  /** failed 时的失败原因 */
  errorText?: string
}

/** 文档库（「文档和知识库」tab 的「文档」子 tab：目录树 + 文档列表，与项目知识库同构） */
export interface DocLibrary {
  folders: KbFolder[]
  docs: KbDoc[]
}

/** 记忆条目（带生命周期） */
export interface MemoryItem {
  id: string
  content: string
  source: '会话沉淀' | '手动'
  createdAt: string
  lifecycle: '活跃' | '即将过期' | '已归档'
  /** 即将过期时的剩余天数 */
  remainDays?: number
  /** AI 反思备注：自动反思规则对归档/活跃判断的原因说明（Mock 只读展示） */
  reflectNote?: string
}

/** 记忆设置：自动收集开关 + 收集规则 + 生命周期策略 + 自动反思规则 */
export interface MemorySettings {
  autoCollect: boolean
  /** 收集记忆规则：用户自定义的自然语言规则，空 = 未设定（自动提炼通用要点） */
  collectRules: string
  /** 用户按天设定，1–3650 */
  retentionDays: number
  /** 永久保留，开启时 retentionDays 不生效 */
  permanent: boolean
  expirePolicy: '自动归档' | '自动删除' | '仅提醒'
  /** 自动反思规则：AI 定期根据项目内容（规范/知识库/会话）整理记忆，判断归档与保持活跃 */
  autoReflect: boolean
  /** 反思频率 */
  reflectFrequency: '每天' | '每周' | '每月'
  /** 自定义反思规则：空 = AI 自动判断 */
  reflectRules: string
}

export interface Knowledge {
  folders: KbFolder[]
  docs: KbDoc[]
  memories: MemoryItem[]
  memorySettings: MemorySettings
}

/** 空文档库（新建项目工厂用） */
export function createEmptyDocLibrary(): DocLibrary {
  return { folders: [], docs: [] }
}

/* —— 项目会话（详情页格 1 会话列表） —— */

/* —— Agent CLI 轨迹（详情页格 3：agent loop 的终端还原） —— */

/**
 * Terminal 行（agent CLI 模式）：还原 agent loop 的完整操作轨迹。
 * kind 分类：
 * - sys    系统横幅（会话启动，双线框样式，text 用 \n 分多行）
 * - prompt 用户/调度输入（❯ 提示符，青蓝加粗）
 * - think  agent 思考输出（灰色斜体，前缀「◦」）
 * - cmd    执行的 shell 命令（❯ 提示符）
 * - out    命令/工具原始输出（text 用 \n 分多行）
 * - file   文件读写块（▸ 前缀，路径 + 内容预览）
 * - tool   工具调用（⚡ 前缀 + 工具名 + 参数）
 * - ok     成功结果（✓ 绿）
 * - err    失败/错误（✗ 红）
 * - info   阶段提示（▸ 蓝）
 */
export interface TerminalLog {
  id: string
  /** HH:mm:ss 时间戳 */
  time: string
  kind: 'sys' | 'prompt' | 'think' | 'cmd' | 'out' | 'file' | 'tool' | 'ok' | 'err' | 'info'
  /** 多行内容用 \n 分隔（out/sys/file 支持） */
  text: string
  /** 归属 ADE id（Agent CLI 多 agent tab 分桶用；缺省 = 主 agent（agents[0]）） */
  agentId?: string
}


/** 项目会话（格 1 会话列表条目） */
export interface ProjectSession {
  id: string
  /** 会话名（如「周报生成 · 汇总统计」） */
  name: string
  /** 来源：auto = 自动化任务（关联 jobId，消息实时取 run）；manual = 手动发起 */
  source: 'auto' | 'manual'
  /** auto 时关联的任务 id */
  jobId?: string
  /** 来源副文案（如「自动化任务 · 今日 08:00 触发」/「手动会话 · 与 wang、luyu」） */
  originText: string
  /** 手动会话的消息（auto 会话不存这里，实时取 run） */
  messages: RunMessage[]
  /** 手动会话的工具日志（auto 会话实时派生，不存这里） */
  logs?: TerminalLog[]
  /** 未读数（进入会话时清零） */
  unread: number
  /** 排序权重（数字大在前；运行中 > 等待 > 已结束） */
  order: number
}

/** 会话头像底色（格 1 条目：背景色 + 会话名前 2 字） */
export const SESSION_AVATAR_COLORS: Record<string, string> = {
  sess1: '#7c66d8', sess2: '#4a90a4', sess3: '#b05757', sess4: '#c2752a', sess5: '#8a6fbf',
}

/** 会话头像底色（未知会话回退默认灰蓝） */
/** 会话头像底色池（真实会话按 id 哈希取稳定颜色） */
const SESSION_COLOR_PALETTE = ['#7c66d8', '#4a90a4', '#b05757', '#c2752a', '#8a6fbf', '#3f8f5f', '#5b7ba6']

export const sessionColorOf = (sessionId: string): string => {
  if (SESSION_AVATAR_COLORS[sessionId]) return SESSION_AVATAR_COLORS[sessionId]
  let hash = 0
  for (let i = 0; i < sessionId.length; i += 1) hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0
  return SESSION_COLOR_PALETTE[hash % SESSION_COLOR_PALETTE.length]
}

/** 成员头像底色（消息流 / 成员抽屉共用配色；后半段为飞书导入新成员用色） */
export const MEMBER_COLORS: Record<string, string> = {
  shilu: '#5b7ba6', luyu: '#3f8f5f', wang: '#c2752a', chen: '#8a6fbf', zhao: '#4a90a4', sun: '#b05757',
  张伟: '#3f8f5f', 李娜: '#5b7ba6', 刘强: '#4a90a4', 孙敏: '#b05757', 周杰: '#c2752a',
  吴霞: '#8a6fbf', 郑凯: '#7c66d8', 冯雪: '#4a90a4', 韩磊: '#3f8f5f', 唐悦: '#b05757',
}

/** 成员头像底色（未知成员回退默认灰蓝） */
export const memberColorOf = (name: string): string => MEMBER_COLORS[name] ?? '#5b7ba6'

export interface Project {
  id: string
  name: string
  description: string
  status: '进行中' | '已完成' | '规划中'
  /** 项目类型：dev = 研发（代码/终端），nondev = 非研发 */
  type: 'dev' | 'nondev'
  /** 工作区模式（沙箱阶段使用） */
  workspaceMode: 'none' | 'serial' | 'worktree'
  createdAt: string
  /** 项目周期：开始日期（YYYY-MM-DD） */
  startDate: string
  /** 项目周期：截止日期（YYYY-MM-DD） */
  endDate: string
  /** 项目会话列表（详情页左栏会话区 / 历史会话抽屉数据源） */
  sessions: ProjectSession[]
  /** 所属文件夹 id（空 = 未分组） */
  folderId?: string
  members: Member[]
  agents: AdeAgent[]
  autoJobs: AutoJob[]
  knowledge: Knowledge
  /** 文档库（「文档和知识库」tab 的「文档」子 tab，与项目知识库同构） */
  documents: DocLibrary
  specs: SpecDoc[]
  /** 代码仓库（可编辑 + 只读，见 CodeRepo） */
  repos: CodeRepo[]
  /** 安全审查（规则 + 记录 + 策略，见 security.ts） */
  security: SecurityData
  /** 代码审查（检查项 + MR 双审交叉验证，见 codereview.ts） */
  codereview: CodeReviewData
}

/* —— 项目文件夹（单层，不嵌套） —— */

/** 文件夹成员条目（owner = 所有者 / member = 成员） */
export interface FolderMember {
  /** 用户名（与 Member.name / CURRENT_USER.name 对齐） */
  name: string
  role: 'owner' | 'member'
}

/** 可选成员池（Mock：覆盖各项目出现的全部用户） */
export const FOLDER_MEMBER_POOL = ['shilu', 'luyu', 'wang', 'chen', 'zhao', 'sun']

/** 项目文件夹：可见成员范围 = owner + 成员 */
export interface ProjectFolder {
  id: string
  name: string
  /** 可见成员范围；空 = 所有人可见（兜底，避免无成员文件夹不可达） */
  members: FolderMember[]
}

/** 新建文件夹的默认成员：创建者自动成为所有者 */
export function createFolderMembers(selected: string[]): FolderMember[] {
  return [
    { name: CURRENT_USER.name, role: 'owner' },
    ...selected.filter((n) => n !== CURRENT_USER.name).map((name) => ({ name, role: 'member' as const })),
  ]
}

export const projectFolders: ProjectFolder[] = [
  {
    id: 'f-dev', name: '研发线',
    members: [
      { name: 'shilu', role: 'owner' },
      { name: 'luyu', role: 'member' },
    ],
  },
  {
    id: 'f-data', name: '数据平台',
    members: [
      { name: 'wang', role: 'owner' },
      { name: 'shilu', role: 'member' },
    ],
  },
]

/* —— 项目周期状态推导（卡片 / 详情页共用） —— */

export type PeriodState =
  | { kind: 'not-started'; days: number }   // 未开始：days = 距开始天数
  | { kind: 'running'; days: number }       // 进行中：days = 剩余天数
  | { kind: 'expiring'; days: number }      // 临期：剩余 ≤ 7 天
  | { kind: 'overdue'; days: number }       // 逾期：days = 逾期天数
  | { kind: 'done' }                        // 已完成：不显示天数

/** 当日零点时间戳 */
function todayStart(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 解析 YYYY-MM-DD 为当日零点时间戳（非法返回 NaN） */
function parseDate(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return NaN
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

/** 按项目状态与周期推导展示态 */
export function getPeriodState(project: Project): PeriodState {
  if (project.status === '已完成') return { kind: 'done' }
  const start = parseDate(project.startDate)
  const end = parseDate(project.endDate)
  const today = todayStart()
  if (Number.isNaN(start) || Number.isNaN(end)) return { kind: 'done' }
  if (today < start) {
    return { kind: 'not-started', days: Math.ceil((start - today) / 86400000) }
  }
  if (today > end) {
    return { kind: 'overdue', days: Math.ceil((today - end) / 86400000) }
  }
  const remain = Math.ceil((end - today) / 86400000)
  return remain <= 7 ? { kind: 'expiring', days: remain } : { kind: 'running', days: remain }
}

/** 周期区间文案：同年省略年份（05-18 ~ 08-31），跨年用完整格式 */
export function formatPeriodRange(startDate: string, endDate: string): string {
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4)
  const s = sameYear ? startDate.slice(5) : startDate
  return `${s} ~ ${endDate}`
}

/** 当天日期 YYYY-MM-DD */
function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 新建项目工厂：空成员/ADE/任务/规范 + 默认知识记忆结构 */
export function createEmptyProject(input: {
  name: string
  description: string
  status: Project['status']
  type?: 'dev' | 'nondev'
  workspaceMode?: 'none' | 'serial' | 'worktree'
  startDate: string
  endDate: string
  folderId?: string
}): Project {
  const type = input.type === 'nondev' ? 'nondev' : 'dev'
  return {
    id: `p${Date.now()}`,
    name: input.name,
    description: input.description,
    status: input.status,
    type,
    workspaceMode: input.workspaceMode ?? (type === 'dev' ? 'serial' : 'none'),
    createdAt: todayISO(),
    startDate: input.startDate,
    endDate: input.endDate,
    folderId: input.folderId,
    sessions: [],
    members: [],
    agents: [],
    autoJobs: [],
    knowledge: {
      folders: [],
      docs: [],
      memories: [],
      memorySettings: {
        autoCollect: false,
        collectRules: '',
        retentionDays: 90,
        permanent: false,
        expirePolicy: '自动归档',
        autoReflect: false,
        reflectFrequency: '每周',
        reflectRules: '',
      },
    },
    documents: createEmptyDocLibrary(),
    specs: [],
    repos: [],
    security: createDefaultSecurity(),
    codereview: createDefaultCodeReview(),
  }
}

export const projects: Project[] = [
  {
    id: 'loomweb',
    name: 'loomweb',
    description: 'Loom Web 端研发',
    status: '进行中',
    type: 'dev',
    workspaceMode: 'serial',
    createdAt: '2026-07-02',
    startDate: '2026-07-02',
    endDate: '2026-09-30',
    folderId: 'f-dev',
    sessions: [],
    members: [
      { id: 'm1', name: 'shilu', initial: 'S', role: '前端', permission: '项目负责人', online: true, lastActive: '活跃于 10 分钟前' },
      { id: 'm2', name: 'luyu', initial: 'L', role: '后端', permission: '管理员', online: false, lastActive: '活跃于 3 小时前' },
      { id: 'm3', name: 'wang', initial: 'W', role: '测试', online: true, lastActive: '活跃于 1 小时前' },
      { id: 'm4', name: 'chen', initial: 'C', role: '产品', online: false, lastActive: '活跃于 昨天' },
    ],
    agents: [
      {
        id: 'a1', name: '研发工程师ADE', role: '研发工程师', model: 'GLM-glm-5.3', status: '工作中', currentTask: '登录模块重构',
        linkedProject: 'loomweb', multimodalModel: 'kimi/kimi-k3', collabModel: '',
        knowledgeBases: ['研发规范库'], mcpServices: ['代码仓库 MCP'],
        adeMd: '## 你是谁\n\n你是本项目的研发工程师，负责 Web 端功能开发与重构。\n\n## 你能做什么\n\n- 实现与重构业务组件\n- 排查并修复缺陷\n- 输出技术方案与代码评审意见\n\n## 你应该怎么说话\n\n- 说话简洁\n- 结论先行，必要时给出依据',
        tools: { gitlab: true, jenkins: false, zentao: false, jira: false, confluence: false, feishu: false, wecom: false },
      },
      {
        id: 'a2', name: '测试工程师ADE', role: '测试工程师', model: 'qwen3.8-max', status: '空闲', currentTask: '',
        linkedProject: 'loomweb', multimodalModel: 'qwen3-vl-plus', collabModel: 'qwen3-max',
        knowledgeBases: ['产品需求库'], mcpServices: [],
        adeMd: '## 你是谁\n\n你是本项目的测试工程师，负责用例设计与回归验证。\n\n## 你能做什么\n\n- 编写与维护测试用例\n- 执行回归并输出报告\n- 跟踪缺陷直至关闭\n\n## 你应该怎么说话\n\n- 说话简洁\n- 缺陷描述附带复现步骤',
        tools: { gitlab: false, jenkins: true, zentao: true, jira: false, confluence: false, feishu: false, wecom: false },
      },
    ],
    autoJobs: [
      {
        id: 'j1', name: '每日构建', workflowId: 'wf1', triggerType: '定时', triggerParam: '每天 08:00',
        enabled: true, needApproval: false,
        currentRun: {
          id: 'r11', jobId: 'j1', status: '运行中', startedAt: '08-28 08:00', currentStep: 1,
          steps: [
            { id: 'st1', name: '拉取代码', status: '成功', time: '08:00:02' },
            { id: 'st2', name: '安装依赖', status: '成功', time: '08:00:41' },
            { id: 'st3', name: '单元测试', status: '运行中' },
            { id: 'st4', name: '构建产物', status: '等待' },
          ],
          messages: [
            { id: 'm1', role: '系统', text: '运行开始：每日构建', time: '08:00:01' },
            { id: 'm1b', role: 'ADE', text: '开始执行：拉取代码', time: '08:00:01' },
            {
              id: 'm2', role: 'ADE', text: '拉取代码完成。', time: '08:00:02',
              result: {
                summary: '已同步 origin/dev 最新提交（2 个文件变更），工作区就绪。',
                files: [
                  { name: 'logs/fetch.log', url: artifactUrl('logs/fetch.log') },
                  { name: 'CHANGES.diff', url: artifactUrl('CHANGES.diff') },
                ],
                sessionUrl: sessionUrlOf('r11', 0),
              },
            },
            { id: 'm2b', role: 'ADE', text: '开始执行：安装依赖', time: '08:00:03' },
            {
              id: 'm3', role: 'ADE', text: '依赖安装完成。', time: '08:00:41',
              result: {
                summary: '依赖安装完成，共 312 个包，无安全漏洞。',
                files: [{ name: 'logs/install.log', url: artifactUrl('logs/install.log') }],
                sessionUrl: sessionUrlOf('r11', 1),
              },
            },
            { id: 'm3b', role: 'ADE', text: '开始执行：单元测试', time: '08:00:42' },
            { id: 'm4', role: '人', text: '顺便把 login 分支的用例也跑一下', time: '08:00:45', sender: { name: 'wang', initial: 'W', color: '#c2752a' } },
            { id: 'm5', role: 'ADE', text: '收到，已将 login 分支用例加入本次测试范围。', time: '08:00:47' },
            { id: 'm6', role: 'ADE', text: '单元测试进行中… 42/58 通过', time: '08:00:42' },
          ],
        },
        history: [
          {
            id: 'r10', jobId: 'j1', status: '成功', startedAt: '08-27 08:00', finishedAt: '08-27 08:03', currentStep: 3,
            steps: [
              { id: 'st1', name: '拉取代码', status: '成功', time: '08:00:02' },
              { id: 'st2', name: '安装依赖', status: '成功', time: '08:00:38' },
              { id: 'st3', name: '单元测试', status: '成功', time: '08:02:10' },
              { id: 'st4', name: '构建产物', status: '成功', time: '08:03:05' },
            ],
            messages: [
              { id: 'm1', role: '系统', text: '运行开始：每日构建', time: '08:00:01' },
              { id: 'm1b', role: 'ADE', text: '开始执行：拉取代码', time: '08:00:01' },
              {
                id: 'm2', role: 'ADE', text: '拉取代码完成。', time: '08:00:02',
                result: {
                  summary: '已同步 origin/dev 最新提交，无文件变更。',
                  files: [{ name: 'logs/fetch.log', url: artifactUrl('logs/fetch.log') }],
                  sessionUrl: sessionUrlOf('r10', 0),
                },
              },
              { id: 'm2b', role: 'ADE', text: '开始执行：安装依赖', time: '08:00:03' },
              {
                id: 'm3', role: 'ADE', text: '依赖安装完成。', time: '08:00:38',
                result: {
                  summary: '依赖安装完成，共 312 个包，无安全漏洞。',
                  files: [{ name: 'logs/install.log', url: artifactUrl('logs/install.log') }],
                  sessionUrl: sessionUrlOf('r10', 1),
                },
              },
              { id: 'm3b', role: 'ADE', text: '开始执行：单元测试', time: '08:00:39' },
              {
                id: 'm4', role: 'ADE', text: '单元测试完成。', time: '08:02:10',
                result: {
                  summary: '单元测试全部通过（58/58），覆盖率 87.4%。',
                  files: [
                    { name: 'test-report.html', url: artifactUrl('test-report.html') },
                    { name: 'coverage/lcov.info', url: artifactUrl('coverage/lcov.info') },
                  ],
                  sessionUrl: sessionUrlOf('r10', 2),
                },
              },
              { id: 'm4b', role: 'ADE', text: '开始执行：构建产物', time: '08:02:15' },
              {
                id: 'm5', role: 'ADE', text: '构建产物完成。', time: '08:03:05',
                result: {
                  summary: '构建产物完成，输出 dist/ 共 42 个文件，体积 1.8 MB。',
                  files: [
                    { name: 'dist/index.html', url: artifactUrl('dist/index.html') },
                    { name: 'dist/assets/app.js', url: artifactUrl('dist/assets/app.js') },
                    { name: 'dist/assets/app.css', url: artifactUrl('dist/assets/app.css') },
                  ],
                  sessionUrl: sessionUrlOf('r10', 3),
                },
              },
              { id: 'm6', role: '系统', text: '运行成功结束，耗时 3 分 04 秒', time: '08:03:05' },
            ],
          },
        ],
      },
      {
        id: 'j2', name: 'MR 静态检查', workflowId: 'wf2', triggerType: '事件', triggerParam: 'MR 创建时',
        enabled: true, needApproval: false,
        history: [
          {
            id: 'r8', jobId: 'j2', status: '成功', startedAt: '08-26 13:40', finishedAt: '08-26 13:42', currentStep: 2,
            steps: [
              { id: 'st1', name: '拉取代码', status: '成功', time: '13:40:02' },
              { id: 'st2', name: '静态检查', status: '成功', time: '13:41:30' },
              { id: 'st3', name: '输出报告', status: '成功', time: '13:42:10' },
            ],
            messages: [
              { id: 'm1', role: '系统', text: '运行开始：MR 静态检查（MR !1024）', time: '13:40:01' },
              {
                id: 'm2', role: 'ADE', text: '拉取 MR 分支完成。', time: '13:40:02',
                result: {
                  summary: '已检出 MR !1024 分支（feat/login-refactor），工作区就绪。',
                  files: [{ name: 'logs/fetch.log', url: artifactUrl('logs/fetch.log') }],
                  sessionUrl: sessionUrlOf('r8', 0),
                },
              },
              {
                id: 'm3', role: 'ADE', text: '静态检查完成。', time: '13:41:30',
                result: {
                  summary: '静态检查完成，0 error / 3 warning（未使用变量 ×2、console 残留 ×1）。',
                  files: [{ name: 'lint-report.html', url: artifactUrl('lint-report.html') }],
                  sessionUrl: sessionUrlOf('r8', 1),
                },
              },
              {
                id: 'm4', role: 'ADE', text: '输出报告完成。', time: '13:42:10',
                result: {
                  summary: '检查报告已生成并回帖到 MR !1024。',
                  files: [{ name: 'mr-1024-review.md', url: artifactUrl('mr-1024-review.md') }],
                  sessionUrl: sessionUrlOf('r8', 2),
                },
              },
              { id: 'm5', role: '系统', text: '运行成功结束，耗时 2 分 10 秒', time: '13:42:10' },
            ],
          },
        ],
      },
      {
        id: 'j3', name: '周报生成', workflowId: 'wf3', triggerType: '定时', triggerParam: '每周五 18:00',
        enabled: true, needApproval: true,
        currentRun: {
          id: 'r12', jobId: 'j3', status: '等待确认', startedAt: '08-28 14:55', currentStep: 2,
          waitingSince: '5 分钟前',
          steps: [
            { id: 'st1', name: '汇总数据', status: '成功', time: '14:55:12' },
            { id: 'st2', name: '生成周报', status: '成功', time: '14:57:40' },
            { id: 'st3', name: '发布到外部渠道', status: '等待' },
          ],
          gate: {
            type: '确认',
            title: '发布前确认',
            description: '即将把周报发布到外部渠道，请确认内容无误。',
            approver: { name: 'shilu', initial: 'S', color: '#5b7ba6' },
          },
          messages: [
            { id: 'm1', role: '系统', text: '运行开始：周报生成', time: '14:55:01' },
            { id: 'm1b', role: 'ADE', text: '开始执行：汇总数据', time: '14:55:02' },
            {
              id: 'm2', role: 'ADE', text: '汇总数据完成。', time: '14:55:12',
              result: {
                summary: '汇总本周 MR / Issue 数据完成：MR 12 个，Issue 8 个，提交 47 次。',
                files: [{ name: 'data/summary.json', url: artifactUrl('data/summary.json') }],
                sessionUrl: sessionUrlOf('r12', 0),
              },
            },
            { id: 'm2b', role: 'ADE', text: '开始执行：生成周报', time: '14:55:13' },
            {
              id: 'm3', role: 'ADE', text: '周报草稿生成完成，等待人工确认。', time: '14:57:40',
              result: {
                summary: '周报草稿生成完成，共 6 个章节（进展 / 风险 / 数据 / 计划 / 缺陷 / 备注）。',
                files: [{ name: 'weekly-report-0828.md', url: artifactUrl('weekly-report-0828.md') }],
                sessionUrl: sessionUrlOf('r12', 1),
              },
            },
            {
              id: 'm4', role: 'ADE', text: '即将把周报发布到外部渠道，请确认内容无误。',
              time: '14:57:41',
              actions: [
                { label: '拒绝', kind: 'default' },
                { label: '批准', kind: 'primary' },
              ],
            },
          ],
        },
        history: [
          {
            id: 'r9', jobId: 'j3', status: '已拒绝', startedAt: '08-22 18:00', finishedAt: '08-22 18:06', currentStep: 2,
            steps: [
              { id: 'st1', name: '汇总数据', status: '成功', time: '18:00:10' },
              { id: 'st2', name: '生成周报', status: '成功', time: '18:02:31' },
              { id: 'st3', name: '发布到外部渠道', status: '跳过' },
            ],
            messages: [
              { id: 'm1', role: '系统', text: '运行开始：周报生成', time: '18:00:01' },
              { id: 'm1b', role: 'ADE', text: '开始执行：汇总数据', time: '18:00:02' },
              { id: 'm2', role: 'ADE', text: '汇总本周 MR / Issue 数据完成。', time: '18:00:10' },
              { id: 'm2b', role: 'ADE', text: '开始执行：生成周报', time: '18:00:11' },
              { id: 'm3', role: 'ADE', text: '周报草稿生成完成，等待人工确认。', time: '18:02:31' },
              { id: 'm4', role: '系统', text: '人工拒绝发布，运行终止', time: '18:06:02' },
            ],
          },
        ],
      },
      {
        id: 'j4', name: '发布准备', workflowId: 'wf4', triggerType: '手动', triggerParam: '手动触发',
        enabled: true, needApproval: false,
        currentRun: {
          id: 'r13', jobId: 'j4', status: '等待输入', startedAt: '08-28 14:48', currentStep: 1,
          waitingSince: '12 分钟前',
          steps: [
            { id: 'st1', name: '检查工作区', status: '成功', time: '14:48:05' },
            { id: 'st2', name: '打包产物', status: '等待' },
            { id: 'st3', name: '归档发布', status: '等待' },
          ],
          gate: {
            type: '输入',
            title: '发布信息补充',
            description: '发布前请补充以下信息：',
            approver: { name: 'luyu', initial: 'L', color: '#3f8f5f' },
            fields: [
              { key: 'version', label: '版本号', placeholder: '如 v1.4.0', required: true },
              { key: 'note', label: '发布说明', placeholder: '本次发布包含的变更摘要', required: true },
            ],
          },
          messages: [
            { id: 'm1', role: '系统', text: '运行开始：发布准备', time: '14:48:01' },
            { id: 'm1b', role: 'ADE', text: '开始执行：检查工作区', time: '14:48:02' },
            {
              id: 'm2', role: 'ADE', text: '工作区检查通过，无未提交变更。', time: '14:48:05',
              result: {
                summary: '工作区检查通过：dev 分支干净、无未提交变更、子模块同步。',
                files: [{ name: 'logs/workspace-check.log', url: artifactUrl('logs/workspace-check.log') }],
                sessionUrl: sessionUrlOf('r13', 0),
              },
            },
            { id: 'm2b', role: 'ADE', text: '开始执行：打包产物', time: '14:48:06' },
            {
              id: 'm3', role: 'ADE', text: '发布前请补充以下信息：',
              time: '14:48:06',
              form: [
                { key: 'version', label: '版本号', placeholder: '如 v1.4.0', required: true },
                { key: 'note', label: '发布说明', placeholder: '本次发布包含的变更摘要', required: true },
              ],
            },
          ],
        },
        history: [],
      },
    ],
    knowledge: {
      folders: [
        { id: 'f1', name: '产品' },
        { id: 'f2', name: '研发' },
      ],
      docs: [
        /* —— 产品 7 篇（收录 5：indexed 3 + stale 1 + indexing 1；未收录 2） —— */
        {
          id: 'd1', title: 'Loom 架构设计说明', source: '团队 wiki', sourceRef: 'wiki/loom/arch', folderId: 'f1',
          importedAt: '08-23', updatedAt: '10-21',
          markdown: '# Loom 架构设计说明\n\n## 技术选型\n\n整体采用 Vite + React 18。\n\n## 样式方案\n\n组件级 CSS 隔离。\n\n## 状态管理\n\n状态走局部 useState，不引入全局状态库。',
          content: [
            { heading: '技术选型', body: '整体采用 Vite + React 18，构建快、热更新稳定。' },
            { heading: '样式方案', body: '组件级 CSS 隔离，每个组件独立样式文件，避免相互覆盖。' },
            { heading: '状态管理', body: '状态走局部 useState，不引入全局状态库，保持简单可预测。' },
          ],
          summary: '整体采用 Vite + React 18，组件级 CSS 隔离，状态走局部 useState，不引入全局状态库。',
          indexState: 'indexed', chunks: 52, indexedAt: '10-21 14:02',
        },
        {
          id: 'd2', title: '多视窗交互规格', source: '团队 wiki', sourceRef: 'wiki/loom/multiview', folderId: 'f1',
          importedAt: '09-02', updatedAt: '10-20',
          markdown: '# 多视窗交互规格\n\n## 入口\n\n首页右上角多视窗按钮。\n\n## 四窗格\n\n切分 2×2，当前会话进左上。\n\n## 重置\n\n关闭重开重置回初始 2×2。',
          content: [
            { heading: '入口', body: '首页右上角多视窗按钮：切分为 2×2 四窗格，当前会话进左上聚焦格。' },
            { heading: '四窗格', body: '空窗格「＋ 打开会话」弹会话选择浮层；窗格 × 置回未分配。' },
            { heading: '重置', body: '关闭多视窗重开重置回初始 2×2。' },
          ],
          summary: '多视窗：2×2 四窗格、空窗格打开会话浮层、重开重置 2×2。',
          indexState: 'stale', chunks: 48, indexedAt: '09-28 16:40', errorText: '文档于 10-20 更新，索引已过期，需重建',
        },
        {
          id: 'd3', title: '协作中心文件夹层级说明', source: '团队 wiki', sourceRef: 'wiki/loom/folders', folderId: 'f1',
          importedAt: '09-10', updatedAt: '09-10',
          markdown: '# 文件夹层级\n\n## 下钻\n\n点击文件夹卡片下钻。\n\n## 面包屑\n\n协作中心 › 文件夹名。\n\n## 移动\n\n项目卡片 ⋯ 菜单移动到。',
          content: [
            { heading: '下钻', body: '顶层 = 文件夹卡片 + 未分组项目；点击文件夹卡片下钻。' },
            { heading: '面包屑', body: '协作中心 › 文件夹名，点面包屑返回。' },
          ],
          summary: '文件夹卡片下钻 + 面包屑返回 + 项目移动到文件夹。',
          indexState: 'indexed', chunks: 38, indexedAt: '10-19 09:30',
        },
        {
          id: 'd4', title: '支付链路时序图说明', source: 'GitLab 文档', sourceRef: 'gitlab/docs/pay-seq', folderId: 'f1',
          importedAt: '10-15', updatedAt: '10-15',
          markdown: '# 支付链路时序\n\n## 收银台\n\n统一收口。\n\n## 幂等\n\n回调需幂等。\n\n## 对账\n\nT+1 定时对账。',
          content: [
            { heading: '收银台', body: '所有支付请求统一经收银台收口分发。' },
            { heading: '幂等', body: '回调需幂等处理，重试不重复入账。' },
          ],
          summary: '收银台统一收口、回调幂等、T+1 对账。',
          indexState: 'indexing', chunks: 0,
        },
        {
          id: 'd5', title: '首页信息架构', source: '团队 wiki', sourceRef: 'wiki/loom/home-ia', folderId: 'f1',
          importedAt: '08-30', updatedAt: '08-30',
          markdown: '# 首页信息架构\n\n## 主区\n\n大标题 + 输入卡片。\n\n## 多视窗\n\n开启后窗格保留标题栏与简化输入条。',
          content: [
            { heading: '主区', body: '大标题 + 输入卡片 + 上下文选择器。' },
            { heading: '多视窗', body: '开启多视窗后每个窗格保留标题栏与简化输入条。' },
          ],
          summary: '首页：大标题 + 输入卡片；多视窗窗格含标题栏与输入条。',
          indexState: 'indexed', chunks: 44, indexedAt: '10-01 11:15',
        },
        {
          id: 'd6', title: '设计规范色板与字号', source: '本地文件', sourceRef: 'design/tokens.md', folderId: 'f1',
          importedAt: '09-18', updatedAt: '09-18',
          markdown: '# 设计规范\n\n## 色板\n\n主色/状态色/中性色。\n\n## 字号\n\n正文 13px，辅助 11.5px。',
          content: [{ heading: '色板', body: '主色/状态色/中性色三组 token。' }],
          summary: '设计 token：色板三组 + 字号阶梯。',
          indexState: 'off', chunks: 0,
        },
        {
          id: 'd7', title: '竞品调研纪要', source: '本地文件', sourceRef: 'research/competitors.md', folderId: 'f1',
          importedAt: '09-25', updatedAt: '09-25',
          markdown: '# 竞品调研\n\n## Cursor\n\n多文件编辑强。\n\n## Copilot\n\nIDE 集成深。',
          content: [{ heading: '要点', body: 'Cursor 多文件编辑强；Copilot IDE 集成深。' }],
          summary: '竞品：Cursor 多文件编辑 / Copilot IDE 集成。',
          indexState: 'off', chunks: 0,
        },
        /* —— 研发 4 篇（收录 3：indexed 2 + failed 1；未收录 1） —— */
        {
          id: 'd8', title: '接口约定 v2', source: 'GitLab 文档', sourceRef: 'gitlab/docs/api-v2', folderId: 'f2',
          importedAt: '08-21', updatedAt: '08-21',
          markdown: '# 接口约定 v2\n\n## 风格\n\n统一 RESTful 风格。\n\n## 错误码\n\n错误码走业务前缀。\n\n## 分页\n\n分页参数固定 page / size。',
          content: [
            { heading: '风格', body: '统一 RESTful 风格，资源名用复数名词，动作用 HTTP 方法表达。' },
            { heading: '错误码', body: '错误码走业务前缀（如 PAY_、USER_），便于按模块定位问题。' },
            { heading: '分页', body: '分页参数固定 page / size，返回体统一带 total。' },
          ],
          summary: '统一 RESTful 风格，错误码走业务前缀，分页参数固定 page / size。',
          indexState: 'failed', chunks: 0, errorText: '解析超时：文档含超长表格，切片阶段超过 30s 限制',
        },
        {
          id: 'd9', title: '模块分布说明', source: '手动', sourceRef: '', folderId: 'f2',
          importedAt: '08-25', updatedAt: '08-25',
          markdown: '# 模块分布说明\n\n## src/\n\n业务组件与入口。\n\n## docs/\n\n方案与说明文档。\n\n## components/\n\n通用组件。',
          content: [
            { heading: 'src/', body: '业务组件与入口。' },
            { heading: 'docs/', body: '方案与说明文档。' },
            { heading: 'components/', body: '通用组件。' },
          ],
          summary: 'src/ 放业务组件与入口，docs/ 放方案文档，components/ 放通用组件。',
          indexState: 'indexed', chunks: 58, indexedAt: '10-12 10:08',
        },
        {
          id: 'd10', title: '构建与发布流水线', source: 'GitLab 文档', sourceRef: 'gitlab/docs/ci-cd', folderId: 'f2',
          importedAt: '09-05', updatedAt: '09-05',
          markdown: '# 构建与发布\n\n## 流水线\n\ntest → build → deploy。\n\n## 环境变量\n\n按环境注入。',
          content: [
            { heading: '流水线', body: 'test → build → deploy 三段。' },
            { heading: '环境变量', body: '按环境注入，不落仓。' },
          ],
          summary: '流水线三段式 + 环境变量按环境注入。',
          indexState: 'indexed', chunks: 46, indexedAt: '10-08 15:22',
        },
        {
          id: 'd11', title: '数据库变更记录', source: 'GitLab 文档', sourceRef: 'gitlab/docs/db-changelog', folderId: 'f2',
          importedAt: '10-02', updatedAt: '10-02',
          markdown: '# 数据库变更\n\n## 迁移\n\n统一走 migration 脚本。',
          content: [{ heading: '迁移', body: '统一走 migration 脚本，禁止手改线上库。' }],
          summary: '数据库变更统一走 migration 脚本。',
          indexState: 'off', chunks: 0,
        },
        /* —— 未分组 7 篇（收录 4：indexed 4；未收录 3） —— */
        {
          id: 'd12', title: '埋点字段字典', source: '团队 wiki', sourceRef: 'wiki/loom/tracking', folderId: '',
          importedAt: '08-28', updatedAt: '08-28',
          markdown: '# 埋点字段字典\n\n## 页面级\n\npage_id + 参数。\n\n## 点击级\n\nelement_id。',
          content: [
            { heading: '页面级', body: 'page_id + 关键参数。' },
            { heading: '点击级', body: 'element_id + 上下文。' },
          ],
          summary: '埋点：页面级 page_id、点击级 element_id。',
          indexState: 'indexed', chunks: 60, indexedAt: '09-30 09:44',
        },
        {
          id: 'd13', title: '灰度发布 SOP', source: '团队 wiki', sourceRef: 'wiki/ops/gray-release', folderId: '',
          importedAt: '09-14', updatedAt: '09-14',
          markdown: '# 灰度发布 SOP\n\n## 阶段\n\n10% → 50% → 全量。\n\n## 回滚\n\n崩溃率超阈值回滚。',
          content: [
            { heading: '阶段', body: '10% → 50% → 全量。' },
            { heading: '回滚', body: '每阶段观察 24 小时，崩溃率超阈值回滚。' },
          ],
          summary: '灰度三阶段放量 + 阈值回滚。',
          indexState: 'indexed', chunks: 42, indexedAt: '10-05 14:50',
        },
        {
          id: 'd14', title: '故障复盘 0817', source: '手动', sourceRef: '', folderId: '',
          importedAt: '08-18', updatedAt: '08-18',
          markdown: '# 故障复盘 0817\n\n## 现象\n\n登录偶发 502。\n\n## 根因\n\n连接池耗尽。\n\n## 措施\n\n池上限 + 告警。',
          content: [
            { heading: '现象', body: '登录偶发 502。' },
            { heading: '根因', body: '连接池耗尽。' },
            { heading: '措施', body: '池上限调整 + 饱和告警。' },
          ],
          summary: '0817 故障：连接池耗尽致 502，池上限 + 告警修复。',
          indexState: 'indexed', chunks: 40, indexedAt: '08-19 10:12',
        },
        {
          id: 'd15', title: '周报归档说明', source: '手动', sourceRef: '', folderId: '',
          importedAt: '09-01', updatedAt: '09-01',
          markdown: '# 周报归档\n\n## 频率\n\n每周五 18:00。\n\n## 存储\n\n归档至知识库。',
          content: [{ heading: '说明', body: '每周五 18:00 由自动化任务归档至知识库。' }],
          summary: '周报每周五归档入知识库。',
          indexState: 'indexed', chunks: 30, indexedAt: '09-02 09:00',
        },
        {
          id: 'd16', title: '新成员环境搭建指南', source: '本地文件', sourceRef: 'onboarding/setup.md', folderId: '',
          importedAt: '09-22', updatedAt: '09-22',
          markdown: '# 环境搭建\n\n## 依赖\n\nNode 20 + npm 10。\n\n## 步骤\n\nnpm install → npm run dev。',
          content: [{ heading: '步骤', body: 'Node 20 + npm 10，install 后 dev。' }],
          summary: '环境：Node 20，install 后 run dev。',
          indexState: 'off', chunks: 0,
        },
        {
          id: 'd17', title: 'API Mock 数据规范', source: '本地文件', sourceRef: 'mock/api-spec.md', folderId: '',
          importedAt: '10-06', updatedAt: '10-06',
          markdown: '# API Mock\n\n## 命名\n\n按资源复数。\n\n## 位置\n\nsrc/data/。',
          content: [{ heading: '说明', body: 'Mock 按资源复数命名，放 src/data/。' }],
          summary: 'API Mock 命名与位置约定。',
          indexState: 'off', chunks: 0,
        },
        {
          id: 'd18', title: '历史设计稿索引', source: '本地文件', sourceRef: 'design/archive.md', folderId: '',
          importedAt: '08-15', updatedAt: '08-15',
          markdown: '# 历史设计稿\n\n## 归档\n\n按版本目录存放。',
          content: [{ heading: '归档', body: '按版本目录存放历史设计稿。' }],
          summary: '历史设计稿按版本归档。',
          indexState: 'off', chunks: 0,
        },
      ],
      memories: [
        { id: 'mem1', content: '组件拆分应遵循展示/容器分离，样式跟随组件目录。', source: '会话沉淀', createdAt: '08-24', lifecycle: '活跃', reflectNote: '与当前组件拆分规范一致，保持活跃' },
        { id: 'mem2', content: '支付回调需幂等处理，重试场景下避免重复入账。', source: '会话沉淀', createdAt: '05-30', lifecycle: '即将过期', remainDays: 5 },
        { id: 'mem3', content: '旧版埋点方案（已废弃，仅供追溯）。', source: '手动', createdAt: '04-12', lifecycle: '已归档', reflectNote: '旧版埋点方案已被新方案替代，AI 于 08-28 反思归档' },
      ],
      memorySettings: { autoCollect: true, collectRules: '只收集代码规范、架构决策与组件拆分相关的要点，忽略闲聊与临时调试内容。', retentionDays: 90, permanent: false, expirePolicy: '自动归档', autoReflect: true, reflectFrequency: '每周', reflectRules: '与当前架构规范冲突或引用已废弃方案的记忆自动归档，组件与接口约定类记忆保持活跃。' },
    },
    documents: {
      folders: [
        { id: 'df1', name: '产品' },
        { id: 'df2', name: '研发流程', parentId: 'df1' },
      ],
      docs: [
        {
          id: 'dd1', title: '产品需求文档 PRD v3', source: '本地文件', sourceRef: 'docs/prd-v3.md', folderId: 'df1',
          importedAt: '09-02', updatedAt: '09-02',
          markdown: '# 产品需求文档 PRD v3\n\n## 多视窗\n\n首页支持 2×2 四窗格。\n\n## 协作中心\n\n文件夹分组下钻。',
          content: [
            { heading: '多视窗', body: '首页支持 2×2 四窗格，空窗格可打开历史会话。' },
            { heading: '协作中心', body: '项目卡片按文件夹分组，支持下钻浏览。' },
          ],
          summary: 'PRD v3：首页多视窗四窗格与协作中心文件夹分组。',
        },
        {
          id: 'dd2', title: '发布流程说明', source: '手动', sourceRef: '', folderId: 'df2',
          importedAt: '09-05', updatedAt: '09-05',
          markdown: '# 发布流程说明\n\n## 环境\n\ntest → staging → prod。\n\n## 窗口\n\n每周二、四 14:00 后可发。',
          content: [
            { heading: '环境', body: 'test → staging → prod 三级环境顺序发布。' },
            { heading: '窗口', body: '每周二、四 14:00 后可发版，紧急修复走绿色通道。' },
          ],
          summary: '三级环境顺序发布，每周二/四 14:00 后为发版窗口。',
        },
        {
          id: 'dd3', title: '会议纪要-需求评审', source: '团队 wiki', sourceRef: 'wiki/loom/minutes-0901', folderId: 'df1',
          importedAt: '09-01', updatedAt: '09-03',
          markdown: '# 会议纪要 · 需求评审\n\n## 结论\n\n多视窗一期只做 2×2。\n\n## 待办\n\nluyu 补接口文档。',
          content: [
            { heading: '结论', body: '多视窗一期只做 2×2，滚动加载二期再议。' },
            { heading: '待办', body: 'luyu 补接口文档；wang 准备回归用例。' },
          ],
          summary: '需求评审结论：多视窗一期只做 2×2，接口文档与用例分派。',
        },
      ],
    },
    specs: [
      {
        id: 's1', name: 'README.md', note: '项目说明', updatedAt: '08-24', inPrompt: false,
        markdown: '# loomweb\n\nLoom Web 端。\n\n## 运行\n\nnpm install\nnpm run dev',
        content: [
          { heading: 'loomweb', body: 'Loom Web 端，基于 React 18 + Vite 的 AI 编程助手界面。' },
          { heading: '运行', body: 'npm install 安装依赖，npm run dev 启动开发服务，默认端口 5173。' },
        ],
      },
      {
        id: 's2', name: 'AGENTS.md', note: '智能体协作约定', updatedAt: '08-22', inPrompt: true,
        markdown: '# AGENTS\n\n## 协作原则\n\n1. 改代码前先读代码\n2. 每次提交附带说明',
        content: [
          { heading: '协作原则', body: '1. 改代码前先读代码；2. 每次提交附带说明；3. 不擅自引入新依赖。' },
        ],
      },
      {
        id: 's3', name: '编码规范.md', note: 'TS/React 规范', updatedAt: '08-20', inPrompt: true,
        markdown: '# 编码规范\n\n## 1. 命名\n\n组件使用 PascalCase，工具函数使用 camelCase。\n\n## 2. 样式\n\n组件级 CSS，禁止全局样式污染。',
        content: [
          { heading: '1. 命名', body: '组件使用 PascalCase，工具函数使用 camelCase，常量使用 UPPER_SNAKE。' },
          { heading: '2. 样式', body: '组件级 CSS，禁止全局样式污染；颜色统一走 CSS 变量。' },
        ],
      },
      {
        id: 's4', name: 'Git 提交规范.md', note: '提交信息格式', updatedAt: '08-15', inPrompt: true,
        markdown: '# Git 提交规范\n\n格式：type: subject\n\ntype 取值 feat / fix / docs / chore。',
        content: [
          { heading: '格式', body: 'type: subject。type 取值 feat / fix / docs / chore，subject 不超过 50 字。' },
        ],
      },
      {
        id: 's5', name: '评审规范.md', note: 'MR 评审要求', updatedAt: '08-12', inPrompt: true,
        markdown: '# 评审规范\n\n1. 至少 1 人通过\n2. 构建通过后方可合并',
        content: [
          { heading: '要求', body: '1. 至少 1 人通过；2. 构建通过后方可合并；3. 涉及规范的改动需负责人确认。' },
        ],
      },
    ],
    repos: [
      {
        id: 'r1', name: 'loomweb', type: 'gitlab', branch: 'dev',
        mode: 'editable', note: '项目主仓，业务代码开发', syncedAt: '08-31 10:24',
      },
      {
        id: 'r2', name: 'loomweb-docs', type: 'gitlab', branch: 'main',
        mode: 'editable', note: '文档站仓库', syncedAt: '08-30 18:02',
      },
      {
        id: 'r3', name: 'loom-ui', type: 'gitlab', branch: 'v2.3.1',
        mode: 'readonly', note: '组件库源码，给 Agent 提供组件 API 上下文', syncedAt: '08-29 09:15',
      },
      {
        id: 'r4', name: 'platform-sdk', type: 'svn', branch: 'trunk',
        mode: 'readonly', note: '平台 SDK，给 Agent 提供接口签名上下文', syncedAt: '08-28 16:40',
      },
    ],
    security: {
      policy: {
        blockMrOnHigh: true, autoIssue: true, scanScope: '全量+增量',
        scheduledReview: true, schedule: { freq: '每天', time: '06:00' },
      },
      rules: [
        ...createDefaultSecurity().rules,
        {
          id: 'cr-eval', name: '禁止使用 eval', tag: '注入', severity: '中危',
          description: '动态执行代码有注入风险',
          matchType: '关键词', pattern: 'eval(',
          scope: '全部文件', enabled: true, builtin: false,
        },
        {
          id: 'cr-vhtml', name: '生产环境禁用 v-html', tag: 'XSS', severity: '低危',
          description: 'Vue 模板 v-html 存在 XSS 风险',
          matchType: '正则', pattern: 'v-html=".*"',
          scope: '前端 *.ts,*.tsx', enabled: true, builtin: false,
        },
      ],
      records: [
        {
          id: 'rec1', trigger: '手动', scope: 'loomweb · dev', startedAt: '09-01 14:20',
          durationSec: 3.6, scannedFiles: 34, rulesApplied: 12,
          findings: [
            {
              id: 'f1', ruleId: 'sr-xss', severity: '高危', file: 'src/utils/html.ts', line: 42,
              snippet: 'const Node = () => <div dangerouslySetInnerHTML={{ __html: userBio }} />',
              description: '使用 dangerouslySetInnerHTML 直接渲染未净化的 HTML，攻击者可注入恶意脚本。',
              suggestion: '渲染前使用 DOMPurify 净化 HTML，或改用文本节点输出。',
              status: '待处理',
            },
            {
              id: 'f2', ruleId: 'sr-key', severity: '高危', file: 'src/api/config.ts', line: 18,
              snippet: "export const PAY_API_KEY = 'sk-live-9f2kx8dmd0slew'",
              description: '源码中硬编码了第三方支付服务 API Key，泄露后可被直接滥用。',
              suggestion: '将凭证迁移到环境变量或密钥管理服务，并轮换已泄露的 Key。',
              status: '待处理',
            },
            {
              id: 'f3', ruleId: 'sr-weak-crypto', severity: '中危', file: 'src/utils/crypto.ts', line: 27,
              snippet: "const hash = createHash('md5').update(data).digest('hex')",
              description: '使用 MD5 做数据摘要，存在碰撞攻击风险。',
              suggestion: '改用 SHA-256 及以上算法；涉及密码存储时使用 bcrypt / argon2。',
              status: '待处理',
            },
            {
              id: 'f4', ruleId: 'sr-sensitive-log', severity: '中危', file: 'src/api/login.ts', line: 63,
              snippet: "console.log('login payload', { phone, password })",
              description: '登录流程将用户密码输出到控制台日志。',
              suggestion: '删除该日志，或对敏感字段脱敏后再输出。',
              status: '已忽略', handledAt: '09-01 14:35',
            },
            {
              id: 'f5', ruleId: 'sr-debug', severity: '低危', file: 'src/hooks/useForm.ts', line: 15,
              snippet: 'if (!values.name) { debugger ; return }',
              description: '残留 debugger 调试语句，生产环境会中断执行。',
              suggestion: '删除 debugger 语句，构建流程可加 eslint no-debugger 兜底。',
              status: '已修复', handledAt: '09-01 14:32',
            },
          ],
        },
        {
          id: 'rec2', trigger: '定时', scope: 'loomweb · dev', startedAt: '08-31 06:00',
          durationSec: 3.2, scannedFiles: 34, rulesApplied: 12,
          findings: [],
        },
      ],
    },
    codereview: {
      checklist: [
        ...createDefaultCodeReview().checklist,
        {
          id: 'ck-localstorage', title: '循环内禁止同步读写 localStorage', category: '性能', defaultLevel: '建议修改',
          description: 'localStorage 为同步阻塞调用，循环内读写会放大卡顿，需在循环外一次完成。',
          badExample: 'for (const k of keys) { const v = localStorage.getItem(k) }',
          goodExample: 'const raw = localStorage.getItem(STORE_KEY); const map = parse(raw)',
          scope: '前端 *.ts,*.tsx', enabled: true, builtin: false,
        },
      ],
      mrs: [
        // mr1 已完成 · 通过：2 双方一致 + 1 仅ADE 已裁决有效
        {
          id: 'mr1', title: 'fix: 登录态静默续期', author: 'shilu',
          sourceBranch: 'auth-refresh', targetBranch: 'dev',
          additions: 64, deletions: 18, files: 5, createdAt: '08-30 11:20', adeReviewedAt: '08-30 11:22',
          itemsApplied: 11, mrUrl: 'https://gitlab.aicoda.tech/fe/loomweb/-/merge_requests/1',
          status: '已完成', verdict: '通过', concludedAt: '08-30 15:10', humanSyncedAt: '08-30 14:45',
          comments: [
            {
              id: 'c1', by: 'ADE', itemId: 'ck-error', level: '必须修改', file: 'src/api/auth.ts', line: 42,
              snippet: 'refresh().catch(() => {})',
              problem: '刷新 token 失败被静默吞掉，用户停留页面直至请求 401 才被动登出。',
              suggestion: 'catch 中标记登录态失效并跳转登录页，携带回跳地址。',
              match: '双方一致',
            },
            {
              id: 'c2', by: '人工', reviewer: 'luyu', itemId: 'ck-error', level: '必须修改', file: 'src/api/auth.ts', line: 42,
              snippet: 'refresh().catch(() => {})',
              problem: '续期失败静默失败，与 ADE 意见一致，需补失效处理。',
              suggestion: '失败时清空本地 token 并引导重新登录。',
              match: '双方一致',
            },
            {
              id: 'c3', by: 'ADE', itemId: 'ck-boundary', level: '必须修改', file: 'src/api/auth.ts', line: 57,
              snippet: 'const token = payload.data.access_token',
              problem: 'payload.data 为空时直接取用会抛错，未做判空。',
              suggestion: '改用可选链并校验 token 非空后再写入。',
              match: '仅ADE', resolution: '有效', resolvedAt: '08-30 14:48',
            },
            {
              id: 'c4', by: 'ADE', itemId: 'ck-naming', level: '建议修改', file: 'src/hooks/useAuth.ts', line: 12,
              snippet: 'const t = useRef(token)',
              problem: 't 命名不表意，读者需追上下文才能理解。',
              suggestion: '改为 tokenRef。',
              match: '双方一致',
            },
            {
              id: 'c5', by: '人工', reviewer: 'luyu', itemId: 'ck-naming', level: '建议修改', file: 'src/hooks/useAuth.ts', line: 12,
              snippet: 'const t = useRef(token)',
              problem: '命名过短，复审要求改为 tokenRef。',
              suggestion: '重命名并全文替换引用。',
              match: '双方一致',
            },
          ],
        },
        // mr2 已完成 · 打回：1 双方一致 + 2 仅ADE（1 误报 1 有效）+ 2 漏检（ck-loop-io 漏检 ×2）
        {
          id: 'mr2', title: 'perf: 订单列表分页优化', author: 'luyu',
          sourceBranch: 'order-pagination', targetBranch: 'dev',
          additions: 142, deletions: 86, files: 7, createdAt: '08-29 09:40', adeReviewedAt: '08-29 09:43',
          itemsApplied: 11, mrUrl: 'https://gitlab.aicoda.tech/fe/loomweb/-/merge_requests/2',
          status: '已完成', verdict: '打回', concludedAt: '08-29 18:02', humanSyncedAt: '08-29 16:20',
          comments: [
            {
              id: 'c1', by: 'ADE', itemId: 'ck-list-key', level: '建议修改', file: 'src/views/OrderList.tsx', line: 31,
              snippet: '<Row key={index} order={o} />',
              problem: '分页列表用 index 作 key，翻页时状态错位。',
              suggestion: '改用 order.id 作 key。',
              match: '双方一致',
            },
            {
              id: 'c2', by: '人工', reviewer: 'shilu', itemId: 'ck-list-key', level: '建议修改', file: 'src/views/OrderList.tsx', line: 31,
              snippet: '<Row key={index} order={o} />',
              problem: 'index 作 key 在翻页场景复用错乱，需改唯一 id。',
              suggestion: 'key={o.id}。',
              match: '双方一致',
            },
            {
              id: 'c3', by: 'ADE', itemId: 'ck-module', level: '建议修改', file: 'src/views/OrderList.tsx', line: 66,
              snippet: 'import { queryOrderPage } from "@/api/order"',
              problem: '视图层直连底层订单 API，绕过了服务层封装。',
              suggestion: '下沉到 services/order.ts 并统一错误处理。',
              match: '仅ADE', resolution: '误报', resolvedAt: '08-29 16:30',
            },
            {
              id: 'c4', by: 'ADE', itemId: 'ck-boundary', level: '必须修改', file: 'src/views/OrderList.tsx', line: 78,
              snippet: 'const total = res.page.total ?? 0',
              problem: 'res.page 可能为 undefined，取 total 前未判空。',
              suggestion: '先判 res.page 存在再取值，或给后端字段兜底默认对象。',
              match: '仅ADE', resolution: '有效', resolvedAt: '08-29 16:35',
            },
            {
              id: 'c5', by: '人工', reviewer: 'shilu', itemId: 'ck-loop-io', level: '必须修改', file: 'src/api/order.ts', line: 24,
              snippet: 'for (const id of pageIds) { const s = await fetchStatus(id) }',
              problem: '循环内逐个请求订单状态，翻一页发 20 个请求，页面明显卡顿。',
              suggestion: '改用批量状态接口一次拉取。',
              match: '仅人工',
            },
            {
              id: 'c6', by: '人工', reviewer: 'shilu', itemId: 'ck-loop-io', level: '必须修改', file: 'src/api/order.ts', line: 31,
              snippet: 'ids.forEach((id) => lockStock(id))',
              problem: '循环内同步锁库存，列表页每行触发一次写操作。',
              suggestion: '聚合为一次批量锁定请求，或交由提交时机统一处理。',
              match: '仅人工',
            },
          ],
        },
        // mr3 待复审（复审工作台主场景）：初始仅 ADE 意见；人工意见打包在 pendingHumanComments，
        // 点击「人工复审 ↗」2s 后模拟 webhook 到达就位（见 mergePendingHuman）
        {
          id: 'mr3', title: 'feat: 购物车满减促销计算', author: 'luyu',
          sourceBranch: 'cart-discount', targetBranch: 'dev',
          additions: 286, deletions: 42, files: 9, createdAt: '09-03 16:40', adeReviewedAt: '09-03 16:41',
          itemsApplied: 11, mrUrl: 'https://gitlab.aicoda.tech/fe/loomweb/-/merge_requests/3',
          status: '待复审',
          comments: [
            {
              id: 'c1', by: 'ADE', itemId: 'ck-boundary', level: '必须修改', file: 'src/cart/promotion.ts', line: 87,
              snippet: 'const threshold = rule.threshold',
              problem: 'rule 可能为 null（无促销场景）时直接取 threshold 抛错。',
              suggestion: '前置判空，无规则时按原价路径返回。',
              match: '双方一致',
            },
            {
              id: 'c3', by: 'ADE', itemId: 'ck-test-cover', level: '建议修改', file: 'src/cart/promotion.ts', line: 120,
              snippet: 'export function calcDiscount() { /* 无测试 */ }',
              problem: '满减阶梯与叠加规则为新增分支逻辑，未见对应单元测试。',
              suggestion: '补充阶梯边界（差 1 元凑单）与多档叠加用例。',
              match: '仅ADE', resolution: null,
            },
            {
              id: 'c4', by: 'ADE', itemId: 'ck-single', level: '建议修改', file: 'src/cart/promotion.ts', line: 45,
              snippet: 'function applyPromotion() { /* 校验+计算+埋点 96 行 */ }',
              problem: 'applyPromotion 职责过多，嵌套达 4 层，难测难改。',
              suggestion: '拆出 validate 与 calc 两个纯函数。',
              match: '仅ADE', resolution: null,
            },
          ],
          pendingHumanComments: [
            {
              id: 'c2', by: '人工', reviewer: 'shilu', itemId: 'ck-boundary', level: '必须修改', file: 'src/cart/promotion.ts', line: 87,
              snippet: 'const threshold = rule.threshold',
              problem: '空规则未判空，购物车无促销商品时会崩。',
              suggestion: '补判空兜底。',
              match: '双方一致',
            },
            {
              id: 'c5', by: '人工', reviewer: 'shilu', itemId: 'ck-loop-io', level: '必须修改', file: 'src/cart/sku.ts', line: 34,
              snippet: 'for (const id of skuIds) { await api.getStock(id) }',
              problem: '循环内逐个查库存，购物车稍大即卡顿。',
              suggestion: '改批量库存接口一次取回。',
              match: '仅人工',
            },
          ],
        },
        // mr4 待裁决：1 双方一致 + 1 仅ADE 未裁决（人工评论已同步）
        {
          id: 'mr4', title: 'refactor: 通知中心跳转逻辑', author: 'wang',
          sourceBranch: 'notify-jump', targetBranch: 'dev',
          additions: 96, deletions: 121, files: 4, createdAt: '09-02 14:05', adeReviewedAt: '09-02 14:07',
          itemsApplied: 11, mrUrl: 'https://gitlab.aicoda.tech/fe/loomweb/-/merge_requests/4',
          status: '待裁决', humanSyncedAt: '09-03 09:30',
          comments: [
            {
              id: 'c1', by: 'ADE', itemId: 'ck-naming', level: '建议修改', file: 'src/notify/jump.ts', line: 18,
              snippet: 'const j = routes.find(() => true)',
              problem: 'j 命名无意义，且 find 回调恒真等价于 routes[0]。',
              suggestion: '改用显式解构首个路由并重命名。',
              match: '双方一致',
            },
            {
              id: 'c2', by: '人工', reviewer: 'shilu', itemId: 'ck-naming', level: '建议修改', file: 'src/notify/jump.ts', line: 18,
              snippet: 'const j = routes.find(() => true)',
              problem: '命名与语义均有问题，同意整改。',
              suggestion: '语义化命名。',
              match: '双方一致',
            },
            {
              id: 'c3', by: 'ADE', itemId: 'ck-comment-why', level: '建议修改', file: 'src/notify/jump.ts', line: 52,
              snippet: '// 遍历路由',
              problem: '注释复述代码字面行为，未说明为何要过滤已下线路由。',
              suggestion: '改为说明历史路由兼容的动机与下线时间。',
              match: '仅ADE', resolution: null,
            },
          ],
        },
        // mr5 待裁决：0 ADE + 1 漏检（纯漏检演示，ADE 栏空意见）
        {
          id: 'mr5', title: 'docs: 使用说明修正', author: 'chen',
          sourceBranch: 'docs-usage', targetBranch: 'dev',
          additions: 38, deletions: 6, files: 2, createdAt: '09-01 10:15', adeReviewedAt: '09-01 10:16',
          itemsApplied: 11, mrUrl: 'https://gitlab.aicoda.tech/fe/loomweb/-/merge_requests/5',
          status: '待裁决', humanSyncedAt: '09-01 15:40',
          comments: [
            {
              id: 'c1', by: '人工', reviewer: 'shilu', itemId: 'ck-comment-why', level: '建议修改', file: 'docs/usage.md', line: 26,
              snippet: '// 详见第 4 节',
              problem: '示例命令已变但注释仍指旧章节编号，误导新用户。',
              suggestion: '更新指向并核对命令输出。',
              match: '仅人工',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'yigou-app',
    name: 'yigou-app',
    description: '翼构移动应用',
    status: '进行中',
    type: 'dev',
    workspaceMode: 'serial',
    createdAt: '2026-05-18',
    startDate: '2026-05-18',
    endDate: '2026-08-31',
    folderId: 'f-dev',
    sessions: [],
    members: [
      { id: 'm1', name: 'luyu', initial: 'L', role: '后端', permission: '项目负责人', online: true, lastActive: '活跃于 20 分钟前' },
      { id: 'm2', name: 'zhao', initial: 'Z', role: '移动端', online: true, lastActive: '活跃于 5 分钟前' },
      { id: 'm3', name: 'sun', initial: 'S', role: '测试', online: false, lastActive: '活跃于 昨天' },
    ],
    agents: [
      {
        id: 'a1', name: '研发工程师ADE', role: '研发工程师', model: 'GLM-glm-5.3', status: '工作中', currentTask: '支付联调',
        linkedProject: '翼构移动应用', multimodalModel: 'kimi/kimi-k3', collabModel: '',
        knowledgeBases: ['研发规范库', '运维手册'], mcpServices: ['代码仓库 MCP', '数据库 MCP'],
        adeMd: '## 你是谁\n\n你是移动端研发工程师，负责商城与支付模块开发。\n\n## 你能做什么\n\n- 业务功能开发与联调\n- 支付链路问题排查\n- 性能与稳定性优化\n\n## 你应该怎么说话\n\n- 说话简洁\n- 涉及资金链路时格外严谨',
        tools: { gitlab: true, jenkins: true, zentao: false, jira: false, confluence: false, feishu: false, wecom: false },
      },
    ],
    autoJobs: [
      {
        id: 'j1', name: '夜间打包', workflowId: 'wf1', triggerType: '定时', triggerParam: '每天 02:00',
        enabled: true, needApproval: false,
        history: [
          {
            id: 'r5', jobId: 'j1', status: '成功', startedAt: '08-26 02:00', finishedAt: '08-26 02:05', currentStep: 1,
            steps: [
              { id: 'st1', name: '拉取代码', status: '成功', time: '02:00:03' },
              { id: 'st2', name: '打包', status: '成功', time: '02:05:12' },
            ],
            messages: [
              { id: 'm1', role: '系统', text: '运行开始：夜间打包', time: '02:00:01' },
              {
                id: 'm2', role: 'ADE', text: '拉取代码完成。', time: '02:00:03',
                result: {
                  summary: '已同步 origin/main 最新提交，工作区就绪。',
                  files: [{ name: 'logs/fetch.log', url: artifactUrl('logs/fetch.log') }],
                  sessionUrl: sessionUrlOf('r5', 0),
                },
              },
              {
                id: 'm3', role: 'ADE', text: '打包完成，产物已上传。', time: '02:05:12',
                result: {
                  summary: '打包完成，产物 app-release-2.4.1.apk（38.2 MB）已上传至制品库。',
                  files: [
                    { name: 'app-release-2.4.1.apk', url: artifactUrl('app-release-2.4.1.apk') },
                    { name: 'release/manifest.json', url: artifactUrl('release/manifest.json') },
                  ],
                  sessionUrl: sessionUrlOf('r5', 1),
                },
              },
              { id: 'm4', role: '系统', text: '运行成功结束，耗时 5 分 11 秒', time: '02:05:12' },
            ],
          },
        ],
      },
      {
        id: 'j2', name: '崩溃日志聚合', workflowId: 'wf2', triggerType: '定时', triggerParam: '每小时',
        enabled: false, needApproval: false,
        history: [
          {
            id: 'r6', jobId: 'j2', status: '成功', startedAt: '08-24 10:00', finishedAt: '08-24 10:00', currentStep: 0,
            steps: [
              { id: 'st1', name: '聚合', status: '成功', time: '10:00:40' },
            ],
            messages: [
              { id: 'm1', role: '系统', text: '运行开始：崩溃日志聚合', time: '10:00:01' },
              {
                id: 'm2', role: 'ADE', text: '聚合完成，新增 12 条崩溃记录。', time: '10:00:40',
                result: {
                  summary: '聚合完成，新增 12 条崩溃记录（支付模块 8 条、启动 3 条、其他 1 条）。',
                  files: [{ name: 'crash/aggregate-0824.json', url: artifactUrl('crash/aggregate-0824.json') }],
                  sessionUrl: sessionUrlOf('r6', 0),
                },
              },
              { id: 'm3', role: '系统', text: '运行成功结束', time: '10:00:40' },
            ],
          },
        ],
      },
    ],
    knowledge: {
      folders: [
        { id: 'f1', name: '支付' },
      ],
      docs: [
        {
          id: 'd0', title: '目录结构说明', source: '手动', sourceRef: '', folderId: 'f1',
          importedAt: '08-19', updatedAt: '08-19',
          markdown: '# 目录结构说明\n\n## app/\n\n各业务模块。\n\n## gateway/\n\n渠道网关。\n\n## common/\n\n公共能力。',
          content: [
            { heading: 'app/', body: '各业务模块，按 feature 划分。' },
            { heading: 'gateway/', body: '渠道网关，负责渠道路由。' },
            { heading: 'common/', body: '公共能力。' },
          ],
          summary: 'app/ 按业务模块划分，gateway/ 负责渠道路由，common/ 放公共能力。',
          indexState: 'off', chunks: 0,
        },
        {
          id: 'd1', title: '支付链路设计', source: '团队 wiki', sourceRef: 'wiki/yigou/pay', folderId: 'f1',
          importedAt: '08-20', updatedAt: '08-20',
          markdown: '# 支付链路设计\n\n## 收口\n\n统一收银台收口。\n\n## 路由\n\n渠道路由在网关层完成。\n\n## 客户端\n\n客户端不感知渠道差异。',
          content: [
            { heading: '收口', body: '统一收银台收口，所有支付请求先进入收银台再分发。' },
            { heading: '路由', body: '渠道路由在网关层完成，按渠道健康度与费率动态选择。' },
            { heading: '客户端', body: '客户端不感知渠道差异，只对接收银台统一协议。' },
          ],
          summary: '统一收银台收口，渠道路由在网关层完成，客户端不感知渠道差异。',
          indexState: 'indexed', chunks: 36, indexedAt: '08-21 10:30',
        },
      ],
      memories: [
        { id: 'mem1', content: '移动端埋点走声明式配置，避免散落在业务代码中。', source: '会话沉淀', createdAt: '08-16', lifecycle: '活跃', reflectNote: '支付链路关键经验，保持活跃' },
      ],
      memorySettings: { autoCollect: true, collectRules: '重点收集支付、账号安全相关的处理经验，涉及第三方 SDK 的坑需完整记录。', retentionDays: 180, permanent: false, expirePolicy: '仅提醒', autoReflect: true, reflectFrequency: '每天', reflectRules: '支付与账号安全相关记忆保持活跃，已下线渠道的处理经验自动归档。' },
    },
    documents: {
      folders: [
        { id: 'df1', name: '需求' },
      ],
      docs: [
        {
          id: 'dd1', title: '支付需求说明 v2', source: '团队 wiki', sourceRef: 'wiki/yigou/pay-req', folderId: 'df1',
          importedAt: '08-22', updatedAt: '08-22',
          markdown: '# 支付需求说明 v2\n\n## 收银台\n\n统一收银台收口。\n\n## 幂等\n\n回调需幂等。',
          content: [
            { heading: '收银台', body: '所有支付请求统一经收银台收口分发。' },
            { heading: '幂等', body: '支付回调需幂等处理，重试不重复入账。' },
          ],
          summary: '支付 v2：统一收银台收口，回调幂等处理。',
        },
        {
          id: 'dd2', title: '灰度计划', source: '手动', sourceRef: '', folderId: 'df1',
          importedAt: '08-26', updatedAt: '08-26',
          markdown: '# 灰度计划\n\n## 阶段\n\n10% → 50% → 全量。\n\n## 观察\n\n每阶段观察 24 小时。',
          content: [
            { heading: '阶段', body: '10% → 50% → 全量三阶段放量。' },
            { heading: '观察', body: '每阶段观察 24 小时，崩溃率超阈值回滚。' },
          ],
          summary: '灰度三阶段放量，每阶段观察 24 小时。',
        },
      ],
    },
    specs: [
      {
        id: 's1', name: 'README.md', note: '项目说明', updatedAt: '08-18', inPrompt: false,
        markdown: '# yigou-app\n\n翼构移动应用。',
        content: [{ heading: 'yigou-app', body: '翼构移动应用，覆盖商城、支付、消息三大模块。' }],
      },
      {
        id: 's2', name: '发布规范.md', note: '版本发布流程', updatedAt: '08-10', inPrompt: true,
        markdown: '# 发布规范\n\n1. 每周二/四发版\n2. 发版前完成回归',
        content: [{ heading: '流程', body: '1. 每周二/四发版；2. 发版前完成回归；3. 灰度 10% 观察 24 小时。' }],
      },
    ],
    repos: [
      {
        id: 'r1', name: 'yigou-app', type: 'gitlab', branch: 'main',
        mode: 'editable', note: '移动端主仓', syncedAt: '08-31 09:02',
      },
      {
        id: 'r2', name: 'pay-gateway', type: 'svn', branch: 'release/2.4',
        mode: 'readonly', note: '支付网关源码，给 Agent 提供支付链路上下文', syncedAt: '08-27 11:30',
      },
    ],
    security: {
      policy: {
        blockMrOnHigh: true, autoIssue: false, scanScope: '增量',
        scheduledReview: false, schedule: { freq: '每周', time: '08:00', weekday: 2 },
      },
      rules: [
        ...createDefaultSecurity().rules,
        {
          id: 'cr-pay-log', name: '支付报文禁止全量打日志', tag: '信息泄露', severity: '中危',
          description: '支付报文含卡号等敏感字段，禁止全量输出',
          matchType: '关键词', pattern: 'log(payload',
          scope: '后端 *.java,*.py', enabled: true, builtin: false,
        },
      ],
      records: [
        {
          id: 'rec1', trigger: 'MR', scope: 'yigou-app · main', startedAt: '08-30 15:12',
          durationSec: 2.1, scannedFiles: 21, rulesApplied: 11,
          findings: [
            {
              id: 'f1', ruleId: 'sr-deser', severity: '高危', file: 'gateway/pay/callback.py', line: 31,
              snippet: 'data = pickle.loads(raw_body)',
              description: '对回调报文直接反序列化，恶意构造的 payload 可导致任意代码执行。',
              suggestion: '改用 JSON 等安全格式解析，禁止 pickle 处理外部输入。',
              status: '待处理',
            },
          ],
        },
      ],
    },
    codereview: {
      checklist: createDefaultCodeReview().checklist,
      mrs: [
        // yr-mr1 已完成 · 通过：1 双方一致 + 1 仅ADE 已裁决误报
        {
          id: 'yr-mr1', title: 'fix: 支付回调金额校验', author: 'luyu',
          sourceBranch: 'pay-verify', targetBranch: 'main',
          additions: 52, deletions: 9, files: 3, createdAt: '08-28 17:25', adeReviewedAt: '08-28 17:27',
          itemsApplied: 10, mrUrl: 'https://gitlab.aicoda.tech/mobile/yigou-app/-/merge_requests/1',
          status: '已完成', verdict: '通过', concludedAt: '08-29 10:00', humanSyncedAt: '08-28 19:05',
          comments: [
            {
              id: 'c1', by: 'ADE', itemId: 'ck-error', level: '必须修改', file: 'pay/callback/verify.ts', line: 33,
              snippet: 'if (!sign) return',
              problem: '验签失败仅 return，未记录失败流水，对账时无法追溯。',
              suggestion: '落库失败记录并触发告警。',
              match: '双方一致',
            },
            {
              id: 'c2', by: '人工', reviewer: 'zhao', itemId: 'ck-error', level: '必须修改', file: 'pay/callback/verify.ts', line: 33,
              snippet: 'if (!sign) return',
              problem: '验签失败无流水，与 ADE 意见一致。',
              suggestion: '补充失败流水与告警。',
              match: '双方一致',
            },
            {
              id: 'c3', by: 'ADE', itemId: 'ck-module', level: '建议修改', file: 'pay/callback/verify.ts', line: 41,
              snippet: 'import { sendSms } from "@/api/notify"',
              problem: '支付模块直连通知 API，绕过服务层。',
              suggestion: '经 notify service 转发。',
              match: '仅ADE', resolution: '误报', resolvedAt: '08-28 19:12',
            },
          ],
        },
        // yr-mr2 待复审（第二项目复审工作台演示）：初始仅 ADE 意见
        {
          id: 'yr-mr2', title: 'feat: 优惠券核销码', author: 'zhao',
          sourceBranch: 'coupon-code', targetBranch: 'main',
          additions: 118, deletions: 24, files: 6, createdAt: '08-31 09:50', adeReviewedAt: '08-31 09:52',
          itemsApplied: 10, mrUrl: 'https://gitlab.aicoda.tech/mobile/yigou-app/-/merge_requests/2',
          status: '待复审',
          comments: [
            {
              id: 'c1', by: 'ADE', itemId: 'ck-boundary', level: '必须修改', file: 'src/coupon/redeem.ts', line: 22,
              snippet: 'const code = input.trim().toUpperCase()',
              problem: 'input 为空时 trim 后仍为空串，未拦截直接进入核销。',
              suggestion: '前置非空校验并给出提示。',
              match: '双方一致',
            },
            {
              id: 'c3', by: 'ADE', itemId: 'ck-test-cover', level: '建议修改', file: 'src/coupon/redeem.ts', line: 48,
              snippet: 'export function redeem() { /* 无测试 */ }',
              problem: '核销状态机（待用/已用/过期）为新增逻辑，缺少用例。',
              suggestion: '覆盖三态流转与并发核销边界。',
              match: '仅ADE', resolution: null,
            },
          ],
          pendingHumanComments: [
            {
              id: 'c2', by: '人工', reviewer: 'luyu', itemId: 'ck-boundary', level: '必须修改', file: 'src/coupon/redeem.ts', line: 22,
              snippet: 'const code = input.trim().toUpperCase()',
              problem: '空码未拦截，同意加校验。',
              suggestion: '非空 + 格式双重校验。',
              match: '双方一致',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'data-pipeline',
    name: 'data-pipeline',
    description: '数据管道平台',
    status: '规划中',
    type: 'dev',
    workspaceMode: 'serial',
    createdAt: '2026-08-20',
    startDate: '2026-09-01',
    endDate: '2026-12-31',
    folderId: 'f-data',
    sessions: [],
    members: [
      { id: 'm1', name: 'wang', initial: 'W', role: '数据', permission: '项目负责人', online: false, lastActive: '活跃于 2 天前' },
      { id: 'm2', name: 'shilu', initial: 'S', role: '平台', online: true, lastActive: '活跃于 30 分钟前' },
    ],
    agents: [],
    autoJobs: [],
    knowledge: {
      folders: [],
      docs: [],
      memories: [],
      memorySettings: { autoCollect: false, collectRules: '收集数据口径与调度配置的变更记录，忽略一次性脚本调试内容。', retentionDays: 90, permanent: false, expirePolicy: '自动归档', autoReflect: false, reflectFrequency: '每周', reflectRules: '' },
    },
    documents: createEmptyDocLibrary(),
    specs: [
      {
        id: 's1', name: 'README.md', note: '项目说明', updatedAt: '08-20', inPrompt: false,
        markdown: '# data-pipeline\n\n数据管道平台（规划中）。',
        content: [{ heading: 'data-pipeline', body: '数据管道平台，当前处于规划阶段，目标 9 月启动。' }],
      },
    ],
    repos: [],
    security: createDefaultSecurity(),
    codereview: createDefaultCodeReview(),
  },
]
