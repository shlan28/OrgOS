import { useState } from 'react'
import type { OrgMember, OrgMemberData, UserSettings } from '../../data/settings'
import { FEISHU_CONTACTS, feishuCorpConnected, initialOf } from '../../data/settings'
import { CURRENT_USER, memberColorOf } from '../../data/projects'
import { Section, Row } from '../SettingsRow'
import SegmentedControl from '../SegmentedControl'
import StatusBadge from '../StatusBadge'
import { CorpAuthPane, UserAuthPane } from './FeishuPanel'
import { BuildingIcon, DownloadIcon, PersonIcon } from '../icons'
import '../FormModal.css'
import '../project-detail/DocLibraryView.css'
import './InviteMembersPanel.css'

interface InviteMembersPanelProps {
  /** 用户设置（飞书授权：企业授权 = 成员导入门槛） */
  settings: UserSettings
  onUpdateSettings: (updater: (s: UserSettings) => UserSettings) => void
  /** 组织成员数据 */
  org: OrgMemberData
  onUpdateOrg: (updater: (d: OrgMemberData) => OrgMemberData) => void
}

type AuthTab = 'corp' | 'user'

/**
 * 「成员管理」面板：**顶部子 tab（企业授权 / 个人授权）置于页面最顶端**。
 * - 企业授权 tab：凭证 + 连接状态 + 从飞书导入成员 + 组织成员（成员域全部内容）
 * - 个人授权 tab：纯 OAuth 授权状态（仅此内容，不展示导入/组织成员）
 * 邀请链接 / 邮箱邀请 / 待接受邀请已整体删除（改飞书导入）。
 */
