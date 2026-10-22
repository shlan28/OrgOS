import React from 'react'

interface IconProps {
  size?: number
  strokeWidth?: number
  className?: string
  color?: string
}

const base = (
  { size = 16, strokeWidth = 1.5, className, color = 'currentColor' }: IconProps,
  children: React.ReactNode,
  viewBox = '0 0 24 24',
) => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox}
    fill="none"
    stroke={color}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
)

/** 侧边栏切换图标（左侧带竖线的矩形） */
export const SidebarIcon = (p: IconProps) =>
  base(p, (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <line x1="9.5" y1="4" x2="9.5" y2="20" />
    </>
  ))

/** 房子图标（Home） */
export const HomeIcon = (p: IconProps) =>
  base(p, (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </>
  ))

/** 代码图标 </> */
export const CodeIcon = (p: IconProps) =>
  base(p, (
    <>
      <polyline points="9 7 4 12 9 17" />
      <polyline points="15 7 20 12 15 17" />
    </>
  ))

/** 铅笔图标（新对话） */
export const PencilIcon = (p: IconProps) =>
  base(p, (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="m14.5 6.5 3 3L10 17l-3.8.8L7 14l7.5-7.5z" />
    </>
  ))

/** 滑块图标（定制） */
export const SlidersIcon = (p: IconProps) =>
  base(p, (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <circle cx="9" cy="7" r="2.2" fill="var(--icon-fill, #fff)" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="2.2" fill="var(--icon-fill, #fff)" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="7.5" cy="17" r="2.2" fill="var(--icon-fill, #fff)" />
    </>
  ))

/** 文件夹图标 */
export const FolderIcon = (p: IconProps) =>
  base(p, (
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-11z" />
  ))

/** 日历图标（项目周期） */
export const CalendarIcon = (p: IconProps) =>
  base(p, (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
      <line x1="8" y1="3" x2="8" y2="6.5" />
      <line x1="16" y1="3" x2="16" y2="6.5" />
    </>
  ))

/** 显示器图标（预览） */
export const MonitorIcon = (p: IconProps) =>
  base(p, (
    <>
      <rect x="3" y="4.5" width="18" height="12.5" rx="1.8" />
      <line x1="9" y1="20.5" x2="15" y2="20.5" />
      <line x1="12" y1="17" x2="12" y2="20.5" />
    </>
  ))

/** 右侧分栏图标 */
export const PanelRightIcon = (p: IconProps) =>
  base(p, (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <line x1="14.5" y1="4" x2="14.5" y2="20" />
    </>
  ))

/** 加号 */
export const PlusIcon = (p: IconProps) =>
  base(p, (
    <>
      <line x1="12" y1="5.5" x2="12" y2="18.5" />
      <line x1="5.5" y1="12" x2="18.5" y2="12" />
    </>
  ))

/** 斜杠 */
export const SlashIcon = (p: IconProps) =>
  base(p, <line x1="15" y1="4.5" x2="9" y2="19.5" />)

/** @ 符号 */
export const AtIcon = (p: IconProps) =>
  base(p, (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M15.6 12v1.4a2.4 2.4 0 0 0 4.8 0V12a8.4 8.4 0 1 0-3.3 6.7" />
    </>
  ))

/** 闪电 */
export const BoltIcon = (p: IconProps) =>
  base(p, <path d="M13 2.5 5 13.5h5.5L11 21.5l8-11h-5.5L13 2.5z" />)

/** 下拉箭头 ⌄ */
export const ChevronDownIcon = (p: IconProps) =>
  base({ strokeWidth: 2, ...p }, <polyline points="6.5 9.5 12 15 17.5 9.5" />)

/** 上箭头（发送） */
export const ArrowUpIcon = (p: IconProps) =>
  base({ strokeWidth: 2.2, ...p }, (
    <>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </>
  ))

/** Git 分支图标 */
export const BranchIcon = (p: IconProps) =>
  base(p, (
    <>
      <circle cx="6.5" cy="5.5" r="2.3" />
      <circle cx="6.5" cy="18.5" r="2.3" />
      <circle cx="17.5" cy="7.5" r="2.3" />
      <line x1="6.5" y1="7.8" x2="6.5" y2="16.2" />
      <path d="M17.5 9.8c0 3.2-3.5 4.4-8 4.7" />
    </>
  ))

/** 对勾 */
export const CheckIcon = (p: IconProps) =>
  base({ strokeWidth: 2, ...p }, <polyline points="5 12.5 10 17.5 19 7" />)

