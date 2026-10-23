/** 用户设置页数据模型与 Mock 数据（纯前端，写操作仅本地 state 生效） */

import {
  ADE_LLM_BASES,
  ADE_MULTIMODAL_MODELS,
  ADE_TOOLS,
  CURRENT_USER,
  createDefaultAdeConfig,
  memberColorOf,
  type AdeAgent,
} from './projects'

/* —— Agent 设置（用户级，与项目 ADE 无关） —— */

/** 用户设置：默认 Agent 配置（App 层 state，不持久化） */
export interface UserSettings {
  /** 我的 ADE 列表（结构复用项目 AdeAgent；点行打开 ADE 配置弹窗编辑） */
  myAdes: AdeAgent[]
  /** 默认 ADE id（对应 myAdes 中一项；新会话/新任务默认使用该 ADE） */
  defaultAdeId: string
  /** 默认大模型底座 */
  model: string
  /** 默认多模态模型 */
  multimodalModel: string
  /** 默认协作模型（空 = 未选择） */
  collabModel: string
  /** 默认工具开关（key 见 ADE_TOOLS） */
  tools: Record<string, boolean>
  /** 个人知识库（多选） */
  knowledgeBases: string[]
  /** MCP 服务（多选） */
  mcpServices: string[]
  /** ADE.md 个性化内容（Markdown） */
  adeMd: string
  /** 飞书授权（「文档」子 tab 导入用；设置页「飞书授权」分区配置） */
  feishu: FeishuSettings
}

/* —— 飞书授权（文档导入 OAuth） —— */

/** 飞书应用凭证 + 个人授权状态（Mock：授权状态全局共享） */
export interface FeishuSettings {
  /** 飞书开放平台 App ID（空 = 未配置，导入弹窗引导去设置） */
  appId: string
  /** App Secret（仅本人可见，界面脱敏显示） */
  appSecret: string
  /** 是否已完成个人授权（user_access_token） */
  authorized: boolean
  /** 授权账号（Mock） */
  authorizedAccount: string
  /** 授权时间（Mock 文案） */
  authorizedAt: string
}

/** 飞书凭证是否已配置（App ID + Secret 均非空） */
export const feishuCredReady = (f: FeishuSettings): boolean =>
  f.appId.trim().length > 0 && f.appSecret.trim().length > 0

/* —— 邀请成员（组织级） —— */

/** 组织成员（与项目 Member 结构对齐，去掉项目语义） */
export interface OrgMember {
  id: string
  name: string
  initial: string
  /** 职位：前端/后端/测试/产品… */
  role: string
  /** 组织权限：所有者 / 管理员 / 成员 */
  permission: '所有者' | '管理员' | '成员'
  online: boolean
  lastActive: string
}

/** 待接受邀请 */
export interface PendingInvite {
  id: string
  email: string
  /** 授予权限：管理员 / 成员（所有者不可通过邀请产生） */
  permission: '管理员' | '成员'
  /** 发送时间（YYYY-MM-DD HH:mm） */
  sentAt: string
  /** 邀请人姓名 */
  invitedBy: string
}

/** 邀请成员页数据（App 层 state，不持久化） */
export interface InviteData {
  /** 邀请链接（可重置） */
  link: string
  /** 链接有效期（天） */
  linkExpireDays: number
  /** 链接加入后默认权限 */
  linkPermission: '管理员' | '成员'
  /** 待接受邀请列表 */
  pending: PendingInvite[]
  /** 组织成员列表 */
  orgMembers: OrgMember[]
}

/* —— 工具方法 —— */

/** 邮箱格式校验（宽松规则：非空 + 单 @ + 前后各有合法段） */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/** 解析多邮箱输入（逗号/空格/分号分隔，去空去重） */
export function parseEmails(input: string): string[] {
  const list = input
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean)
  return Array.from(new Set(list))
}

/** 生成 Mock 邀请链接（重置时刷新） */
export function generateInviteLink(): string {
  const seg = () =>
    Math.random().toString(16).slice(2, 6).padEnd(4, '0')
  return `https://loom.aicoda.tech/join/${seg()}-${seg()}`
}

/** 当前时间格式化（YYYY-MM-DD HH:mm，用于邀请发送/重发时间） */
export function nowStamp(): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 成员头像底色（复用项目成员配色池） */
export { memberColorOf }

