/** 首页多视窗 · Mock 历史会话池（纯前端数据，与项目详情 auto 引擎解耦） */

import type { MessageSender, RunMessage } from '../../data/projects'
import { CURRENT_USER, ADE_SENDER } from '../../data/projects'

/** 历史会话徽标（SessionPicker 列表 / SessionPane 标题栏共用） */
export type PaneBadge = 'Gate' | '运行中' | '手动'

/**
 * 多视窗窗格的会话槽位：
 * - { kind: 'new' } = 新对话（当前会话）
 * - { kind: 'history'; id } = 已装入的历史会话
 * - null = 未分配（空窗格占位）
 */
export type PaneSession =
  | { kind: 'new' }
  | { kind: 'history'; id: string }
  | null

export interface PaneHistorySession {
  id: string
  /** 会话名（窗格标题栏 / 选择器列表） */
  name: string
  /** 徽标类型（映射 tone：Gate=info / 运行中=success / 手动=neutral） */
  badge: PaneBadge
  /** 徽标补充文案（如「运行中 3/5」；标题栏徽标 = badge + badgeText 拼接） */
  badgeText?: string
  /** 副文案（选择器 hover / 语义说明，暂未展示） */
  originText: string
  /** Mock 静态消息（窗格消息流渲染） */
  messages: RunMessage[]
}

/* —— Mock 说话人（与项目域配色对齐） —— */

const LUYU: MessageSender = { name: 'luyu', initial: 'L', color: '#3f8f5f' }
const WANG: MessageSender = { name: 'wang', initial: 'W', color: '#c2752a' }

const msg = (
  id: string, role: RunMessage['role'], sender: MessageSender | undefined, text: string,
): RunMessage => ({ id, role, text, time: '', sender })

/** Mock 历史会话池（按选择器列表顺序） */
export const PANE_HISTORY_SESSIONS: PaneHistorySession[] = [
  {
    id: 'ph-1',
    name: '周报生成 · 汇总统计',
    badge: '运行中',
    badgeText: '运行中 3/5',
    originText: '自动化任务 · 今日 08:00 触发',
    messages: [
      msg('ph-1-m1', '系统', undefined, '—— 周报生成 · 今日 08:00 自动触发 ——'),
      msg('ph-1-m2', 'ADE', ADE_SENDER, '已拉取本周 47 个 MR，按成员分组统计中…'),
      msg('ph-1-m3', '人', CURRENT_USER, '先发草稿到群里。'),
      msg('ph-1-m4', 'ADE', ADE_SENDER, '草稿已生成：looms/周报/第42周.md，请确认。'),
    ],
  },
  {
    id: 'ph-2',
    name: '发布准备 · 版本 v1.4.0',
    badge: 'Gate',
    originText: '自动化任务 · 等待确认',
    messages: [
      msg('ph-2-m1', '系统', undefined, '—— 发布准备 · 等待人工处理 ——'),
      msg('ph-2-m2', 'ADE', ADE_SENDER, '预检完成：3 项检查全部通过，等待发布确认。'),
      msg('ph-2-m3', '人', WANG, '确认后记得同步禅道状态。'),
    ],
  },
  {
    id: 'ph-3',
    name: '规范答疑 · coding-standards',
    badge: '手动',
    originText: '手动会话 · 与 wang、luyu',
    messages: [
      msg('ph-3-m1', '人', LUYU, '@wang 这里的命名规范是驼峰还是下划线？'),
      msg('ph-3-m2', 'ADE', ADE_SENDER, '查了项目规范 coding-standards.md：变量用驼峰，文件名用 kebab-case。'),
      msg('ph-3-m3', '人', WANG, '收到，我改一下。'),
    ],
  },
  {
    id: 'ph-4',
    name: '登录页重构 · 讨论稿',
    badge: '手动',
    originText: '手动会话 · 与 luyu',
    messages: [
      msg('ph-4-m1', '人', CURRENT_USER, '帮我把登录页改成深色模式，先出一版讨论稿。'),
      msg('ph-4-m2', 'ADE', ADE_SENDER, '讨论稿已生成：3 个方案（A 纯黑 / B 深灰 / C 跟随系统），见 dist/login-dark.html。'),
    ],
  },
]

/** 按 id 取历史会话 */
export const paneHistoryOf = (id: string): PaneHistorySession | undefined =>
  PANE_HISTORY_SESSIONS.find((s) => s.id === id)