/** 项目中心（2x2 网格） */
export const ProjectsIcon = (p: IconProps) =>
  base(p, (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </>
  ))

/** 左箭头（返回） */
export const ArrowLeftIcon = (p: IconProps) =>
  base(p, (
    <>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="11 6 5 12 11 18" />
    </>
  ))

/** 右箭头（查看） */
export const ChevronRightIcon = (p: IconProps) =>
  base({ strokeWidth: 2, ...p }, <polyline points="9.5 6.5 15 12 9.5 17.5" />)

/** 放大镜（搜索） */
export const SearchIcon = (p: IconProps) =>
  base(p, (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <line x1="15.8" y1="15.8" x2="20.5" y2="20.5" />
    </>
  ))

/** 用户组（项目成员） */
export const UsersIcon = (p: IconProps) =>
  base(p, (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6" />
      <path d="M17.5 14.8c1.8.8 3 2.3 3 4.7" />
    </>
  ))

/** 气泡（会话） */
export const ChatIcon = (p: IconProps) =>
  base(p, (
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  ))

/** 时钟回转（历史会话） */
export const HistoryIcon = (p: IconProps) =>
  base(p, (
    <>
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l4 2" />
    </>
  ))

/** 机器人（项目ADE） */
export const RobotIcon = (p: IconProps) =>
  base(p, (
    <>
      <rect x="4.5" y="8" width="15" height="11" rx="2.5" />
      <line x1="12" y1="4.5" x2="12" y2="8" />
      <circle cx="12" cy="3.5" r="1" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
      <path d="M9.5 16.2h5" />
    </>
  ))

/** 书本（知识记忆） */
export const BookIcon = (p: IconProps) =>
  base(p, (
    <>
      <path d="M4.5 5A1.5 1.5 0 0 1 6 3.5h13.5v15.5H6A1.5 1.5 0 0 0 4.5 20.5V5z" />
      <path d="M4.5 19A1.5 1.5 0 0 1 6 17.5h13.5" />
      <line x1="9" y1="7.5" x2="15.5" y2="7.5" />
      <line x1="9" y1="10.5" x2="14" y2="10.5" />
    </>
  ))

/** 齿轮（自动化任务） */
export const GearIcon = (p: IconProps) =>
  base(p, (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" />
    </>
  ))

/** 文档 */
export const DocIcon = (p: IconProps) =>
  base(p, (
    <>
      <path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20V3.5z" />
      <path d="M14 3.5V8h4" />
      <line x1="9" y1="12.5" x2="15" y2="12.5" />
      <line x1="9" y1="16" x2="13.5" y2="16" />
    </>
  ))

/** 盾牌（安全审查） */
export const ShieldIcon = (p: IconProps) =>
  base(p, (
    <>
      <path d="M12 3 5 5.8v5.4c0 4.4 3 7.6 7 9.3 4-1.7 7-4.9 7-9.3V5.8L12 3z" />
      <polyline points="9 11.8 11.2 14 15 9.8" />
    </>
  ))

/** 锥形瓶（测试） */
export const FlaskIcon = (p: IconProps) =>
  base(p, (
    <>
      <path d="M9.5 3.5h5M10.5 3.5v5.2L5.2 18a1.6 1.6 0 0 0 1.4 2.5h10.8a1.6 1.6 0 0 0 1.4-2.5L13.5 8.7V3.5" />
      <line x1="7.5" y1="15" x2="16.5" y2="15" />
    </>
  ))

/** 柱状图（自动化统计） */
export const ChartIcon = (p: IconProps) =>
  base(p, (
    <>
      <line x1="4" y1="20" x2="20" y2="20" />
      <line x1="7" y1="20" x2="7" y2="12" />
      <line x1="12" y1="20" x2="12" y2="7" />
      <line x1="17" y1="20" x2="17" y2="14.5" />
    </>
  ))

/** 铃铛（通知） */
export const BellIcon = (p: IconProps) =>
  base(p, (
    <>
      <path d="M18 15.5v-5a6 6 0 1 0-12 0v5L4.5 18h15L18 15.5z" />
      <path d="M9.5 18a2.5 2.5 0 0 0 5 0" />
    </>
  ))

/** 检查单（代码审查） */
export const ChecklistIcon = (p: IconProps) =>
  base(p, (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <polyline points="8.2 8.4 9.4 9.6 11.6 7.4" />
      <line x1="13.6" y1="8.5" x2="16.2" y2="8.5" />
      <polyline points="8.2 13.4 9.4 14.6 11.6 12.4" />
      <line x1="13.6" y1="13.5" x2="16.2" y2="13.5" />
      <line x1="8.2" y1="17.2" x2="10.4" y2="17.2" />
    </>
  ))