export default function InviteMembersPanel({
  settings, onUpdateSettings, org, onUpdateOrg,
}: InviteMembersPanelProps) {
  /** 顶部子 tab：企业授权（默认，含成员导入与组织成员）/ 个人授权 */
  const [tab, setTab] = useState<AuthTab>('corp')

  /* —— 导入弹窗状态 —— */
  const [importing, setImporting] = useState(false)
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  /** 导入后权限（弹窗底部下拉，默认「成员」） */
  const [permission, setPermission] = useState<'管理员' | '成员'>('成员')
  const [importBusy, setImportBusy] = useState(false)

  const connected = feishuCorpConnected(settings.feishu)
  const memberNames = org.orgMembers.map((m) => m.name)

  /* —— 导入交互 —— */

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => (prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]))
  }

  /** 全选 / 全不选（仅新联系人；已是成员置灰不可选） */
  const toggleCheckAll = () => {
    const selectable = FEISHU_CONTACTS.filter((c) => !memberNames.includes(c.name))
    const ids = selectable.map((c) => c.id)
    const allOn = ids.every((id) => checkedIds.includes(id))
    setCheckedIds(allOn ? [] : ids)
  }

  /** 导入所选（1s Mock）：选中联系人顶插入组织成员（shilu 之后），权限 = 底部下拉 */
  const handleImport = () => {
    if (checkedIds.length === 0 || importBusy) return
    setImportBusy(true)
    window.setTimeout(() => {
      const newMembers: OrgMember[] = FEISHU_CONTACTS
        .filter((c) => checkedIds.includes(c.id))
        .map((c, i) => ({
          id: `om${Date.now()}_${i}`,
          name: c.name,
          initial: initialOf(c.name),
          role: c.title,
          permission,
          online: false,
          lastActive: '活跃于 刚刚',
        }))
      onUpdateOrg((d) => ({
        orgMembers: [d.orgMembers[0], ...newMembers, ...d.orgMembers.slice(1)],
      }))
      setImportBusy(false)
      setImporting(false)
      setCheckedIds([])
    }, 1000)
  }

  /* —— 组织成员操作（保留原行为） —— */

  const handleRemoveMember = (id: string) =>
    onUpdateOrg((d) => ({ orgMembers: d.orgMembers.filter((m) => m.id !== id) }))

  const owners = org.orgMembers.filter((m) => m.permission === '所有者')
  const isOwner = org.orgMembers.some((m) => m.name === CURRENT_USER.name && m.permission === '所有者')

  const appIdMask = (id: string) => (id ? `${id.slice(0, 8)}…${id.slice(-4)}` : '（未配置）')

  /* —— 渲染 —— */

  return (
    <div className="member-mgmt-panel">
      {/* 顶部子 tab：企业授权 / 个人授权（页面最顶端） */}
      <div className="mm-tabs">
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as AuthTab)}
          items={[
            { key: 'corp', label: '企业授权', icon: <BuildingIcon size={13} /> },
            { key: 'user', label: '个人授权', icon: <PersonIcon size={13} /> },
          ]}
        />
        <span className="mm-tabs-hint">企业授权管成员导入 · 个人授权管文档导入</span>
      </div>

      {tab === 'user' ? (
        /* —— 个人授权 tab：仅授权状态（不展示导入成员 / 组织成员） —— */
        <UserAuthPane settings={settings} onUpdateSettings={onUpdateSettings} />
      ) : (
        /* —— 企业授权 tab：授权 + 导入 + 组织成员 —— */
        <>
          <CorpAuthPane settings={settings} onUpdateSettings={onUpdateSettings} />

          {/* 从飞书导入成员（门槛 = 企业授权已连接） */}
          <Section label="从飞书导入成员">
            <div className={`import-guide-row${connected ? '' : ' off'}`}>
              <div className="import-guide-main">
                <span className={`import-guide-icon${connected ? '' : ' warn'}`}>
                  <DownloadIcon size={14} />
                </span>
                <span className="import-guide-text">
                  <span className="import-guide-title">
                    {connected ? '企业应用已连接，可导入通讯录成员' : '请先完成上方企业授权'}
                    {connected && <span className="mm-dot-ok" />}
                  </span>
                  <span className="import-guide-sub">
                    {connected
                      ? '从飞书通讯录选择联系人批量导入组织，导入后可在下方组织成员中管理'
                      : '保存企业应用凭证连接成功后，可从飞书通讯录导入成员'}
                  </span>
                </span>
              </div>
              <button
                type="button"
                className="fs-import-btn"
                disabled={!connected}
                title={connected ? '打开通讯录选择成员导入' : '请先完成企业授权（保存应用凭证）'}
                onClick={() => { setImporting(true); setCheckedIds([]) }}
              >
                <DownloadIcon size={13} />
                从飞书导入成员
              </button>
            </div>
          </Section>

          {/* 组织成员（行为保留：移除 / 唯一所有者保护 / 权限说明） */}
          <Section label={`组织成员（${org.orgMembers.length}）`}>
            {org.orgMembers.map((m) => {
              const isMe = m.name === CURRENT_USER.name
              const ownerLocked = m.permission === '所有者' && owners.length <= 1
              return (
                <Row key={m.id}>
                  <div className="settings-row-main">
                    <span className="org-member-avatar" style={{ background: memberColorOf(m.name) }}>
                      {m.initial}
                    </span>
                    <span className="settings-row-text">
                      <span className="settings-row-title">
                        {m.name}
                        {isMe && <span className="me-tag">我</span>}
                      </span>
                      <span className="settings-row-sub">{m.role} · {m.permission} · {m.lastActive}</span>
                    </span>
                  </div>
                  <div className="settings-row-right">
                    {m.online && <span className="online-dot" title="在线" />}
                    <StatusBadge tone={
                      m.permission === '所有者' ? 'neutral'
                        : m.permission === '管理员' ? 'info' : 'neutral'
                    }>{m.permission}</StatusBadge>
                    <button
                      type="button"
                      className="text-btn danger"
                      disabled={!isOwner || ownerLocked}
                      title={
                        !isOwner
                          ? '仅所有者可移除成员'
                          : ownerLocked
                            ? '唯一所有者不可移除'
                            : '移除成员'
                      }
                      onClick={() => handleRemoveMember(m.id)}
                    >
                      移除
                    </button>
                  </div>
                </Row>
              )
            })}
            <p className="invite-perm-note">
              <b>所有者</b>：拥有全部权限，可管理成员与组织配置（唯一所有者不可移除）；<b>管理员</b>：可导入与管理成员；<b>成员</b>：可使用项目与 Agent 能力。
            </p>
          </Section>
        </>
      )}

      {/* 从飞书导入成员弹窗（单步：企业凭证就绪即打开，无 OAuth 步骤） */}
      {importing && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setImporting(false) }}
        >
          <div className="modal-box fs-import-modal" role="dialog" aria-modal="true" aria-label="从飞书导入成员">
            <div className="modal-head">
              <span className="modal-title">从飞书导入成员</span>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setImporting(false)}>×</button>
            </div>

            {/* 企业应用已连接状态条（替代授权步骤卡） */}
            <div className="mm-conn-bar">
              <StatusBadge tone="success">已连接</StatusBadge>
              <span className="mm-conn-main">
                企业应用 <span className="mm-conn-id">{appIdMask(settings.feishu.appId)}</span> · 权限：读取通讯录
              </span>
              <span className="mm-conn-sub">tenant_access_token</span>
            </div>

            {/* 通讯录多选列表 */}
            <div className="fs-list-wrap">
              <div className="fs-list-head">
                <span>飞书通讯录 · 共 {FEISHU_CONTACTS.length} 人</span>
                <button type="button" className="mm-pick-all" onClick={toggleCheckAll}>全选新人</button>
              </div>
              <div className="fs-list">
                {FEISHU_CONTACTS.map((c) => {
                  const isMember = memberNames.includes(c.name)
                  const checked = checkedIds.includes(c.id)
                  return (
                    <div
                      key={c.id}
                      className={`fs-item${isMember ? ' disabled' : ''}${checked ? ' sel' : ''}`}
                      title={isMember ? '已是组织成员' : undefined}
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        className={`fs-check${checked ? ' on' : ''}`}
                        disabled={isMember}
                        title={isMember ? '已是组织成员' : '勾选导入该成员'}
                        onClick={() => toggleCheck(c.id)}
                      >
                        {checked ? '✓' : ''}
                      </button>
                      <button
                        type="button"
                        className="mm-member-label"
                        disabled={isMember}
                        onClick={() => toggleCheck(c.id)}
                      >
                        <span className="mm-contact-avatar" style={{ background: memberColorOf(c.name) }}>
                          {initialOf(c.name)}
                        </span>
                        <span className="mm-contact-main">
                          <span className="mm-contact-name">{c.name}</span>
                          <span className="mm-contact-sub">{c.department} · {c.title}</span>
                        </span>
                        {isMember && <span className="mm-contact-tag">已是成员</span>}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 底部：权限 + 计数 + 操作 */}
            <div className="mm-import-foot">
              <span className="mm-foot-label">导入后权限</span>
              <select
                className="field-select"
                value={permission}
                onChange={(e) => setPermission(e.target.value as '管理员' | '成员')}
              >
                <option value="成员">成员</option>
                <option value="管理员">管理员</option>
              </select>
              <span className="mm-pick-count">
                已选 <b>{checkedIds.length}</b> 人（已是成员不可选）
              </span>
              <span className="modal-actions">
                <button type="button" className="text-btn" onClick={() => setImporting(false)}>取消</button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={checkedIds.length === 0 || importBusy}
                  onClick={handleImport}
                >
                  {importBusy ? '导入中…' : checkedIds.length > 0 ? `导入所选（${checkedIds.length} 人）` : '请勾选要导入的成员'}
                </button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
