import { useEffect } from 'react'
import type { InviteData, UserSettings } from '../data/settings'
import AgentSettingsPanel from './settings/AgentSettingsPanel'
import InviteMembersPanel from './settings/InviteMembersPanel'
import FeishuPanel from './settings/FeishuPanel'
import { RobotIcon, UsersIcon, FeishuIcon } from './icons'
import './SettingsPage.css'

/** 设置页左导航项 */
export type SettingsSection = 'agent' | 'invite' | 'feishu'

const NAV_ITEMS: { key: SettingsSection; label: string; icon: (s: number) => React.ReactNode }[] = [
  { key: 'agent', label: 'Agent 设置', icon: (s) => <RobotIcon size={s} /> },
  { key: 'invite', label: '邀请成员', icon: (s) => <UsersIcon size={s} /> },
  { key: 'feishu', label: '飞书授权', icon: (s) => <FeishuIcon size={s} /> },
]

interface SettingsPageProps {
  /** 当前设置分区 */
  section: SettingsSection
  onChangeSection: (s: SettingsSection) => void
  /** 关闭设置页（× / Esc） */
  onClose: () => void
  /** 用户设置数据 */
  settings: UserSettings
  /** 更新用户设置（局部 patch） */
  onUpdateSettings: (updater: (s: UserSettings) => UserSettings) => void
  /** 邀请成员数据 */
  invite: InviteData
  /** 更新邀请成员数据（局部 patch） */
  onUpdateInvite: (updater: (d: InviteData) => InviteData) => void
}

/**
 * 设置页：页头（标题 + × 关闭）+ 左导航（Agent 设置 / 邀请成员）+ 右内容双栏。
 * 数据与写操作全部由 App 注入；面板组件零持久化。
 */
export default function SettingsPage({
  section, onChangeSection, onClose, settings, onUpdateSettings, invite, onUpdateInvite,
}: SettingsPageProps) {
  /** Esc 关闭（无浮层时） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 有弹窗/菜单打开时不响应（FormModal / AdeSettingsModal 自带 Escape，且事件冒泡先到其监听）
      if (document.querySelector('.modal-overlay, .ade-modal-overlay, .user-menu')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="page">
      {/* 页头：标题 + × 关闭 */}
      <div className="settings-page-head">
        <div className="settings-head-row">
          <div>
            <h1 className="page-title">设置</h1>
            <p className="page-subtitle">管理你的 Agent 默认配置与组织成员</p>
          </div>
          <button type="button" className="settings-close" title="关闭设置" aria-label="关闭设置" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="settings-page">
        {/* 左导航 */}
        <nav className="settings-nav">
          <div className="settings-nav-title">设置</div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`settings-nav-item${section === item.key ? ' active' : ''}`}
              onClick={() => onChangeSection(item.key)}
            >
              {item.icon(15)}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* 右内容 */}
        <div className="settings-content">
          {section === 'agent' && <AgentSettingsPanel settings={settings} onUpdateSettings={onUpdateSettings} />}
          {section === 'invite' && <InviteMembersPanel invite={invite} onUpdateInvite={onUpdateInvite} />}
          {section === 'feishu' && <FeishuPanel settings={settings} onUpdateSettings={onUpdateSettings} />}
        </div>
      </div>
    </div>
  )
}