/** 实心圆点（时间线：当前步骤） */
export const DotIcon = (p: IconProps) =>
  base({ strokeWidth: 0, ...p }, <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />)

/** 空心圆（时间线：待执行步骤） */
export const CircleIcon = (p: IconProps) =>
  base(p, <circle cx="12" cy="12" r="4.5" />)

/** 对勾圆圈（时间线：已完成步骤） */
export const CheckCircleIcon = (p: IconProps) =>
  base(p, (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <polyline points="8.3 12.3 10.8 14.8 15.8 9.5" />
    </>
  ))

/** 问号圆圈（帮助说明，hover 浮层） */
export const HelpIcon = (p: IconProps) =>
  base(p, (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.4 9.2a2.6 2.6 0 0 1 5.1.6c0 1.8-2.5 2.1-2.5 3.7" />
      <circle cx="12" cy="16.8" r="0.5" fill="currentColor" stroke="none" />
    </>
  ))

/** 流程图（工作流 tab + 节点分叉） */
export const WorkflowIcon = (p: IconProps) =>
  base(p, (
    <>
      <rect x="3" y="3.5" width="7" height="5.5" rx="1.5" />
      <rect x="3" y="15" width="7" height="5.5" rx="1.5" />
      <rect x="14" y="9.25" width="7" height="5.5" rx="1.5" />
      <path d="M6.5 9v2.4h7V12" />
      <path d="M6.5 15v-2.4h7V12" />
    </>
  ))

/** 时钟（定时触发节点） */
export const ClockIcon = (p: IconProps) =>
  base(p, (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ))

/** 闪电（事件触发节点） */
export const ZapIcon = (p: IconProps) =>
  base(p, <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />)

/** 下载（拉取代码节点） */
export const DownloadIcon = (p: IconProps) =>
  base(p, (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ))

/** 立方体（安装依赖 / 构建产物节点） */
export const BoxIcon = (p: IconProps) =>
  base(p, (
    <>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </>
  ))

/** 小方块组（单元测试节点） */
export const BlocksIcon = (p: IconProps) =>
  base(p, (
    <>
      <path d="M9 3H5a2 2 0 0 0-2 2v4c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
      <path d="M19 13h-4a2 2 0 0 0-2 2v4c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2z" />
      <path d="M5 13v2a2 2 0 0 0 2 2h2" />
      <path d="M19 11V9a2 2 0 0 0-2-2h-2" />
    </>
  ))

/** 外发（发布节点） */
export const ExternalIcon = (p: IconProps) =>
  base(p, (
    <>
      <path d="M4 14v6h6" />
      <path d="M20 10V4h-6" />
      <path d="M20 4l-7 7" />
      <path d="M4 20l7-7" />
    </>
  ))

/** 麦克风（录音入口） */
export const MicIcon = (p: IconProps) =>
  base(p, (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <line x1="12" y1="18" x2="12" y2="21.5" />
    </>
  ))

/** 方块（停止录音） */
export const StopIcon = (p: IconProps) =>
  base({ strokeWidth: 0, ...p }, <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />)

/** 斜向箭头（跳转放大，占位禁用） */
export const ExpandIcon = (p: IconProps) =>
  base(p, (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M9 6H5.5A1.5 1.5 0 0 0 4 7.5V18.5A1.5 1.5 0 0 0 5.5 20h11A1.5 1.5 0 0 0 18 18.5V15" />
    </>
  ))

/** 多视窗（2×2 四格切分，区别于侧栏项目中心 ProjectsIcon 的厚重网格） */
export const MultiViewIcon = (p: IconProps) =>
  base({ strokeWidth: 1.5, ...p }, (
    <>
      <rect x="3" y="3" width="8" height="7.5" rx="1.6" />
      <rect x="13" y="3" width="8" height="7.5" rx="1.6" />
      <rect x="3" y="12.5" width="8" height="7.5" rx="1.6" />
      <rect x="13" y="12.5" width="8" height="7.5" rx="1.6" />
    </>
  ))

/** 邮件（邀请成员 · 邮箱邀请） */
export const MailIcon = (p: IconProps) =>
  base(p, (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ))

/** 链接（邀请成员 · 邀请链接） */
export const LinkIcon = (p: IconProps) =>
  base(p, (
    <>
      <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.2 1.2" />
      <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.2-1.2" />
    </>
  ))