/* —— 默认数据 —— */

/** 我的 ADE 初值：研发工程师ADE（默认）+ 测试工程师ADE */
function createMyAdes(): AdeAgent[] {
  const base = createDefaultAdeConfig()
  return [
    {
      id: 'ua1',
      name: '研发工程师ADE',
      role: '研发工程师',
      model: ADE_LLM_BASES[0],
      status: '空闲',
      currentTask: '',
      ...base,
      adeMd: '## 你是谁\n\n你是我的研发工程师搭档，负责功能开发与技术方案。\n\n## 你能做什么\n\n- 实现业务组件与模块\n- 排查缺陷并给出修复\n- 输出技术方案与评审意见\n\n## 你应该怎么说话\n\n- 说话简洁\n- 结论先行',
      tools: { ...base.tools, gitlab: true, jenkins: true },
    },
    {
      id: 'ua2',
      name: '测试工程师ADE',
      role: '测试工程师',
      model: ADE_LLM_BASES[1],
      status: '空闲',
      currentTask: '',
      ...base,
      adeMd: '## 你是谁\n\n你是我的测试工程师搭档，负责用例设计与回归验证。\n\n## 你能做什么\n\n- 编写与维护测试用例\n- 执行回归并输出报告\n\n## 你应该怎么说话\n\n- 说话简洁\n- 缺陷描述附带复现步骤',
      tools: { ...base.tools, jenkins: true, zentao: true },
    },
  ]
}

/** 用户设置初值 */
export function createDefaultUserSettings(): UserSettings {
  const myAdes = createMyAdes()
  return {
    myAdes,
    defaultAdeId: myAdes[0].id,
    model: ADE_LLM_BASES[0],
    multimodalModel: ADE_MULTIMODAL_MODELS[0],
    collabModel: '',
    knowledgeBases: ['研发规范库'],
    mcpServices: ['代码仓库 MCP'],
    adeMd: myAdes[0].adeMd,
    tools: { ...myAdes[0].tools },
    feishu: {
      appId: 'cli_a3f8e09b2c61',
      appSecret: 'Kf9sXq2Lm7RtYw4Zp8Nb3Vc6D',
      authorized: false,
      authorizedAccount: CURRENT_USER.name,
      authorizedAt: '',
    },
  }
}

/** 飞书 OAuth 授权 Mock：800ms 授权中后写回已授权态 */
export function feishuAuthorized(account: string): FeishuSettings {
  return {
    appId: '',
    appSecret: '',
    authorized: true,
    authorizedAccount: account,
    authorizedAt: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-'),
  }
}

/** 邀请成员页初值 */
export function createDefaultInviteData(): InviteData {
  return {
    link: generateInviteLink(),
    linkExpireDays: 7,
    linkPermission: '成员',
    pending: [
      {
        id: 'inv1',
        email: 'wang.qi@aicoda.tech',
        permission: '成员',
        sentAt: '2026-10-21 14:30',
        invitedBy: CURRENT_USER.name,
      },
      {
        id: 'inv2',
        email: 'chen.yu@aicoda.tech',
        permission: '管理员',
        sentAt: '2026-10-22 09:12',
        invitedBy: CURRENT_USER.name,
      },
    ],
    orgMembers: [
      { id: 'om1', name: 'shilu', initial: 'S', role: '平台', permission: '所有者', online: true, lastActive: '活跃于 10 分钟前' },
      { id: 'om2', name: 'luyu', initial: 'L', role: '前端', permission: '管理员', online: false, lastActive: '活跃于 1 小时前' },
      { id: 'om3', name: 'wang', initial: 'W', role: '后端', permission: '成员', online: true, lastActive: '活跃于 30 分钟前' },
      { id: 'om4', name: 'chen', initial: 'C', role: '测试', permission: '成员', online: false, lastActive: '活跃于 昨天' },
      { id: 'om5', name: 'zhao', initial: 'Z', role: '产品', permission: '成员', online: false, lastActive: '活跃于 3 天前' },
    ],
  }
}

/** ADE 工具总开关快捷操作：全部开/关（作用于 ADE_TOOLS 全集） */
export function allTools(on: boolean): Record<string, boolean> {
  return Object.fromEntries(ADE_TOOLS.map((t) => [t.id, on]))
}
