import { useState } from 'react'
import type { InviteData, PendingInvite } from '../../data/settings'
import { generateInviteLink, isValidEmail, nowStamp, parseEmails } from '../../data/settings'
import { CURRENT_USER, memberColorOf } from '../../data/projects'
import { Section, Row } from '../SettingsRow'
import SegmentedControl from '../SegmentedControl'
import StatusBadge from '../StatusBadge'
import { LinkIcon, MailIcon } from '../icons'

interface InviteMembersPanelProps {
  invite: InviteData
  onUpdateInvite: (updater: (d: InviteData) => InviteData) => void
}

/** 链接有效期选项 */
const EXPIRE_OPTIONS = [1, 7, 30]

type InviteTab = 'link' | 'email'

/**
 * 邀请成员面板：邀请方式分段（链接 / 邮箱）+ 待接受邀请 + 组织成员 + 权限说明。
 * 全部即改即存（无草稿态）；复制用 clipboard API，失败降级文案提示。
 */
export default function InviteMembersPanel({ invite, onUpdateInvite }: InviteMembersPanelProps) {
  const [tab, setTab] = useState<InviteTab>('link')
  /** 邮箱邀请表单 */
  const [emails, setEmails] = useState('')
  const [permission, setPermission] = useState<'管理员' | '成员'>('成员')
  /** 复制按钮状态 */
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  /** 校验提示（空 = 无错误） */
  const [error, setError] = useState('')

  const patch = (p: Partial<InviteData>) => onUpdateInvite((d) => ({ ...d, ...p }))

  /* —— 邀请链接 —— */

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(invite.link)
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
    window.setTimeout(() => setCopied('idle'), 1600)
  }

  const handleResetLink = () => patch({ link: generateInviteLink() })

  /* —— 邮箱邀请 —— */

  const handleSend = () => {
    const list = parseEmails(emails)
    if (list.length === 0) {
      setError('请输入邮箱地址')
      return
    }
    const invalid = list.filter((e) => !isValidEmail(e))
    if (invalid.length > 0) {
      setError(`邮箱格式不正确：${invalid.join('、')}`)
      return
    }
    const memberNames = invite.orgMembers.map((m) => m.name)
    const pendingEmails = invite.pending.map((p) => p.email)
    const exists = list.filter((e) => pendingEmails.includes(e) || memberNames.find((n) => n && e.startsWith(`${n}@`)))
    if (exists.length > 0) {
      setError(`已在成员或待接受列表中：${exists.join('、')}`)
      return
    }
    const stamp = nowStamp()
    const newInvites: PendingInvite[] = list.map((email, i) => ({
      id: `inv${Date.now()}${i}`,
      email,
      permission,
      sentAt: stamp,
      invitedBy: CURRENT_USER.name,
    }))
    onUpdateInvite((d) => ({ ...d, pending: [...newInvites, ...d.pending] }))
    setEmails('')
    setError('')
  }

  /* —— 待接受 / 成员操作 —— */

  const handleResend = (id: string) =>
    onUpdateInvite((d) => ({
      ...d,
      pending: d.pending.map((p) => (p.id === id ? { ...p, sentAt: nowStamp() } : p)),
    }))

  const handleRevoke = (id: string) =>
    onUpdateInvite((d) => ({ ...d, pending: d.pending.filter((p) => p.id !== id) }))

  const handleRemoveMember = (id: string) =>
    onUpdateInvite((d) => ({ ...d, orgMembers: d.orgMembers.filter((m) => m.id !== id) }))

  /* —— 渲染 —— */

  const owners = invite.orgMembers.filter((m) => m.permission === '所有者')
  const isOwner = invite.orgMembers.some((m) => m.name === CURRENT_USER.name && m.permission === '所有者')

  return (
    <div>
      {/* —— 邀请方式 —— */}
      <div className="invite-seg">
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as InviteTab)}
          items={[
            { key: 'link', label: '邀请链接', icon: <LinkIcon size={13} /> },
            { key: 'email', label: '邮箱邀请', icon: <MailIcon size={13} /> },
          ]}
        />
      </div>

      {tab === 'link' ? (
        <Section label="邀请链接">
          <div className="invite-link-row">
            <input className="field-input" value={invite.link} readOnly />
            <button
              type="button"
              className="btn-primary"
              onClick={handleCopy}
              style={{ width: 76, flexShrink: 0 }}
            >
              {copied === 'ok' ? '已复制' : copied === 'fail' ? '复制失败' : '复制'}
            </button>
          </div>
          <div className="invite-link-opts">
            <div className="invite-link-opt">
              <span className="invite-link-opt-label">链接有效期</span>
              <select
                className="field-select"
                value={invite.linkExpireDays}
                onChange={(e) => patch({ linkExpireDays: Number(e.target.value) })}
              >
                {EXPIRE_OPTIONS.map((d) => <option key={d} value={d}>{d} 天</option>)}
              </select>
            </div>
            <div className="invite-link-opt">
              <span className="invite-link-opt-label">加入后权限</span>
              <select
                className="field-select"
                value={invite.linkPermission}
                onChange={(e) => patch({ linkPermission: e.target.value as '管理员' | '成员' })}
              >
                <option value="成员">成员</option>
                <option value="管理员">管理员</option>
              </select>
            </div>
          </div>
          <Row>
            <div className="settings-row-text">
              <span className="settings-row-title">重置邀请链接</span>
              <span className="settings-row-sub">重置后原链接立即失效，已通过该链接加入的成员不受影响</span>
            </div>
            <button type="button" className="text-btn danger" onClick={handleResetLink}>重置链接</button>
          </Row>
        </Section>
      ) : (
        <Section label="邮箱邀请">
          <div className="invite-mail-form">
            <div className="invite-mail-line">
              <input
                className="field-input"
                placeholder="邮箱地址，多个用逗号或空格分隔"
                value={emails}
                onChange={(e) => {
                  setEmails(e.target.value)
                  setError('')
                }}
              />
              <select
                className="field-select"
                value={permission}
                onChange={(e) => setPermission(e.target.value as '管理员' | '成员')}
              >
                <option value="成员">成员</option>
                <option value="管理员">管理员</option>
              </select>
              <button
                type="button"
                className="btn-primary"
                disabled={!emails.trim() || !!error}
                onClick={handleSend}
                style={{ flexShrink: 0 }}
              >
                发送邀请
              </button>
            </div>
            {error ? (
              <p className="invite-form-hint danger">{error}</p>
            ) : (
              <p className="invite-form-hint">发送后对方将收到邮件邀请，接受后自动加入组织并授予所选权限。</p>
            )}
          </div>
        </Section>
      )}

      {/* —— 待接受邀请 —— */}
      <Section label={`待接受邀请（${invite.pending.length}）`}>
        {invite.pending.length === 0 && (
          <Row><span className="settings-row-sub">暂无待接受的邀请</span></Row>
        )}
        {invite.pending.map((p) => (
          <Row key={p.id}>
            <div className="settings-row-main">
              <span className="settings-row-title invite-email">{p.email}</span>
              <span className="settings-row-sub">
                由 {p.invitedBy} 邀请于 {p.sentAt}
              </span>
            </div>
            <div className="settings-row-right">
              <StatusBadge tone={p.permission === '管理员' ? 'info' : 'neutral'}>{p.permission}</StatusBadge>
              <button type="button" className="text-btn" onClick={() => handleResend(p.id)}>重发</button>
              <button type="button" className="text-btn danger" onClick={() => handleRevoke(p.id)}>撤销</button>
            </div>
          </Row>
        ))}
      </Section>

      {/* —— 组织成员 —— */}
      <Section label={`组织成员（${invite.orgMembers.length}）`}>
        {invite.orgMembers.map((m) => {
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
          <b>所有者</b>：拥有全部权限，可管理成员与组织配置（唯一所有者不可移除）；<b>管理员</b>：可邀请与管理成员；<b>成员</b>：可使用项目与 Agent 能力。
        </p>
      </Section>
    </div>
  )
}
