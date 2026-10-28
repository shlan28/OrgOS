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
  /** 飞书授权（企业授权管成员导入 / 个人授权管文档导入） */
  feishu: FeishuSettings
}

/* —— 飞书授权（企业授权管成员导入 · 个人授权管文档导入，两者解耦） —— */

/** 飞书应用凭证 + 个人授权状态（Mock：授权状态全局共享）
 * - appId / appSecret = 企业授权（tenant_access_token，读取企业通讯录；「成员管理」导入成员的门槛）
 * - authorized* = 个人授权（user_access_token，OAuth 无需凭证；项目「文档」子 tab 导入文档的门槛）
 */
export interface FeishuSettings {
  /** 企业授权：飞书自建应用 App ID（空 = 未连接，成员导入引导去配置） */
  appId: string
  /** 企业授权：App Secret（仅本人可见，界面脱敏显示） */
  appSecret: string
  /** 个人授权：是否已完成 OAuth 授权（user_access_token） */
  authorized: boolean
  /** 个人授权账号（Mock） */
  authorizedAccount: string
  /** 个人授权时间（Mock 文案） */
  authorizedAt: string
}

/* —— 工具方法 —— */

/** 当前时间格式化（YYYY-MM-DD HH:mm） */
export function nowStamp(): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 成员姓名 → 头像字母（中文取首字、英文取首字母大写） */
export function initialOf(name: string): string {
  const ch = name.trim().charAt(0)
  return /[a-z]/.test(ch) ? ch.toUpperCase() : ch
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
    model: 'deepseek-chat',
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

/** ADE 工具总开关快捷操作：全部开/关（作用于 ADE_TOOLS 全集） */
export function allTools(on: boolean): Record<string, boolean> {
  return Object.fromEntries(ADE_TOOLS.map((t) => [t.id, on]))
}
