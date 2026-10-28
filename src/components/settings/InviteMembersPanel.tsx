import { useCallback, useEffect, useState } from 'react'
import { orgApi, type FeishuContact, type OrgFeishuConfig, type OrgMember, type OrgUser } from '../../lib/orgApi'
import { initialOf } from '../../data/settings'
import { memberColorOf } from '../../data/projects'
import { Section, Row } from '../SettingsRow'
import SegmentedControl from '../SegmentedControl'
import StatusBadge from '../StatusBadge'
import { CorpAuthPane, UserAuthPane } from './FeishuPanel'
import { BuildingIcon, DownloadIcon, PersonIcon } from '../icons'
import '../FormModal.css'
import '../project-detail/DocLibraryView.css'
import './InviteMembersPanel.css'

type AuthTab = 'corp' | 'user'

/**
 * 「成员管理」面板：顶部子 tab（企业授权 / 个人授权）+ 从飞书导入成员 + 组织成员。
 * 数据全部来自后端（org_members / org_settings），无本地 Mock。
 */
export default function InviteMembersPanel() {
  const [tab, setTab] = useState<AuthTab>('corp')

  const [members, setMembers] = useState<OrgMember[]>([])
  const [feishu, setFeishu] = useState<OrgFeishuConfig | null>(null)
  const [user, setUser] = useState<OrgUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  /* —— 导入弹窗状态 —— */
  const [importing, setImporting] = useState(false)
  const [contacts, setContacts] = useState<FeishuContact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactsError, setContactsError] = useState('')
  const [checkedNames, setCheckedNames] = useState<string[]>([])
  const [permission, setPermission] = useState<'管理员' | '成员'>('成员')
  const [importBusy, setImportBusy] = useState(false)

  const loadAll = useCallback(async () => {
    try {
      const [memberRes, config, session] = await Promise.all([
        orgApi.members(),
        orgApi.feishu(),
        orgApi.session(),
      ])
      setMembers(memberRes.members)
      setFeishu(config)
      setUser(session.user)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载成员失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const connected = Boolean(feishu?.connected)
  const memberNames = members.map((m) => m.name)

  /* —— 导入交互 —— */

  const openImport = async () => {
    setImporting(true)
    setCheckedNames([])
    setContacts([])
    setContactsError('')
    setContactsLoading(true)
    try {
      const { contacts: list } = await orgApi.contacts()
      setContacts(list)
    } catch (err) {
      setContactsError(err instanceof Error ? err.message : '拉取飞书通讯录失败')
    } finally {
      setContactsLoading(false)
    }
  }

  const toggleCheck = (name: string) => {
    setCheckedNames((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  /** 全选 / 全不选（仅新联系人；已是成员置灰不可选） */
  const toggleCheckAll = () => {
    const selectable = contacts.filter((c) => !memberNames.includes(c.name)).map((c) => c.name)
    const allOn = selectable.every((name) => checkedNames.includes(name))
    setCheckedNames(allOn ? [] : selectable)
  }

  /** 导入所选：后端批量写入（按姓名去重） */
  const handleImport = async () => {
    if (checkedNames.length === 0 || importBusy) return
    setImportBusy(true)
    setError('')
    try {
      const selected = contacts.filter((c) => checkedNames.includes(c.name))
      await orgApi.importMembers(selected, permission)
      await loadAll()
      setImporting(false)
      setCheckedNames([])
    } catch (err) {
      setContactsError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImportBusy(false)
    }
  }

  /* —— 组织成员操作 —— */

  const handleRemoveMember = async (id: string) => {
    setError('')
    try {
      await orgApi.removeMember(id)
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : '移除成员失败')
    }
  }

  const isOwner = user?.permission === '所有者'
  /** 企业授权：仅管理员（所有者 / 管理员）可见 */
  const canViewCorp = user?.permission === '所有者' || user?.permission === '管理员'
  /** 实际展示的 tab（非管理员强制个人授权） */
  const activeTab: AuthTab = canViewCorp ? tab : 'user'

  const appIdMask = (id: string) => (id ? `${id.slice(0, 8)}…${id.slice(-4)}` : '（未配置）')

  /* —— 未登录兜底（正常由 App 登录页拦截） —— */

  if (!user) {
    return (
      <div className="member-mgmt-panel">
        <Section label="成员管理">
          <Row><span className="settings-row-sub">{loading ? '加载中…' : '请先登录后再管理成员'}</span></Row>
        </Section>
      </div>
    )
  }

  /* —— 渲染 —— */

  return (
    <div className="member-mgmt-panel">
      {/* 顶部子 tab：企业授权（仅管理员）/ 个人授权（页面最顶端） */}
      <div className="mm-tabs">
        <SegmentedControl
          value={activeTab}
          onChange={(v) => setTab(v as AuthTab)}
          items={[
            ...(canViewCorp
              ? [{ key: 'corp', label: '企业授权', icon: <BuildingIcon size={13} /> }]
              : []),
            { key: 'user', label: '个人授权', icon: <PersonIcon size={13} /> },
          ]}
        />
        <span className="mm-tabs-hint">
          {canViewCorp ? '企业授权管成员导入 · 个人授权管文档导入' : '个人授权管文档导入'}
        </span>
      </div>

      {/* 当前登录身份（与成员名单分离） */}
      <Section label="当前登录">
        <Row>
          <div className="settings-row-main">
            <span className="org-member-avatar" style={{ background: memberColorOf(user.name) }}>
              {initialOf(user.name)}
            </span>
            <span className="settings-row-text">
              <span className="settings-row-title">
                {user.name}
                <span className="me-tag">我</span>
              </span>
              <span className="settings-row-sub">登录账号 · {user.permission}</span>
            </span>
          </div>
          <div className="settings-row-right">
            <StatusBadge tone="neutral">{user.permission}</StatusBadge>
          </div>
        </Row>
      </Section>

      {error && (
        <Section label="提示">
          <Row><span className="settings-row-sub">{error}</span></Row>
        </Section>
      )}

      {activeTab === 'user' ? (
        feishu
          ? <UserAuthPane feishu={feishu} onChanged={setFeishu} />
          : <Section label="个人授权"><Row><span className="settings-row-sub">加载中…</span></Row></Section>
      ) : (
        <>
          {feishu
            ? <CorpAuthPane feishu={feishu} onChanged={setFeishu} canEdit={isOwner} />
            : <Section label="应用凭证"><Row><span className="settings-row-sub">加载中…</span></Row></Section>}

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
                disabled={!connected || !isOwner}
                title={
                  !isOwner
                    ? '仅所有者可导入成员'
                    : connected ? '打开通讯录选择成员导入' : '请先完成企业授权（保存应用凭证）'
                }
                onClick={openImport}
              >
                <DownloadIcon size={13} />
                从飞书导入成员
              </button>
            </div>
          </Section>

          {/* 组织成员 */}
          <Section label={`组织成员（${members.length}）`}>
            {loading && (
              <Row><span className="settings-row-sub">加载中…</span></Row>
            )}
            {!loading && members.length === 0 && (
              <Row><span className="settings-row-sub">还没有成员，先从飞书通讯录导入</span></Row>
            )}
            {!loading && members.map((m) => {
              const isMe = m.name === user.name
              return (
                <Row key={m.id}>
                  <div className="settings-row-main">
                    <span className="org-member-avatar" style={{ background: memberColorOf(m.name) }}>
                      {initialOf(m.name)}
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
                      disabled={!isOwner}
                      title={!isOwner ? '仅所有者可移除成员' : '移除成员'}
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

            {/* 企业应用已连接状态条 */}
            <div className="mm-conn-bar">
              <StatusBadge tone="success">已连接</StatusBadge>
              <span className="mm-conn-main">
                企业应用 <span className="mm-conn-id">{appIdMask(feishu?.appId ?? '')}</span> · 权限：读取通讯录
              </span>
              <span className="mm-conn-sub">tenant_access_token</span>
            </div>

            {/* 通讯录多选列表 */}
            <div className="fs-list-wrap">
              <div className="fs-list-head">
                <span>飞书通讯录 · 共 {contacts.length} 人</span>
                <button type="button" className="mm-pick-all" onClick={toggleCheckAll}>全选新人</button>
              </div>
              <div className="fs-list">
                {contactsLoading && (
                  <div className="fs-item">
                    <span className="mm-contact-main">
                      <span className="mm-contact-sub">正在拉取飞书通讯录…</span>
                    </span>
                  </div>
                )}
                {!contactsLoading && contactsError && (
                  <div className="fs-item">
                    <span className="mm-contact-main">
                      <span className="mm-contact-sub">{contactsError}</span>
                    </span>
                  </div>
                )}
                {!contactsLoading && !contactsError && contacts.length === 0 && (
                  <div className="fs-item">
                    <span className="mm-contact-main">
                      <span className="mm-contact-sub">通讯录为空</span>
                    </span>
                  </div>
                )}
                {!contactsLoading && contacts.map((c) => {
                  const isMember = memberNames.includes(c.name)
                  const checked = checkedNames.includes(c.name)
                  return (
                    <div
                      key={c.name}
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
                        onClick={() => toggleCheck(c.name)}
                      >
                        {checked ? '✓' : ''}
                      </button>
                      <button
                        type="button"
                        className="mm-member-label"
                        disabled={isMember}
                        onClick={() => toggleCheck(c.name)}
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
                已选 <b>{checkedNames.length}</b> 人（已是成员不可选）
              </span>
              <span className="modal-actions">
                <button type="button" className="text-btn" onClick={() => setImporting(false)}>取消</button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={checkedNames.length === 0 || importBusy}
                  onClick={handleImport}
                >
                  {importBusy ? '导入中…' : checkedNames.length > 0 ? `导入所选（${checkedNames.length} 人）` : '请勾选要导入的成员'}
                </button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
